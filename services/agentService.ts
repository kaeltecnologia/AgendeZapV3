/**
 * AgendeZap — Agente Conversacional v3
 *
 * Arquitetura: GPT-4o Mini (ou Gemini) conduz a conversa de forma natural.
 * A IA entende tudo que o cliente diz de uma vez, pula etapas automaticamente
 * e gera respostas humanas. O código só gerencia DB e reservas.
 */

import { supabase } from './supabase';
import { db } from './mockDb';
import { AppointmentStatus, BookingSource, BreakPeriod } from '../types';
import { sendProfessionalNotification } from './notificationService';
import { evolutionService } from './evolutionService';
import { nichoConfigs, isBarbearia } from '../config/nichoConfigs';
import { logAIUsage, estimateTokens } from './usageTracker';
import { notifyWaitlistLeads } from './waitlistService';

// =====================================================================
// TYPES
// =====================================================================

interface HistoryEntry {
  role: 'user' | 'bot';
  text: string;
}

interface SessionData {
  clientName?: string;
  serviceId?: string;
  serviceName?: string;
  serviceDuration?: number;
  servicePrice?: number;
  professionalId?: string;
  professionalName?: string;
  date?: string;        // YYYY-MM-DD
  time?: string;        // HH:MM
  availableSlots?: string[];
  pendingConfirm?: boolean;       // summary shown, waiting for yes/no
  pendingCancelReason?: boolean;  // asked for cancel reason, waiting for it
  greetedAt?: string;             // brasiliaDate when last greeted — persisted so Edge Function cold-starts don't duplicate
  // Professional personal-contact flow: set when lead mentions a prof's name without booking intent
  pendingProfContact?: { profId: string; profName: string; profPhone: string };
  // Follow-up context: set when system sends aviso/lembrete/reativacao to this phone
  pendingFollowUpType?: 'aviso' | 'lembrete' | 'reativacao';
  followUpApptTime?: string;         // HH:MM of the booked appointment (for reply context)
  followUpServiceName?: string;      // service name (for reply context)
  followUpProfessionalId?: string;   // professional of the appointment (for reschedule flow)
  followUpServiceId?: string;        // service id (for reschedule duration lookup)
  // Group booking (client + companion)
  groupBooking?: {
    active: boolean;
    companionDesc?: string;            // "minha esposa", "meu filho", etc.
    sameService?: boolean;             // both want same service?
    companionServiceId?: string;
    companionServiceName?: string;
    companionServiceDuration?: number;
    resolvedMode?: 'consecutive' | 'parallel'; // how the 2nd slot was resolved
    companion2ProfId?: string;         // 2nd professional (parallel mode)
    companion2ProfName?: string;
    companion2Time?: string;           // 2nd appointment time (consecutive mode)
  };
  // Reschedule flow: client wants to cancel existing appt and rebook same service/prof/time on new date
  pendingReschedule?: {
    oldApptId: string;
    oldDate: string;     // YYYY-MM-DD (original date — for display + waitlist notify)
    oldTime: string;     // HH:MM
    oldProfName: string;
    isEarlierSlot?: boolean; // true = client wants same day but earlier time (not a date change)
  };
}

interface Session {
  tenantId: string;
  phone: string;
  data: SessionData;
  history: HistoryEntry[];
  updatedAt: number;
}

// =====================================================================
// SESSION STORE
// =====================================================================

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const sessions = new Map<string, Session>();

function sessionKey(tenantId: string, phone: string): string {
  return `${tenantId}::${phone}`;
}

function getSession(tenantId: string, phone: string): Session | null {
  const s = sessions.get(sessionKey(tenantId, phone));
  if (!s) return null;
  if (Date.now() - s.updatedAt > SESSION_TIMEOUT_MS) {
    sessions.delete(sessionKey(tenantId, phone));
    return null;
  }
  return s;
}

