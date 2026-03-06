/**
 * AgendeZap — Edge Function: whatsapp-webhook
 *
 * Recebe webhooks da Evolution API e processa mensagens 24/7,
 * mesmo com o navegador fechado. Sessões persistidas no Supabase.
 *
 * Deploy: supabase functions deploy whatsapp-webhook
 * URL:    https://cnnfnqrnjckntnxdgwae.supabase.co/functions/v1/whatsapp-webhook
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Deno/Supabase Edge Runtime global (not in TS lib)
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

// ── Config ────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EVO_URL = Deno.env.get('EVOLUTION_API_URL') || 'https://evolution-api-agendezap-evolution-api.xzftjp.easypanel.host';
const EVO_KEY = Deno.env.get('EVOLUTION_API_KEY') || '429683C4C977415CAAFCCE10F7D57E11';
const EVO_HEADERS = { 'Content-Type': 'application/json', 'apikey': EVO_KEY };

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — follow-up replies can come hours after the message

// ── Helpers ───────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');

function capitalizeName(s: string): string {
  return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'UTC',
  });
}

function extractPhone(msg: any): string | null {
  const candidates = [
    msg.key?.remoteJidAlt, msg.key?.participantAlt,
    msg.key?.remoteJid, msg.participant, msg.key?.participant,
  ];
  for (const c of candidates) {
    if (!c || c.includes('@lid') || c.includes('@g.us')) continue;
    const num = c.replace(/@.*/, '').replace(/\D/g, '');
    if (num.length >= 10 && num.length <= 13) return num;
  }
  return null;
}

// ── Session management (Supabase table: agent_sessions) ───────────────
async function getSession(tenantId: string, phone: string): Promise<any | null> {
  const { data } = await supabase.from('agent_sessions')
    .select('data, history, updated_at')
    .eq('tenant_id', tenantId).eq('phone', phone).maybeSingle();
  if (!data) return null;
  if (Date.now() - new Date(data.updated_at).getTime() > SESSION_TTL_MS) {
    await supabase.from('agent_sessions').delete().eq('tenant_id', tenantId).eq('phone', phone);
    return null;
  }
  return { data: data.data || {}, history: data.history || [] };
}

async function saveSession(tenantId: string, phone: string, data: any, history: any[]) {
  await supabase.from('agent_sessions').upsert(
    { tenant_id: tenantId, phone, data, history: history.slice(-20), updated_at: new Date().toISOString() },
    { onConflict: 'tenant_id,phone' }
  );
}

async function clearSession(tenantId: string, phone: string) {
  await supabase.from('agent_sessions').delete().eq('tenant_id', tenantId).eq('phone', phone);
}

// ── Persistent WhatsApp message history ──────────────────────────────
async function saveWaMsg(
  tenantId: string, msgId: string, phone: string,
  body: string, ts: number, pushName: string, msgType: string, fromMe: boolean, raw: any = {}
) {
  try {
    await supabase.from('whatsapp_messages').upsert({
      msg_id:    msgId || `${phone}_${ts}`,
      tenant_id: tenantId,
      phone,
      direction: fromMe ? 'out' : 'in',
      body:      body      || '',
      msg_type:  msgType   || 'text',
      push_name: pushName  || phone,
      from_me:   fromMe,
      ts,
      raw,
    }, { onConflict: 'tenant_id,msg_id', ignoreDuplicates: true });
  } catch { /* non-fatal */ }
}

// ── Dedup (shares msg_dedup table with browser polling) ──────────────
async function claimMsg(key: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('msg_dedup').insert({ fp: key });
    if (error?.code === '23505') return false; // already processed
    if (error) return true;  // table missing → fail open
    // prune old entries older than 24h (fire-and-forget)
    (async () => { try { await supabase.from('msg_dedup').delete().lt('ts', new Date(Date.now() - 86_400_000).toISOString()); } catch {} })();
    return true;
  } catch { return true; }
}

// ── Audio transcription ───────────────────────────────────────────────
async function fetchAudioBase64(instanceName: string, msg: any): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(`${EVO_URL}/chat/getBase64FromMediaMessage/${instanceName}`, {
      method: 'POST', headers: EVO_HEADERS,
      body: JSON.stringify({ message: msg, convertToMp4: false }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    const base64 = d.base64 || d.data || '';
    if (!base64) return null;
    return { base64, mimeType: d.mimetype || d.mimeType || 'audio/ogg' };
  } catch { return null; }
}

async function transcribeAudio(apiKey: string, base64: string, mimeType: string): Promise<string | null> {
  if (apiKey.startsWith('sk-')) {
    // OpenAI Whisper
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('webm') ? 'webm' : 'ogg';
      const blob = new Blob([bytes], { type: mimeType });
      const form = new FormData();
      form.append('file', blob, `audio.${ext}`);
      form.append('model', 'whisper-1');
      form.append('language', 'pt');
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: form,
      });
      if (!res.ok) return null;
      return (await res.json()).text?.trim() || null;
    } catch { return null; }
  } else {
    // Gemini
    try {
      const mime = mimeType === 'audio/ogg' ? 'audio/ogg; codecs=opus' : mimeType;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { inline_data: { mime_type: mime, data: base64 } },
            { text: 'Transcreva exatamente o que foi dito em português. Retorne APENAS o texto transcrito.' }
          ]}],
        }),
      });
      if (!res.ok) return null;
      return (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    } catch { return null; }
  }
}

// ── Available slots ───────────────────────────────────────────────────
async function getAvailableSlots(
  tenantId: string, professionalId: string, date: string,
  durationMinutes: number, settings: any
): Promise<string[]> {
  const dayIndex = new Date(date + 'T12:00:00').getDay();
  const dayConfig = settings.operatingHours?.[dayIndex];
  if (!dayConfig?.active) return [];

  const [startRange, endRange] = dayConfig.range.split('-');
  const [startH, startM] = startRange.split(':').map(Number);
  const [endH, endM] = endRange.split(':').map(Number);

  const { data: appts } = await supabase.from('appointments')
    .select('inicio, fim').eq('tenant_id', tenantId).eq('professional_id', professionalId)
    .neq('status', 'cancelado')  // IA cancela com 'cancelado'
    .neq('status', 'CANCELLED')  // frontend cancela com 'CANCELLED'
    .gte('inicio', `${date}T00:00:00`).lte('inicio', `${date}T23:59:59`);

  const breaks: any[] = settings.breaks || [];
  // Use Brazil time (UTC-3) for today's date and past-slot filtering
  const nowBrasilia = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const todayLocal = `${nowBrasilia.getUTCFullYear()}-${pad(nowBrasilia.getUTCMonth()+1)}-${pad(nowBrasilia.getUTCDate())}`;
  const isToday = date === todayLocal;
  const nowBrasiliaMinutes = nowBrasilia.getUTCHours() * 60 + nowBrasilia.getUTCMinutes();
  const slots: string[] = [];
  let cursor = startH * 60 + startM;
  const endCursor = endH * 60 + endM;
  // acceptLastSlot: permite iniciar no horário exato de fechamento
  const loopLimit = dayConfig.acceptLastSlot ? endCursor : endCursor - durationMinutes;

  while (cursor <= loopLimit) {
    const h = Math.floor(cursor / 60), m = cursor % 60;
    const label = `${pad(h)}:${pad(m)}`;
    const slotStart = new Date(`${date}T${label}:00`);
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);
    const slotEndLabel = `${pad(slotEnd.getHours())}:${pad(slotEnd.getMinutes())}`;

    if (isToday && (h * 60 + m) <= nowBrasiliaMinutes) { cursor += 30; continue; }
    const BUFFER_MS = 11 * 60 * 1000; // últimos 11 min do procedimento anterior são compartilháveis
    const conflict = (appts || []).some((a: any) => {
      const aStart = new Date(a.inicio), aEnd = new Date(a.fim);
      if (!(aStart < slotEnd && aEnd > slotStart)) return false;
      return slotStart.getTime() < aEnd.getTime() - BUFFER_MS;
    });
    if (conflict) { cursor += 30; continue; }
    const brk = breaks.some((b: any) => {
      if (b.professionalId && b.professionalId !== professionalId) return false;
      // Férias: verifica faixa de datas (date → vacationEndDate)
      if (b.type === 'vacation') {
        const vacStart = b.date || '';
        const vacEnd = b.vacationEndDate || b.date || '';
        return !!vacStart && date >= vacStart && date <= vacEnd;
      }
      if (b.date && b.date !== date) return false;
      if (b.dayOfWeek != null && b.dayOfWeek !== dayIndex) return false;
      return label < b.endTime && slotEndLabel > b.startTime;
    });
    if (brk) { cursor += 30; continue; }
    slots.push(label);
    cursor += 30;
  }
  return slots;
}

// ── Token tracking helpers ────────────────────────────────────────────
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini':      { input: 0.150 / 1_000_000, output: 0.600 / 1_000_000 },
  'gemini-2.0-flash': { input: 0, output: 0 },
};

function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

async function logAIUsage(params: {
  tenant_id: string; phone_number?: string;
  input_tokens: number; output_tokens: number;
  model: string; success: boolean;
}): Promise<void> {
  try {
    const p = MODEL_PRICING[params.model] ?? MODEL_PRICING['gpt-4o-mini'];
    const cost = params.input_tokens * p.input + params.output_tokens * p.output;
    await supabase.from('ai_usage_logs').insert({
      tenant_id: params.tenant_id,
      phone_number: params.phone_number,
      input_tokens: params.input_tokens,
      output_tokens: params.output_tokens,
      total_tokens: params.input_tokens + params.output_tokens,
      model: params.model,
      estimated_cost_usd: cost,
      success: params.success,
    });
  } catch (_e) { /* non-critical */ }
}

// ── AI Brain ─────────────────────────────────────────────────────────
async function callBrain(
  apiKey: string, tenantName: string, today: string,
  services: any[], professionals: any[],
  history: any[], data: any,
  availableSlots?: string[], customSystemPrompt?: string,
  shouldGreet?: boolean, brasiliaGreeting?: string,
  tenantId?: string, phone?: string,
  vacationCtx?: string
): Promise<any | null> {
  const svcList = services.map(s => `• ${s.name} (${s.durationMinutes}min, R$${s.price.toFixed(2)}) — ID:"${s.id}"`).join('\n');
  const profList = professionals.length > 0 ? professionals.map(p => `• ${p.name} — ID:"${p.id}"`).join('\n') : '• (apenas um profissional disponível)';

  const known: string[] = [];
  if (data.clientName) known.push(`Nome: ${data.clientName}`);
  if (data.serviceName) known.push(`Serviço: ${data.serviceName}`);
  if (data.professionalName) known.push(`Profissional: ${data.professionalName}`);
  if (data.date) known.push(`Data: ${formatDate(data.date)}`);
  if (data.time) known.push(`Horário: ${data.time}`);
  if (data.preferredTime && !data.time) known.push(`Preferência de horário: a partir das ${data.preferredTime}`);
  if ((data as any).requestedQuantity && (data as any).requestedQuantity > 1) known.push(`Quantidade de horários solicitada: ${(data as any).requestedQuantity} (o cliente quer marcar ${(data as any).requestedQuantity} horários/pessoas)`);
  if (data.pendingReschedule) {
    if (data.pendingReschedule.isEarlierSlot) {
      known.push(`ADIANTAMENTO EM ANDAMENTO: cliente quer horário mais cedo do que ${data.pendingReschedule.oldTime} hoje com ${data.pendingReschedule.oldProfName} — horários disponíveis mais cedo listados abaixo`);
    } else {
      known.push(`REAGENDAMENTO EM ANDAMENTO: cancelar agendamento de ${formatDate(data.pendingReschedule.oldDate)} às ${data.pendingReschedule.oldTime} com ${data.pendingReschedule.oldProfName}`);
      if (!data.date) known.push(`Nova data: ainda não informada — pergunte`);
    }
  }

  const slotsSection = availableSlots?.length
    ? `\nHORÁRIOS DISPONÍVEIS (use APENAS estes — NUNCA invente horários fora desta lista):\n${availableSlots.slice(0, 12).map(s => `• ${s}`).join('\n')}`
    : (data.professionalId && data.date
      ? (data.serviceId
        ? '\n⚠️ NENHUM HORÁRIO DISPONÍVEL — NÃO sugira horários. Informe que a agenda está cheia e ofereça outro dia.'
        : '\n🚫 SERVIÇO NÃO DEFINIDO — ⛔ PROIBIDO mencionar ou sugerir QUALQUER horário específico (ex: "16:00", "17:00"). Pergunte APENAS: "Qual procedimento/serviço você gostaria?" — a disponibilidade depende da duração do serviço.')
      : '');

  const histStr = history.slice(-10).map((h: any) => `${h.role === 'user' ? 'Cliente' : 'Agente'}: ${h.text}`).join('\n');
  const isFirst = history.filter((h: any) => h.role === 'bot').length === 0;

  const greetSection = shouldGreet
    ? `\n🌅 PRIMEIRA SAUDAÇÃO DO DIA:
• Cumprimente com "${brasiliaGreeting}!" de forma calorosa e apresente o estabelecimento: "${tenantName}".
• Pergunte apenas "Como posso te ajudar?" — nada mais.
• ❌ NÃO liste serviços, profissionais, preços nem horários na saudação inicial.
• ✅ Exemplo: "${brasiliaGreeting}! Seja bem-vindo ao ${tenantName} 😊 Como posso te ajudar?"\n`
    : '';

  const flowSection = `\n📋 FLUXO (siga nesta ordem — pule etapas já no CONTEXTO ATUAL ou que o cliente já informou):
1️⃣ SERVIÇO → 2️⃣ PROFISSIONAL → 3️⃣ DIA → 4️⃣ HORÁRIO → 5️⃣ CONFIRMAÇÃO
• Se cliente perguntar sobre horários SEM mencionar dia ("tem horário?", "como estão os horários?", "horário disponível", "tem vaga?") → assuma HOJE e mostre os horários disponíveis de hoje
⚡ QUANDO NÃO HÁ HORÁRIO DISPONÍVEL — protocolo obrigatório (NUNCA apenas diga "que pena"):
1. Tente MESMO DIA: "Esse horário não está disponível, mas hoje ainda tenho [lista de horários]. Algum serve?"
2. Se cliente recusar todos do mesmo dia (ou não houver mais): sugira o HORÁRIO DESEJADO no próximo dia disponível: "Amanhã às [hora desejada] está disponível. Serve?"
3. Se o horário desejado não tiver no próximo dia: ofereça o horário mais próximo disponível nos próximos dias\n`;

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
• "Não vou poder ir amanhã" / "não consigo ir" / "não vou conseguir [horário]" / "não vou chegar a tempo" / "não vai dar tempo" = intenção implícita → perguntar: "Quer que eu cancele seu agendamento de [data] às [hora] com [prof]? Se quiser remarcar, posso ajudar também!"
• ⚠️ "Não consigo mudar meu horário" = "minha agenda pessoal não permite que eu apareça" (NÃO é recusa de reagendamento) — tratar como cancelamento implícito
• ⚠️ "Tchau" junto com relato de impossibilidade = despedida informal + cancelamento, NÃO é só uma saudação de saída
• Cliente com múltiplos agendamentos futuros → listar todos e perguntar qual(is) cancelar
• Linguagem informal ("desisti", "tira meu nome", "me tira da agenda de sexta", "não vou dar tempo", "vou perder o horário") → identificar agendamento + confirmar antes de cancelar

🔄 REAGENDAR — protocolo obrigatório:
• "Mais cedo" / "mais tarde" = vago → clarificar: "Mais cedo no mesmo dia ou em outra data?"
• "Semana que vem mesmo horário" → VERIFICAR disponibilidade ANTES de confirmar (não assume que tem vaga)
• "Atrasou" / "Chego X min depois" / "Vou atrasar" / "Estou atrasado" = AVISO DE ATRASO, NÃO reagendamento → responder: "Entendido! Vou avisar ao [profissional]. Te esperamos! 😊" — NÃO altere data/hora/cancelled
• "Trocar de barbeiro, manter horário" → verificar disponibilidade do novo prof naquele slot ANTES de confirmar
• "Primeiro horário do [prof]" = duas ações → cancelar atual + agendar novo → confirmar as duas juntas: "O primeiro horário do [prof] é [data/hora]. Confirmo o reagendamento e cancelo o seu atual ([data/hora])?"

🏖️ PROFISSIONAL DE FÉRIAS — protocolo obrigatório:
• Se o cliente pedir um profissional que está DE FÉRIAS → informe que está de férias e quando retorna. Ofereça alternativa UMA VEZ.
• Se o cliente INSISTIR que quer SOMENTE aquele profissional ("só com o [nome]", "somente com o [nome]", "quero esperar o [nome]") → RESPEITE a escolha. NÃO insista em outro profissional. Diga: "Entendido! O [nome] retorna [data]. Posso te avisar quando ele voltar? 😊"
• NUNCA "discuta" com o cliente sobre a escolha de profissional — se ele quer esperar, aceite.

📋 CONSULTAS — responder a pergunta ≠ agendar automaticamente:
• "Vocês trabalham domingo?" / "qual o horário de vocês?" → informar funcionamento; só depois oferecer agendar
• "Quanto tempo demora um procedimento?" → informar duração; só depois oferecer agendar
• "O [prof] tá disponível essa semana?" / "tá de folga?" → informar disponibilidade do profissional; só depois oferecer agendar
• "Tem vaga hoje?" / "Como estão os horários?" / "Tem horário?" SEM dia → mostre os horários disponíveis de HOJE + "Quer agendar? Qual serviço?" — NÃO crie agendamento ainda
• "Para hoje" / "quero pra hoje" no meio do fluxo → mude o DIA para hoje e consulte os horários disponíveis

🗣️ LINGUAGEM COLOQUIAL DE SERVIÇOS — quando o cliente usa termo informal que mapeia claramente para um serviço, preencha o serviço automaticamente NO extracted.service e NÃO pergunte "qual serviço?" — prossiga direto para data/horário:
CORTE DE CABELO → "cabelo" / "cabeça" / "cortar a cabeça" / "cabecinha" / "cortar o cabelo" / "cortar o cabelo do meu filho/da minha filha" / "aparar" / "dar uma aparada" / "dar um trato no cabelo" / "dar um jeito no cabelo" / "fazer o cabelo" / "tirar o excesso" / "franja" / "ligar" / "passar o pente" / "zerar" / "na máquina" / "renovar o visual" / "dar uma caprichada"
BARBA → "barba" / "fazer a barba" / "tirar a barba" / "aparar a barba" / "dar um trato na barba" / "modelar a barba" / "barba e bigode"
BIGODE → "bigode" / "aparar o bigode"
SOBRANCELHA → "sobrancelha" / "sombrancelha" / "fazer a sobrancelha" / "tirar a sobrancelha" / "design de sobrancelha"
COLORAÇÃO → "pintar o cabelo" / "colorir" / "loiro" / "mechas" / "ombré" / "reflexo" / "tingir"
ALISAMENTO → "alisar" / "relaxar" / "progressiva" / "escova progressiva" / "botox capilar"
ESCOVA → "escova" / "dar uma escovada" / "modelar o cabelo"
• REGRA GERAL: se o cliente menciona qualquer parte do corpo ou gíria de serviço que claramente identifica UM serviço da lista, assuma esse serviço — NÃO peça confirmação do serviço, peça data/horário diretamente

🔀 AMBÍGUO — não assuma, pergunte com contexto:
• Saudação simples ("oi", "tudo bem?", "boa tarde") → cumprimentar + "Como posso te ajudar?"
• "Acabei de sair do trabalho" = intenção implícita de horário tardio → "Que horas você chega? Nosso último horário hoje é às [hora]."
• "Fala com minha esposa, ela que organiza" → "Claro! Pode passar o contato dela ou ela pode me chamar diretamente por aqui."
• Mensagem com dois pedidos ("me manda o endereço e já agendo") → atender os dois na mesma resposta\n`;

  const profSelectionRule = professionals.length > 1 && !data.professionalId
    ? `\n⚠️ PROFISSIONAL — ainda não definido. Profissionais disponíveis: ${professionals.map((p: any) => `${p.name} (ID:"${p.id}")`).join(', ')}
• Se o cliente mencionou um nome NESTA MENSAGEM → extraia o professionalId e confirme.
• Se o cliente disser "qualquer um", "tanto faz", "quem estiver disponível", "pode ser qualquer", "quem tiver" ou similar → ESCOLHA AUTOMATICAMENTE ${professionals[0]?.name}. Diga: "Pode ser com ${professionals[0]?.name} então! 😊 Tem algum dia de preferência?" e defina o professionalId.
• Se NÃO mencionou e NÃO disse "qualquer" → pergunte: "Com qual profissional prefere? Temos: ${professionals.map((p: any) => p.name).join(', ')}"
• NUNCA repita a pergunta se o cliente já disse um nome ou já aceitou qualquer profissional.
• Se o cliente questionar uma escolha sua → "Desculpe! Com qual prefere? ${professionals.map((p: any) => p.name).join(' ou ')}?" e retorne professionalId: null.\n`
    : '';

  // Ensure we have ISO format for date calculations (handles both "YYYY-MM-DD" and formatted strings)
  const todayISOClean = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : (() => {
    // Extract date from formatted string like "sexta-feira, 06/03/2026"
    const m = today.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : today;
  })();
  const [ty, tm, td] = todayISOClean.split('-').map(Number);
  const tomorrowDate = new Date(Date.UTC(ty, tm-1, td+1));
  const tomorrowISO = `${tomorrowDate.getUTCFullYear()}-${pad(tomorrowDate.getUTCMonth()+1)}-${pad(tomorrowDate.getUTCDate())}`;
  const todayFormatted = formatDate(todayISOClean);
  const todayDow = DOW_PT[new Date(todayISOClean+'T12:00:00Z').getUTCDay()];
  const tomorrowDow = DOW_PT[tomorrowDate.getUTCDay()];

  const prompt = `Você é o ATENDENTE DE WHATSAPP de "${tenantName}". Hoje é ${todayFormatted} (${todayDow}).
Atendente brasileiro — informal, caloroso, direto. Máximo 2-3 linhas por resposta.
${customSystemPrompt ? `\n--- REGRAS DO ESTABELECIMENTO ---\n${customSystemPrompt}\n---\n` : ''}${greetSection}
SERVIÇOS: ${svcList}
PROFISSIONAIS: ${profList}${vacationCtx ? `\n${vacationCtx}` : ''}${slotsSection}

CONTEXTO ATUAL: ${known.length > 0 ? known.join(' | ') : 'nenhuma informação coletada ainda'}
${data.pendingConfirm ? '\n⚠️ RESUMO JÁ MOSTRADO — se cliente afirmar ("sim","ok","pode","beleza","bora","fechou","isso","confirma") → "confirmed":true OBRIGATORIAMENTE.' : ''}

HISTÓRICO (mais recente no final):
${histStr}
${flowSection}${profSelectionRule}${behaviorRules}
════════════════════════════════
COMO RESPONDER:
════════════════════════════════

📏 FORMATO:
• Máximo 2-3 linhas • Tom informal brasileiro • Emojis: use APENAS na saudação inicial ou ao confirmar agendamento. Na grande maioria das mensagens NÃO use emoji. • Sempre termine com pergunta

${isFirst && !shouldGreet ? '📥 PRIMEIRA MENSAGEM: o cliente já enviou uma solicitação com contexto — NÃO cumprimente ("Boa noite! Seja bem-vindo..."), vá direto ao ponto. Processe tudo que o cliente informou sem perguntar de novo. Se já houver Data e Preferência de horário no CONTEXTO ATUAL, confirme-os na resposta.\n' : ''}
📅 AO OFERECER HORÁRIO (somente após profissional já definido no CONTEXTO ATUAL):
• ❌ ERRADO: "Temos disponível às 15:00"
• ✅ CERTO: "Com o [profissional escolhido] às 15:00 pode ser? 😊"

❌ HORÁRIO INDISPONÍVEL: explique + ofereça alternativa + pergunte "Serve?"
✅ CONFIRMAÇÃO: "confirmed":true → responda só "Agendado! Te esperamos 😊"
🔄 DESISTÊNCIA: aceite naturalmente, sem drama

💡 CASOS ESPECIAIS:
• 2 serviços → use o de maior duração ou combo
• 2 pessoas → descubra o serviço do cliente primeiro, depois pergunte sobre o acompanhante
• 2 profissionais opcionais (cliente diz EXPLICITAMENTE "X ou Y") → somente neste caso escolha o disponível
• Preço → informe direto: "Corte está R$40,00"
• Agenda cheia → sugira outra semana
• Lista de espera: se cliente pedir "se alguém cancelar me avisa", "me manda se abrir um horário antes", "lista de espera", "se tiver desistência" → responda que anotou e irá avisar; defina waitlist:true no JSON.
• Reagendamento: se CONTEXTO ATUAL tiver "REAGENDAMENTO EM ANDAMENTO":
  - Nova data JÁ no contexto → mostre resumo: "Vou cancelar seu agendamento de [data_antiga] às [hora] com [prof] e marcar para [nova_data] às [hora]. Confirma?" → aguarde confirmação
  - Nova data AUSENTE → pergunte: "Para qual data você quer remarcar?"
  - Após confirmação → defina confirmed:true (sistema cancela o antigo e cria o novo automaticamente)
  - Se cliente perguntar "qual dia está agendado?" / "qual meu horário?" / "o que tenho marcado?" → responda com os dados do contexto: "Você tem agendado para [data_antiga] às [hora] com [prof]. Para qual data quer remarcar?"
  - Se cliente demonstrar confusão ("não entendi", "o que você falou?", "tá errado") → pare o fluxo, reconheça: "Desculpe a confusão! 😅 O que posso fazer por você?"
• Adiantamento (horário mais cedo): se CONTEXTO ATUAL tiver "ADIANTAMENTO EM ANDAMENTO":
  - Ofereça os horários disponíveis mais cedo: "Tem sim! Teria às [X] ou [Y]. Qual você prefere?"
  - Se cliente escolher um horário → extraia o time no JSON → defina confirmed:true
  - Se cliente não quiser / preferir manter o original → responda "Tudo bem! Mantenho o das [hora_original] então. Te esperamos! 😊" e defina confirmed:false

════════════════════════════════
EXTRAÇÃO:
════════════════════════════════
• Horários: "nove horas"→"09:00", "três da tarde"→"15:00", "meio dia"→"12:00"
• NUNCA repita perguntas sobre info já no CONTEXTO ATUAL
• Use horários SOMENTE da lista disponível
• waitlist: true se cliente pediu lista de espera / ser avisado se abrir horário
• reschedule: true se cliente disse que quer reagendar / remarcar horário JÁ existente ("tenho horário mas não vou conseguir ir", "preciso mudar meu horário", "não consigo chegar a tempo, quero remarcar")
📅 DATAS (retorne SEMPRE em YYYY-MM-DD):
• "hoje" → ${todayISOClean} (${todayDow}) | "amanhã" → ${tomorrowISO} (${tomorrowDow})
• Dia da semana (ex: "sábado") → calcule o PRÓXIMO a partir de hoje (${todayISOClean}, ${todayDow})
• Nunca extraia datas no passado — se o dia já passou esta semana, use a próxima semana

RESPONDA APENAS COM JSON VÁLIDO (sem markdown, sem \`\`\`):
{"reply":"...","extracted":{"clientName":null,"serviceId":null,"professionalId":null,"date":null,"time":null,"confirmed":null,"cancelled":null,"waitlist":null,"reschedule":null}}`;

  try {
    if (apiKey.startsWith('sk-')) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Você responde APENAS com JSON válido conforme solicitado.' },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' }
        })
      });
      if (!res.ok) { console.error('[Brain] OpenAI', res.status, await res.text().catch(() => '')); return null; }
      const d = await res.json();
      const result = JSON.parse(d.choices?.[0]?.message?.content || 'null');
      if (tenantId) {
        logAIUsage({
          tenant_id: tenantId, phone_number: phone,
          input_tokens: d.usage?.prompt_tokens ?? estimateTokens(prompt),
          output_tokens: d.usage?.completion_tokens ?? estimateTokens(result?.reply ?? ''),
          model: 'gpt-4o-mini', success: !!result,
        }).catch(() => {});
      }
      return result;
    } else {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } })
      });
      if (!res.ok) { console.error('[Brain] Gemini', res.status); return null; }
      const gd = await res.json();
      const gResult = JSON.parse(gd.candidates?.[0]?.content?.parts?.[0]?.text || 'null');
      if (tenantId) {
        const usage = gd.usageMetadata;
        logAIUsage({
          tenant_id: tenantId, phone_number: phone,
          input_tokens: usage?.promptTokenCount ?? estimateTokens(prompt),
          output_tokens: usage?.candidatesTokenCount ?? estimateTokens(gResult?.reply ?? ''),
          model: 'gemini-2.0-flash', success: !!gResult,
        }).catch(() => {});
      }
      return gResult;
    }
  } catch (e) { console.error('[Brain] error:', e); return null; }
}

// ── Send-side dedup: blocks exact same message to same phone within 3 min ──
const _wSentDedup = new Map<string, number>();
const _W_DEDUP_TTL = 180_000; // 3 minutes

function _isWDuplicate(phone: string, text: string): boolean {
  const key = `${phone.replace(/\D/g, '')}::${text.trim().slice(0, 120)}`;
  const now = Date.now();
  const last = _wSentDedup.get(key);
  if (last !== undefined && now - last < _W_DEDUP_TTL) return true;
  _wSentDedup.set(key, now);
  if (_wSentDedup.size > 500) {
    for (const [k, t] of _wSentDedup) { if (now - t > _W_DEDUP_TTL) _wSentDedup.delete(k); }
  }
  return false;
}

// ── Send WhatsApp message ─────────────────────────────────────────────
async function sendMsg(instanceName: string, phone: string, text: string, tenantId?: string) {
  if (_isWDuplicate(phone, text)) {
    console.log(`[sendMsg] Dedup: blocked duplicate → ${phone}`);
    return;
  }
  await fetch(`${EVO_URL}/message/sendText/${instanceName}`, {
    method: 'POST', headers: EVO_HEADERS,
    body: JSON.stringify({ number: phone, text, linkPreview: false }),
  }).catch(e => console.error('[sendMsg] error:', e));
  // Persist outgoing message so ConversationsView shows full history
  if (tenantId) {
    saveWaMsg(
      tenantId,
      `out_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      phone, text, Math.floor(Date.now() / 1000), 'Bot', 'text', true
    ).catch(() => {});
  }
}

// ── Notify waitlist leads when a slot opens (appointment cancelled) ────
async function notifyWaitlistLeadsInline(tenantId: string, date?: string) {
  try {
    const { data: tenantRow } = await supabase.from('tenants').select('evolution_instance, nome, name').eq('id', tenantId).maybeSingle();
    const inst: string = tenantRow?.evolution_instance || '';
    if (!inst) return;
    const tenantName: string = tenantRow?.nome || tenantRow?.name || 'Nosso estabelecimento';

    const { data: sRow } = await supabase.from('tenant_settings').select('follow_up').eq('tenant_id', tenantId).maybeSingle();
    const fu = sRow?.follow_up || {};
    const customerData: Record<string, any> = fu._customerData || {};

    const waitlistIds = Object.entries(customerData)
      .filter(([, v]) => (v as any)?.waitlistAlert === true)
      .map(([id]) => id);
    if (waitlistIds.length === 0) return;

    const { data: customers } = await supabase.from('customers').select('id, nome, telefone').in('id', waitlistIds).eq('tenant_id', tenantId);
    if (!customers || customers.length === 0) return;

    const dateCtx = date ? ` no dia *${date.split('-').reverse().join('/')}*` : '';
    const updatedCData = { ...customerData };

    for (const cust of customers) {
      if (!cust.telefone) continue;
      const firstName = (cust.nome as string)?.split(' ')[0] || 'cliente';
      const msg = `⚡ *Oi, ${firstName}!* Surgiu um horário disponível${dateCtx} aqui no *${tenantName}*!\n\nSe ainda tiver interesse, é só me responder que a gente encaixa. 😊`;
      await fetch(`${EVO_URL}/message/sendText/${inst}`, {
        method: 'POST', headers: EVO_HEADERS,
        body: JSON.stringify({ number: cust.telefone, text: msg, linkPreview: false }),
      }).catch(e => console.error('[waitlist] sendMsg error:', e));
      updatedCData[cust.id] = { ...(updatedCData[cust.id] || {}), waitlistAlert: false };
    }

    await supabase.from('tenant_settings').upsert({ tenant_id: tenantId, follow_up: { ...fu, _customerData: updatedCData } });
  } catch (e) {
    console.error('[waitlist] notifyWaitlistLeadsInline error:', e);
  }
}

// ── Relative date resolver (TypeScript layer — before LLM call) ───────
function resolveRelativeDate(text: string, todayISO: string): string | null {
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const t = norm(text);
  const [y, mo, dy] = todayISO.split('-').map(Number);
  const todayUTC = new Date(Date.UTC(y, mo - 1, dy));
  const todayDow = todayUTC.getUTCDay(); // 0=Dom,1=Seg,...,6=Sab
  const p2 = (n: number) => String(n).padStart(2, '0');
  const addDays = (n: number): string => {
    const d = new Date(Date.UTC(y, mo - 1, dy + n));
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth()+1)}-${p2(d.getUTCDate())}`;
  };
  if (/\bhoje\b/.test(t)) return todayISO;
  if (/\bamanha\b/.test(t)) return addDays(1);
  if (/depois de amanha|depois do amanha/.test(t)) return addDays(2);
  const dayMap: [RegExp, number][] = [
    [/\bdomingo\b/, 0], [/\bsegunda(-feira)?\b/, 1], [/\bterca(-feira)?\b/, 2],
    [/\bquarta(-feira)?\b/, 3], [/\bquinta(-feira)?\b/, 4], [/\bsexta(-feira)?\b/, 5],
    [/\bsabado\b/, 6],
  ];
  const isNext = /proxim|semana que vem|semana proxim|outra semana/.test(t);
  for (const [re, dow] of dayMap) {
    if (re.test(t)) {
      let diff = dow - todayDow;
      if (diff < 0) diff += 7;
      if (isNext) {
        const daysToSunday = todayDow === 0 ? 0 : 7 - todayDow;
        if (diff <= daysToSunday) diff += 7;
      }
      return addDays(diff);
    }
  }
  // Absolute date: "10/03", "10/03/2026", "dia 10/03", "dia 10"
  const absMatch = t.match(/(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (absMatch) {
    const dd = parseInt(absMatch[1], 10);
    const mm = parseInt(absMatch[2], 10);
    const yyyy = absMatch[3] ? (absMatch[3].length === 2 ? 2000 + parseInt(absMatch[3], 10) : parseInt(absMatch[3], 10)) : y;
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      return `${yyyy}-${p2(mm)}-${p2(dd)}`;
    }
  }
  // "dia 10" (only day, no month) → assume current or next month
  const dayOnly = t.match(/\bdia\s+(\d{1,2})\b/);
  if (dayOnly && !absMatch) {
    const dd = parseInt(dayOnly[1], 10);
    if (dd >= 1 && dd <= 31) {
      // If the day already passed this month, use next month
      let mm2 = mo, yy2 = y;
      if (dd < dy) { mm2++; if (mm2 > 12) { mm2 = 1; yy2++; } }
      return `${yy2}-${p2(mm2)}-${p2(dd)}`;
    }
  }
  return null;
}

// ── Day of week in Portuguese ─────────────────────────────────────────
const DOW_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

// ── Professional name matcher ─────────────────────────────────────────
function matchProfessionalName(text: string, professionals: Array<{ id: string; name: string }>): { id: string; name: string } | null {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim();
  const brNorm = (s: string) =>
    s.replace(/th/g, 't').replace(/ph/g, 'f').replace(/([a-z])\1/g, '$1').replace(/y/g, 'i').replace(/ck/g, 'c').replace(/w/g, 'v');
  const normText = norm(text);
  const textWords = normText.split(/\s+/);

  // 1. Full name exact word match (e.g. "com Gil Santos" matches "Gil Santos")
  for (const p of professionals) {
    const pNorm = norm(p.name);
    if (new RegExp(`\\b${pNorm.replace(/\s+/g, '\\s+')}\\b`).test(normText)) return p;
  }

  // 2. First name exact word match — must be a whole word in the message
  //    "Gil" matches " gil " but NOT "gilson" (word boundary prevents substring match)
  for (const p of professionals) {
    const first = norm(p.name).split(' ')[0];
    if (first.length >= 3 && new RegExp(`\\b${first}\\b`).test(normText)) return p;
  }

  // 3. Nickname/abbreviation: message word (4+ chars) matches inside a name part
  //    e.g. "Lipe" inside "Felipe", "Beto" inside "Roberto"
  //    BUT skip if the message word is longer than the name part (prevents "gilson" matching "gil")
  for (const p of professionals) {
    const nameParts = norm(p.name).split(' ');
    for (const word of textWords.filter((w: string) => w.length >= 4)) {
      if (nameParts.some((part: string) => part.length >= word.length && part.includes(word))) return p;
    }
  }

  // 4. Brazilian spelling variation (Matheus↔Mateus, Thiago↔Tiago, Philipe↔Felipe)
  const brText = brNorm(normText);
  for (const p of professionals) {
    const brFirst = brNorm(norm(p.name).split(' ')[0]);
    if (brFirst.length >= 3 && new RegExp(`\\b${brFirst}\\b`).test(brText)) return p;
  }
  return null;
}

// ── Service keyword matcher ──────────────────────────────────────────
// Matches service by counting how many message keywords appear in each service name.
// "corte barba" → "Corte de Cabelo e Barba" (2 hits) over "Corte de Cabelo" (1 hit).
// Tiebreaker: higher coverage (hits / service words) wins.
function matchServiceByKeywords(
  text: string,
  services: Array<{ id: string; name: string; durationMinutes: number; price: number }>
): { id: string; name: string; durationMinutes: number; price: number } | null {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim();
  const normText = norm(text);
  const STOP = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'com', 'no', 'na', 'em', 'o', 'a', 'os', 'as', 'um', 'uma', 'pra', 'para', 'por', 'que', 'nao', 'sim', 'hoje', 'amanha', 'horas', 'hora', 'marca', 'marcar', 'agendar', 'reservar', 'quero', 'preciso', 'gostaria', 'favor', 'pode', 'vou', 'vai', 'ter', 'tem', 'boa', 'bom', 'tarde', 'noite', 'dia', 'manha', 'voce', 'viu', 'deixa', 'agendado']);

  // 1. Full service name as substring
  for (const svc of services) {
    if (normText.includes(norm(svc.name))) return svc;
  }

  // 2. Keyword overlap scoring
  const msgWords = normText.split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
  if (msgWords.length === 0) return null;

  let best: typeof services[0] | null = null;
  let bestHits = 0;
  let bestCoverage = 0;

  for (const svc of services) {
    const svcWords = norm(svc.name).split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
    if (svcWords.length === 0) continue;
    const hits = msgWords.filter(mw => svcWords.some(sw => sw.includes(mw) || mw.includes(sw))).length;
    const coverage = hits / svcWords.length;
    if (hits > bestHits || (hits === bestHits && coverage > bestCoverage)) {
      bestHits = hits;
      bestCoverage = coverage;
      best = svc;
    }
  }

  return bestHits >= 1 ? best : null;
}