function saveSession(session: Session): void {
  session.updatedAt = Date.now();
  if (session.history.length > 20) session.history = session.history.slice(-20);
  sessions.set(sessionKey(session.tenantId, session.phone), session);
  // Persistir no Supabase para sobreviver ao fechamento do browser (fire & forget)
  supabase.from('agent_sessions').upsert({
    tenant_id: session.tenantId,
    phone: session.phone,
    data: session.data,
    history: session.history,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,phone' }).catch(e =>
    console.error('[Agent] Supabase session save error:', e)
  );
}

function clearSession(tenantId: string, phone: string): void {
  sessions.delete(sessionKey(tenantId, phone));
  supabase.from('agent_sessions')
    .delete().eq('tenant_id', tenantId).eq('phone', phone)
    .catch(() => {});
}

// ── Called by followUpService after each successful send ─────────────
// Registers context so the next client reply is handled in the right tone.
export function registerFollowUpContext(
  tenantId: string,
  phone: string,
  type: 'aviso' | 'lembrete' | 'reativacao',
  sentMessage: string,
  ctx?: {
    apptTime?: string;
    serviceName?: string;
    clientName?: string;
    professionalId?: string;
    serviceId?: string;
  }
): void {
  const key = sessionKey(tenantId, phone);
  let sess = sessions.get(key);
  if (!sess) {
    sess = { tenantId, phone, data: {} as SessionData, history: [], updatedAt: Date.now() };
  }
  sess.data.pendingFollowUpType = type;
  if (ctx?.apptTime)        sess.data.followUpApptTime       = ctx.apptTime;
  if (ctx?.serviceName)     sess.data.followUpServiceName    = ctx.serviceName;
  if (ctx?.professionalId)  sess.data.followUpProfessionalId = ctx.professionalId;
  if (ctx?.serviceId)       sess.data.followUpServiceId      = ctx.serviceId;
  if (ctx?.clientName && !sess.data.clientName) sess.data.clientName = ctx.clientName;
  // Add the system message to history so the AI has full context if needed
  sess.history.push({ role: 'bot', text: sentMessage });
  if (sess.history.length > 20) sess.history = sess.history.slice(-20);
  sess.updatedAt = Date.now();
  sessions.set(key, sess);
  // Persist to Supabase so the Edge Function webhook also sees this context
  saveSession(sess as Session);
  console.log(`[Agent] Follow-up context registered: ${type} → ${phone}`);
}

// =====================================================================
// FORMATTING HELPERS
// =====================================================================

function capitalizeName(s: string): string {
  return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function formatSlots(slots: string[]): string {
  return slots.map(s => `• ${s}`).join('\n');
}

// Detect time-of-day preference from normalised text
function getTimePref(norm: string): { from: string; to: string } | null {
  if (norm.includes('inicio da manha') || norm.includes('começo da manha') || norm.includes('cedo'))
    return { from: '07:00', to: '10:00' };
  if (norm.includes('manha'))
    return { from: '07:00', to: '12:00' };
  if (norm.includes('inicio da tarde') || norm.includes('comeco da tarde') || norm.includes('começo da tarde'))
    return { from: '12:00', to: '14:30' };
  if (norm.includes('meio da tarde'))
    return { from: '13:00', to: '16:00' };
  if (norm.includes('final da tarde') || norm.includes('fim da tarde') || norm.includes('fimzinho da tarde'))
    return { from: '16:00', to: '19:00' };
  if (norm.includes('tarde'))
    return { from: '12:00', to: '18:00' };
  if (norm.includes('noite') || norm.includes('a noite'))
    return { from: '18:00', to: '22:00' };
  return null;
}

// Try to extract a time from free text against a list of available slots
function quickTime(text: string, slots: string[]): string | null {
  const t = text.trim();
  const matchColon = t.match(/(\d{1,2})[h:H](\d{2})?/);
  if (matchColon) {
    const label = `${matchColon[1].padStart(2, '0')}:${(matchColon[2] || '00').padStart(2, '0')}`;
    if (slots.includes(label)) return label;
    const nearest = slots.find(s => s >= label);
    if (nearest) return nearest;
  }
  const matchBare = t.match(/\b(1[0-9]|2[0-3]|[7-9])\b/);
  if (matchBare) {
    const label = `${String(parseInt(matchBare[1])).padStart(2, '0')}:00`;
    if (slots.includes(label)) return label;
    const nearest = slots.find(s => s >= label);
    if (nearest) return nearest;
  }
  return null;
}

// =====================================================================
// AVAILABILITY — respects operating hours and break periods
// =====================================================================

async function getAvailableSlots(
  tenantId: string,
  professionalId: string,
  date: string,
  durationMinutes: number,
  settings: any
): Promise<string[]> {
  const dateObj = new Date(date + 'T12:00:00');
  const dayIndex = dateObj.getDay();
  const dayConfig = settings.operatingHours?.[dayIndex];
  if (!dayConfig?.active) return [];

  const [startRange, endRange] = dayConfig.range.split('-');
  const [startH, startM] = startRange.split(':').map(Number);
  const [endH, endM] = endRange.split(':').map(Number);

  const { data: appointments } = await supabase
    .from('appointments')
    .select('inicio, fim')
    .eq('tenant_id', tenantId)
    .eq('professional_id', professionalId)
    .neq('status', AppointmentStatus.CANCELLED) // frontend: 'CANCELLED'
    .neq('status', 'cancelado')                 // legado IA: 'cancelado'
    .gte('inicio', `${date}T00:00:00`)
    .lte('inicio', `${date}T23:59:59`);

  const breaks: BreakPeriod[] = settings.breaks || [];
  // Use Brazil time (UTC-3) for today's date and past-slot filtering
  const nowBrasilia = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayLocal = `${nowBrasilia.getUTCFullYear()}-${pad(nowBrasilia.getUTCMonth() + 1)}-${pad(nowBrasilia.getUTCDate())}`;
  const isToday = date === todayLocal;
  const nowBrasiliaMinutes = nowBrasilia.getUTCHours() * 60 + nowBrasilia.getUTCMinutes();
  const INTERVAL_MIN = 30;
  const slots: string[] = [];

  let cursor = startH * 60 + startM;
  const endCursor = endH * 60 + endM;

  // acceptLastSlot: permite iniciar no horário exato de fechamento
  const loopLimit = dayConfig.acceptLastSlot ? endCursor : endCursor - durationMinutes;
  while (cursor <= loopLimit) {
    const h = Math.floor(cursor / 60);
    const m = cursor % 60;
    const label = `${pad(h)}:${pad(m)}`;
    const slotStart = new Date(`${date}T${label}:00`);
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);
    const slotEndLabel = `${pad(slotEnd.getHours())}:${pad(slotEnd.getMinutes())}`;

    if (isToday && (h * 60 + m) <= nowBrasiliaMinutes) { cursor += INTERVAL_MIN; continue; }

    const BUFFER_MS = 11 * 60 * 1000; // últimos 11 min do procedimento anterior são compartilháveis
    const hasAppConflict = (appointments || []).some((a: any) => {
      const aStart = new Date(a.inicio);
      const aEnd = new Date(a.fim);
      if (!(aStart < slotEnd && aEnd > slotStart)) return false;
      return slotStart.getTime() < aEnd.getTime() - BUFFER_MS;
    });
    if (hasAppConflict) { cursor += INTERVAL_MIN; continue; }

    const hasBreakConflict = breaks.some(brk => {
      if (brk.professionalId && brk.professionalId !== professionalId) return false;
      // Férias: verifica faixa de datas (date → vacationEndDate)
      if ((brk as any).type === 'vacation') {
        const vacStart = brk.date || '';
        const vacEnd = (brk as any).vacationEndDate || brk.date || '';
        return !!vacStart && date >= vacStart && date <= vacEnd;
      }
      const matchDate = !brk.date || brk.date === date;
      const matchDay = brk.dayOfWeek == null || brk.dayOfWeek === dayIndex;
      if (!matchDate || !matchDay) return false;
      return label < brk.endTime && slotEndLabel > brk.startTime;
    });
    if (hasBreakConflict) { cursor += INTERVAL_MIN; continue; }

    slots.push(label);
    cursor += INTERVAL_MIN;
  }

  return slots;
}

// =====================================================================
// AI BRAIN — single call that handles the entire conversation
// =====================================================================

interface BrainOutput {
  reply: string;
  extracted: {
    clientName?: string | null;
    serviceId?: string | null;
    professionalId?: string | null;
    date?: string | null;
    time?: string | null;
    confirmed?: boolean | null;
    cancelled?: boolean | null;
    groupIntent?: boolean | null;       // client wants to book for 2+ people
    sameService?: boolean | null;       // both want the same service
    companionServiceId?: string | null; // companion's service if different
    waitlist?: boolean | null;          // client wants to join waitlist / be called if slot opens
    reschedule?: boolean | null;        // client wants to cancel existing appt and rebook on new date
  };
}

async function callBrain(
  apiKey: string,
  tenantName: string,
  today: string,
  services: Array<{ id: string; name: string; durationMinutes: number; price: number }>,
  professionals: Array<{ id: string; name: string }>,
  history: HistoryEntry[],
  data: SessionData,
  availableSlots?: string[],
  customSystemPrompt?: string,
  shouldGreet?: boolean,
  brasiliaGreeting?: string,
  groupCtx?: string,
  nichoName?: string,
  tenantId?: string,
  phone?: string,
  isAudio?: boolean
): Promise<BrainOutput | null> {

  const svcList = services.map(s =>
    `• ${s.name} (${s.durationMinutes}min, R$${s.price.toFixed(2)}) — ID:"${s.id}"`
  ).join('\n');

  const profList = professionals.length > 0
    ? professionals.map(p => `• ${p.name} — ID:"${p.id}"`).join('\n')
    : '• (apenas um profissional disponível)';

  const known: string[] = [];
  if (data.clientName) known.push(`Nome: ${data.clientName}`);
  if (data.serviceName) known.push(`Serviço: ${data.serviceName}`);
  if (data.professionalName) known.push(`Profissional: ${data.professionalName}`);
  if (data.date) known.push(`Data: ${formatDate(data.date)}`);
  if (data.time) known.push(`Horário: ${data.time}`);
  if (data.pendingReschedule) {
    if (data.pendingReschedule.isEarlierSlot) {
      known.push(`ADIANTAMENTO EM ANDAMENTO: cliente quer horário mais cedo do que ${data.pendingReschedule.oldTime} hoje com ${data.pendingReschedule.oldProfName} — horários disponíveis mais cedo listados abaixo`);
    } else {
      known.push(`REAGENDAMENTO EM ANDAMENTO: cancelar agendamento de ${formatDate(data.pendingReschedule.oldDate)} às ${data.pendingReschedule.oldTime} com ${data.pendingReschedule.oldProfName}`);
      if (!data.date) known.push(`Nova data: ainda não informada — pergunte`);
    }
  }

  const followUpCtx = data.pendingFollowUpType === 'reativacao'
    ? `\n📩 CONTEXTO ESPECIAL — RECUPERAÇÃO DE CLIENTE INATIVO:
• O cliente estava ausente e recebeu uma mensagem de reativação.
• Se a resposta for positiva/afirmativa → Mostre entusiasmo em recebê-lo de volta e IMEDIATAMENTE pergunte quando quer agendar (ex: "Que ótimo ter você de volta! 😊 Quando prefere vir? Temos horários disponíveis essa semana!").
• Se demonstrar interesse em serviço → inicie o fluxo de agendamento diretamente.
• Se negar ou não quiser → despeça-se com simpatia, deixe porta aberta.\n`
    : (data.pendingFollowUpType === 'aviso' || data.pendingFollowUpType === 'lembrete')
    ? `\n📩 CONTEXTO ESPECIAL — ${data.pendingFollowUpType === 'aviso' ? 'CHECK-IN DIÁRIO' : 'LEMBRETE DE AGENDAMENTO'}:
• Cliente tem agendamento${data.followUpApptTime ? ` às ${data.followUpApptTime}` : ''} e respondeu ao lembrete.
• Se confirmar presença → responda com entusiasmo confirmando o horário.
• Se quiser reagendar ou tiver dúvida → ajude imediatamente.
• NÃO inicie novo agendamento a menos que o cliente peça explicitamente.\n`
    : '';

  const slotsSection = availableSlots && availableSlots.length > 0
    ? `\nHORÁRIOS DISPONÍVEIS (use APENAS estes):\n${availableSlots.slice(0, 12).map(s => `• ${s}`).join('\n')}`
    : (data.professionalId && data.date
      ? (data.serviceId
        ? `\n(Horários para esta data ainda não verificados — NÃO sugira horários específicos ainda)`
        : `\n⚠️ SERVIÇO NÃO DEFINIDO — Descubra qual serviço o cliente quer ANTES de buscar horários. Pergunte o serviço agora.`)
      : (data.professionalId && !data.date
        ? `\n⛔ DIA NÃO DEFINIDO — NÃO sugira horários. Pergunte o dia de preferência primeiro.`
        : ''));

  const histStr = history.slice(-10).map(h =>
    `${h.role === 'user' ? 'Cliente' : 'Agente'}: ${h.text}`
  ).join('\n');

  const isFirstMessage = history.filter(h => h.role === 'bot').length === 0;

  const greetSection = shouldGreet
    ? `\n🌅 PRIMEIRA SAUDAÇÃO DO DIA:
• Cumprimente com "${brasiliaGreeting}!" de forma calorosa e apresente o estabelecimento: "${tenantName}".
• Pergunte apenas "Como posso te ajudar?" — nada mais.
• ❌ NÃO liste serviços, profissionais, preços nem horários na saudação inicial.
• ✅ Exemplo exato: "${brasiliaGreeting}! Seja bem-vindo ao ${tenantName} 😊 Como posso te ajudar?"\n`
    : '';

  const groupSection = groupCtx
    ? `\n👥 AGENDAMENTO EM GRUPO:\n${groupCtx}\n`
    : '';

  // ── Nicho-aware sections ─────────────────────────────────────────────
  const nicho = nichoName || 'Barbearia';
  const cfg = nichoConfigs[nicho as keyof typeof nichoConfigs] ?? nichoConfigs['Barbearia'];
  const isBrb = isBarbearia(nicho);

  // Intro line (after tenant name)
  const introLinha = cfg.introLinha;

  // Tom line inside FORMATO OBRIGATÓRIO
  const tomLine = cfg.tomFormatado;

  // Emojis hint
  const emojisHint = cfg.emojisHint;

  // Nicho-specific rules (appended to CASOS ESPECIAIS)
  const nichoRulesSection = (!isBrb && cfg.regrasEspecificas.length > 0)
    ? `\n🏷️ REGRAS DO NICHO (${nicho}):\n${cfg.regrasEspecificas.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n`
    : '';

  // Desistência / mudança de ideia — adapt farewell phrase for non-barbearia
  const farewellLine = isBrb
    ? '• "Fechou meu querido! Até a próxima 😊"'
    : '• Despeça-se com simpatia e deixe a porta aberta para um novo agendamento';

  const audioNote = isAudio
    ? `\n🎵 MENSAGEM POR ÁUDIO: A última mensagem do cliente foi enviada como áudio e transcrita automaticamente. Pode conter pequenas imprecisões de fala — interprete com flexibilidade. Responda normalmente, sem mencionar o áudio.\n`
    : '';

  // ── Sequential flow + professional selection rule ─────────────────────
  const flowSection = `\n📋 FLUXO OBRIGATÓRIO (pule etapas que o cliente já informou — não repita perguntas):
1️⃣ SERVIÇO → 2️⃣ PROFISSIONAL → 3️⃣ DIA → 4️⃣ PERÍODO (manhã/tarde) → 5️⃣ HORÁRIO → 6️⃣ CONFIRMAÇÃO
⛔ REGRAS ABSOLUTAS:
• Se DIA não estiver no CONTEXTO ATUAL → pergunte "Tem algum dia de preferência?" ANTES de qualquer horário
• EXCEÇÃO: se o cliente perguntar sobre horários SEM mencionar dia ("tem horário?", "como estão os horários?", "horário disponível", "tem vaga?") → assuma HOJE e mostre os horários disponíveis de hoje
• Se DIA definido mas PERÍODO não → pergunte "Prefere de manhã ou à tarde?"
• ❌ JAMAIS mencione ou sugira horário específico (ex: "09:00", "15:00") sem ter DIA confirmado no CONTEXTO ATUAL

⚡ QUANDO NÃO HÁ HORÁRIO DISPONÍVEL — protocolo obrigatório (NUNCA apenas diga "que pena"):
1. Tente MESMO DIA: "Esse horário não está disponível, mas hoje ainda tenho [lista de horários do mesmo dia]. Algum serve?"
2. Se cliente recusar todos do mesmo dia (ou não houver mais): sugira o HORÁRIO DESEJADO no próximo dia disponível: "Amanhã às [hora desejada] está disponível. Serve?"
3. Se o horário desejado não tiver no próximo dia: ofereça o horário mais próximo disponível nos próximos dias\n`;

  // ── Behavioral rules covering 30 real-world scenarios ──────────────────
  const behaviorRules = `
⛔ ARMADILHAS — NUNCA FAÇA:
• "Quero cortar amanhã" → NÃO agende sem profissional + horário confirmados
• "Tem horário hoje?" / "Como estão os horários?" / "Horário disponível" / "Tem vaga?" SEM dia específico = assuma HOJE → mostre horários disponíveis de hoje + "Quer agendar? Qual serviço?"
• "De manhã" / "de tarde" / "próxima semana" = tempo VAGO → mostre as opções daquele período/semana, nunca escolha por conta própria
• "Mesmo de sempre" → sem memória histórica → "Pode confirmar o serviço e horário preferido?"
• "Pode ser com o [prof]?" com SERVIÇO já no contexto → NÃO pergunte "sobre o que você quer falar" → confirme direto: "Ótimo, com o [prof]! Qual dia prefere?"
• Profissional já definido no contexto → NÃO pergunte de novo sobre o profissional

🚫 CANCELAR — protocolo obrigatório (nesta ordem):
1. Localizar: "Encontrei seu agendamento: [data/hora/serviço]."
2. Confirmar: "Confirmo o cancelamento?"
3. Só então: "cancelled":true
• "Não vou poder ir amanhã" / "não consigo ir" = intenção implícita → perguntar: "Quer que eu cancele seu agendamento de amanhã às [hora]?"
• Cliente com múltiplos agendamentos futuros → listar todos e perguntar qual(is) cancelar
• Linguagem informal ("desisti", "tira meu nome", "me tira da agenda de sexta") → identificar agendamento + confirmar antes de cancelar

🔄 REAGENDAR — protocolo obrigatório:
• "Mais cedo" / "mais tarde" = vago → clarificar: "Mais cedo no mesmo dia ou em outra data?"
• "Semana que vem mesmo horário" → VERIFICAR disponibilidade ANTES de confirmar (não assume que tem vaga)
• "Atrasou" / "Chego X min depois" / "Vou atrasar" / "Estou atrasado" = AVISO DE ATRASO, NÃO reagendamento → responder: "Entendido! Vou avisar ao [profissional]. Te esperamos! 😊" — NÃO altere data/hora/cancelled
• "Trocar de barbeiro, manter horário" → verificar disponibilidade do novo prof naquele slot ANTES de confirmar
• "Primeiro horário do [prof]" = duas ações → cancelar atual + agendar novo → confirmar as duas juntas: "O primeiro horário do [prof] é [data/hora]. Confirmo o reagendamento e cancelo o seu atual ([data/hora])?"

📋 CONSULTAS — responder a pergunta ≠ agendar automaticamente:
• "Vocês trabalham domingo?" / "qual o horário de vocês?" → informar funcionamento; só depois oferecer agendar
• "Quanto tempo demora um procedimento?" → informar duração; só depois oferecer agendar
• "O [prof] tá disponível essa semana?" / "tá de folga?" → informar disponibilidade do profissional; só depois oferecer agendar
• "Tem vaga hoje?" / "Como estão os horários?" / "Tem horário?" SEM dia → mostre os horários disponíveis de HOJE + "Quer agendar? Qual serviço?" — NÃO crie agendamento ainda
• "Para hoje" / "quero pra hoje" no meio do fluxo → mude o DIA para hoje e consulte os horários disponíveis

🗣️ LINGUAGEM COLOQUIAL DE SERVIÇOS — interprete termos informais como referência ao serviço correspondente:
• "cabeça" / "cortar a cabeça" / "cabecinha" = CORTE DE CABELO (não literal) → identifique o serviço de corte na lista
• "barba" / "fazer a barba" / "tirar a barba" = serviço de barba
• "bigode" = serviço de bigode ou barba
• "sobrancelha" / "sombrancelha" = design de sobrancelha
• "franja" = corte de franja ou corte
• "ligar" / "passar o pente" / "zerar" / "na máquina" = corte de cabelo
• Cliente menciona parte do corpo informalmente → mapeie para o serviço mais próximo da lista

🔀 AMBÍGUO — não assuma, pergunte com contexto:
• Saudação simples ("oi", "tudo bem?", "boa tarde") → cumprimentar + "Como posso te ajudar?"
• "Acabei de sair do trabalho" = intenção implícita de horário tardio → "Que horas você chega? Nosso último horário hoje é às [hora]."
• "Fala com minha esposa, ela que organiza" → "Claro! Pode passar o contato dela ou ela pode me chamar diretamente por aqui."
• Mensagem com dois pedidos ("me manda o endereço e já agendo") → atender os dois na mesma resposta\n`;

  const profSelectionRule = professionals.length > 1 && !data.professionalId
    ? `\n⚠️ PROFISSIONAL — ainda não definido. Profissionais: ${professionals.map(p => `${p.name} (ID:"${p.id}")`).join(', ')}
• Se o cliente mencionou um nome NESTA MENSAGEM → extraia o professionalId correspondente e confirme a escolha (ex: "Ótimo, com o ${professionals[0].name}! Tem algum dia de preferência?").
• Se o cliente disser "qualquer um", "tanto faz", "quem estiver disponível", "pode ser qualquer", "quem tiver" ou similar → ESCOLHA AUTOMATICAMENTE o primeiro profissional da lista. Diga: "Pode ser com ${professionals[0]?.name} então! 😊 Tem algum dia de preferência?" e defina o professionalId correspondente.
• Se o cliente NÃO mencionou nenhum profissional e NÃO disse "qualquer" → pergunte: "Com qual profissional prefere? Temos: ${professionals.map(p => p.name).join(', ')}"
• NUNCA repita a pergunta se o cliente já disse um nome ou já aceitou qualquer profissional.
• Se o cliente questionar uma escolha sua → "Desculpe! Com qual prefere? ${professionals.map(p => p.name).join(' ou ')}?" e retorne professionalId: null.\n`
    : '';

  const prompt = `Você é o ATENDENTE DE WHATSAPP de "${tenantName}". Hoje é ${today}.
${introLinha}
${customSystemPrompt ? `\n--- REGRAS DO ESTABELECIMENTO ---\n${customSystemPrompt}\n---\n` : ''}${followUpCtx}${audioNote}${greetSection}${groupSection}
SERVIÇOS: ${svcList}
PROFISSIONAIS: ${profList}${slotsSection}

CONTEXTO ATUAL: ${known.length > 0 ? known.join(' | ') : 'nenhuma informação coletada ainda'}
${data.pendingConfirm ? '\n⚠️ RESUMO JÁ MOSTRADO — se cliente afirmar ("sim","ok","pode","beleza","bora","fechou","isso","confirma") → "confirmed":true OBRIGATORIAMENTE.' : ''}

HISTÓRICO (mais recente no final):
${histStr}
${flowSection}${profSelectionRule}${behaviorRules}
════════════════════════════════
COMO RESPONDER — APRENDA COM HUMANOS:
════════════════════════════════

📏 FORMATO OBRIGATÓRIO:
• Máximo 2-3 linhas por mensagem
${tomLine}
• Emojis: use APENAS na saudação inicial ou ao confirmar agendamento. Na grande maioria das mensagens NÃO use emoji.
• SEMPRE termine com pergunta curta ou confirmação

${isFirstMessage && !shouldGreet ? '📥 PRIMEIRA MENSAGEM: processe tudo que o cliente já informou (nome, serviço, profissional, etc.) sem perguntar de novo.\n' : ''}
📅 AO OFERECER HORÁRIO (somente após profissional já definido no CONTEXTO ATUAL):
• ❌ ERRADO: "Temos disponível às 15:00"
• ✅ CERTO: "Com o [nome do profissional já escolhido] às 15:00 pode ser? 😊"
• Sempre: PROFISSIONAL (o que o cliente escolheu) + HORÁRIO + "pode ser?" ou "serve?"

❌ QUANDO O HORÁRIO PEDIDO NÃO ESTÁ DISPONÍVEL:
1. Explique brevemente por quê: "Após as 18h não teria essa semana"
2. Ofereça o mais próximo: "Mas teria amanhã às 17:00"
3. Pergunte: "Serve??" — NUNCA assuma aceitação

✅ QUANDO CLIENTE CONFIRMA (sim/ok/pode/beleza/bora/isso):
• Defina "confirmed":true — o sistema gravará automaticamente
• Responda apenas: "Agendado! Te esperamos 😊" ou "Fechou! 👍"

🔄 QUANDO CLIENTE MUDA DE IDEIA OU DESISTE:
${farewellLine}
• Sem drama, aceite naturalmente

💡 CASOS ESPECIAIS:
• 2 serviços juntos → verifique se existe combo no cardápio, senão use o de maior duração
• 2 pessoas → siga as instruções do bloco 👥 AGENDAMENTO EM GRUPO acima
• 2 profissionais opcionais (cliente diz EXPLICITAMENTE "Matheus ou Felipe") → somente neste caso escolha o que tiver horário disponível
• Preço perguntado → informe direto: "O serviço está R$40,00"
• Agenda cheia → "Essa semana tá cheio, mas semana que vem teria. Vamos agendar?"
• Lista de espera: se cliente pedir "se alguém cancelar me avisa", "me manda se abrir um horário antes", "lista de espera", "se tiver desistência" → responda que anotou e que irá avisar caso abra horário; defina waitlist:true no JSON.
• Reagendamento: se CONTEXTO ATUAL tiver "REAGENDAMENTO EM ANDAMENTO":
  - Nova data JÁ no contexto → mostre resumo: "Vou cancelar seu agendamento de [data_antiga] às [hora] com [prof] e marcar para [nova_data] às [hora]. Confirma?" → aguarde confirmação
  - Nova data AUSENTE → pergunte: "Para qual data você quer remarcar?" (sem alterar serviceId/professionalId/time)
  - Após confirmação do cliente → defina confirmed:true (sistema cancelará o antigo e criará o novo automaticamente)
• Adiantamento (horário mais cedo): se CONTEXTO ATUAL tiver "ADIANTAMENTO EM ANDAMENTO":
  - Ofereça os horários disponíveis mais cedo: "Tem sim! Teria às [X] ou [Y]. Qual você prefere?"
  - Se cliente escolher um horário → extraia o time no JSON → defina confirmed:true
  - Se cliente não quiser / preferir manter o original → responda "Tudo bem! Mantenho o das [hora_original] então. Te esperamos! 😊" e defina confirmed:false
${nichoRulesSection}
════════════════════════════════
EXTRAÇÃO DE DADOS:
════════════════════════════════
• Horários em texto: "nove horas"→"09:00", "dez da manhã"→"10:00", "três da tarde"→"15:00", "meio dia"→"12:00"
• NUNCA repita perguntas sobre info já coletada no CONTEXTO ATUAL
• Use horários SOMENTE da lista disponível — nunca invente
• groupIntent: true se cliente mencionou agendar para mais de uma pessoa
• sameService: true/false se souber se as pessoas vão fazer o mesmo procedimento
• companionServiceId: ID do serviço do acompanhante (quando diferente do cliente)
• waitlist: true se cliente pediu para entrar em lista de espera / ser avisado se alguém cancelar / "me manda se abrir um horário antes" / "se der um horário vago me chama"
• reschedule: true se cliente disse que quer reagendar / remarcar horário JÁ existente ("tenho horário mas não vou conseguir ir", "preciso mudar meu horário", "não consigo chegar a tempo, quero remarcar", "reagendar meu horário")

RESPONDA APENAS COM JSON VÁLIDO (sem markdown, sem \`\`\`):
{"reply":"...","extracted":{"clientName":null,"serviceId":null,"professionalId":null,"date":null,"time":null,"confirmed":null,"cancelled":null,"groupIntent":null,"sameService":null,"companionServiceId":null,"waitlist":null,"reschedule":null}}`;

  try {
    if (apiKey.startsWith('sk-')) {
      // OpenAI GPT-4o Mini
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Você responde APENAS com JSON válido conforme solicitado. Nenhum texto fora do JSON.' },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' }
        })
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        console.error('[callBrain] OpenAI error:', res.status, err.substring(0, 300));
        return null;
      }
      const d = await res.json();
      const result = JSON.parse(d.choices?.[0]?.message?.content || 'null') as BrainOutput;
      // ── Token tracking ──────────────────────────────────────────────
      if (tenantId) {
        logAIUsage({
          tenant_id: tenantId,
          phone_number: phone,
          input_tokens:  d.usage?.prompt_tokens     ?? estimateTokens(prompt),
          output_tokens: d.usage?.completion_tokens ?? estimateTokens(result?.reply ?? ''),
          model: 'gpt-4o-mini',
          success: !!result,
        }).catch(() => {});
      }
      return result;

    } else {
      // Gemini REST API
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        console.error('[callBrain] Gemini error:', res.status, err.substring(0, 300));
        return null;
      }
      const d = await res.json();
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text || 'null';
      const result = JSON.parse(text) as BrainOutput;
      // ── Token tracking ──────────────────────────────────────────────
      if (tenantId) {
        const usage = d.usageMetadata;
        logAIUsage({
          tenant_id: tenantId,
          phone_number: phone,
          input_tokens:  usage?.promptTokenCount     ?? estimateTokens(prompt),
          output_tokens: usage?.candidatesTokenCount ?? estimateTokens(result?.reply ?? ''),
          model: 'gemini-2.0-flash',
          success: !!result,
        }).catch(() => {});
      }
      return result;
    }
  } catch (e: any) {
    console.error('[callBrain] Parse/network error:', e.message);
    return null;
  }
}