// ── Brasília greeting ─────────────────────────────────────────────────
function getBrasiliaGreeting(): { greeting: string; dateStr: string } {
  const b = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const h = b.getUTCHours();
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    greeting: h < 12 ? 'bom dia' : h < 18 ? 'boa tarde' : 'boa noite',
    dateStr: `${b.getUTCFullYear()}-${p(b.getUTCMonth() + 1)}-${p(b.getUTCDate())}`,
  };
}

// ── Message debounce: aguarda 20s para acumular mensagens rápidas ─────
async function debouncedRun(tenant: any, phone: string, text: string, settings: any, pushName?: string) {
  const tenantId = tenant.id;
  const DEBOUNCE_MS = (settings.msgBufferSecs ?? 20) * 1_000;

  // Load current session and append this message to the pending queue
  const raw = await getSession(tenantId, phone) || { data: {}, history: [] };
  const pending: string[] = [...(raw.data._pendingMsgs || []), text];
  // Unique ID for this invocation — last writer wins
  const myId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  await saveSession(tenantId, phone,
    { ...raw.data, _pendingMsgs: pending, _processorId: myId },
    raw.history
  );

  // Wait for more messages to arrive
  await new Promise(r => setTimeout(r, DEBOUNCE_MS));

  // Re-read session to check if a newer invocation superseded us
  const fresh = await getSession(tenantId, phone);
  if (!fresh || fresh.data._processorId !== myId) {
    // Another message arrived after us — it will process the batch
    return;
  }

  // We are the final processor — combine all buffered messages
  const combined = ((fresh.data._pendingMsgs || []) as string[]).join('\n');

  // Clear debounce state so runAgent sees a clean session
  const cleanData = { ...fresh.data };
  delete cleanData._pendingMsgs;
  delete cleanData._processorId;
  await saveSession(tenantId, phone, cleanData, fresh.history);

  await runAgent(tenant, phone, combined || text, settings, pushName);
}