// =====================================================================
// PROFESSIONAL NAME MATCHER — TypeScript layer, more reliable than LLM extraction
// =====================================================================

/**
 * Tries to find a professional mentioned by name in the user's message.
 * Normalizes accents and is case-insensitive. Tries full name first, then first name.
 */
function matchProfessionalName(
  text: string,
  professionals: Array<{ id: string; name: string }>
): { id: string; name: string } | null {
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim();

  const normText = norm(text);

  // Full name match
  for (const p of professionals) {
    if (normText.includes(norm(p.name))) return p;
  }
  // First name match (min 3 chars, word boundary)
  for (const p of professionals) {
    const firstName = norm(p.name).split(' ')[0];
    if (firstName.length >= 3 && new RegExp(`\\b${firstName}\\b`).test(normText)) return p;
  }
  // Nickname/abbreviation: any word (4+ chars) in the message is a substring of a name part
  // e.g. "Lipe" inside "Felipe", "Beto" inside "Roberto"
  for (const p of professionals) {
    const nameParts = norm(p.name).split(' ');
    for (const word of normText.split(/\s+/).filter(w => w.length >= 4)) {
      if (nameParts.some(part => part.includes(word))) return p;
    }
  }
  return null;
}

// =====================================================================
// BRASÍLIA GREETING — time-aware, once per day per phone
// =====================================================================

// Tracks which phones were greeted today (Brasília time). Lives for the browser session.
const _greetedToday = new Map<string, string>(); // "tenantId::phone" → "YYYY-MM-DD"

function getBrasiliaGreeting(): { greeting: string; dateStr: string } {
  // Brasília = UTC-3
  const b = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const h = b.getUTCHours();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    greeting: h < 12 ? 'bom dia' : h < 18 ? 'boa tarde' : 'boa noite',
    dateStr: `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())}`,
  };
}

// =====================================================================
// GROUP BOOKING HELPERS
// =====================================================================

/** Returns the group booking prompt context based on current session state. */
function buildGroupCtx(data: SessionData): string {
  const gb = data.groupBooking;
  if (!gb?.active) return '';

  const lines: string[] = [`Cliente quer agendar para si e para ${gb.companionDesc || 'um acompanhante'}.`];

  if (!data.serviceId) {
    lines.push('O cliente pode já ter mencionado o serviço nesta mensagem — EXTRAIA o serviceId do texto ANTES de perguntar. Só pergunte "Qual serviço você quer?" se não foi possível extrair. Não pergunte sobre o acompanhante antes de ter o serviço do cliente definido.');
  } else if (gb.sameService === undefined) {
    lines.push(`Serviço do CLIENTE já definido: "${data.serviceName}". PRÓXIMA PERGUNTA OBRIGATÓRIA: "O acompanhante vai fazer ${data.serviceName} também ou outro serviço?" — NÃO pule esta etapa, NÃO pergunte profissional nem dia ainda.`);
  } else if (!gb.companionServiceId) {
    lines.push(`PRÓXIMA PERGUNTA OBRIGATÓRIA: Qual serviço o acompanhante vai fazer? Opções: ${data.serviceName} ou outro? Liste os serviços disponíveis.`);
  } else if (gb.resolvedMode === 'consecutive' && gb.companion2Time) {
    lines.push(`SOLUÇÃO ENCONTRADA: mesmo profissional (${data.professionalName}) em horários consecutivos — pessoa 1 às ${data.time}, acompanhante às ${gb.companion2Time}. Apresente ao cliente e peça confirmação.`);
  } else if (gb.resolvedMode === 'parallel' && gb.companion2ProfName) {
    lines.push(`SOLUÇÃO ENCONTRADA: dois profissionais no mesmo horário — ${data.professionalName} às ${data.time} (cliente) e ${gb.companion2ProfName} às ${data.time} (acompanhante). Apresente ao cliente e peça confirmação.`);
  } else if (data.time && !gb.resolvedMode) {
    lines.push(`PROBLEMA: não há dois horários disponíveis neste horário/dia. Explique com simpatia e sugira outro horário ou outro dia. Ou, se tiver outro profissional disponível no mesmo horário, proponha a divisão ("Podemos marcar você com ${data.professionalName} e o(a) acompanhante com outro profissional às ${data.time}, pode ser?").`);
  } else {
    lines.push('Colete profissional + data + horário normalmente. O sistema resolverá o segundo horário automaticamente após você coletar esses dados.');
  }

  return lines.join(' ');
}

/** Tries to resolve the companion's slot (consecutive or parallel). */
async function resolveGroupBooking(
  tenantId: string,
  data: SessionData,
  allProfessionals: Array<{ id: string; name: string }>,
): Promise<NonNullable<SessionData['groupBooking']>> {
  const gb = data.groupBooking!;
  const duration1 = data.serviceDuration || 30;
  const duration2 = gb.companionServiceDuration || duration1;
  const date = data.date!;
  const time = data.time!;
  const profId = data.professionalId!;

  const pad = (n: number) => String(n).padStart(2, '0');
  const addMinutesToTime = (t: string, min: number): string => {
    const [h, m] = t.split(':').map(Number);
    const total = h * 60 + m + min;
    return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
  };

  const time2 = addMinutesToTime(time, duration1);

  // Try consecutive: same professional, slot right after person 1
  const { available: canConsec } = await db.isSlotAvailable(
    tenantId, profId, new Date(`${date}T${time2}:00`), duration2
  );
  if (canConsec) {
    console.log(`[Group] Consecutive resolved: ${time} + ${time2}`);
    return { ...gb, resolvedMode: 'consecutive', companion2Time: time2 };
  }

  // Try parallel: another professional free at the same time
  const others = allProfessionals.filter(p => p.id !== profId);
  for (const op of others) {
    const { available: canParallel } = await db.isSlotAvailable(
      tenantId, op.id, new Date(`${date}T${time}:00`), duration2
    );
    if (canParallel) {
      console.log(`[Group] Parallel resolved: ${data.professionalName} + ${op.name} at ${time}`);
      return { ...gb, resolvedMode: 'parallel', companion2ProfId: op.id, companion2ProfName: op.name };
    }
  }

  console.log(`[Group] No resolution found for ${date} ${time}`);
  return gb; // resolvedMode stays undefined → prompt will explain the issue
}

// =====================================================================
// DEDUPLICATION — two-layer system
// =====================================================================

const _recentHandled = new Map<string, number>();

function makeFingerprint(tenantId: string, phone: string, text: string): string {
  return `${tenantId}::${phone}::${text.trim().slice(0, 120)}`;
}

function isLocalDuplicate(fp: string): boolean {
  const now = Date.now();
  const last = _recentHandled.get(fp);
  if (last !== undefined && now - last < 60_000) return true;
  _recentHandled.set(fp, now);
  for (const [k, t] of _recentHandled) {
    if (now - t > 120_000) _recentHandled.delete(k);
  }
  return false;
}

// =====================================================================
// MAIN HANDLER
// =====================================================================