// ── Main agent logic ──────────────────────────────────────────────────
async function runAgent(tenant: any, phone: string, text: string, settings: any, pushName?: string) {
  const tenantId = tenant.id;
  const tenantName = tenant.nome || tenant.name || 'Barbearia';
  const instanceName = tenant.evolution_instance || `agz_${(tenant.slug || '').replace(/[^a-z0-9]/g, '')}`;

  // Key hierarchy: tenant key → global shared key → Gemini
  let apiKey = (settings.openaiApiKey || '').trim();
  if (!apiKey) {
    let globalRows: any[] = [];
    try {
      const { data } = await supabase.from('global_settings').select('key, value');
      globalRows = data || [];
    } catch (e) { console.error('[runAgent] global_settings fetch error:', e); }
    const sharedKey = (globalRows.find((r: any) => r.key === 'shared_openai_key')?.value || '').trim();
    apiKey = sharedKey || (tenant.gemini_api_key || '').trim();
  }
  if (!apiKey) { console.warn('[Agent] no API key for tenant', tenant.id); return; }

  const lowerText = text.toLowerCase();
  const isCancellation = ['cancelar', 'cancela', 'cancele', 'cancelamento'].some(k => lowerText.includes(k));
  // isReset: only trigger on very short messages (≤40 chars) to prevent false positives.
  // e.g. "vou sair cedinho" is NOT a reset command — the lead is just saying they're leaving.
  const isReset = lowerText.trim().length <= 40 &&
    ['sair', 'reiniciar', 'recomeçar', 'recomecar', 'esquece', 'esquecer'].some(k => lowerText.includes(k));

  // Pre-check: pending implicit-cancel confirmation (user previously asked to cancel)
  const preSession = await getSession(tenantId, phone);
  if (preSession?.data?.pendingCancelConfirm) {
    const { apptId, dtLabel, tmIC, profName } = preSession.data.pendingCancelConfirm as any;
    const normPCC = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const AFFIRM_PCC = ['sim', 'ok', 'pode', 'certo', 'cancela', 'cancelar', 'confirmo', 'bora', 'isso', 'claro', 'pode cancelar', 'cancela sim'];
    const DENY_PCC  = ['nao', 'não', 'negativo', 'nope', 'deixa', 'esquece'];
    const RESCHEDULE_PCC = ['remarcar', 'reagendar', 'mudar', 'trocar', 'outro dia', 'outro horario'];
    // Implicit cancel phrases — if present, the user is repeating "can't make it", not saying "no, keep it"
    const IMPLICIT_CANCEL_PCC = ['nao vou conseguir', 'nao vou chegar', 'nao consigo ir', 'nao consigo comparecer', 'nao vou comparecer', 'nao vou poder'];
    const hasImplicitCancelPCC = IMPLICIT_CANCEL_PCC.some(k => normPCC.includes(k));
    const isAffirmPCC  = AFFIRM_PCC.some(a => normPCC === a || normPCC.includes(a));
    // isDenyPCC: only fire on short/clear "no" replies — not on long messages that happen to contain "nao"
    const isDenyPCC    = !hasImplicitCancelPCC && normPCC.split(/\s+/).length <= 8 &&
      DENY_PCC.some(d => normPCC === d || normPCC.split(/\s+/).includes(d)) && !isAffirmPCC;
    const isReschPCC   = RESCHEDULE_PCC.some(r => normPCC.includes(r));

    if (isReschPCC || (isAffirmPCC && normPCC.includes('remarcar')) || (isAffirmPCC && normPCC.includes('reagendar'))) {
      // User wants to reschedule → convert to reschedule flow
      preSession.data.pendingCancelConfirm = undefined;
      preSession.data.pendingReschedule = preSession.data.pendingCancelConfirm_rescheduleData;
      await saveSession(tenantId, phone, preSession.data, preSession.history);
      // Fall through to normal flow with pendingReschedule set
    } else if (isAffirmPCC) {
      // User confirmed cancellation → cancel the appointment directly
      try {
        await supabase.from('appointments').update({ status: 'CANCELLED' }).eq('id', apptId).eq('tenant_id', tenantId);
        notifyWaitlistLeadsInline(tenantId).catch(console.error);
      } catch (eCPCC) { console.error('[Agent] pendingCancelConfirm cancel error:', eCPCC); }
      const replyPCC = `✅ Agendamento de *${dtLabel}* às *${tmIC}* com *${profName}* cancelado!\n\nSe quiser remarcar quando puder, é só me chamar. 😊`;
      preSession.history.push({ role: 'user', text }, { role: 'bot', text: replyPCC });
      await clearSession(tenantId, phone);
      await sendMsg(instanceName, phone, replyPCC, tenantId);
      return;
    } else if (isDenyPCC) {
      // User said no → keep the appointment
      preSession.data.pendingCancelConfirm = undefined;
      const replyPCC = `Tudo bem! Seu agendamento está mantido. Te esperamos! 😊`;
      preSession.history.push({ role: 'user', text }, { role: 'bot', text: replyPCC });
      await saveSession(tenantId, phone, preSession.data, preSession.history);
      await sendMsg(instanceName, phone, replyPCC, tenantId);
      return;
    } else {
      // Ambiguous or repeated implicit-cancel → clear pendingCancelConfirm and fall through
      // so the implicit-cancel detection block below can re-evaluate and re-ask correctly.
      preSession.data.pendingCancelConfirm = undefined;
      preSession.data.pendingCancelConfirm_rescheduleData = undefined;
      await saveSession(tenantId, phone, preSession.data, preSession.history);
    }
  }

  // Pre-check: user providing cancel reason
  if (preSession?.data?.pendingCancelReason) {
    await clearSession(tenantId, phone);
    try {
      const { data: customer } = await supabase.from('customers').select('id')
        .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
      if (customer) {
        const n = new Date();
        const nowLocal = `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}T${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
        const { data: appts } = await supabase.from('appointments').select('id, inicio')
          .eq('tenant_id', tenantId).eq('customer_id', customer.id)
          .in('status', ['CONFIRMED', 'PENDING', 'confirmado', 'pendente'])
          .gte('inicio', nowLocal).order('inicio', { ascending: true }).limit(1);
        if (appts && appts.length > 0) {
          await supabase.from('appointments').update({ status: 'CANCELLED' }).eq('id', appts[0].id);
          const dateFmt = new Date(appts[0].inicio.substring(0, 10) + 'T12:00:00')
            .toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
          await sendMsg(instanceName, phone, `✅ Agendamento de *${dateFmt}* cancelado!\n\nMotivo registrado. Obrigado pelo feedback! 😊`, tenantId);
          return;
        }
      }
    } catch (e) { console.error('[Agent] cancel-reason error:', e); }
    await sendMsg(instanceName, phone, `Cancelamento registrado! Obrigado por nos avisar. 😊`, tenantId);
    return;
  }

  if (isReset) {
    await clearSession(tenantId, phone);
    await sendMsg(instanceName, phone, `Tudo bem! Quando quiser agendar, é só me chamar. 😊`, tenantId);
    return;
  }

  if (isCancellation) {
    const sess = preSession || { data: {}, history: [] };
    sess.data.pendingCancelReason = true;
    await sendMsg(instanceName, phone, `Que pena que precisou cancelar! 😕\n\nPode nos contar o motivo? Isso nos ajuda a melhorar o atendimento. 🙏`, tenantId);
    saveSession(tenantId, phone, sess.data, sess.history).catch(e => console.error('[Agent] saveSession err:', e));
    return;
  }

  // Load data
  const [profsRes, svcsRes] = await Promise.all([
    supabase.from('professionals').select('id, nome, ativo, phone').eq('tenant_id', tenantId).eq('ativo', true),
    supabase.from('services').select('id, nome, preco, duracao_minutos, ativo').eq('tenant_id', tenantId).eq('ativo', true),
  ]);

  const profsRaw = profsRes.data || [];
  // Full list: used for name matching (client can request a prof on vacation → slot-check explains why)
  const professionals = profsRaw.map((p: any) => ({ id: p.id, name: (p.nome || '').trim(), phone: (p.phone || '').trim() }));

  // Use Brasília time for "today" (UTC-3)
  const nowBrasilia = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const todayISO = `${nowBrasilia.getUTCFullYear()}-${pad(nowBrasilia.getUTCMonth()+1)}-${pad(nowBrasilia.getUTCDate())}`;

  const services = (svcsRes.data || []).map((s: any) => ({
    id: s.id, name: s.nome, durationMinutes: s.duracao_minutos, price: Number(s.preco || 0)
  }));

  // Build custom system prompt with variable substitution
  let customPrompt = (settings.systemPrompt || '').trim();
  if (customPrompt) {
    const hoje = nowBrasilia.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    customPrompt = customPrompt
      .replace(/\$\{tenant\.nome\}/g, tenantName)
      .replace(/\$\{hoje\}/g, hoje)
      .replace(/\$\{tenant\.nicho\}/g, tenant.nicho || 'estabelecimento')
      .replace(/\$\{profStr\}/g, professionals.map(p => p.name).join(', '))
      .replace(/\$\{svcStr\}/g, services.map(s => `${s.name} (R$${s.price.toFixed(2)})`).join(', '));
  }

  // Get/create session
  let session = await getSession(tenantId, phone);
  if (!session) {
    const { data: existing } = await supabase.from('customers').select('nome')
      .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
    const knownName = existing?.nome || (pushName && pushName !== 'Cliente' ? pushName : null);
    session = { data: knownName ? { clientName: knownName } : {}, history: [] };
  }

  // Greeting flag (persisted in session to survive cold starts)
  const { greeting: brasiliaGreeting, dateStr: brasiliaDate } = getBrasiliaGreeting();
  const shouldGreet = session.data.greetedAt !== brasiliaDate;

  // ── Date-change during confirmation (TypeScript layer) ───────────────
  // Client was shown a slot (date+time set) but asks about a different day → reset and re-query
  if (session.data.date && session.data.time && !session.data.pendingReschedule) {
    const normDC = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const DATE_CHANGE_KW = [
      'amanha', 'depois de amanha', 'semana que vem',
      'proxima semana', 'proximo', 'proxima',
      'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo',
      'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira',
      'pra amanha', 'para amanha', 'no sabado', 'na sexta', 'na quinta',
      'na terca', 'na quarta', 'na segunda', 'no domingo',
      'outro dia', 'outro horario', 'outra data', 'mudar o dia', 'mudar para',
      'nao quero hoje', 'prefiro amanha', 'prefiro outro dia',
    ];
    const AFFIRM_DC = ['sim', 'ok', 'pode', 'confirmo', 'isso', 'beleza', 'bora', 'ta', 'tá', 'certo', 'fechado', 'quero', 'perfeito', 'claro', 'serve', 'yes'];
    const isAffirm = AFFIRM_DC.some(a => normDC === a || normDC.split(/\s+/).includes(a));
    const hasDateChange = !isAffirm && DATE_CHANGE_KW.some(k => normDC.includes(k));
    if (hasDateChange) {
      console.log('[Agent] Date-change during confirmation — resetting date/time');
      if (session.data.time) session.data.preferredTime = session.data.time;
      session.data.date = undefined;
      session.data.time = undefined;
      session.data.availableSlots = undefined;
      session.data.pendingConfirm = undefined;
    }
  }

  // ── Next available day detection (TypeScript layer) ───────────────────
  if (session.data.professionalId && !session.data.pendingReschedule) {
    const normND = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const NEXT_KW = [
      'proximo dia', 'proximo horario', 'proxima disponibilidade', 'quando tem',
      'quando vai ter', 'quando tem horario', 'quando teria', 'proximo disponivel',
      'proximo dia disponivel', 'qual dia tem', 'qual dia vai ter',
      'quando e o proximo', 'proximo que tiver', 'me manda o proximo',
      'horario de preferencia', 'meu horario de preferencia',
    ];
    if (NEXT_KW.some((k: string) => normND.includes(k))) {
      try {
        const prefTime = session.data.preferredTime || session.data.time;
        const profId = session.data.professionalId;
        const profName = session.data.professionalName || 'profissional';
        const duration = session.data.serviceDuration || 30;
        const padN = (n: number) => String(n).padStart(2, '0');
        const nowBrN = new Date(Date.now() - 3 * 60 * 60 * 1000);
        let foundDate = '';
        let foundSlots: string[] = [];
        for (let d = 1; d <= 14; d++) {
          const target = new Date(nowBrN.getTime() + d * 86400000);
          const dateStr = `${target.getUTCFullYear()}-${padN(target.getUTCMonth()+1)}-${padN(target.getUTCDate())}`;
          const slots = await getAvailableSlots(tenantId, profId, dateStr, duration, settings);
          if (slots.length > 0) {
            const filtered = prefTime ? slots.filter((s: string) => s >= prefTime) : slots;
            foundSlots = filtered.length > 0 ? filtered : slots;
            foundDate = dateStr;
            break;
          }
        }
        if (foundDate) {
          const dateFmt = formatDate(foundDate);
          const displaySlots = foundSlots.slice(0, 3).join(', ');
          const prefNote = prefTime ? ` (a partir das ${prefTime})` : '';
          const reply = `O próximo horário disponível com ${profName} é *${dateFmt}*${prefNote}! Teria: *${displaySlots}*. Qual horário você prefere?`;
          session.data.date = foundDate;
          session.data.availableSlots = foundSlots;
          session.history.push({ role: 'user', text: text }, { role: 'bot', text: reply });
          await saveSession(tenantId, phone, session.data, session.history);
          await sendMsg(instanceName, phone, reply, tenantId);
          return;
        } else {
          const reply = `Não encontrei horário disponível com ${profName} nos próximos 14 dias. 😕 Quer tentar com outro profissional ou outro serviço?`;
          session.history.push({ role: 'user', text: text }, { role: 'bot', text: reply });
          await saveSession(tenantId, phone, session.data, session.history);
          await sendMsg(instanceName, phone, reply, tenantId);
          return;
        }
      } catch (eND) { console.error('[Agent] next-day detection error:', eND); }
    }
  }

  // ── "On the way / running late" detection (TypeScript layer) ──────────
  // Lead is heading to their appointment (possibly late).
  // Must run BEFORE implicit-cancel so "vou atrasar mas tô indo" doesn't cancel.
  // e.g.: "tô indo embora", "saindo agora", "acho que vou atrasar", "logo chego"
  if (!session.data.pendingConfirm && !session.data.pendingReschedule && !session.data.pendingCancelConfirm) {
    const IM_COMING_KW = [
      'indo embora', 'saindo agora', 'to saindo', 'to vindo', 'a caminho',
      'logo chego', 'indo para ai', 'indo pra ai', 'estou indo', 'indo ja',
      'saindo de casa', 'ja saio', 'ja estou saindo', 'chego ja',
      'chego em breve', 'indo agora', 'saindo logo', 'indo embora agora',
      'estou saindo', 'sai agora', 'to chegando', 'estou chegando',
    ];
    const RUNNING_LATE_KW = [
      'vou atrasar', 'to atrasado', 'to atrasada', 'posso atrasar',
      'talvez atrase', 'atraso um pouco', 'chegar atrasado', 'chegar atrasada',
      'vai atrasar', 'acho que atraso', 'uns minutos atrasado', 'atraso uns',
      'chegando atrasado', 'talvez eu atraso', 'talvez nao atraso',
    ];
    const normOW = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const isOnWay = IM_COMING_KW.some((k: string) => normOW.includes(k));
    const isRunningLate = RUNNING_LATE_KW.some((k: string) => normOW.includes(k));
    if (isOnWay || isRunningLate) {
      try {
        // Try to find appointment for a personalized response
        const { data: custOW } = await supabase.from('customers').select('id')
          .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
        let owReply = '';
        if (custOW) {
          // Look up appointment within the last 2h (might already be late) up to next 4h
          const n0OW = new Date(Date.now() - 3 * 60 * 60 * 1000);
          const windowStart = new Date(n0OW.getTime() - 2 * 60 * 60 * 1000);
          const windowEnd   = new Date(n0OW.getTime() + 4 * 60 * 60 * 1000);
          const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
          const { data: apptOW } = await supabase.from('appointments')
            .select('id, inicio, service_id, professional_id')
            .eq('tenant_id', tenantId).eq('customer_id', custOW.id)
            .in('status', ['CONFIRMED', 'PENDING', 'confirmado', 'pendente'])
            .gte('inicio', fmt(windowStart)).lte('inicio', fmt(windowEnd))
            .order('inicio', { ascending: true }).limit(1);
          if (apptOW && apptOW.length > 0) {
            const profOW = professionals.find((p: any) => p.id === apptOW[0].professional_id);
            const profNameOW = profOW?.name || 'profissional';
            const tmOW = (apptOW[0].inicio as string).substring(11, 16);
            owReply = isRunningLate
              ? `Sem problema! 😊 Pode vir, ${profNameOW} vai te aguardar. Agendamento às ${tmOW}!`
              : `Ótimo! 😊 ${profNameOW} está te aguardando às ${tmOW}. Pode vir!`;
          }
        }
        if (!owReply) {
          owReply = isRunningLate
            ? 'Sem problema! 😊 Pode vir no seu tempo, te esperamos aqui!'
            : 'Ótimo! 😊 Te esperamos aqui!';
        }
        session.data.greetedAt = brasiliaDate;
        session.history.push({ role: 'user', text }, { role: 'bot', text: owReply });
        await saveSession(tenantId, phone, session.data, session.history);
        await sendMsg(instanceName, phone, owReply, tenantId);
        return;
      } catch (eOW) { console.error('[Agent] on-the-way detection error:', eOW); }
    }
  }

  // ── Implicit cancellation detection (TypeScript layer) ──────────────
  // MUST run BEFORE reschedule detection — "nao vou conseguir" etc. are cancel signals,
  // not reschedule signals. Moving this first prevents false reschedule triggers.
  // e.g.: "não vou conseguir 9 horas", "não vou chegar a tempo", "não vai dar tempo"
  if (!session.data.pendingReschedule && !session.data.pendingConfirm && !session.data.pendingCancelConfirm) {
    const IMPLICIT_CANCEL_KW = [
      'nao vou conseguir', 'nao consigo chegar', 'nao vou chegar a tempo',
      'nao vou dar tempo', 'nao vai dar tempo', 'nao vai dar pra ir',
      'nao vai dar pra chegar', 'nao vou chegar', 'vou perder o horario',
      'nao vou poder aparecer', 'nao vou conseguir aparecer',
      'nao vou a tempo', 'nao vou conseguir ir', 'nao consigo comparecer',
      'nao vou comparecer', 'nao vou poder comparecer', 'nao consigo ir',
    ];
    const normIC = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const hasImplicitCancel = IMPLICIT_CANCEL_KW.some((k: string) => normIC.includes(k));
    if (hasImplicitCancel) {
      try {
        const { data: custIC } = await supabase.from('customers').select('id')
          .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
        if (custIC) {
          const n0IC = new Date(Date.now() - 3 * 60 * 60 * 1000);
          const nowLocalIC = `${n0IC.getUTCFullYear()}-${pad(n0IC.getUTCMonth()+1)}-${pad(n0IC.getUTCDate())}T${pad(n0IC.getUTCHours())}:${pad(n0IC.getUTCMinutes())}:00`;
          const { data: upcomingIC } = await supabase.from('appointments')
            .select('id, inicio, service_id, professional_id')
            .eq('tenant_id', tenantId).eq('customer_id', custIC.id)
            .in('status', ['CONFIRMED', 'PENDING', 'confirmado', 'pendente'])
            .gte('inicio', nowLocalIC).order('inicio', { ascending: true }).limit(1);
          if (upcomingIC && upcomingIC.length > 0) {
            const apptIC = upcomingIC[0];
            const dtIC = (apptIC.inicio as string).substring(0, 10);
            const tmIC = (apptIC.inicio as string).substring(11, 16);
            const svcIC = services.find((s: any) => s.id === apptIC.service_id);
            const profIC = professionals.find((p: any) => p.id === apptIC.professional_id);
            const dtLabelIC = dtIC === todayISO ? 'hoje' : formatDate(dtIC);
            const profNameIC = profIC?.name || 'profissional';
            const confirmMsg = `Entendido, sem problema! 😊 Quer que eu cancele seu agendamento de *${dtLabelIC}* às *${tmIC}* com *${profNameIC}*? Se preferir, posso remarcar para outro dia também!`;
            session.data.pendingCancelConfirm = {
              apptId: apptIC.id, dtLabel: dtLabelIC, tmIC, profName: profNameIC,
            };
            session.data.pendingCancelConfirm_rescheduleData = {
              oldApptId: apptIC.id, oldDate: dtIC, oldTime: tmIC,
              oldProfName: profNameIC,
            };
            session.history.push({ role: 'user', text }, { role: 'bot', text: confirmMsg });
            await saveSession(tenantId, phone, session.data, session.history);
            await sendMsg(instanceName, phone, confirmMsg, tenantId);
            return;
          } else {
            // Customer found in DB but no upcoming appointment
            const noApptIC = `Entendido! 😊 Parece que você não vai conseguir comparecer.\n\nNão encontrei nenhum agendamento ativo no seu número. Pode me confirmar o *dia e horário* que estava agendado? Verifico aqui e cancelo ou remarco pra você!`;
            session.history.push({ role: 'user', text }, { role: 'bot', text: noApptIC });
            await saveSession(tenantId, phone, session.data, session.history);
            await sendMsg(instanceName, phone, noApptIC, tenantId);
            return;
          }
        } else {
          // Customer not registered in DB — still handle gracefully, don't let AI say "Tudo bem!"
          const notFoundIC = `Entendido! 😊 Parece que você não vai conseguir comparecer.\n\nPode me confirmar seu *nome completo* e o *dia e horário* do agendamento? Assim consigo verificar e cancelar ou remarcar pra você!`;
          session.history.push({ role: 'user', text }, { role: 'bot', text: notFoundIC });
          await saveSession(tenantId, phone, session.data, session.history);
          await sendMsg(instanceName, phone, notFoundIC, tenantId);
          return;
        }
      } catch (eIC) { console.error('[Agent] implicit-cancel detection error:', eIC); }
    }
  }

  // ── Reschedule detection (TypeScript layer) ──────────────────────────
  if (!session.data.pendingReschedule && !session.data.pendingConfirm) {
    const RESCHEDULE_KW = [
      'reagendar', 'remarcar', 'mudar meu horario', 'mudar meu agendamento',
      'trocar meu horario', 'trocar meu agendamento',
      'preciso mudar', 'preciso remarcar', 'preciso reagendar',
      'nao vou poder ir', 'quero remarcar', 'quero reagendar',
    ];
    const normRS = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const wantsReschedule = RESCHEDULE_KW.some((k: string) => normRS.includes(k));
    if (wantsReschedule) {
      try {
        const { data: custRS } = await supabase.from('customers').select('id')
          .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
        if (custRS) {
          const n0 = new Date(Date.now() - 3 * 60 * 60 * 1000);
          const nowLocal = `${n0.getUTCFullYear()}-${pad(n0.getUTCMonth()+1)}-${pad(n0.getUTCDate())}T${pad(n0.getUTCHours())}:${pad(n0.getUTCMinutes())}:00`;
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
            session.data.serviceId        = apptRS.service_id;
            session.data.serviceName      = svcRS?.name;
            session.data.serviceDuration  = svcRS?.durationMinutes;
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
          } else {
            // No upcoming appointment found — ask for more info (attempt 1)
            session.data.pendingRescheduleSearch = { attempt: 1 };
            const noApptMsg = '😕 Não identifiquei nenhum agendamento ativo no seu número.\n\nPode me confirmar seu *nome completo* e o *dia que estava agendado*? Assim consigo verificar melhor!';
            session.history.push({ role: 'user', text: text }, { role: 'bot', text: noApptMsg });
            await saveSession(tenantId, phone, session.data, session.history);
            await sendMsg(instanceName, phone, noApptMsg, tenantId);
            return;
          }
        }
      } catch (eRS) { console.error('[Agent] reschedule pre-detection error:', eRS); }
    }
  }

  // ── Reschedule search retry (TypeScript layer) ────────────────────────
  if (session.data.pendingRescheduleSearch) {
    const attempt = session.data.pendingRescheduleSearch.attempt;
    try {
      const { data: custRS2 } = await supabase.from('customers').select('id')
        .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
      if (custRS2) {
        const { data: anyRS } = await supabase.from('appointments')
          .select('id, inicio, service_id, professional_id')
          .eq('tenant_id', tenantId).eq('customer_id', custRS2.id)
          .in('status', ['CONFIRMED', 'PENDING', 'confirmado', 'pendente'])
          .order('inicio', { ascending: true }).limit(1);
        if (anyRS && anyRS.length > 0) {
          const apptRS2 = anyRS[0];
          const oldDate2 = (apptRS2.inicio as string).substring(0, 10);
          const oldTime2 = (apptRS2.inicio as string).substring(11, 16);
          const svcRS2  = services.find((s: any) => s.id === apptRS2.service_id);
          const profRS2 = professionals.find((p: any) => p.id === apptRS2.professional_id);
          session.data.serviceId        = apptRS2.service_id;
          session.data.serviceName      = svcRS2?.name;
          session.data.serviceDuration  = svcRS2?.durationMinutes;
          session.data.professionalId   = apptRS2.professional_id;
          session.data.professionalName = profRS2?.name;
          session.data.time             = oldTime2;
          session.data.pendingReschedule = {
            oldApptId: apptRS2.id,
            oldDate: oldDate2,
            oldTime: oldTime2,
            oldProfName: profRS2?.name || 'Profissional',
          };
          session.data.pendingRescheduleSearch = undefined;
          console.log('[Agent] Reschedule retry found appt', apptRS2.id);
          // Fall through to AI with pendingReschedule now set
        } else if (attempt >= 1) {
          session.data.pendingRescheduleSearch = undefined;
          const noAppt2Msg = '😕 Não encontrei nenhum agendamento no sistema com essas informações.\n\nQuer que eu agende um *novo horário* pra você? É só me dizer o serviço e o dia! 😊';
          session.history.push({ role: 'user', text: text }, { role: 'bot', text: noAppt2Msg });
          await saveSession(tenantId, phone, session.data, session.history);
          await sendMsg(instanceName, phone, noAppt2Msg, tenantId);
          return;
        }
      }
    } catch (eRS2) { console.error('[Agent] reschedule retry error:', eRS2); }
  }

  // ── Earlier slot detection (TypeScript layer) ────────────────────────
  if (!session.data.pendingReschedule && !session.data.pendingConfirm) {
    const EARLIER_KW = [
      'adiantar', 'mais cedo', 'hora mais cedo', 'horario mais cedo',
      'antes das', 'puder ir antes', 'conseguir ir antes',
      'um pouco antes', 'ir antes', 'chegar antes',
    ];
    const normEar = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const wantsEarlier = EARLIER_KW.some((k: string) => normEar.includes(k));
    if (wantsEarlier) {
      try {
        const { data: custE } = await supabase.from('customers').select('id')
          .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
        if (custE) {
          const n0 = new Date(Date.now() - 3 * 60 * 60 * 1000);
          const nowLocal = `${n0.getUTCFullYear()}-${pad(n0.getUTCMonth()+1)}-${pad(n0.getUTCDate())}T${pad(n0.getUTCHours())}:${pad(n0.getUTCMinutes())}:00`;
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
            if (apptDate === todayISO) {
              const allSlots = await getAvailableSlots(tenantId, apptE.professional_id, apptDate, svcE?.durationMinutes || 30, settings);
              const nowHHMM = `${pad(n0.getUTCHours())}:${pad(n0.getUTCMinutes())}`;
              const earlierSlots = allSlots.filter((s: string) => s >= nowHHMM && s < apptTime);
              if (earlierSlots.length === 0) {
                const reply = `Hoje mais cedo não tem disponível com o ${profE?.name || 'profissional'}, mas fique tranquilo — seu horário das ${apptTime} está confirmado! 😊`;
                session.history.push({ role: 'user', text: lowerText }, { role: 'bot', text: reply });
                await sendMsg(instanceName, phone, reply, tenantId);
                saveSession(tenantId, phone, session.data, session.history).catch(() => {});
                return;
              }
              session.data.serviceId        = apptE.service_id;
              session.data.serviceName      = svcE?.name;
              session.data.serviceDuration  = svcE?.durationMinutes;
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
              console.log('[Agent] Earlier slot detected, options:', earlierSlots);
            }
          }
        }
      } catch (eEar) { console.error('[Agent] earlier slot detection error:', eEar); }
    }
  }

  // ── Confusion / loop-break detection (TypeScript layer) ─────────────
  if (session.data.pendingReschedule || session.data.pendingRescheduleSearch) {
    const normConf = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const CONFUSION_KW = [
      'nao entendi', 'nao to entendendo', 'nao estou entendendo',
      'o que voce entendeu', 'o que vc entendeu', 'o que entendeu',
      'ta errado', 'esta errado', 'isso nao e o que eu disse',
      'nao foi isso', 'nao e isso', 'nao disse isso',
      'voce nao ta entendendo', 'vc nao ta entendendo',
    ];
    if (CONFUSION_KW.some(k => normConf.includes(k))) {
      session.data.pendingReschedule = undefined;
      session.data.pendingRescheduleSearch = undefined;
      session.data.serviceId = undefined;
      session.data.date = undefined;
      session.data.time = undefined;
      session.data.professionalId = undefined;
      const confReply = 'Desculpe a confusão! 😅 Pode me contar de novo o que você precisa que eu te ajudo certinho?';
      session.history.push({ role: 'user', text: text }, { role: 'bot', text: confReply });
      await saveSession(tenantId, phone, session.data, session.history);
      await sendMsg(instanceName, phone, confReply, tenantId);
      return;
    }
  }

  // ── Appointment query detection (TypeScript layer) ────────────────────
  // When client asks about an existing appointment ("meu horário", "ta agendado?"),
  // look up DB directly and respond — bypassing the booking flow.
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
    const isApptQ   = APPT_Q.some((k: string) => normAQ.includes(k));
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
              const svc  = services.find((s: any) => s.id === a.service_id);
              const prof = professionals.find((p: any) => p.id === a.professional_id);
              const dl   = dt === todayISO ? 'hoje' : formatDate(dt);
              return `• ${dl} às *${tm}* — ${svc?.name || 'Procedimento'} com ${prof?.name || 'Profissional'}`;
            });
            const replyAQ = nextAppts.length === 1
              ? `Aqui está seu agendamento:\n\n${lines[0]}\n\nPosso te ajudar com mais alguma coisa?`
              : `Seus próximos agendamentos:\n\n${lines.join('\n')}\n\nPosso te ajudar com mais alguma coisa?`;
            session.history.push({ role: 'user', text }, { role: 'bot', text: replyAQ });
            await saveSession(tenantId, phone, session.data, session.history);
            await sendMsg(instanceName, phone, replyAQ, tenantId);
            return;
          }
        }
      } catch (eAQ) { console.error('[Agent] appt-query error:', eAQ); }
      // No appointments found or error → fall through to normal booking flow
    }
  }

  // Professional name pre-extraction (TypeScript layer — more reliable than LLM)
  // Vacation check runs for any # of professionals. Personal-contact-flow only for multi-prof.
  if (!session.data.professionalId && !session.data.pendingProfContact) {
    const matched = matchProfessionalName(lowerText, professionals);
    if (matched) {
      // ── Vacation check: always runs regardless of professional count ──
      const _vacBreakWh1 = (settings.breaks || []).find((b: any) => {
        if (b.professionalId && b.professionalId !== matched.id) return false;
        if (b.type !== 'vacation') return false;
        const vacStart: string = b.date || '';
        const vacEnd: string = b.vacationEndDate || b.date || '';
        return !!vacStart && todayISO >= vacStart && todayISO <= vacEnd;
      });
      if (_vacBreakWh1) {
        const _vacEnd1 = (_vacBreakWh1 as any).vacationEndDate || _vacBreakWh1.date || '';
        const _returnDate1 = _vacEnd1 ? (() => {
          const d = new Date(_vacEnd1 + 'T12:00:00');
          d.setDate(d.getDate() + 1);
          return formatDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        })() : '';
        const _returnInfo1 = _returnDate1 ? ` Retorna ${_returnDate1}.` : '';
        const othersAvail = (professionals as any[])
          .filter((p: any) => p.id !== matched.id)
          .filter((p: any) => !(settings.breaks || []).some((b: any) => {
            if (b.professionalId && b.professionalId !== p.id) return false;
            if (b.type !== 'vacation') return false;
            const vs: string = b.date || '', ve: string = b.vacationEndDate || b.date || '';
            return !!vs && todayISO >= vs && todayISO <= ve;
          }));
        const othersStr = othersAvail.map((p: any) => p.name).join(' ou ');
        const vacMsg = `*${matched.name}* está de férias no momento!${_returnInfo1} 🏖️\n\n${othersStr ? `Mas o ${othersStr} pode te atender! Gostaria de agendar?` : 'Gostaria de agendar com outro profissional?'}`;
        session.history.push({ role: 'user', text });
        session.history.push({ role: 'bot', text: vacMsg });
        await sendMsg(instanceName, phone, vacMsg, tenantId);
        saveSession(tenantId, phone, session.data, session.history).catch(() => {});
        return;
      }

      if (professionals.length > 1) {
        // Multiple professionals: check for booking intent or personal-contact flow
        const normMsg2 = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '');
        const BOOK_KW2 = ['agendar', 'marcar', 'horario', 'reservar', 'procedimento', 'servico', 'corte', 'barba', 'agendamento', 'cabelo', 'cabeca', 'cabecinha', 'cabeça'];
        const hasSvcMention = services.some((s: any) =>
          normMsg2.includes((s.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ''))
        );
        const hasBookingKw2 = BOOK_KW2.some((k: string) => normMsg2.includes(k));
        const isMidBooking  = !!(session.data.serviceId || session.data.pendingConfirm);
        // Personal-contact flow only on first message OR explicit "quero falar com" intent
        const isFirstMsg = session.history.filter((h: any) => h.role === 'bot').length === 0;
        const PERSONAL_KW = ['quero falar com', 'preciso falar com', 'falar com o', 'falar com a', 'entrar em contato com'];
        const hasPersonalIntent = PERSONAL_KW.some((k: string) => normMsg2.includes(k));

        if (hasBookingKw2 || hasSvcMention || isMidBooking || (!isFirstMsg && !hasPersonalIntent)) {
          session.data.professionalId   = matched.id;
          session.data.professionalName = matched.name;
        } else {
          // No booking signal on first message or explicit "falar com" — ask first
          const profPhone = (professionals as any[]).find((p: any) => p.id === matched.id)?.phone || '';
          session.data.pendingProfContact = { profId: matched.id, profName: matched.name, profPhone };
          const question = `Você gostaria de falar com o *${matched.name}* sobre algum assunto específico?`;
          const { greeting: brasiliaGreetingPc, dateStr: brasiliaDatePc } = getBrasiliaGreeting();
          const reply = shouldGreet
            ? `${brasiliaGreetingPc.charAt(0).toUpperCase() + brasiliaGreetingPc.slice(1)}! ${question}`
            : question;
          if (shouldGreet) session.data.greetedAt = brasiliaDatePc;
          session.history.push({ role: 'user', text });
          session.history.push({ role: 'bot', text: reply });
          await sendMsg(instanceName, phone, reply, tenantId);
          saveSession(tenantId, phone, session.data, session.history).catch(() => {});
          return;
        }
      } else {
        // Single professional: pre-set them directly (no personal-contact-flow question needed)
        session.data.professionalId   = matched.id;
        session.data.professionalName = matched.name;
      }
    }
  }

  // Date pre-extraction (TypeScript layer — resolves day names to YYYY-MM-DD)
  // Always try to resolve — if client mentions a NEW date, update the session
  {
    const resolved = resolveRelativeDate(lowerText, todayISO);
    if (resolved && resolved !== session.data.date) {
      session.data.date = resolved;
      // New date → clear time and slots so they are re-fetched
      session.data.time = undefined;
      session.data.availableSlots = undefined;
      console.log('[Agent] TS date updated to:', resolved);
    }
  }

  // ── Closed-day guard (TypeScript layer) ──────────────────────────────
  // If the resolved date falls on a day the business is closed, find the
  // next open day and respond immediately — never let the AI guess day names.
  if (session.data.date) {
    const _cdDate = session.data.date;
    const _cdDow = new Date(_cdDate + 'T12:00:00Z').getUTCDay();
    const _cdConfig = settings.operatingHours?.[_cdDow];
    if (!_cdConfig?.active) {
      // Find next open day (scan up to 14 days ahead)
      const _cdBaseDate = new Date(_cdDate + 'T12:00:00Z');
      let _nextOpenISO: string | null = null;
      let _nextOpenDow = -1;
      for (let i = 1; i <= 14; i++) {
        const _nd = new Date(_cdBaseDate.getTime() + i * 86400000);
        const _ndDow = _nd.getUTCDay();
        if (settings.operatingHours?.[_ndDow]?.active) {
          _nextOpenISO = `${_nd.getUTCFullYear()}-${pad(_nd.getUTCMonth()+1)}-${pad(_nd.getUTCDate())}`;
          _nextOpenDow = _ndDow;
          break;
        }
      }
      const _closedDowName = DOW_PT[_cdDow]; // correct day name from code
      // Compute tomorrow label inline (tomorrowISO is only available inside callBrain)
      const _isTomorrow = (() => {
        const td = new Date(todayISO + 'T12:00:00Z');
        return _cdBaseDate.getTime() - td.getTime() === 86400000;
      })();
      const _closedLabel = _cdDate === todayISO ? 'Hoje' : _isTomorrow ? 'Amanhã' : formatDate(_cdDate);
      if (_nextOpenISO) {
        const _nextDowName = DOW_PT[_nextOpenDow];
        const _nextDD = _nextOpenISO.slice(8, 10);
        const _nextMM = _nextOpenISO.slice(5, 7);
        const _cdMsg = `${_closedLabel} (${_closedDowName}) a gente não abre 😕 Mas na ${_nextDowName}, dia ${_nextDD}/${_nextMM}, estamos abertos! Quer agendar pra esse dia?`;
        session.data.date = _nextOpenISO;
        session.history.push({ role: 'bot', text: _cdMsg });
        await sendMsg(instanceName, phone, _cdMsg, tenantId);
        saveSession(tenantId, phone, session.data, session.history).catch(() => {});
        return;
      } else {
        const _cdMsg = `Desculpe, não temos dias abertos nos próximos 14 dias 😕 Entre em contato novamente mais tarde!`;
        session.data.date = undefined;
        session.history.push({ role: 'bot', text: _cdMsg });
        await sendMsg(instanceName, phone, _cdMsg, tenantId);
        saveSession(tenantId, phone, session.data, session.history).catch(() => {});
        return;
      }
    }
  }

  // Time-preference pre-extraction (TypeScript layer)
  // Captures "depois das 17", "a partir das 16", "após 12:00" etc. for slot filtering
  if (!session.data.preferredTime) {
    const normTP = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const tpMatch = normTP.match(/(?:depois das?|a partir das?|apos(?:\s+as?)?\s*|mais tarde(?:\s+das?)?|a partir de)\s*(\d{1,2})(?::(\d{2}))?/);
    if (tpMatch) {
      const h = parseInt(tpMatch[1], 10);
      const m = tpMatch[2] ? parseInt(tpMatch[2], 10) : 0;
      if (h >= 6 && h <= 23) {
        session.data.preferredTime = `${pad(h)}:${pad(m)}`;
      }
    }
  }

  // Quantity pre-extraction (TypeScript layer)
  // Captures "2 horários", "3 vagas", "2 pessoas" — lead wants multiple slots at once
  if (!(session.data as any).requestedQuantity) {
    const normQT = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const qtMatch = normQT.match(/\b([2-9]|1[0-9])\s*(?:horarios?|vagas?|pessoas?|agendamentos?|atendimentos?|slots?)\b/);
    if (qtMatch) {
      const qty = parseInt(qtMatch[1], 10);
      if (qty >= 2 && qty <= 10) (session.data as any).requestedQuantity = qty;
    }
  }

  // Professionals visible to the AI: exclude anyone on vacation for the target date.
  // The full `professionals` list is still used for name matching above so the
  // slot-check can explain vacations when the client explicitly requests that prof.
  const _targetDateWh = session.data.date || todayISO;
  const professionalsVisible = professionals.filter((p: { id: string; name: string }) =>
    !(settings.breaks || []).some((b: any) => {
      if (b.type !== 'vacation') return false;
      if (b.professionalId && b.professionalId !== p.id) return false;
      const vs: string = b.date || '';
      const ve: string = b.vacationEndDate || b.date || '';
      return !!vs && _targetDateWh >= vs && _targetDateWh <= ve;
    })
  );

  session.history.push({ role: 'user', text });

  // ── Vacation guard for already-selected professional ─────────────────────
  // Handles the case where professionalId was set in a prior turn but that
  // professional is currently on vacation (TS pre-extraction only runs when
  // professionalId is NOT yet set).
  // Always respond with vacation message — no keyword matching needed since
  // real users ask in countless unpredictable ways ("tá atendendo?", "já voltou?", etc.)
  if (session.data.professionalId) {
    const _curVacBreakWh = (settings.breaks || []).find((b: any) => {
      if (b.type !== 'vacation') return false;
      if (b.professionalId && b.professionalId !== session.data.professionalId) return false;
      const vs: string = b.date || '';
      const ve: string = b.vacationEndDate || b.date || '';
      return !!vs && todayISO >= vs && todayISO <= ve;
    });
    if (_curVacBreakWh) {
      const _vacProfNameWh = session.data.professionalName || 'O profissional';
      const _vacEndWh2 = (_curVacBreakWh as any).vacationEndDate || _curVacBreakWh.date || '';
      const _returnDateWh2 = _vacEndWh2 ? (() => {
        const d = new Date(_vacEndWh2 + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        return formatDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      })() : '';
      const _returnInfoWh2 = _returnDateWh2 ? ` Retorna ${_returnDateWh2}.` : '';
      const _othersAvailWh = professionals.filter((p: any) => p.id !== session.data.professionalId)
        .filter((p: any) => !(settings.breaks || []).some((b: any) => {
          if (b.type !== 'vacation') return false;
          if (b.professionalId && b.professionalId !== p.id) return false;
          const vs: string = b.date || '', ve: string = b.vacationEndDate || b.date || '';
          return !!vs && todayISO >= vs && todayISO <= ve;
        }));
      const _othersStrWh = _othersAvailWh.map((p: any) => p.name).join(' ou ');
      const _vacMsgWh = `*${_vacProfNameWh}* está de férias no momento!${_returnInfoWh2} 🏖️\n\n${_othersStrWh ? `Mas o ${_othersStrWh} pode te atender! Gostaria de agendar?` : 'Pode agendar quando o profissional retornar.'}`;
      session.data.professionalId   = undefined;
      session.data.professionalName = undefined;
      session.data.date             = undefined;
      session.history.push({ role: 'bot', text: _vacMsgWh });
      await sendMsg(instanceName, phone, _vacMsgWh, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(() => {});
      return;
    }
  }

  // ── Follow-up context: aviso/lembrete/reativacao ──────────────────────────
  // When followUpService sends a follow-up message it persists pendingFollowUpType
  // in the session. Handle the first reply here before falling through to the AI.
  // Affirmative emoji detection (👍👊✅🤙🙏💪👏🔥) — used in follow-up and fallback
  const AFFIRM_EMOJI_RE = /[\u{1F44D}\u{1F44A}\u{2705}\u{1F919}\u{1F64F}\u{1F4AA}\u{1F44F}\u{1F525}\u{1F91D}\u{1F60A}\u{1F609}\u{1F601}\u{1F973}]/u;
  const isEmojiAffirm = AFFIRM_EMOJI_RE.test(text) && text.replace(/[\s\u{FE0F}\u{200D}\u{20E3}]/gu, '').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '').length === 0;

  if (session.data.pendingFollowUpType) {
    const fType = session.data.pendingFollowUpType as string;
    const fNorm = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const fWds  = fNorm.split(/\s+/);

    const RESCHEDULE_WORDS = [
      'remarcar', 'remarcacao', 'reagendar', 'mudar horario', 'trocar horario',
      'outro horario', 'possivel remarcar', 'consigo remarcar', 'consegue remarcar',
      'remarcar para', 'mudar para', 'trocar para', 'inicio da tarde', 'inicio da manha',
      'comeco da tarde', 'começo da tarde', 'final da tarde', 'meio da tarde',
    ];
    const AFFIRM_WORDS = [
      'sim', 'ok', 'pode', 'certo', 'confirmado', 'confirmar', 'confirma', 'confirmo',
      'quero', 'bora', 'beleza', 'combinado', 'claro', 'perfeito', 'otimo',
      'obrigado', 'obrigada', 'vlw', 'valeu', 'vou', 'estarei', 'ta', 'yes',
      'blz', 'show', 'tenho', 'posso', 'afirmativo', 'ate la', 'to la', 'boa',
      'bom', 'tmj', 'fechado', 'isso',
    ];
    const DENY_WORDS = [
      'nao', 'nope', 'negativo', 'impossivel', 'nao vou', 'nao consigo', 'nao quero',
      'cancela', 'cancelar',
    ];

    const EARLIER_FU_KW = [
      'adiantar', 'adiantada', 'mais cedo', 'hora mais cedo', 'horario mais cedo',
      'antes das', 'puder ir antes', 'conseguir ir antes', 'antecipar',
      'um pouco antes', 'ir antes', 'chegar antes',
    ];
    const wantsEarlierFu = EARLIER_FU_KW.some(k => fNorm.includes(k));
    const wantsReschedule = RESCHEDULE_WORDS.some(k => fNorm.includes(k));
    const hasBookingKw    = wantsEarlierFu || wantsReschedule || ['agendar', 'marcar', 'horario', 'mudar', 'trocar', 'reagendar'].some(k => fNorm.includes(k));
    const isAffirm        = isEmojiAffirm || (!hasBookingKw && AFFIRM_WORDS.some(a => fWds.includes(a) || fNorm === a) && fWds.length <= 8);
    const isDeny          = DENY_WORDS.some(d => fWds.includes(d)) && fWds.length <= 6;
    const denyAsFiller    = DENY_WORDS.some(d => fWds.includes(d)) && AFFIRM_WORDS.filter(a => fWds.includes(a)).length >= 2;
    // Resolve date from follow-up reply ("amanhã", "10/03", "semana que vem")
    const fuResolvedDate  = resolveRelativeDate(fNorm, todayISO);

    // Helper: detect time-of-day preference
    const getTimePref = (n: string): { from: string; to: string } | null => {
      if (n.includes('inicio da manha') || n.includes('cedo'))                                return { from: '07:00', to: '10:00' };
      if (n.includes('manha'))                                                                 return { from: '07:00', to: '12:00' };
      if (n.includes('inicio da tarde') || n.includes('comeco da tarde'))                    return { from: '12:00', to: '14:30' };
      if (n.includes('meio da tarde'))                                                         return { from: '13:00', to: '16:00' };
      if (n.includes('final da tarde') || n.includes('fim da tarde'))                         return { from: '16:00', to: '19:00' };
      if (n.includes('tarde'))                                                                  return { from: '12:00', to: '18:00' };
      if (n.includes('noite'))                                                                  return { from: '18:00', to: '22:00' };
      return null;
    };

    // aviso/lembrete: wants EARLIER slot ("adiantar", "mais cedo")
    if ((fType === 'aviso' || fType === 'lembrete') && wantsEarlierFu) {
      const profIdKnown = session.data.followUpProfessionalId as string | undefined;
      const svcDuration =
        services.find((s: any) => s.id === session.data.followUpServiceId)?.durationMinutes ??
        services.find((s: any) => s.name === session.data.followUpServiceName)?.durationMinutes ?? 30;
      const profE = professionals.find((p: any) => p.id === profIdKnown);
      const apptTime = session.data.followUpApptTime as string || '23:59';

      if (profE) {
        const allSlots = await getAvailableSlots(tenantId, profE.id, todayISO, svcDuration, settings);
        const n0 = new Date(Date.now() - 3 * 60 * 60 * 1000);
        const nowHHMM = `${pad(n0.getUTCHours())}:${pad(n0.getUTCMinutes())}`;
        const earlierSlots = allSlots.filter((s: string) => s >= nowHHMM && s < apptTime);

        session.data.pendingFollowUpType = undefined;
        let reply: string;
        if (earlierSlots.length > 0) {
          const slotList = earlierSlots.slice(0, 6).map((s: string) => `• ${s}`).join('\n');
          reply = `Vou verificar! Horários mais cedo com *${profE.name}* hoje:\n\n${slotList}\n\nQual prefere?`;
          session.data.professionalId   = profE.id;
          session.data.professionalName = profE.name;
          session.data.date             = todayISO;
          session.data.availableSlots   = earlierSlots;
          if (session.data.followUpServiceId)   session.data.serviceId       = session.data.followUpServiceId;
          if (session.data.followUpServiceName) session.data.serviceName     = session.data.followUpServiceName;
          if (session.data.followUpServiceId)   session.data.serviceDuration = svcDuration;
          // Set up pendingReschedule so the old appointment gets cancelled on confirm
          try {
            const { data: custEar } = await supabase.from('customers').select('id')
              .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
            if (custEar) {
              const { data: apptEar } = await supabase.from('appointments')
                .select('id').eq('tenant_id', tenantId).eq('customer_id', custEar.id)
                .in('status', ['CONFIRMED', 'PENDING', 'confirmado', 'pendente'])
                .gte('inicio', `${todayISO}T${apptTime}:00`).lt('inicio', `${todayISO}T${apptTime}:59`)
                .limit(1);
              if (apptEar?.[0]) {
                session.data.pendingReschedule = {
                  oldApptId: apptEar[0].id, oldDate: todayISO, oldTime: apptTime,
                  oldProfName: profE.name, isEarlierSlot: true,
                };
              }
            }
          } catch (e) { console.error('[Agent] earlier fu appt lookup error:', e); }
        } else {
          reply = `O *${profE.name}* está cheio até o seu horário, não consigo adiantar. Te esperamos às *${apptTime}*! 😊`;
        }
        session.history.push({ role: 'bot', text: reply });
        await sendMsg(instanceName, phone, reply, tenantId);
        saveSession(tenantId, phone, session.data, session.history).catch(e => console.error('[Agent] followUp earlier err:', e));
        return;
      }
    }

    // aviso/lembrete: wants to reschedule to a DIFFERENT day ("amanhã", "10/03", "semana que vem")
    if ((fType === 'aviso' || fType === 'lembrete') && fuResolvedDate && fuResolvedDate !== todayISO) {
      const profIdKnown = session.data.followUpProfessionalId as string | undefined;
      const svcDuration =
        services.find((s: any) => s.id === session.data.followUpServiceId)?.durationMinutes ??
        services.find((s: any) => s.name === session.data.followUpServiceName)?.durationMinutes ?? 30;
      const profD = professionals.find((p: any) => p.id === profIdKnown);
      const targetDate = fuResolvedDate;
      const prefRange = getTimePref(fNorm);

      let slots: string[] = [];
      let chosenProf: { id: string; name: string } | undefined = profD;

      if (chosenProf) {
        const raw = await getAvailableSlots(tenantId, chosenProf.id, targetDate, svcDuration, settings);
        slots = prefRange ? raw.filter((s: string) => s >= prefRange.from && s <= prefRange.to) : raw;
      }
      // Fallback: any professional
      if (slots.length === 0) {
        for (const p of professionals as { id: string; name: string }[]) {
          const raw = await getAvailableSlots(tenantId, p.id, targetDate, svcDuration, settings);
          const filtered = prefRange ? raw.filter((s: string) => s >= prefRange.from && s <= prefRange.to) : raw;
          if (filtered.length > 0) { slots = filtered; chosenProf = p; break; }
        }
      }

      session.data.pendingFollowUpType = undefined;
      const dateLbl = formatDate(targetDate);
      let reply: string;
      if (slots.length > 0 && chosenProf) {
        const slotList = slots.slice(0, 6).map((s: string) => `• ${s}`).join('\n');
        reply = `Para *${dateLbl}* com *${chosenProf.name}* temos:\n\n${slotList}\n\nQual horário fica bom?`;
        session.data.professionalId   = chosenProf.id;
        session.data.professionalName = chosenProf.name;
        session.data.date             = targetDate;
        session.data.availableSlots   = slots;
        if (session.data.followUpServiceId)   session.data.serviceId       = session.data.followUpServiceId;
        if (session.data.followUpServiceName) session.data.serviceName     = session.data.followUpServiceName;
        if (session.data.followUpServiceId)   session.data.serviceDuration = svcDuration;
      } else {
        reply = `O *${chosenProf?.name || 'profissional'}* está com a agenda cheia em *${dateLbl}*. 😕 Quer verificar outro dia ou outro profissional?`;
      }
      session.history.push({ role: 'bot', text: reply });
      await sendMsg(instanceName, phone, reply, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(e => console.error('[Agent] followUp reschedule day err:', e));
      return;
    }

    // aviso/lembrete: rescheduling (same day) → find and offer slots
    if ((fType === 'aviso' || fType === 'lembrete') && wantsReschedule) {
      const prefRange   = getTimePref(fNorm);
      const ANY_PROF    = ['qualquer', 'quem estiver', 'tanto faz', 'quem tiver', 'qualquer um', 'pode ser qualquer'];
      const wantsAnyProf = ANY_PROF.some(k => fNorm.includes(k));

      const profIdKnown  = session.data.followUpProfessionalId as string | undefined;
      const svcDuration  =
        services.find((s: any) => s.id === session.data.followUpServiceId)?.durationMinutes ??
        services.find((s: any) => s.name === session.data.followUpServiceName)?.durationMinutes ?? 30;

      let slots: string[] = [];
      let chosenProf: { id: string; name: string } | undefined = professionals.find((p: any) => p.id === profIdKnown);

      // Try same professional first
      if (!wantsAnyProf && chosenProf) {
        const raw = await getAvailableSlots(tenantId, chosenProf.id, todayISO, svcDuration, settings);
        slots = prefRange ? raw.filter((s: string) => s >= prefRange.from && s <= prefRange.to) : raw;
      }

      // Fallback: any professional
      if (slots.length === 0) {
        for (const p of professionals as { id: string; name: string }[]) {
          const raw = await getAvailableSlots(tenantId, p.id, todayISO, svcDuration, settings);
          const filtered = prefRange ? raw.filter((s: string) => s >= prefRange.from && s <= prefRange.to) : raw;
          if (filtered.length > 0) { slots = filtered; chosenProf = p; break; }
        }
      }

      session.data.pendingFollowUpType = undefined;
      let reply: string;
      if (slots.length > 0 && chosenProf) {
        const slotList  = slots.slice(0, 6).map((s: string) => `• ${s}`).join('\n');
        const rangeNote = prefRange ? ' nesse período' : '';
        reply = `Claro! Posso remarcar com *${chosenProf.name}*${rangeNote}:\n\n${slotList}\n\nQual horário fica bom?`;
        session.data.professionalId   = chosenProf.id;
        session.data.professionalName = chosenProf.name;
        session.data.date             = todayISO;
        if (session.data.followUpServiceId)   session.data.serviceId       = session.data.followUpServiceId;
        if (session.data.followUpServiceName) session.data.serviceName     = session.data.followUpServiceName;
        session.data.availableSlots = slots;
      } else {
        const periodMsg = prefRange ? ' nesse horário' : '';
        reply = `Que pena! Infelizmente não temos mais horários disponíveis para hoje${periodMsg}. 😕 Quer marcar para outro dia?`;
      }
      session.history.push({ role: 'bot', text: reply });
      await sendMsg(instanceName, phone, reply, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(e => console.error('[Agent] followUp saveSession err:', e));
      return;
    }

    // aviso/lembrete: affirmative (or "Não, [affirmative]" filler) → confirm presence
    if ((fType === 'aviso' || fType === 'lembrete') && (isAffirm || denyAsFiller)) {
      const apptTime = session.data.followUpApptTime as string | undefined;
      const reply = apptTime ? `Show de bola! Aguardamos você às *${apptTime}*.` : `Show de bola! Aguardamos você.`;
      session.data.pendingFollowUpType = undefined;
      session.history.push({ role: 'bot', text: reply });
      await sendMsg(instanceName, phone, reply, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(e => console.error('[Agent] followUp saveSession err:', e));
      return;
    }

    // reativacao: short denial → polite dismissal
    if (fType === 'reativacao' && isDeny) {
      const reply = `Tudo bem! Quando precisar, é só chamar. 😊`;
      session.data.pendingFollowUpType = undefined;
      session.history.push({ role: 'bot', text: reply });
      await sendMsg(instanceName, phone, reply, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(e => console.error('[Agent] followUp saveSession err:', e));
      return;
    }

    // Anything else → clear flag and fall through to AI with full history context
    session.data.pendingFollowUpType = undefined;
  }

  // ─── Follow-up fallback: session may have expired but appointment exists today ──
  // When no pendingFollowUpType (session expired) but client sends short affirmative
  // and has an appointment today → respond as follow-up confirmation instead of greeting.
  if (!session.data.pendingFollowUpType && shouldGreet) {
    const normFb = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?\u{1F4AA}\u{1F44D}\u{2705}\u{1F64F}]/gu, '').trim();
    const FB_AFFIRM = [
      'ok', 'sim', 'pode', 'certo', 'confirmado', 'confirmar', 'confirma', 'confirmo',
      'bora', 'beleza', 'ta', 'tá', 'blz', 'vlw', 'valeu', 'show', 'boa', 'bom',
      'obrigado', 'obrigada', 'tmj', 'combinado', 'fechado', 'vou', 'estarei',
      'la', 'claro', 'otimo', 'perfeito', 'isso',
    ];
    const FB_PHRASES = ['bom dia', 'boa tarde', 'boa noite', 'pode confirmar', 'pode sim', 'to la', 'la estarei', 'vou sim'];
    const fbWords = normFb.split(/\s+/);
    const isShortAffirm = isEmojiAffirm || (fbWords.length <= 8 && (
      FB_AFFIRM.some(a => fbWords.includes(a)) ||
      FB_PHRASES.some(p => normFb.includes(p))
    ));
    if (isShortAffirm) {
      try {
        const { data: custFb } = await supabase.from('customers').select('id, nome')
          .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
        if (custFb) {
          const padFb = (n: number) => String(n).padStart(2, '0');
          const nowBrFb = new Date(Date.now() - 3 * 60 * 60 * 1000);
          const todayFb = `${nowBrFb.getUTCFullYear()}-${padFb(nowBrFb.getUTCMonth()+1)}-${padFb(nowBrFb.getUTCDate())}`;
          const { data: apptsFb } = await supabase.from('appointments')
            .select('id, inicio, service_id, professional_id')
            .eq('tenant_id', tenantId).eq('customer_id', custFb.id)
            .in('status', ['CONFIRMED', 'PENDING', 'confirmado', 'pendente'])
            .gte('inicio', `${todayFb}T00:00:00`)
            .lt('inicio', `${todayFb}T23:59:59`)
            .order('inicio', { ascending: true }).limit(1);
          if (apptsFb && apptsFb.length > 0) {
            const apptTime = (apptsFb[0].inicio as string).substring(11, 16);
            const reply = `Show de bola! Aguardamos você às *${apptTime}*. 😊`;
            session.history.push({ role: 'user', text: text }, { role: 'bot', text: reply });
            session.data.greetedAt = brasiliaDate;
            await saveSession(tenantId, phone, session.data, session.history);
            await sendMsg(instanceName, phone, reply, tenantId);
            return;
          }
        }
      } catch (eFb) { console.error('[Agent] follow-up fallback error:', eFb); }
    }
  }

  // ─── First-message context-aware response ───────────────────────────────────
  // When shouldGreet=true AND the message resolves a date (either already pre-extracted
  // or found via regex here), respond directly with context instead of a generic greeting.
  // Skip if the message already mentions a specific service — let richFirstMessage + AI handle those.
  if (shouldGreet) {
    // If date wasn't pre-extracted yet, try to resolve it now (fallback path)
    if (!session.data.date) {
      const resolvedFm = resolveRelativeDate(lowerText, todayISO);
      if (resolvedFm) session.data.date = resolvedFm;
    }
    if (session.data.date) {
      const normFmCtx = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
      // Specific service keywords → skip this block, let richFirstMessage + AI handle
      const SPECIFIC_SVC_KW = [
        'cortar', 'corte', 'barba', 'cabelo', 'cabeca', 'escova', 'manicure',
        'sobrancelha', 'colorir', 'pintar', 'progressiva', 'alisar', 'procedimento',
      ];
      const hasSpecificSvcCtx = SPECIFIC_SVC_KW.some((k: string) => normFmCtx.includes(k));
      if (!hasSpecificSvcCtx) {
        const { greeting: gCtx, dateStr: dStrCtx } = getBrasiliaGreeting();
        const dateLabelCtx = formatDate(session.data.date);
        const prefTCtx  = session.data.preferredTime;
        const timeHintCtx = prefTCtx ? ` a partir das ${prefTCtx.replace(':00', 'h')}` : '';
        const qtyCtx = (session.data as any).requestedQuantity;
        const qtyHintCtx = qtyCtx && qtyCtx > 1 ? ` (${qtyCtx} horários)` : '';
        const profCtx = session.data.professionalName;
        const profHintCtx = profCtx ? ` com *${profCtx}*` : '';
        const replyCtx = `${gCtx.charAt(0).toUpperCase() + gCtx.slice(1)}! Para *${dateLabelCtx}${timeHintCtx}*${profHintCtx}${qtyHintCtx}, qual serviço você quer? 😊`;
        session.data.greetedAt = dStrCtx;
        session.history.push({ role: 'user', text }, { role: 'bot', text: replyCtx });
        await saveSession(tenantId, phone, session.data, session.history);
        await sendMsg(instanceName, phone, replyCtx, tenantId);
        return;
      }
    }
  }

  // ─── Professional contact inquiry response ──────────────────────────
  if (session.data.pendingProfContact) {
    const { profId, profName, profPhone } = session.data.pendingProfContact as { profId: string; profName: string; profPhone: string };
    const normMsgPc = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '');
    const normWdsPc = normMsgPc.split(/\s+/);
    const BOOK_KW_PC = ['agendar', 'marcar', 'horario', 'reservar', 'procedimento', 'servico', 'corte', 'barba', 'agendamento', 'cabelo', 'cabeca', 'cabecinha', 'cabeça'];
    const AFFIRM_PC  = ['sim', 'pode', 'quero', 'ok', 'claro', 'isso', 'bora', 'gostaria', 'queria', 'preciso', 'favor', 'exato'];
    const DENY_PC    = ['nao', 'não', 'nope', 'negativo'];
    const hasBookingKwPc = BOOK_KW_PC.some((k: string) => normMsgPc.includes(k));
    const isAffirmPc     = AFFIRM_PC.some((a: string) => normWdsPc.includes(a));
    const isDenyPc       = DENY_PC.some((d: string) => normWdsPc.includes(d)) && !isAffirmPc;

    if (hasBookingKwPc) {
      // Lead wants to book WITH this professional → set prof and fall through to normal flow
      session.data.professionalId   = profId;
      session.data.professionalName = profName;
      session.data.pendingProfContact = undefined;
    } else if (isAffirmPc) {
      if (profPhone) {
        const leadLabel = (pushName && pushName !== 'Cliente') ? `*${pushName}* (${phone})` : `*${phone}*`;
        const notif = `📩 *Olá, ${profName}!*\n\nO contato ${leadLabel} quer falar com você pelo WhatsApp. Verifique quando puder!\n\n— ${tenantName}`;
        await sendMsg(instanceName, profPhone, notif, tenantId);
      }
      const replyPc = profPhone
        ? `Certo! Notifiquei o *${profName}* e ele entrará em contato com você em breve. 😊`
        : `Vou passar seu contato para o *${profName}*! Em breve ele entra em contato. 😊`;
      session.data.pendingProfContact = undefined;
      session.history.push({ role: 'bot', text: replyPc });
      await sendMsg(instanceName, phone, replyPc, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(() => {});
      return;
    } else if (isDenyPc) {
      const replyPc = `Sem problema! Posso te ajudar com algo mais? Se quiser agendar um serviço é só falar. 😊`;
      session.data.pendingProfContact = undefined;
      session.history.push({ role: 'bot', text: replyPc });
      await sendMsg(instanceName, phone, replyPc, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(() => {});
      return;
    } else {
      // Ambiguous — let AI handle with full context
      session.data.pendingProfContact = undefined;
    }
  }

  // ── TypeScript-layer service keyword pre-extraction ─────────────────
  // Matches "corte barba" → "Corte de Cabelo e Barba", "barba" → "Barba", etc.
  // Runs BEFORE slot prefetch so the system knows the exact duration.
  if (!session.data.serviceId) {
    const _matchedSvc = matchServiceByKeywords(lowerText, services);
    if (_matchedSvc) {
      session.data.serviceId = _matchedSvc.id;
      session.data.serviceName = _matchedSvc.name;
      session.data.serviceDuration = _matchedSvc.durationMinutes;
      session.data.servicePrice = _matchedSvc.price;
      console.log('[Agent] TS pre-extracted service:', _matchedSvc.name);
    }
  }

  // Prefetch slots only when all 3 are known (professional + date + service).
  // Service is required because availability depends on duration.
  let prefetchedSlots: string[] | undefined;
  const _hasProf = !!session.data.professionalId;
  const _hasDate = !!session.data.date;
  const _hasSvc  = !!session.data.serviceId;
  if (_hasProf && _hasDate && _hasSvc) {
    const _slotDur = session.data.serviceDuration || 30;
    prefetchedSlots = await getAvailableSlots(tenantId, session.data.professionalId!, session.data.date!, _slotDur, settings);

    // Empty slots = vacation or fully booked — handle immediately before calling brain
    if (prefetchedSlots.length === 0) {
      const _vacBreakWh3 = (settings.breaks || []).find((b: any) => {
        if (b.professionalId && b.professionalId !== session.data.professionalId) return false;
        if (b.type !== 'vacation') return false;
        const vacStart = b.date || '';
        const vacEnd = b.vacationEndDate || b.date || '';
        return !!vacStart && session.data.date >= vacStart && session.data.date <= vacEnd;
      });
      const profName = session.data.professionalName || 'O profissional';
      if (_vacBreakWh3) {
        const _vacEndWh3 = (_vacBreakWh3 as any).vacationEndDate || _vacBreakWh3.date || '';
        const _returnDateWh3 = _vacEndWh3 ? (() => {
          const d = new Date(_vacEndWh3 + 'T12:00:00');
          d.setDate(d.getDate() + 1);
          return formatDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        })() : '';
        const _returnInfoWh3 = _returnDateWh3 ? ` Retorna ${_returnDateWh3}.` : '';
        const noAvail = `${profName} está de férias neste período!${_returnInfoWh3} 🏖️\n\nGostaria de escolher outro profissional ou outra data?`;
        session.data.date = undefined;
        session.data.professionalId = undefined;
        session.data.professionalName = undefined;
        session.history.push({ role: 'bot', text: noAvail });
        await sendMsg(instanceName, phone, noAvail, tenantId);
        saveSession(tenantId, phone, session.data, session.history).catch(e => console.error('[Agent] saveSession err:', e));
        return;
      }
      // Fully booked — proactively check the next open days (up to 7 days ahead, skip closed days)
      const _bookedDate = session.data.date;
      const _nextDur = session.data.serviceDuration || (services.length > 0
        ? Math.min(...services.map((s: any) => s.durationMinutes || 30))
        : 30);
      let _foundNextDate: string | null = null;
      let _foundNextSlots: string[] = [];
      const _bookedBase = new Date(_bookedDate + 'T12:00:00Z');
      for (let _di = 1; _di <= 7; _di++) {
        const _nd = new Date(_bookedBase.getTime() + _di * 86400000);
        const _ndDow = _nd.getUTCDay();
        if (!settings.operatingHours?.[_ndDow]?.active) continue; // skip closed days
        const _ndISO = `${_nd.getUTCFullYear()}-${pad(_nd.getUTCMonth()+1)}-${pad(_nd.getUTCDate())}`;
        const _ndSlots = await getAvailableSlots(tenantId, session.data.professionalId!, _ndISO, _nextDur, settings);
        if (_ndSlots.length > 0) { _foundNextDate = _ndISO; _foundNextSlots = _ndSlots; break; }
      }
      if (_foundNextDate) {
        const _isToday = _bookedDate === todayISO;
        const _fullLabel = _isToday ? 'Hoje' : `Em ${formatDate(_bookedDate)}`;
        const _ndDow2 = DOW_PT[new Date(_foundNextDate + 'T12:00:00Z').getUTCDay()];
        const _ndDD = _foundNextDate.slice(8, 10);
        const _ndMM = _foundNextDate.slice(5, 7);
        const noAvail = `${_fullLabel} o ${profName} está com a agenda cheia 😕 Mas na ${_ndDow2}, dia ${_ndDD}/${_ndMM}, tem horário! Quer marcar?`;
        session.data.date = _foundNextDate;
        session.data.availableSlots = _foundNextSlots;
        session.history.push({ role: 'bot', text: noAvail });
        await sendMsg(instanceName, phone, noAvail, tenantId);
        saveSession(tenantId, phone, session.data, session.history).catch(e => console.error('[Agent] saveSession err:', e));
        return;
      }
      const noAvail = `Que pena! Não tem horário disponível em ${formatDate(_bookedDate)} com ${profName}. 😕\n\nPara qual outro dia você prefere?`;
      session.data.date = undefined;
      session.history.push({ role: 'bot', text: noAvail });
      await sendMsg(instanceName, phone, noAvail, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(e => console.error('[Agent] saveSession err:', e));
      return;
    }
  }

  // ─── Suppress greeting when first message already has rich context ────────
  // When shouldGreet=true but the client's first message already contains booking intent
  // (service keywords, professional name, date, or is a long contextual message),
  // disable the "only say welcome, ask nothing else" greeting override so the AI can
  // actually process and answer the message content.
  // We still set greetedAt so the next turn doesn't trigger the greeting again.
  const _normRI = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
  const SERVICE_INTENT_KW = [
    'cortar', 'corte', 'cabelo', 'cabeca', 'barba', 'sobrancelha', 'manicure',
    'escova', 'colorir', 'pintar', 'progressiva', 'alisar', 'procedimento',
    'agendar', 'marcar', 'horario', 'quero', 'preciso', 'gostaria', 'queria',
    'tem vaga', 'tem horario', 'disponivel', 'atender', 'atendimento', 'agora',
  ];
  const hasServiceIntent = SERVICE_INTENT_KW.some((k: string) => _normRI.includes(k));
  // Rich = any combination of context signals OR just service intent alone.
  // When the client's first message (or combined debounced messages) already contains
  // a service keyword, suppress the "only greet, ask nothing" override so the AI
  // can actually process and answer the message.
  const richFirstMessage = shouldGreet && (
    !!(session.data.professionalId && session.data.date) ||
    !!(session.data.professionalId && hasServiceIntent) ||
    !!(session.data.date && hasServiceIntent) ||
    hasServiceIntent  // any service intent → process fully instead of just greeting
  );
  const effectiveShouldGreet = shouldGreet && !richFirstMessage;
  if (richFirstMessage) session.data.greetedAt = brasiliaDate;

  // ── Build vacation context for AI prompt ──────────────────────────
  const _breaksWh = settings.breaks || [];
  const _profsOnVacWh = professionals.filter((p: any) =>
    _breaksWh.some((b: any) => {
      if (b.type !== 'vacation') return false;
      if (b.professionalId && b.professionalId !== p.id) return false;
      const vs = b.date || '', ve = b.vacationEndDate || b.date || '';
      return !!vs && _targetDateWh >= vs && _targetDateWh <= ve;
    })
  );
  const _vacCtxWh = _profsOnVacWh.length > 0 ? `🏖️ PROFISSIONAIS DE FÉRIAS (NÃO disponíveis para agendamento):\n${_profsOnVacWh.map((p: any) => {
    const vb = _breaksWh.find((b: any) => {
      if (b.type !== 'vacation') return false;
      if (b.professionalId && b.professionalId !== p.id) return false;
      const vs = b.date || '', ve = b.vacationEndDate || b.date || '';
      return !!vs && _targetDateWh >= vs && _targetDateWh <= ve;
    });
    const ve = vb ? (vb.vacationEndDate || vb.date || '') : '';
    const retorno = ve ? (() => {
      const d = new Date(ve + 'T12:00:00');
      d.setDate(d.getDate() + 1);
      return formatDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    })() : 'data indefinida';
    return `• ${p.name} — de férias, retorna ${retorno}`;
  }).join('\n')}\n⚠️ Se o cliente pedir ESPECIFICAMENTE um profissional de férias, INFORME que está de férias e quando retorna. NÃO insista em outro profissional se o cliente disser que quer SOMENTE aquele.` : '';

  // First brain call
  let brain = await callBrain(apiKey, tenantName, todayISO, services, professionalsVisible, session.history, session.data, prefetchedSlots, customPrompt || undefined, effectiveShouldGreet, brasiliaGreeting, tenantId, phone, _vacCtxWh || undefined);
  if (!brain) {
    const fallback = `Desculpe, tive um problema técnico. Pode repetir? 😅`;
    session.history.push({ role: 'bot', text: fallback });
    await sendMsg(instanceName, phone, fallback, tenantId);
    saveSession(tenantId, phone, session.data, session.history).catch(e => console.error('[Agent] saveSession err:', e));
    return;
  }

  // Apply extractions
  const ext = brain.extracted;
  if (ext.clientName && !session.data.clientName) session.data.clientName = capitalizeName(ext.clientName.trim());
  if (ext.serviceId && !session.data.serviceId) {
    const svc = services.find(s => s.id === ext.serviceId);
    if (svc) { session.data.serviceId = svc.id; session.data.serviceName = svc.name; session.data.serviceDuration = svc.durationMinutes; session.data.servicePrice = svc.price; }
  }
  if (ext.professionalId && !session.data.professionalId) {
    const prof = professionals.find(p => p.id === ext.professionalId);
    if (prof) { session.data.professionalId = prof.id; session.data.professionalName = prof.name; }
  }
  if (ext.date && !session.data.date) session.data.date = ext.date;
  if (ext.time && !session.data.time && prefetchedSlots?.length) {
    if (prefetchedSlots.includes(ext.time)) session.data.time = ext.time;
  }

  // ── TypeScript guard: block LLM from offering times without service ──────────
  // If service is still unknown after LLM extraction, strip any specific times from
  // the reply and replace with a service question. This is a hard guardrail since
  // availability depends on service duration.
  if (!session.data.serviceId && session.data.professionalId) {
    const _timePattern = /\b([01]?\d|2[0-3])[:h]\s*[0-5]?\d\b/;
    if (_timePattern.test(brain.reply) || (ext.time && !ext.serviceId)) {
      const svcNames = services.map((s: any) => s.name).join(', ');
      brain.reply = `Qual procedimento você gostaria? Temos: ${svcNames}`;
      brain.extracted.time = null;
      brain.extracted.confirmed = null;
    }
  }

  // Re-run with real slots if we just got prof+date+service
  // Re-fetch slots when all 3 are now set but weren't before the LLM call
  const justGotProfAndDate = !prefetchedSlots && session.data.professionalId && session.data.date && session.data.serviceId;
  if (justGotProfAndDate) {
    const newSlots = await getAvailableSlots(tenantId, session.data.professionalId!, session.data.date!, session.data.serviceDuration || 60, settings);
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
        session.data.serviceDuration || (services[0]?.durationMinutes ?? 30), settings);
      if (_nextSlots2.length > 0) {
        const _isToday2 = _bookedDate2 === todayISO;
        const _fullLabel2 = _isToday2 ? 'Hoje' : `Em ${formatDate(_bookedDate2)}`;
        const _nextLabel2 = _isToday2 ? 'amanhã' : `em ${formatDate(_nextDate2)}`;
        const msg2 = `${_fullLabel2} o ${_profName2} está com a agenda cheia 😕 Mas ${_nextLabel2} tem horário! Quer marcar?`;
        session.data.date = _nextDate2;
        session.data.availableSlots = _nextSlots2;
        session.history.push({ role: 'bot', text: msg2 });
        await sendMsg(instanceName, phone, msg2, tenantId);
        saveSession(tenantId, phone, session.data, session.history).catch(e => console.error('[Agent] saveSession err:', e));
        return;
      }
      const msg = `Que pena! Não tem horário disponível em ${formatDate(_bookedDate2)} com ${_profName2}. 😕\n\nPara qual outro dia você prefere?`;
      session.data.date = undefined;
      session.history.push({ role: 'bot', text: msg });
      await sendMsg(instanceName, phone, msg, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(e => console.error('[Agent] saveSession err:', e));
      return;
    }
    const brain2 = await callBrain(apiKey, tenantName, todayISO, services, professionalsVisible, session.history, session.data, newSlots, customPrompt || undefined, false, brasiliaGreeting, tenantId, phone, _vacCtxWh || undefined);
    if (brain2) {
      if (brain2.extracted.time && !session.data.time && newSlots.includes(brain2.extracted.time)) {
        session.data.time = brain2.extracted.time;
      }
      brain = brain2;
    }
  }

  // Affirmative fallback for confirmation
  if (session.data.pendingConfirm && brain.extracted.confirmed === null) {
    const affirm = ['sim', 'ok', 'pode', 'confirmo', 'isso', 'exato', 'correto', 'quero', 'bora', 'ta', 'beleza', 'certo', 'fechado', 'vamos', 'claro', 'yes', 'perfeito'];
    const norm = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    if (affirm.some(a => norm.split(/\s+/).includes(a) || norm === a)) {
      brain.extracted.confirmed = true;
    }
  }

  // Safety net: impede "Agendado!" fictício quando faltam dados para booking
  if (brain.extracted.confirmed === true && !(session.data.serviceId && session.data.professionalId && session.data.date && session.data.time)) {
    brain.extracted.confirmed = null;
    const missingParts = [
      !session.data.serviceId && 'serviço',
      !session.data.professionalId && 'profissional',
      !session.data.date && 'data',
      !session.data.time && 'horário',
    ].filter(Boolean).join(', ');
    const confirmWords = /agendad|marcad|confirm|reservad|te esperamos/i;
    if (confirmWords.test(brain.reply || '')) {
      brain.reply = `Quase lá! Ainda preciso saber: ${missingParts}. 😊`;
    }
  }

  // Handle cancellation extracted by AI
  if (brain.extracted.cancelled === true) {
    try {
      const { data: customer } = await supabase.from('customers').select('id')
        .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
      if (customer) {
        const n0 = new Date(Date.now() - 3 * 60 * 60 * 1000); // Brazil time
        const nowLocal = `${n0.getUTCFullYear()}-${pad(n0.getUTCMonth()+1)}-${pad(n0.getUTCDate())}T${pad(n0.getUTCHours())}:${pad(n0.getUTCMinutes())}:00`;
        const { data: appts } = await supabase.from('appointments').select('id, inicio')
          .eq('tenant_id', tenantId).eq('customer_id', customer.id)
          .in('status', ['CONFIRMED', 'PENDING', 'confirmado', 'pendente'])
          .gte('inicio', nowLocal).order('inicio', { ascending: true }).limit(1);
        if (appts && appts.length > 0) {
          await supabase.from('appointments').update({ status: 'CANCELLED' }).eq('id', appts[0].id);
          // Notify waitlist leads (fire-and-forget)
          notifyWaitlistLeadsInline(tenantId, appts[0].inicio?.substring(0, 10)).catch(console.error);
        }
      }
    } catch (e) { console.error('[Agent] cancelled extraction error:', e); }
    await clearSession(tenantId, phone);
    session.history.push({ role: 'bot', text: brain.reply });
    await sendMsg(instanceName, phone, brain.reply, tenantId);
    return;
  }

  // Handle waitlist request
  if (brain.extracted.waitlist === true) {
    try {
      const { data: custWl } = await supabase.from('customers').select('id')
        .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
      if (custWl) {
        const { data: sWl } = await supabase.from('tenant_settings').select('follow_up').eq('tenant_id', tenantId).maybeSingle();
        const fuWl = sWl?.follow_up || {};
        const allCDataWl = { ...(fuWl._customerData || {}) };
        allCDataWl[custWl.id] = { ...(allCDataWl[custWl.id] || {}), waitlistAlert: true };
        await supabase.from('tenant_settings').upsert({ tenant_id: tenantId, follow_up: { ...fuWl, _customerData: allCDataWl } });
      }
    } catch (e) { console.error('[Agent] waitlist save error:', e); }
  }

  // Handle booking
  if (brain.extracted.confirmed === true && session.data.serviceId && session.data.professionalId && session.data.date && session.data.time) {
    try {
      // Compute end time without timezone-dependent Date methods
      const [startHH, startMM] = session.data.time.split(':').map(Number);
      const dur = session.data.serviceDuration || 60;
      const totalMin = startHH * 60 + startMM + dur;
      const endH = Math.floor(totalMin / 60) % 24;
      const endM = totalMin % 60;
      const startTimeStr = `${session.data.date}T${session.data.time}:00`;
      const endTimeStr   = `${session.data.date}T${pad(endH)}:${pad(endM)}:00`;

      // Slot conflict check — prevent double booking (checks full duration overlap)
      const { data: conflicting } = await supabase.from('appointments')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('professional_id', session.data.professionalId)
        .not('status', 'in', '("cancelado","CANCELLED")')
        .lt('inicio', endTimeStr)   // existing starts before new ends
        .gt('fim',    startTimeStr); // existing ends after new starts
      if (conflicting && conflicting.length > 0) {
        const freshSlots = await getAvailableSlots(tenantId, session.data.professionalId!, session.data.date!, dur, settings);
        session.data.time = undefined;
        session.data.availableSlots = freshSlots;
        const takenMsg = freshSlots.length > 0
          ? `Ops! Esse horário acabou de ser ocupado. 😕 Ainda temos:\n\n${freshSlots.slice(0, 6).map(s => `• ${s}`).join('\n')}\n\nQual você prefere?`
          : `Ops! Esse horário foi ocupado e não há mais vagas nesse dia. Para qual outro dia você prefere?`;
        if (freshSlots.length === 0) session.data.date = undefined;
        session.history.push({ role: 'bot', text: takenMsg });
        await sendMsg(instanceName, phone, takenMsg, tenantId);
        saveSession(tenantId, phone, session.data, session.history).catch(() => {});
        return;
      }

      // Find or create customer
      let { data: customer } = await supabase.from('customers').select('id')
        .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
      if (!customer) {
        const { data: newC } = await supabase.from('customers')
          .insert({ tenant_id: tenantId, telefone: phone, nome: session.data.clientName || pushName || 'Cliente' })
          .select('id').single();
        customer = newC;
      }
      if (!customer) throw new Error('Failed to find or create customer');

      // ── Plan quota check ────────────────────────────────────────────
      let isPlanAppt = false;
      let planBalanceMsg = '';
      try {
        const cData = settings.customerData[customer.id] || {};
        if (cData.planId && cData.planStatus === 'ativo') {
          const plan = settings.plans.find(p => p.id === cData.planId && p.active);
          if (plan) {
            // Migrate legacy plan format
            const quotas = plan.quotas && plan.quotas.length > 0
              ? plan.quotas
              : (plan.serviceId ? [{ serviceId: plan.serviceId, quantity: plan.proceduresPerMonth || 0 }] : []);

            const svcId = session.data.serviceId;
            const quota = quotas.find(q => q.serviceId === svcId);
            if (quota) {
              const usageKey = `${customer.id}::${svcId}`;
              const used = settings.planUsage[usageKey] || 0;
              if (used < quota.quantity) {
                isPlanAppt = true;
                // Increment usage in JSONB
                const newUsage = { ...settings.planUsage, [usageKey]: used + 1 };
                const { data: curSettings } = await supabase.from('tenant_settings')
                  .select('follow_up').eq('tenant_id', tenantId).maybeSingle();
                const curFu = curSettings?.follow_up || {};
                await supabase.from('tenant_settings').upsert({
                  tenant_id: tenantId,
                  follow_up: { ...curFu, _planUsage: newUsage }
                }, { onConflict: 'tenant_id' });
                settings.planUsage[usageKey] = used + 1; // update local copy too

                // Build balance message for all quotas
                const balParts: string[] = [];
                for (const q of quotas) {
                  const uKey = `${customer.id}::${q.serviceId}`;
                  const u = settings.planUsage[uKey] || 0;
                  const svcName = session.data.serviceName || q.serviceId;
                  // Try to look up real service name for other quotas
                  balParts.push(`${svcName}: ${u}/${q.quantity}`);
                }
                planBalanceMsg = `\n\n📦 *Saldo do plano:* ${balParts.join(' | ')}`;
              }
            }
          }
        }
      } catch (ePlan) {
        console.error('[Agent] plan quota check error:', ePlan);
      }

      await supabase.from('appointments').insert({
        tenant_id: tenantId,
        customer_id: customer.id,
        professional_id: session.data.professionalId,
        service_id: session.data.serviceId,
        inicio: startTimeStr,
        fim: endTimeStr,
        status: 'CONFIRMED',
        origem: 'AI',
        is_plan: isPlanAppt,
      });

      // ── Reschedule: cancel old appointment ───────────────────────────
      const pendingRS = session.data.pendingReschedule;
      const wasReschedule = !!pendingRS?.oldApptId;
      if (pendingRS?.oldApptId) {
        try {
          await supabase.from('appointments')
            .update({ status: 'CANCELLED' })
            .eq('id', pendingRS.oldApptId).eq('tenant_id', tenantId);
          notifyWaitlistLeadsInline(tenantId, pendingRS.oldDate).catch(console.error);
        } catch (eCancelOld) {
          console.error('[Agent] reschedule: failed to cancel old appt:', eCancelOld);
        }
      }

      await clearSession(tenantId, phone);

      const confirmMsg = wasReschedule
        ? `✅ *Reagendado!*\n\n` +
          `📅 *Dia:* ${formatDate(session.data.date)}\n` +
          `⏰ *Horário:* ${session.data.time}\n` +
          `✂️ *Procedimento:* ${session.data.serviceName}\n` +
          `💈 *Profissional:* ${session.data.professionalName}` +
          (isPlanAppt ? planBalanceMsg : '') +
          `\n\nTe esperamos! 😊`
        : `✅ *Agendamento confirmado!*\n\n` +
          `📅 *Dia:* ${formatDate(session.data.date)}\n` +
          `⏰ *Horário:* ${session.data.time}\n` +
          `✂️ *Procedimento:* ${session.data.serviceName}\n` +
          `💈 *Profissional:* ${session.data.professionalName}` +
          (isPlanAppt ? planBalanceMsg : '') +
          `\n\nTe esperamos! 😊`;
      await sendMsg(instanceName, phone, confirmMsg, tenantId);

      // Individual appointment notifications disabled — daily agenda summary sent at 00:01 instead.

      return;
    } catch (e) {
      console.error('[Agent] booking error:', e);
      await sendMsg(instanceName, phone, `Ocorreu um erro ao confirmar. Por favor, tente novamente.`, tenantId);
      return;
    }
  }

  // Set pendingConfirm when all info is known
  if (session.data.serviceId && session.data.professionalId && session.data.date && session.data.time) {
    session.data.pendingConfirm = true;
  }

  // ── Duplicate / loop guard ────────────────────────────────────────────────
  // When the AI would repeat a generic greeting/question that was already sent last turn,
  // replace with a clear "I didn't understand" message instead of looping.
  {
    const lastBotMsg = (session.history.filter((h: any) => h.role === 'bot').slice(-1)[0]?.text || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const newReplyNorm = brain.reply.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const GENERIC_PAT = [
      'como posso te ajudar', 'seja bem-vindo', 'seja bem vindo',
      'tudo bem?', 'tudo bem!', 'qual procedimento voce gostaria',
      'o que voce gostaria de agendar', 'como posso ajudar',
    ];
    const isGeneric = (s: string) => GENERIC_PAT.some(p => s.includes(p));
    if (isGeneric(newReplyNorm) && isGeneric(lastBotMsg)) {
      brain.reply = 'Desculpa, não entendi bem. Como posso te ajudar hoje? 😊';
      console.log('[Agent] Loop guard triggered — replaced generic repeat with fallback');
    }
  }

  if (shouldGreet || richFirstMessage) session.data.greetedAt = brasiliaDate;
  session.history.push({ role: 'bot', text: brain.reply });
  await sendMsg(instanceName, phone, brain.reply, tenantId);
  saveSession(tenantId, phone, session.data, session.history).catch(e => console.error('[Agent] saveSession err:', e));
}

// ── Campaign-tick: server-side bulk dispatch ──────────────────────────
function randRangeEF(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isInWindowEF(windowStart: string, windowEnd: string): boolean {
  // Evaluate in America/Sao_Paulo time (UTC-3) so user-defined hours make sense
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const [h, m] = fmt.format(new Date()).split(':').map(Number);
  const nowMins = h * 60 + m;
  const [sh, sm] = windowStart.split(':').map(Number);
  const [eh, em] = windowEnd.split(':').map(Number);
  return nowMins >= sh * 60 + sm && nowMins < eh * 60 + em;
}

async function processCampaignTick(): Promise<void> {
  const now = new Date().toISOString();

  // Find all running campaigns whose next_send_at is due
  const { data: campaigns } = await supabase
    .from('bulk_campaigns')
    .select('*')
    .eq('status', 'running')
    .lte('next_send_at', now);

  if (!campaigns?.length) return;

  for (const camp of campaigns) {
    try {
      const contacts: { id: string; name: string; phone: string }[] = camp.contacts || [];
      const messages: string[] = (camp.messages || []).filter((m: string) => m?.trim());

      // Campaign finished
      if (camp.current_index >= contacts.length || !messages.length) {
        await supabase.from('bulk_campaigns')
          .update({ status: 'done', updated_at: new Date().toISOString() })
          .eq('id', camp.id);
        continue;
      }

      // Time window check — reschedule for next minute if outside window
      if (camp.use_time_window && !isInWindowEF(camp.window_start, camp.window_end)) {
        await supabase.from('bulk_campaigns')
          .update({
            next_send_at: new Date(Date.now() + 60_000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', camp.id);
        continue;
      }

      const contact = contacts[camp.current_index];
      const msg = messages[camp.sent_count % messages.length];

      let ok = false;
      try {
        await sendMsg(camp.admin_instance, contact.phone, msg);
        ok = true;
      } catch (e) {
        console.error('[Campaign] sendMsg error:', e);
      }

      const newSent = camp.sent_count + (ok ? 1 : 0);
      const newErrors = camp.error_count + (ok ? 0 : 1);
      const newIndex = camp.current_index + 1;
      const isLast = newIndex >= contacts.length;

      let nextMs = 0;
      if (!isLast) {
        const isPause = camp.pause_every > 0 && (camp.sent_count + 1) % camp.pause_every === 0;
        nextMs = (isPause
          ? randRangeEF(camp.pause_min, camp.pause_max)
          : randRangeEF(camp.delay_min, camp.delay_max)
        ) * 1_000;
      }

      await supabase.from('bulk_campaigns')
        .update({
          sent_count: newSent,
          error_count: newErrors,
          current_index: newIndex,
          status: isLast ? 'done' : 'running',
          next_send_at: new Date(Date.now() + nextMs).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', camp.id);

    } catch (e) {
      console.error('[Campaign] tick error for', camp.id, e);
    }
  }
}

// ── Webhook entry point ───────────────────────────────────────────────
Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-campaign-tick',
  };

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  // ── Campaign-tick shortcut (browser polls + pg_cron) ─────────────────
  if (req.headers.get('x-campaign-tick') === 'true') {
    try {
      await processCampaignTick();
    } catch (e: any) {
      console.error('[CampaignTick] error:', e);
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const event: string = body.event || body.type || '';

    // Only process message events
    if (!event.toLowerCase().includes('message')) {
      return new Response(JSON.stringify({ ok: true, skipped: event }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const instanceName: string = body.instance || body.instanceName || '';

    // Parse message(s) — Evolution API sends either array or single object
    const msgData = body.data;
    const messages: any[] = Array.isArray(msgData)
      ? msgData
      : Array.isArray(msgData?.messages)
        ? msgData.messages
        : msgData ? [msgData] : [];

    // Find tenant by instance name
    const { data: tenants } = await supabase.from('tenants').select('*');
    const tenant = (tenants || []).find((t: any) =>
      t.evolution_instance === instanceName ||
      `agz_${t.slug}` === instanceName ||
      instanceName.includes(t.slug || '')
    );
    if (!tenant) {
      console.warn('[Webhook] tenant not found for instance:', instanceName);
      return new Response(JSON.stringify({ ok: false, error: 'tenant not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Load settings from Supabase (reads follow_up JSONB)
    const { data: settingsRow } = await supabase.from('tenant_settings')
      .select('*').eq('tenant_id', tenant.id).maybeSingle();
    const fu = settingsRow?.follow_up || {};
    const settings = {
      aiActive: settingsRow?.ai_active ?? false,
      aiLeadActive: fu._aiLeadActive !== false, // default true; false = não responder leads desconhecidos
      openaiApiKey: fu._openaiApiKey || '',
      systemPrompt: fu._systemPrompt || '',
      operatingHours: settingsRow?.operating_hours || fu._operatingHours || {},
      breaks: fu._breaks || [],
      msgBufferSecs: fu._msgBufferSecs ?? 30,
      customerData: (fu._customerData || {}) as Record<string, { aiPaused?: boolean; planId?: string; planStatus?: string }>,
      plans: (fu._plans || []) as Array<{ id: string; active: boolean; quotas?: Array<{ serviceId: string; quantity: number }>; serviceId?: string; proceduresPerMonth?: number; price?: number }>,
      planUsage: (fu._planUsage || {}) as Record<string, number>,
    };

    if (!settings.aiActive) {
      return new Response(JSON.stringify({ ok: true, skipped: 'ai_inactive' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Process each message
    for (const msg of messages) {
      if (!msg || msg.key?.fromMe) continue;
      const remoteJid: string = msg.key?.remoteJid || '';
      if (remoteJid.includes('@g.us')) continue; // skip groups

      const msgId: string = msg.key?.id || '';
      if (msgId) {
        // Claim by message ID (instant dedup)
        if (!await claimMsg(`wh::${msgId}`)) continue;
        // Also claim by fingerprint so browser polling skips this message
        const phone = extractPhone(msg);
        const rawText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        if (phone && rawText) {
          await claimMsg(`${tenant.id}::${phone}::${rawText.trim().slice(0, 120)}`);
        }
      }

      // Resolve text (with audio transcription if needed)
      let text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
      if (!text) {
        const msgType = msg.messageType || msg.type || '';
        const isAudio = ['audioMessage', 'pttMessage'].includes(msgType) || !!msg.message?.audioMessage || !!msg.message?.pttMessage;
        if (isAudio) {
          let audioKey = (settings.openaiApiKey || '').trim();
          if (!audioKey) {
            let gRows: any[] = [];
            try { const { data } = await supabase.from('global_settings').select('key, value'); gRows = data || []; } catch {}
            audioKey = ((gRows).find((r: any) => r.key === 'shared_openai_key')?.value || '').trim() || (tenant.gemini_api_key || '').trim();
          }
          if (audioKey) {
            const audio = await fetchAudioBase64(instanceName, msg);
            if (audio) {
              const transcribed = await transcribeAudio(audioKey, audio.base64, audio.mimeType);
              if (transcribed) text = transcribed;
            }
          }
          if (!text) {
            const phone = extractPhone(msg);
            if (phone) await sendMsg(instanceName, phone, `Recebi seu áudio! 🎵 Pode digitar sua mensagem? 😊`, tenant.id);
            continue;
          }
        }
      }

      if (!text) continue;
      const phone = extractPhone(msg);
      if (!phone) continue;

      // Persist incoming message to whatsapp_messages (fire-and-forget)
      EdgeRuntime.waitUntil(
        saveWaMsg(
          tenant.id,
          msgId || `${phone}_${msg.messageTimestamp || Date.now()}`,
          phone, text,
          msg.messageTimestamp || Math.floor(Date.now() / 1000),
          msg.pushName || '', msg.messageType || 'text', false,
          { key: msg.key, message: msg.message, messageType: msg.messageType }
        )
      );

      // Se aiLeadActive estiver desativado, ignora mensagens de números desconhecidos
      // Também verifica se a IA foi pausada manualmente para este lead específico
      const hasPausedCustomers = Object.values(settings.customerData).some(cd => cd?.aiPaused);
      const needsCustomerLookup = !settings.aiLeadActive || hasPausedCustomers;
      let resolvedCustomerId: string | null = null;
      if (needsCustomerLookup) {
        const { data: existingCust } = await supabase.from('customers')
          .select('id').eq('tenant_id', tenant.id).eq('telefone', phone).maybeSingle();
        if (!settings.aiLeadActive && !existingCust) continue;
        resolvedCustomerId = existingCust?.id || null;
      }
      if (resolvedCustomerId && settings.customerData[resolvedCustomerId]?.aiPaused) continue;
      // Also check phone-based pause key (for leads not yet in customers table)
      if (settings.customerData[`phone:${phone}`]?.aiPaused) continue;

      // Fire-and-forget: responde 200 imediatamente; debounce roda em background
      EdgeRuntime.waitUntil(
        debouncedRun(tenant, phone, text, settings, msg.pushName).catch(e =>
          console.error('[Webhook] debouncedRun error:', e)
        )
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e: any) {
    console.error('[Webhook] Fatal error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