export async function handleMessage(
  tenant: any,
  phone: string,
  messageText: string,
  pushName?: string,
  options?: { isAudio?: boolean }
): Promise<string | null> {
  const tenantId: string = tenant.id;
  const tenantName: string = tenant.nome || tenant.name || 'Barbearia';
  const geminiKey: string = tenant.gemini_api_key || '';

  const text = messageText.trim();
  if (!text) return null;

  const lowerText = text.toLowerCase();
  const isCancellation = ['cancelar', 'cancela', 'cancele', 'cancelamento'].some(k => lowerText.includes(k));
  const isReset = ['sair', 'reiniciar', 'recomeçar', 'recomecar', 'esquece', 'esquecer', 'restart', 'voltar ao início', 'voltar ao inicio'].some(k => lowerText.includes(k));

  // ─── Check if user is providing their cancel reason (2nd step) ─────
  const preSession = getSession(tenantId, phone);
  if (preSession?.data?.pendingCancelReason) {
    const fp0 = makeFingerprint(tenantId, phone, text);
    if (isLocalDuplicate(fp0)) return null;
    clearSession(tenantId, phone);
    try {
      const { data: customer } = await supabase
        .from('customers').select('id')
        .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
      if (customer) {
        const now0 = new Date();
        const p0 = (n: number) => String(n).padStart(2, '0');
        const nowLocal = `${now0.getFullYear()}-${p0(now0.getMonth()+1)}-${p0(now0.getDate())}T${p0(now0.getHours())}:${p0(now0.getMinutes())}:${p0(now0.getSeconds())}`;
        const { data: appts } = await supabase.from('appointments')
          .select('id, inicio').eq('tenant_id', tenantId).eq('customer_id', customer.id)
          .eq('status', AppointmentStatus.CONFIRMED).gte('inicio', nowLocal)
          .order('inicio', { ascending: true }).limit(1);
        if (appts && appts.length > 0) {
          await supabase.from('appointments').update({ status: AppointmentStatus.CANCELLED }).eq('id', appts[0].id);
          notifyWaitlistLeads(tenantId, { date: (appts[0].inicio as string).substring(0, 10) }).catch(console.error);
          const dateFormatted = new Date((appts[0].inicio as string).substring(0,10) + 'T12:00:00')
            .toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
          return `✅ Agendamento de *${dateFormatted}* cancelado com sucesso.\n\nMotivo registrado. Obrigado pelo feedback! Até a próxima. 😊`;
        }
      }
    } catch (e) { console.error('[Agent] Cancel-reason error:', e); }
    return `Cancelamento registrado! Obrigado por nos avisar. Quando precisar, estamos aqui. 😊`;
  }

  // ─── Reset — clears session immediately ────────────────────────────
  if (isReset) {
    clearSession(tenantId, phone);
    return `Tudo bem! Quando quiser agendar, é só me chamar. 😊`;
  }

  // ─── Cancellation — asks for reason first ──────────────────────────
  if (isCancellation) {
    const fp0 = makeFingerprint(tenantId, phone, text);
    if (isLocalDuplicate(fp0)) return null;
    const sess = preSession || { tenantId, phone, data: {} as SessionData, history: [], updatedAt: Date.now() };
    sess.data.pendingCancelReason = true;
    saveSession(sess as Session);
    return `Que pena que precisou cancelar! 😕\n\nPode nos contar o motivo? Isso nos ajuda a melhorar o atendimento. 🙏`;
  }

  // ─── Follow-up context reply ─────────────────────────────────────────
  // When the system (followUpService) sends aviso/lembrete/reativacao, it registers
  // context in the session. The next reply from that phone is handled here so the AI
  // doesn't treat it as a new booking attempt.
  if (preSession?.data?.pendingFollowUpType) {
    const fType = preSession.data.pendingFollowUpType;
    const norm  = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const wds   = norm.split(/\s+/);

    const AFFIRM = [
      'sim', 'ok', 'pode', 'certo', 'fechado', 'confirmado', 'confirmar', 'quero',
      'bora', 'beleza', 'combinado', 'claro', 'exato', 'correto', 'perfeito',
      'otimo', 'obrigado', 'obrigada', 'vlw', 'valeu', 'vou', 'estarei',
      'ta', 'tá', 'yes', 'vamos', 'sure', 'blz', 'ótimo', 'show', 'certo',
      'tenho', 'consigo', 'posso', 'afirmativo', 'certeza', 'com certeza',
      'até lá', 'ate la', 'estarei lá', 'estarei la', 'boa', 'tô lá', 'to la',
    ];
    const DENY = [
      'nao', 'não', 'nao posso', 'não posso', 'nope', 'negativo', 'impossivel',
      'impossível', 'nao vou', 'não vou', 'nao consigo', 'não consigo',
      'nao quero', 'não quero', 'cancela', 'cancelar',
    ];
    // Extra guard: don't intercept if client clearly wants to reschedule/book
    const RESCHEDULE_WORDS = [
      'remarcar', 'remarcacao', 'reagendar', 'mudar horario', 'trocar horario',
      'outro horario', 'possivel remarcar', 'consigo remarcar', 'consegue remarcar',
      'remarcar para', 'mudar para', 'trocar para', 'inicio da tarde', 'inicio da manha',
      'começo da tarde', 'comeco da tarde', 'final da tarde', 'meio da tarde',
    ];
    const wantsReschedule = RESCHEDULE_WORDS.some(k => norm.includes(k));
    const hasBookingIntent = wantsReschedule ||
      ['agendar', 'marcar', 'horario', 'horário', 'mudar', 'trocar', 'reagendar'].some(k => norm.includes(k));

    const isAffirm = !hasBookingIntent && AFFIRM.some(a => wds.includes(a) || norm === a);
    const isDeny   = DENY.some(d => wds.includes(d));
    // Brazilian "Não, [affirmative]" filler: "nao" used as emphasis before affirming
    // e.g. "Não, tá confirmado, mais que confirmado, preciso cortar o cabelo"
    const denyAsFiller = isDeny && AFFIRM.filter(a => wds.includes(a)).length >= 2;

    // ── aviso / lembrete: rescheduling request → offer slots directly ───────
    if ((fType === 'aviso' || fType === 'lembrete') && wantsReschedule) {
      const fp0 = makeFingerprint(tenantId, phone, text);
      if (isLocalDuplicate(fp0)) return null;

      const ANY_PROF = ['qualquer', 'quem estiver', 'tanto faz', 'quem tiver', 'qualquer um', 'pode ser qualquer'];
      const wantsAnyProf = ANY_PROF.some(k => norm.includes(k));
      const prefRange = getTimePref(norm);

      const [professionals, services, settings] = await Promise.all([
        db.getProfessionals(tenantId),
        db.getServices(tenantId),
        db.getSettings(tenantId),
      ]);

      const profIdKnown = preSession.data.followUpProfessionalId;
      const svcDuration =
        services.find(s => s.id === preSession.data.followUpServiceId)?.durationMinutes ??
        services.find(s => s.name === preSession.data.followUpServiceName)?.durationMinutes ?? 30;

      // Brasilia date today
      const nowBr = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const padZ  = (n: number) => String(n).padStart(2, '0');
      const todayBr = `${nowBr.getUTCFullYear()}-${padZ(nowBr.getUTCMonth() + 1)}-${padZ(nowBr.getUTCDate())}`;

      let slots: string[] = [];
      let chosenProf = professionals.find(p => p.id === profIdKnown && p.active);

      // Try same professional first (unless client explicitly wants any)
      if (!wantsAnyProf && chosenProf) {
        const raw = await getAvailableSlots(tenantId, chosenProf.id, todayBr, svcDuration, settings);
        slots = prefRange ? raw.filter(s => s >= prefRange.from && s <= prefRange.to) : raw;
      }

      // Fallback: find any professional with available slots
      if (slots.length === 0) {
        for (const p of professionals.filter(pp => pp.active)) {
          const raw = await getAvailableSlots(tenantId, p.id, todayBr, svcDuration, settings);
          const filtered = prefRange ? raw.filter(s => s >= prefRange.from && s <= prefRange.to) : raw;
          if (filtered.length > 0) {
            slots = filtered;
            chosenProf = p;
            break;
          }
        }
      }

      preSession.data.pendingFollowUpType = undefined;

      let reply: string;
      if (slots.length > 0 && chosenProf) {
        const slotList = slots.slice(0, 6).map(s => `• ${s}`).join('\n');
        const profNote = chosenProf.id !== profIdKnown
          ? `com *${chosenProf.name}*`
          : `com *${chosenProf.name}*`;
        const rangeNote = prefRange ? ' nesse período' : '';
        reply = `Claro! Posso remarcar ${profNote}${rangeNote}:\n\n${slotList}\n\nQual horário fica bom?`;
        // Prime session for time selection
        preSession.data.professionalId   = chosenProf.id;
        preSession.data.professionalName = chosenProf.name;
        preSession.data.date             = todayBr;
        preSession.data.availableSlots   = slots;
        if (preSession.data.followUpServiceId)   preSession.data.serviceId   = preSession.data.followUpServiceId;
        if (preSession.data.followUpServiceName) preSession.data.serviceName = preSession.data.followUpServiceName;
      } else {
        const periodMsg = prefRange ? ' nesse horário' : '';
        reply = `Que pena! Infelizmente não temos mais horários disponíveis para hoje${periodMsg}. 😕 Quer marcar para outro dia?`;
      }

      preSession.history.push({ role: 'user', text }, { role: 'bot', text: reply });
      saveSession(preSession);
      return reply;
    }

    // ── aviso / lembrete: affirmative (or "Não, [affirmative]" filler) → confirm presence ───
    if ((fType === 'aviso' || fType === 'lembrete') && ((isAffirm && wds.length <= 8) || denyAsFiller)) {
      const fp0 = makeFingerprint(tenantId, phone, text);
      if (isLocalDuplicate(fp0)) return null;
      const apptTime = preSession.data.followUpApptTime;
      const reply = apptTime
        ? `Show de bola! Aguardamos você às *${apptTime}*.`
        : `Show de bola! Aguardamos você.`;
      preSession.data.pendingFollowUpType = undefined;
      preSession.history.push({ role: 'user', text }, { role: 'bot', text: reply });
      saveSession(preSession);
      return reply;
    }

    // ── reativacao: short denial → polite dismissal ────────────────────
    if (fType === 'reativacao' && isDeny && wds.length <= 6) {
      const fp0 = makeFingerprint(tenantId, phone, text);
      if (isLocalDuplicate(fp0)) return null;
      const reply = `Tudo bem! Quando precisar, é só chamar. 😊`;
      preSession.data.pendingFollowUpType = undefined;
      preSession.history.push({ role: 'user', text }, { role: 'bot', text: reply });
      saveSession(preSession);
      return reply;
    }

    // ── Anything else (long msg, ambiguous, reativacao+positive):
    // Clear the flag and fall through — AI has full history context.
    preSession.data.pendingFollowUpType = undefined;
    saveSession(preSession);
  }

  // ─── Professional contact inquiry response ──────────────────────────
  // Lead previously received "Você gostaria de falar com [prof]?" — handle their reply.
  if (preSession?.data?.pendingProfContact) {
    const fp0 = makeFingerprint(tenantId, phone, text);
    if (isLocalDuplicate(fp0)) return null;
    const { profId, profName, profPhone } = preSession.data.pendingProfContact;
    const normMsg = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '');
    const normWds = normMsg.split(/\s+/);
    const BOOK_KW = ['agendar', 'marcar', 'horario', 'reservar', 'procedimento', 'servico', 'corte', 'barba', 'agendamento', 'cabeca', 'cabecinha', 'cabeça'];
    const AFFIRM  = ['sim', 'pode', 'quero', 'ok', 'claro', 'isso', 'bora', 'gostaria', 'queria', 'preciso', 'favor', 'exato'];
    const DENY    = ['nao', 'não', 'nope', 'negativo'];
    const hasBookingKw = BOOK_KW.some(k => normMsg.includes(k));
    const isAffirm     = AFFIRM.some(a => normWds.includes(a));
    const isDeny       = DENY.some(d => normWds.includes(d)) && !isAffirm;

    if (hasBookingKw) {
      // Lead wants to book WITH this professional → set prof and fall through to normal flow
      preSession.data.professionalId   = profId;
      preSession.data.professionalName = profName;
      preSession.data.pendingProfContact = undefined;
      saveSession(preSession);
      // Fall through — normal AI booking flow will pick up from here
    } else if (isAffirm) {
      // Lead wants personal contact → notify the professional via WhatsApp
      if (profPhone) {
        const inst = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug || '');
        const leadLabel = (pushName && pushName !== 'Cliente') ? `*${pushName}* (${phone})` : `*${phone}*`;
        const notif = `📩 *Olá, ${profName}!*\n\nO contato ${leadLabel} quer falar com você pelo WhatsApp. Verifique quando puder!\n\n— ${tenantName}`;
        evolutionService.sendMessage(inst, profPhone, notif).catch(console.error);
      }
      const reply = profPhone
        ? `Certo! Notifiquei o *${profName}* e ele entrará em contato com você em breve. 😊`
        : `Vou passar seu contato para o *${profName}*! Em breve ele entra em contato. 😊`;
      preSession.data.pendingProfContact = undefined;
      preSession.history.push({ role: 'user', text }, { role: 'bot', text: reply });
      saveSession(preSession);
      return reply;
    } else if (isDeny) {
      const reply = `Sem problema! Posso te ajudar com algo mais? Se quiser agendar um serviço é só falar. 😊`;
      preSession.data.pendingProfContact = undefined;
      preSession.history.push({ role: 'user', text }, { role: 'bot', text: reply });
      saveSession(preSession);
      return reply;
    } else {
      // Ambiguous — let AI handle with full context
      preSession.data.pendingProfContact = undefined;
      saveSession(preSession);
    }
  }

  // ─── Dedup ─────────────────────────────────────────────────────────
  const fp = makeFingerprint(tenantId, phone, text);
  if (isLocalDuplicate(fp)) return null;
  const claimed = await db.claimMessage(fp);
  if (!claimed) return null;

  // ─── Load data ─────────────────────────────────────────────────────
  const [professionals, services, settings] = await Promise.all([
    db.getProfessionals(tenantId),
    db.getServices(tenantId),
    db.getSettings(tenantId),
  ]);

  // ─── Per-lead AI pause check ────────────────────────────────────────
  // If the admin paused IA for this specific lead, silently skip.
  if (settings.customerData) {
    const { data: custCheck } = await supabase
      .from('customers').select('id')
      .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
    if (custCheck && settings.customerData[custCheck.id]?.aiPaused) {
      return null;
    }
  }

  const activeProfessionals = professionals.filter((p: any) => p.active).map((p: any) => ({ ...p, name: (p.name || '').trim() }));
  const activeServices = services.filter((s: any) => s.active);

  // Key hierarchy: tenant's own key → shared global key (SuperAdmin) → Gemini
  const tenantKey = (settings.openaiApiKey || '').trim();
  let apiKey = tenantKey;
  if (!apiKey) {
    const globalCfg = await db.getGlobalConfig();
    const sharedKey = (globalCfg['shared_openai_key'] || '').trim();
    apiKey = sharedKey || geminiKey;
  }

  if (!apiKey) {
    return `Erro: chave de API não configurada. Por favor, configure em Ajustes → Agente IA.`;
  }

  // Use Brazil time (UTC-3) for today's date
  const _nowBrasilia = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayISO = `${_nowBrasilia.getUTCFullYear()}-${pad(_nowBrasilia.getUTCMonth()+1)}-${pad(_nowBrasilia.getUTCDate())}`;

  const serviceOptions = activeServices.map((s: any) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes, price: s.price }));

  const profOptions = activeProfessionals.map((p: any) => ({ id: p.id, name: p.name }));

  // ─── Build custom system prompt with variable substitution ──────────
  let customPrompt = (settings.systemPrompt || '').trim();
  if (customPrompt) {
    const profStr = profOptions.map(p => p.name).join(', ');
    const svcStr = activeServices.map((s: any) => `${s.name} (R$${(s.price || 0).toFixed(2)})`).join(', ');
    const hoje = _nowBrasilia.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    customPrompt = customPrompt
      .replace(/\$\{tenant\.nome\}/g, tenantName)
      .replace(/\$\{hoje\}/g, hoje)
      .replace(/\$\{tenant\.nicho\}/g, tenant.nicho || 'estabelecimento')
      .replace(/\$\{profStr\}/g, profStr)
      .replace(/\$\{svcStr\}/g, svcStr);
  }

  // ─── New session — create, then let AI handle greeting + extraction ─
  let session = getSession(tenantId, phone);
  // Tentar restaurar do Supabase se não estiver na memória (garante continuidade após fechar o browser)
  if (!session) {
    try {
      const { data: sbSess } = await supabase
        .from('agent_sessions')
        .select('data, history, updated_at')
        .eq('tenant_id', tenantId)
        .eq('phone', phone)
        .maybeSingle();
      if (sbSess && Date.now() - new Date(sbSess.updated_at).getTime() < SESSION_TIMEOUT_MS) {
        session = {
          tenantId, phone,
          data: sbSess.data as SessionData,
          history: sbSess.history as HistoryEntry[],
          updatedAt: new Date(sbSess.updated_at).getTime(),
        };
        sessions.set(sessionKey(tenantId, phone), session);
        console.log('[Agent] Sessão restaurada do Supabase para', phone);
      }
    } catch { /* ignorar erro de restauração */ }
  }
  if (!session) {
    const { data: existing } = await supabase.from('customers').select('nome')
      .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
    const knownName = existing?.nome || (pushName && pushName !== 'Cliente' ? pushName : null);

    session = {
      tenantId, phone,
      data: knownName ? { clientName: knownName } : {},
      history: [],
      updatedAt: Date.now(),
    };
    // No early return — fall through so callBrain processes first message naturally
  }

  // ─── Brasília greeting ──────────────────────────────────────────────
  const { greeting: brasiliaGreeting, dateStr: brasiliaDate } = getBrasiliaGreeting();
  const _greetKey = `${tenantId}::${phone}`;
  // Check both in-memory cache AND persisted session data (in case of Edge Function cold start)
  const shouldGreet = session.data.greetedAt !== brasiliaDate && _greetedToday.get(_greetKey) !== brasiliaDate;

  // ─── Detect group booking intent from keywords ────────────────────────
  const groupKeywords = ['eu e ', 'pra mim e', 'para mim e', 'minha esposa', 'meu esposo',
    'minha namorada', 'meu namorado', 'meu filho', 'minha filha', 'meu pai', 'minha mae',
    'minha mãe', 'meu irmao', 'meu irmão', 'minha irma', 'minha irmã', 'meu amigo',
    'minha amiga', 'duas pessoas', 'dois cortes', 'nós dois', 'nos dois', 'pra dois',
    'para dois', 'pra nós', 'meu parceiro', 'minha parceira', 'meu marido', 'minha mulher'];
  const hasGroupIntent = groupKeywords.some(k => lowerText.includes(k));
  if (hasGroupIntent && !session.data.groupBooking?.active) {
    const companionMap: [string, string][] = [
      ['minha esposa', 'sua esposa'], ['meu esposo', 'seu esposo'],
      ['minha namorada', 'sua namorada'], ['meu namorado', 'seu namorado'],
      ['meu filho', 'seu filho'], ['minha filha', 'sua filha'],
      ['meu pai', 'seu pai'], ['minha mae', 'sua mãe'], ['minha mãe', 'sua mãe'],
      ['meu irmao', 'seu irmão'], ['meu irmão', 'seu irmão'],
      ['minha irma', 'sua irmã'], ['minha irmã', 'sua irmã'],
      ['meu amigo', 'seu amigo'], ['minha amiga', 'sua amiga'],
      ['meu marido', 'seu marido'], ['minha mulher', 'sua mulher'],
    ];
    const found = companionMap.find(([k]) => lowerText.includes(k));
    session.data.groupBooking = {
      active: true,
      companionDesc: found ? found[1] : 'acompanhante',
      sameService: undefined,
    };
    console.log('[Agent] Group booking detected:', session.data.groupBooking.companionDesc);
  }

  // ─── Reschedule detection (TypeScript layer) ─────────────────────────
  // Detects "tenho horário mas preciso reagendar" → fetches existing appt and pre-fills session
  if (!session.data.pendingReschedule && !session.data.pendingConfirm) {
    const RESCHEDULE_KW = [
      'reagendar', 'remarcar', 'mudar meu horario', 'mudar meu agendamento',
      'trocar meu horario', 'trocar meu agendamento', 'nao vou conseguir',
      'não vou conseguir', 'nao consigo ir', 'não consigo ir',
      'preciso mudar', 'preciso remarcar', 'preciso reagendar',
      'nao vou poder ir', 'não vou poder ir', 'quero remarcar', 'quero reagendar',
    ];
    const normRS = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const wantsReschedule = RESCHEDULE_KW.some(k => normRS.includes(k));
    if (wantsReschedule) {
      try {
        const { data: custRS } = await supabase.from('customers').select('id')
          .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
        if (custRS) {
          const now0 = new Date();
          const p0 = (n: number) => String(n).padStart(2, '0');
          const nowLocal = `${now0.getFullYear()}-${p0(now0.getMonth()+1)}-${p0(now0.getDate())}T${p0(now0.getHours())}:${p0(now0.getMinutes())}:00`;
          const { data: upcomingRS } = await supabase.from('appointments')
            .select('id, inicio, service_id, professional_id')
            .eq('tenant_id', tenantId).eq('customer_id', custRS.id)
            .in('status', ['CONFIRMED', 'PENDING', 'confirmado', 'pendente'])
            .gte('inicio', nowLocal).order('inicio', { ascending: true }).limit(1);
          if (upcomingRS && upcomingRS.length > 0) {
            const apptRS = upcomingRS[0];
            const oldDate = (apptRS.inicio as string).substring(0, 10);
            const oldTime = (apptRS.inicio as string).substring(11, 16);
            const svcRS  = services.find((s: any) => s.id === apptRS.service_id);
            const profRS = professionals.find((p: any) => p.id === apptRS.professional_id);
            // Pre-fill session with same service + prof + time (only new date is missing)
            session.data.serviceId        = apptRS.service_id;
            session.data.serviceName      = svcRS?.name;
            session.data.serviceDuration  = svcRS?.durationMinutes;
            session.data.servicePrice     = svcRS?.price;
            session.data.professionalId   = apptRS.professional_id;
            session.data.professionalName = profRS?.name;
            session.data.time             = oldTime;
            session.data.pendingReschedule = {
              oldApptId: apptRS.id,
              oldDate,
              oldTime,
              oldProfName: profRS?.name || 'Profissional',
            };
            console.log('[Agent] Reschedule detected, pre-filled session from appt', apptRS.id);
          }
        }
      } catch (eRS) { console.error('[Agent] reschedule pre-detection error:', eRS); }
    }
  }

  // ─── Earlier slot detection (TypeScript layer) ───────────────────────
  // Detects "quero adiantar", "mais cedo", etc. — client wants an earlier time TODAY
  if (!session.data.pendingReschedule && !session.data.pendingConfirm) {
    const EARLIER_KW = [
      'adiantar', 'mais cedo', 'hora mais cedo', 'horario mais cedo',
      'antes das', 'puder ir antes', 'conseguir ir antes',
      'um pouco antes', 'ir antes', 'chegar antes',
    ];
    const normEar = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const wantsEarlier = EARLIER_KW.some(k => normEar.includes(k));
    if (wantsEarlier) {
      try {
        const { data: custE } = await supabase.from('customers').select('id')
          .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
        if (custE) {
          const now0 = new Date();
          const p0 = (n: number) => String(n).padStart(2, '0');
          const nowLocal = `${now0.getFullYear()}-${p0(now0.getMonth()+1)}-${p0(now0.getDate())}T${p0(now0.getHours())}:${p0(now0.getMinutes())}:00`;
          const { data: upcomingE } = await supabase.from('appointments')
            .select('id, inicio, service_id, professional_id')
            .eq('tenant_id', tenantId).eq('customer_id', custE.id)
            .in('status', ['CONFIRMED', 'PENDING', 'confirmado', 'pendente'])
            .gte('inicio', nowLocal).order('inicio', { ascending: true }).limit(1);
          if (upcomingE && upcomingE.length > 0) {
            const apptE = upcomingE[0];
            const apptDate = (apptE.inicio as string).substring(0, 10);
            const apptTime = (apptE.inicio as string).substring(11, 16);
            const svcE  = services.find((s: any) => s.id === apptE.service_id);
            const profE = professionals.find((p: any) => p.id === apptE.professional_id);
            // Only consider earlier if appointment is TODAY
            if (apptDate === todayISO) {
              const allSlots = await getAvailableSlots(tenantId, apptE.professional_id, apptDate, svcE?.durationMinutes || 30, settings);
              const nowHHMM = `${pad(_nowBrasilia.getUTCHours())}:${pad(_nowBrasilia.getUTCMinutes())}`;
              const earlierSlots = allSlots.filter(s => s >= nowHHMM && s < apptTime);
              if (earlierSlots.length === 0) {
                const reply = `Hoje mais cedo não tem disponível com o ${profE?.name || 'profissional'}, mas fique tranquilo — seu horário das ${apptTime} está confirmado! 😊`;
                session.history.push({ role: 'user', text }, { role: 'bot', text: reply });
                saveSession(session);
                return reply;
              }
              // Earlier slots found — set up reschedule flow for earlier time
              session.data.serviceId        = apptE.service_id;
              session.data.serviceName      = svcE?.name;
              session.data.serviceDuration  = svcE?.durationMinutes;
              session.data.servicePrice     = svcE?.price;
              session.data.professionalId   = apptE.professional_id;
              session.data.professionalName = profE?.name;
              session.data.date             = apptDate;
              session.data.availableSlots   = earlierSlots;
              session.data.pendingReschedule = {
                oldApptId: apptE.id,
                oldDate: apptDate,
                oldTime: apptTime,
                oldProfName: profE?.name || 'Profissional',
                isEarlierSlot: true,
              };
              console.log('[Agent] Earlier slot detected, earlier options:', earlierSlots);
            }
          }
        }
      } catch (eEar) { console.error('[Agent] earlier slot detection error:', eEar); }
    }
  }

  // ─── Appointment query detection (TypeScript layer) ───────────────────
  // When a client asks about their existing appointment ("meu horário", "ta agendado?"),
  // look up DB directly and respond — skipping the booking flow entirely.
  // Must run BEFORE professional name extraction to prevent false personal-contact triggers.
  {
    const normAQ = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const APPT_Q = [
      'meu horario', 'qual meu horario', 'qual o meu horario', 'qual e meu horario',
      'meu agendamento', 'minha consulta', 'meu compromisso',
      'esta agendado', 'ta agendado', 'esta marcado', 'ta marcado',
      'agendado para hoje', 'marcado para hoje', 'tenho agendamento',
      'horario de hoje', 'horario marcado', 'como esta meu agendamento',
      'como ta meu agendamento', 'confirmar meu agendamento', 'meu horario esta',
    ];
    const isApptQ   = APPT_Q.some(k => normAQ.includes(k));
    const isMidBkng = !!(session.data.serviceId || (session.data.date && session.data.time) || session.data.pendingConfirm);
    if (isApptQ && !isMidBkng) {
      try {
        const { data: custAQ } = await supabase.from('customers')
          .select('id').eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
        if (custAQ) {
          const { data: nextAppts } = await supabase.from('appointments')
            .select('id, inicio, service_id, professional_id')
            .eq('tenant_id', tenantId).eq('customer_id', custAQ.id)
            .in('status', ['CONFIRMED', 'PENDING', 'confirmado', 'pendente'])
            .gte('inicio', `${todayISO}T00:00:00`)
            .order('inicio', { ascending: true }).limit(5);
          if (nextAppts && nextAppts.length > 0) {
            const lines = (nextAppts as any[]).map((a: any) => {
              const dt   = (a.inicio as string).substring(0, 10);
              const tm   = (a.inicio as string).substring(11, 16);
              const svc  = serviceOptions.find(s => s.id === a.service_id);
              const prof = profOptions.find(p => p.id === a.professional_id);
              const dl   = dt === todayISO ? 'hoje' : formatDate(dt);
              return `• ${dl} às *${tm}* — ${svc?.name || 'Procedimento'} com ${prof?.name || 'Profissional'}`;
            });
            const replyAQ = nextAppts.length === 1
              ? `Aqui está seu agendamento:\n\n${lines[0]}\n\nPosso te ajudar com mais alguma coisa?`
              : `Seus próximos agendamentos:\n\n${lines.join('\n')}\n\nPosso te ajudar com mais alguma coisa?`;
            session.history.push({ role: 'user', text }, { role: 'bot', text: replyAQ });
            saveSession(session);
            return replyAQ;
          }
        }
      } catch (eAQ) { console.error('[Agent] appt-query error:', eAQ); }
      // No appointments found or error → fall through to normal booking flow
    }
  }

  // ─── TypeScript-layer professional name pre-extraction ─────────────
  // Runs BEFORE calling LLM. Checks vacation first (for any # of professionals),
  // then for multiple-prof setups either starts a booking flow or personal-contact flow.
  if (!session.data.professionalId && !session.data.pendingProfContact) {
    const matchedProf = matchProfessionalName(lowerText, profOptions);
    if (matchedProf) {
      // ── Vacation check: always runs regardless of professional count ──
      const profIsOnVacation = (settings.breaks || []).some((b: any) => {
        if (b.professionalId && b.professionalId !== matchedProf.id) return false;
        if ((b as any).type !== 'vacation') return false;
        const vacStart = b.date || '';
        const vacEnd = (b as any).vacationEndDate || b.date || '';
        return !!vacStart && todayISO >= vacStart && todayISO <= vacEnd;
      });
      if (profIsOnVacation) {
        const othersAvail = profOptions
          .filter((p: any) => p.id !== matchedProf.id)
          .filter((p: any) => !(settings.breaks || []).some((b: any) => {
            if (b.professionalId && b.professionalId !== p.id) return false;
            if ((b as any).type !== 'vacation') return false;
            const vs = b.date || '', ve = (b as any).vacationEndDate || b.date || '';
            return !!vs && todayISO >= vs && todayISO <= ve;
          }));
        const othersStr = othersAvail.map((p: any) => p.name).join(' ou ');
        const vacMsg = `*${matchedProf.name}* está de férias no momento! 🏖️\n\n${othersStr ? `Gostaria de agendar com ${othersStr}?` : 'Gostaria de agendar com outro profissional?'}`;
        session.history.push({ role: 'user', text }, { role: 'bot', text: vacMsg });
        saveSession(session);
        return vacMsg;
      }

      if (profOptions.length > 1) {
        // Multiple professionals: check for booking intent or personal-contact flow
        const normMsg2 = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '');
        const BOOK_KW2 = ['agendar', 'marcar', 'horario', 'reservar', 'procedimento', 'servico', 'corte', 'barba', 'agendamento', 'quero marcar', 'quero agendar', 'cabeca', 'cabecinha', 'cabeça'];
        const hasSvcMention = activeServices.some((s: any) =>
          normMsg2.includes((s.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ''))
        );
        const hasBookingKw2 = BOOK_KW2.some(k => normMsg2.includes(k));
        const isMidBooking  = !!(session.data.serviceId || session.data.pendingConfirm);
        // Personal-contact flow only on first message OR explicit "quero falar com" intent
        const isFirstMsg = session.history.filter((h: any) => h.role === 'bot').length === 0;
        const PERSONAL_KW = ['quero falar com', 'preciso falar com', 'falar com o', 'falar com a', 'entrar em contato com'];
        const hasPersonalIntent = PERSONAL_KW.some(k => normMsg2.includes(k));

        if (hasBookingKw2 || hasSvcMention || isMidBooking || (!isFirstMsg && !hasPersonalIntent)) {
          // Normal booking flow: pre-set the professional
          session.data.professionalId   = matchedProf.id;
          session.data.professionalName = matchedProf.name;
          console.log('[Agent] TS pre-extracted professional:', matchedProf.name);
        } else {
          // No booking signal on first message or explicit "falar com" — ask first
          const profWithPhone = activeProfessionals.find((p: any) => p.id === matchedProf.id);
          session.data.pendingProfContact = {
            profId:    matchedProf.id,
            profName:  matchedProf.name,
            profPhone: (profWithPhone as any)?.phone || '',
          };
          const question = `Você gostaria de falar com o *${matchedProf.name}* sobre algum assunto específico?`;
          const reply = shouldGreet
            ? `${brasiliaGreeting.charAt(0).toUpperCase() + brasiliaGreeting.slice(1)}! ${question}`
            : question;
          if (shouldGreet) {
            session.data.greetedAt = brasiliaDate;
            _greetedToday.set(`${tenantId}::${phone}`, brasiliaDate);
          }
          session.history.push({ role: 'user', text }, { role: 'bot', text: reply });
          saveSession(session);
          return reply;
        }
      } else {
        // Single professional: pre-set them directly (no personal-contact-flow question needed)
        session.data.professionalId   = matchedProf.id;
        session.data.professionalName = matchedProf.name;
        console.log('[Agent] TS pre-extracted single professional:', matchedProf.name);
      }
    }
  }

  // ─── Add user message to history ───────────────────────────────────
  session.history.push({ role: 'user', text });

  // ─── Vacation guard for already-selected professional ────────────────
  // Handles the case where session.data.professionalId was set in a prior turn
  // but that professional is currently on vacation (TS pre-extraction above only
  // runs when professionalId is NOT yet set).
  // Always respond with vacation message — no keyword matching needed since
  // real users ask in countless unpredictable ways ("tá atendendo?", "já voltou?", etc.)
  if (session.data.professionalId) {
    const _curProfOnVac = (settings.breaks || []).some((b: any) => {
      if ((b as any).type !== 'vacation') return false;
      if (b.professionalId && b.professionalId !== session.data.professionalId) return false;
      const vs = b.date || '';
      const ve = (b as any).vacationEndDate || b.date || '';
      return !!vs && todayISO >= vs && todayISO <= ve;
    });
    if (_curProfOnVac) {
      const _vacProfName = session.data.professionalName || 'O profissional';
      const _othersAvail = profOptions
        .filter((p: any) => p.id !== session.data.professionalId)
        .filter((p: any) => !(settings.breaks || []).some((b: any) => {
          if ((b as any).type !== 'vacation') return false;
          if (b.professionalId && b.professionalId !== p.id) return false;
          const vs = b.date || '', ve = (b as any).vacationEndDate || b.date || '';
          return !!vs && todayISO >= vs && todayISO <= ve;
        }));
      const _othersStr = _othersAvail.map((p: any) => p.name).join(' ou ');
      const _vacMsg = `*${_vacProfName}* está de férias no momento! 🏖️\n\n${_othersStr ? `Gostaria de agendar com ${_othersStr}?` : 'Pode agendar quando o profissional retornar.'}`;
      session.data.professionalId   = undefined;
      session.data.professionalName = undefined;
      session.data.date             = undefined;
      session.history.push({ role: 'bot', text: _vacMsg });
      saveSession(session);
      return _vacMsg;
    }
  }

  // ─── Fetch available slots only when service is known (duration required for accuracy) ──
  let prefetchedSlots: string[] | undefined;
  if (session.data.professionalId && session.data.date && session.data.serviceId) {
    const _slotDuration = session.data.serviceDuration || 30;
    prefetchedSlots = await getAvailableSlots(
      tenantId, session.data.professionalId, session.data.date,
      _slotDuration, settings
    );
    session.data.availableSlots = prefetchedSlots;

    // Empty slots = vacation or truly fully booked — handle before calling brain
    if (prefetchedSlots.length === 0) {
      const isVacation = (settings.breaks || []).some((b: any) => {
        if (b.professionalId && b.professionalId !== session.data.professionalId) return false;
        if ((b as any).type !== 'vacation') return false;
        const vacStart = b.date || '';
        const vacEnd = (b as any).vacationEndDate || b.date || '';
        return !!vacStart && session.data.date! >= vacStart && session.data.date! <= vacEnd;
      });
      const profName = session.data.professionalName || 'O profissional';
      if (isVacation) {
        const noAvail = `${profName} está de férias neste período! 🏖️\n\nGostaria de escolher outro profissional ou outra data?`;
        session.data.date = undefined;
        session.data.professionalId = undefined;
        session.data.professionalName = undefined;
        session.history.push({ role: 'bot', text: noAvail });
        saveSession(session);
        return noAvail;
      }
      // Fully booked — proactively check the next day
      const _bookedDate = session.data.date!;
      const _nextDate = (() => {
        const d = new Date(_bookedDate + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        const p = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      })();
      const _nextDur = session.data.serviceDuration || 30;
      const _nextSlots = await getAvailableSlots(tenantId, session.data.professionalId!, _nextDate, _nextDur, settings);
      if (_nextSlots.length > 0) {
        const _isToday = _bookedDate === todayISO;
        const _fullLabel = _isToday ? 'Hoje' : `Em ${formatDate(_bookedDate)}`;
        const _nextLabel = _isToday ? 'amanhã' : `em ${formatDate(_nextDate)}`;
        const noAvail = `${_fullLabel} o ${profName} está com a agenda cheia 😕 Mas ${_nextLabel} tem horário! Quer marcar?`;
        session.data.date = _nextDate;
        session.data.availableSlots = _nextSlots;
        session.history.push({ role: 'bot', text: noAvail });
        saveSession(session);
        return noAvail;
      }
      const noAvail = `Que pena! Não tem horário disponível em ${formatDate(_bookedDate)} com ${profName}. 😕\n\nPara qual outro dia você prefere?`;
      session.data.date = undefined;
      session.history.push({ role: 'bot', text: noAvail });
      saveSession(session);
      return noAvail;
    }
  }

  // ─── Professionals visible to the AI (excludes anyone on vacation for the target date) ──
  // profOptions (full list) is kept for name-matching above so the slot-check can explain
  // vacations when the client explicitly requests a prof who is currently on vacation.
  const _targetDate = session.data.date || todayISO;
  const _breaks: BreakPeriod[] = settings.breaks || [];
  const profOptionsVisible = profOptions.filter((p: { id: string; name: string }) =>
    !_breaks.some(b => {
      if ((b as any).type !== 'vacation') return false;
      if (b.professionalId && b.professionalId !== p.id) return false;
      const vacStart = b.date || '';
      const vacEnd = (b as any).vacationEndDate || b.date || '';
      return !!vacStart && _targetDate >= vacStart && _targetDate <= vacEnd;
    })
  );

  // ─── First AI Brain call ────────────────────────────────────────────
  const tenantNicho: string = (tenant.nicho as string) || 'Barbearia';
  const groupBookingCtx = buildGroupCtx(session.data);
  let brain = await callBrain(
    apiKey, tenantName, todayISO,
    serviceOptions, profOptionsVisible,
    session.history, session.data, prefetchedSlots, customPrompt || undefined,
    shouldGreet, brasiliaGreeting, groupBookingCtx || undefined,
    tenantNicho, tenantId, phone, options?.isAudio
  );

  if (!brain) {
    const fallback = `Desculpe, tive um problema técnico. Pode repetir? 😅`;
    session.history.push({ role: 'bot', text: fallback });
    saveSession(session);
    return fallback;
  }

  // ─── Apply extractions ─────────────────────────────────────────────
  const ext = brain.extracted;

  if (ext.clientName && !session.data.clientName) {
    session.data.clientName = capitalizeName(ext.clientName.trim());
  }
  if (ext.serviceId && !session.data.serviceId) {
    const svc = activeServices.find((s: any) => s.id === ext.serviceId);
    if (svc) {
      session.data.serviceId = svc.id;
      session.data.serviceName = svc.name;
      session.data.serviceDuration = svc.durationMinutes;
      session.data.servicePrice = svc.price;
    }
  }
  if (ext.professionalId && !session.data.professionalId) {
    const prof = activeProfessionals.find((p: any) => p.id === ext.professionalId);
    if (prof) { session.data.professionalId = prof.id; session.data.professionalName = prof.name; }
  }
  // Only apply date/time if not already set
  if (ext.date && !session.data.date) session.data.date = ext.date;

  // Validate time against available slots
  const currentSlots = prefetchedSlots || [];
  if (ext.time && !session.data.time && currentSlots.length > 0) {
    const validTime = currentSlots.includes(ext.time) ? ext.time : quickTime(ext.time, currentSlots);
    if (validTime) session.data.time = validTime;
  }

  // ─── Group booking extractions ────────────────────────────────────────
  if (session.data.groupBooking?.active) {
    const gb = session.data.groupBooking;
    if (ext.sameService !== null && ext.sameService !== undefined && gb.sameService === undefined) {
      gb.sameService = ext.sameService;
      if (ext.sameService && session.data.serviceId && !gb.companionServiceId) {
        // companion uses same service as the client
        const svc = activeServices.find((s: any) => s.id === session.data.serviceId);
        if (svc) {
          gb.companionServiceId = svc.id;
          gb.companionServiceName = svc.name;
          gb.companionServiceDuration = svc.durationMinutes;
        }
      }
    }
    if (ext.companionServiceId && !gb.companionServiceId) {
      const svc = activeServices.find((s: any) => s.id === ext.companionServiceId);
      if (svc) {
        gb.companionServiceId = svc.id;
        gb.companionServiceName = svc.name;
        gb.companionServiceDuration = svc.durationMinutes;
      }
    }
  }

  // ─── If we JUST extracted professional + date + service, fetch slots and re-run ──
  const justGotProfAndDate = !prefetchedSlots && session.data.professionalId && session.data.date && session.data.serviceId;
  if (justGotProfAndDate) {
    const newSlots = await getAvailableSlots(
      tenantId, session.data.professionalId!, session.data.date!,
      session.data.serviceDuration || 30, settings
    );
    session.data.availableSlots = newSlots;

    if (newSlots.length === 0) {
      const _profName2 = session.data.professionalName || 'O profissional';
      const _bookedDate2 = session.data.date!;
      const _nextDate2 = (() => {
        const d = new Date(_bookedDate2 + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        const p = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      })();
      const _nextSlots2 = await getAvailableSlots(tenantId, session.data.professionalId!, _nextDate2,
        session.data.serviceDuration || (activeServices[0]?.durationMinutes ?? 30), settings);
      if (_nextSlots2.length > 0) {
        const _isToday2 = _bookedDate2 === todayISO;
        const _fullLabel2 = _isToday2 ? 'Hoje' : `Em ${formatDate(_bookedDate2)}`;
        const _nextLabel2 = _isToday2 ? 'amanhã' : `em ${formatDate(_nextDate2)}`;
        const noAvail2 = `${_fullLabel2} o ${_profName2} está com a agenda cheia 😕 Mas ${_nextLabel2} tem horário! Quer marcar?`;
        session.data.date = _nextDate2;
        session.data.availableSlots = _nextSlots2;
        session.history.push({ role: 'bot', text: noAvail2 });
        saveSession(session);
        return noAvail2;
      }
      const noAvail = `Que pena! Não tem horário disponível em ${formatDate(_bookedDate2)} com ${_profName2}. 😕\n\nPara qual outro dia você prefere?`;
      session.data.date = undefined;
      session.history.push({ role: 'bot', text: noAvail });
      saveSession(session);
      return noAvail;
    }

    // Try to extract time from current message against real slots (regex only, no extra AI call)
    if (!session.data.time) {
      const t = quickTime(text, newSlots);
      if (t) session.data.time = t;
    }

    // ─── Resolve companion slot if group booking data is now complete ────
    if (
      session.data.groupBooking?.active &&
      session.data.groupBooking.companionServiceId &&
      !session.data.groupBooking.resolvedMode &&
      session.data.professionalId && session.data.date && session.data.time
    ) {
      session.data.groupBooking = await resolveGroupBooking(tenantId, session.data, profOptions);
    }

    // Re-run brain with real slots so it can show a natural response with slot options
    const groupBookingCtx2 = buildGroupCtx(session.data);
    const brain2 = await callBrain(
      apiKey, tenantName, todayISO,
      serviceOptions, profOptionsVisible,
      session.history, session.data, newSlots, customPrompt || undefined,
      false, brasiliaGreeting, groupBookingCtx2 || undefined,
      tenantNicho, tenantId, phone, false
    );
    if (brain2) {
      // Apply any new extractions from second call
      if (brain2.extracted.time && !session.data.time) {
        const v2 = newSlots.includes(brain2.extracted.time) ? brain2.extracted.time : quickTime(brain2.extracted.time, newSlots);
        if (v2) session.data.time = v2;
      }
      brain = brain2;
    }
  }

  // ─── Resolve companion slot (Case B: prof+date already known, time just extracted by brain1) ─
  if (
    session.data.groupBooking?.active &&
    session.data.groupBooking.companionServiceId &&
    !session.data.groupBooking.resolvedMode &&
    !justGotProfAndDate &&
    session.data.professionalId && session.data.date && session.data.time
  ) {
    session.data.groupBooking = await resolveGroupBooking(tenantId, session.data, profOptions);
  }

  // ─── Fallback: force confirmed if pendingConfirm + affirmative message ─
  if (session.data.pendingConfirm && brain.extracted.confirmed === null) {
    const affirmWords = ['sim', 'ok', 'pode', 'confirmo', 'isso', 'exato', 'correto', 'com certeza', 'quero', 'bora', 'ta', 'tá', 'beleza', 'certo', 'fechado', 'feito', 'vamos', 'positivo', 'claro', 'confirmado', 'confirmar', 'yes', 'perfeito'];
    const normalized = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const words = normalized.split(/\s+/);
    if (affirmWords.some(a => words.includes(a) || normalized === a)) {
      console.log('[Agent] Affirmative fallback → forced confirmed=true');
      brain.extracted.confirmed = true;
    }
  }

  // ─── Handle confirmation ────────────────────────────────────────────
  if (brain.extracted.confirmed === true &&
      session.data.serviceId && session.data.professionalId &&
      session.data.date && session.data.time) {
    try {
      const startTimeStr = `${session.data.date}T${session.data.time}:00`;
      const { available } = await db.isSlotAvailable(
        tenantId, session.data.professionalId,
        new Date(startTimeStr), session.data.serviceDuration || 30
      );

      if (!available) {
        const freshSlots = await getAvailableSlots(
          tenantId, session.data.professionalId, session.data.date,
          session.data.serviceDuration || 30, settings
        );
        session.data.time = undefined;
        session.data.availableSlots = freshSlots;
        const takenMsg = freshSlots.length > 0
          ? `Ops! Esse horário foi ocupado agora. 😕 Ainda temos:\n\n${formatSlots(freshSlots.slice(0, 6))}\n\nQual você prefere?`
          : `Ops! Esse horário foi ocupado e não há mais vagas nesse dia. Para qual outro dia você prefere?`;
        if (freshSlots.length === 0) session.data.date = undefined;
        session.history.push({ role: 'bot', text: takenMsg });
        saveSession(session);
        return takenMsg;
      }

      // Check plan coverage
      const customer = await db.findOrCreateCustomer(tenantId, phone, session.data.clientName || pushName || 'Cliente');
      let isPlanAppointment = false;
      if (customer.planId) {
        const plans = await db.getPlans(tenantId);
        const activePlan = plans.find((p: any) => p.id === customer.planId);
        if (activePlan) {
          isPlanAppointment = activePlan.proceduresPerMonth === 0 ||
            (await db.getPlanUsageCount(tenantId, customer.id)) < activePlan.proceduresPerMonth;
        }
      }

      const appointment = await db.addAppointment({
        tenant_id: tenantId,
        customer_id: customer.id,
        professional_id: session.data.professionalId,
        service_id: session.data.serviceId,
        startTime: startTimeStr,
        durationMinutes: session.data.serviceDuration,
        status: AppointmentStatus.CONFIRMED,
        source: isPlanAppointment ? BookingSource.PLAN : BookingSource.AI,
        isPlan: isPlanAppointment,
      });

      if (isPlanAppointment) await db.incrementPlanUsage(tenantId, customer.id).catch(console.error);
      if (appointment) sendProfessionalNotification(appointment).catch(console.error);

      // ─── Reschedule: cancel old appointment ──────────────────────────
      const pendingRS = session.data.pendingReschedule;
      if (pendingRS?.oldApptId) {
        try {
          await supabase.from('appointments')
            .update({ status: AppointmentStatus.CANCELLED })
            .eq('id', pendingRS.oldApptId).eq('tenant_id', tenantId);
          notifyWaitlistLeads(tenantId, { date: pendingRS.oldDate }).catch(console.error);
        } catch (eCancelOld) {
          console.error('[Agent] reschedule: failed to cancel old appt:', eCancelOld);
        }
      }

      // ─── Group booking: create companion appointment ───────────────────
      let groupMsg = '';
      const gbConf = session.data.groupBooking;
      if (gbConf?.active && gbConf.resolvedMode && gbConf.companionServiceId) {
        const companionStartTime = gbConf.resolvedMode === 'consecutive'
          ? `${session.data.date}T${gbConf.companion2Time}:00`
          : `${session.data.date}T${session.data.time}:00`;
        const companionProfId = gbConf.resolvedMode === 'parallel'
          ? gbConf.companion2ProfId!
          : session.data.professionalId!;
        const companionProfName = gbConf.resolvedMode === 'parallel'
          ? gbConf.companion2ProfName!
          : session.data.professionalName!;
        try {
          const appt2 = await db.addAppointment({
            tenant_id: tenantId,
            customer_id: customer.id,
            professional_id: companionProfId,
            service_id: gbConf.companionServiceId,
            startTime: companionStartTime,
            durationMinutes: gbConf.companionServiceDuration || session.data.serviceDuration,
            status: AppointmentStatus.CONFIRMED,
            source: BookingSource.AI,
            isPlan: false,
          });
          if (appt2) sendProfessionalNotification(appt2).catch(console.error);
          const comp2Time = gbConf.resolvedMode === 'consecutive' ? gbConf.companion2Time! : session.data.time!;
          groupMsg = `\n\n👥 ${gbConf.companionDesc || 'Acompanhante'}: ${gbConf.companionServiceName} com ${companionProfName} às ${comp2Time}`;
        } catch (e: any) {
          console.error('[Agent] Group companion booking error:', e.message);
        }
      }

      const wasReschedule = !!session.data.pendingReschedule;
      clearSession(tenantId, phone);
      const planNote = isPlanAppointment ? '\n📦 _Coberto pelo seu plano._' : '';
      if (shouldGreet) _greetedToday.set(_greetKey, brasiliaDate);
      return wasReschedule
        ? (
          `Reagendado! ✅\n\n` +
          `📅 ${formatDate(session.data.date)} às ${session.data.time}\n` +
          `✂️ ${session.data.serviceName} com ${session.data.professionalName}` +
          planNote +
          `\n\nTe esperamos! 😊`
        )
        : (
          `Agendado! ✅\n\n` +
          `📅 ${formatDate(session.data.date)} às ${session.data.time}\n` +
          `✂️ ${session.data.serviceName} com ${session.data.professionalName}` +
          groupMsg +
          planNote +
          `\n\nTe esperamos! 😊`
        );
    } catch (e: any) {
      console.error('[Agent] Booking error:', e);
      return `Ocorreu um erro ao confirmar. Por favor, tente novamente.`;
    }
  }

  // ─── User rejected confirmation — keep name, reset booking data ────
  if (brain.extracted.confirmed === false) {
    const clientName = session.data.clientName;
    const h = session.history;
    clearSession(tenantId, phone);
    const newSession: Session = { tenantId, phone, data: { clientName }, history: h, updatedAt: Date.now() };
    saveSession(newSession);
    // Brain already generated a natural "no problem, let's try again" reply
  }

  // ─── Handle cancellation extracted by AI ────────────────────────────
  if (brain.extracted.cancelled === true) {
    try {
      const { data: customer } = await supabase
        .from('customers').select('id')
        .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
      if (customer) {
        const now0 = new Date();
        const p0 = (n: number) => String(n).padStart(2, '0');
        const nowLocal = `${now0.getFullYear()}-${p0(now0.getMonth()+1)}-${p0(now0.getDate())}T${p0(now0.getHours())}:${p0(now0.getMinutes())}:${p0(now0.getSeconds())}`;
        const { data: appts } = await supabase.from('appointments')
          .select('id, inicio').eq('tenant_id', tenantId).eq('customer_id', customer.id)
          .eq('status', AppointmentStatus.CONFIRMED).gte('inicio', nowLocal)
          .order('inicio', { ascending: true }).limit(1);
        if (appts && appts.length > 0) {
          await supabase.from('appointments').update({ status: AppointmentStatus.CANCELLED }).eq('id', appts[0].id);
          notifyWaitlistLeads(tenantId, { date: (appts[0].inicio as string).substring(0, 10) }).catch(console.error);
        }
      }
    } catch (e) { console.error('[Agent] cancelled extraction error:', e); }
    clearSession(tenantId, phone);
    return brain.reply;
  }

  // ─── Handle waitlist request ─────────────────────────────────────────
  if (brain.extracted.waitlist === true) {
    try {
      const { data: custWl } = await supabase
        .from('customers').select('id')
        .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
      if (custWl) {
        const s = await db.getSettings(tenantId);
        const allCData = { ...(s.customerData || {}) };
        allCData[custWl.id] = { ...( allCData[custWl.id] || {}), waitlistAlert: true };
        await db.updateSettings(tenantId, { customerData: allCData });
      }
    } catch (e) { console.error('[Agent] waitlist save error:', e); }
  }

  // ─── Mark as pending confirm when summary was shown ────────────────
  if (brain.extracted.time || session.data.time) {
    const allKnown = session.data.serviceId && session.data.professionalId &&
      session.data.date && session.data.time;
    if (allKnown) session.data.pendingConfirm = true;
  }

  if (shouldGreet) session.data.greetedAt = brasiliaDate; // persist so cold-start doesn't re-greet
  const finalReply = brain.reply;
  session.history.push({ role: 'bot', text: finalReply });
  saveSession(session);
  if (shouldGreet) _greetedToday.set(_greetKey, brasiliaDate);
  return finalReply;
}
