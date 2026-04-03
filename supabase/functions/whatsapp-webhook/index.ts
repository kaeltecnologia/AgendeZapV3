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

// ── Periodic background cleanup (runs at most once per hour) ─────────
let _lastCleanup = 0;
function maybeCleanup() {
  const now = Date.now();
  if (now - _lastCleanup < 3_600_000) return; // max once/hour
  _lastCleanup = now;
  (async () => {
    try {
      // Purge sessions older than 24h (safety net beyond per-load TTL)
      await supabase.from('agent_sessions').delete()
        .lt('updated_at', new Date(now - 86_400_000).toISOString());
      // Purge old msg_dedup entries
      await supabase.from('msg_dedup').delete()
        .lt('ts', new Date(now - 86_400_000).toISOString());
      // Purge stale _wSentDedup entries from memory
      for (const [k, t] of _wSentDedup) { if (now - t > _W_DEDUP_TTL) _wSentDedup.delete(k); }
      console.log('[Cleanup] Purged old sessions, msg_dedup, and in-memory cache');
    } catch (e) { console.error('[Cleanup] error:', e); }
  })();
}

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
  const sd = data.data || {};
  // ── Clean stale volatile fields on session load ──────────────────────
  // availableSlots must always be freshly fetched, never carried over
  delete sd.availableSlots;
  // pendingVacationOffer is per-turn context, should not persist
  delete sd.pendingVacationOffer;
  // Clean stale button state (>30 min old)
  if (sd._pendingButtons && Date.now() - (sd._pendingButtons.sentAt || 0) > 30 * 60 * 1000) {
    delete sd._pendingButtons;
  }
  return { data: sd, history: data.history || [] };
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
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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

async function cleanupAudioTranscription(apiKey: string, raw: string): Promise<string> {
  const prompt = `Você é um assistente que converte fala informal brasileira em texto estruturado para agendamento.
Regras:
- Mantenha nomes de serviços, datas, horários e nomes de profissionais
- Converta gírias e abreviações para português correto
- "dps do almoco tipo umas duas hora" → "às 14h"
- "5 e meia" → "às 17:30"
- "amanha de manha" → "amanhã de manhã"
- Retorne APENAS o texto limpo, sem explicações ou aspas

Texto do áudio: "${raw}"`;

  try {
    if (apiKey.startsWith('sk-')) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          temperature: 0.2,
        }),
      });
      if (!res.ok) return raw;
      const j = await res.json();
      return j.choices?.[0]?.message?.content?.trim() || raw;
    } else {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        }),
      });
      if (!res.ok) return raw;
      return (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text?.trim() || raw;
    }
  } catch { return raw; }
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
      // Feriado: aplica a TODOS os profissionais
      if (b.type === 'holiday' && !b.professionalId && b.date === date) {
        // Dia inteiro
        if (b.startTime === '00:00' && (b.endTime === '23:59' || b.endTime === '23:00')) return true;
        // Meio período: bloqueia a partir do startTime
        return label >= b.startTime;
      }
      // Férias: EXIGE professionalId explícito (sem professionalId = não aplica a ninguém)
      if (b.type === 'vacation') {
        if (!b.professionalId || b.professionalId !== professionalId) return false;
        const vacStart = b.date || '';
        const vacEnd = b.vacationEndDate || b.date || '';
        return !!vacStart && date >= vacStart && date <= vacEnd;
      }
      if (b.professionalId && b.professionalId !== professionalId) return false;
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
  'gpt-4.1-mini':     { input: 0.400 / 1_000_000, output: 1.600 / 1_000_000 },
  'gemini-2.5-flash': { input: 0, output: 0 },
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
    const p = MODEL_PRICING[params.model] ?? MODEL_PRICING['gpt-4.1-mini'];
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
  vacationCtx?: string,
  operatingHours?: Record<number, { active: boolean; start?: string; end?: string }>
): Promise<any | null> {
  // ── Data preparation (unchanged) ──────────────────────────────────
  const svcList = services.map(s => `- ${s.name || 'Serviço'} (${s.durationMinutes || 30}min, R$${(Number(s.price) || 0).toFixed(2)}) -- ID:"${s.id}"`).join('\n');
  const profList = professionals.length > 0 ? professionals.map(p => `- ${p.name || 'Profissional'} -- ID:"${p.id}"`).join('\n') : '- (apenas um profissional disponível)';

  const known: string[] = [];
  if (data.clientName) known.push(`Nome: ${data.clientName}`);
  if (data.serviceName) known.push(`Serviço: ${data.serviceName}${(data as any)._comboTotalDuration ? ` (${(data as any)._comboTotalDuration}min total, R$${((data as any)._comboTotalPrice || 0).toFixed(2)})` : ''}`);
  if ((data as any)._comboRequest) known.push(`⚠️ MULTI-SERVIÇO: Cliente pediu ${(data as any)._comboRequest}. Mencione TODOS os serviços na resposta. Duração total e preço já estão calculados acima.`);
  if (data.professionalName) known.push(`Profissional: ${data.professionalName}`);
  if (data.date) known.push(`Data: ${formatDate(data.date)}`);
  if (data.time) known.push(`Horário: ${data.time}`);
  if ((data as any)._fitInNow) {
    known.push(`⚡ ENCAIXE AGORA: Cliente quer atendimento IMEDIATO. Pergunte qual serviço se não souber. Mostre horários disponíveis a partir de AGORA. Se não houver vaga agora, sugira o mais próximo.`);
  }
  if ((data as any)._suggestedTime && !data.time) {
    if ((data as any)._nearestSlot) {
      known.push(`⏰ HORÁRIO PEDIDO: ${(data as any)._suggestedTime} (NÃO disponível). Mais próximo: ${(data as any)._nearestSlot}. Ofereça o mais próximo.`);
    } else {
      known.push(`⏰ HORÁRIO DETECTADO: cliente disse "${(data as any)._suggestedTime}". Use este horário se estiver na lista de disponíveis. NÃO pergunte horário de novo.`);
    }
  }
  if (data.preferredTime && !data.time) known.push(`Preferência de horário: a partir das ${data.preferredTime}`);
  if ((data as any).requestedQuantity && (data as any).requestedQuantity > 1) known.push(`Quantidade: ${(data as any).requestedQuantity} horários/pessoas`);
  if (data.pendingReschedule) {
    if (data.pendingReschedule.isEarlierSlot) {
      known.push(`ADIANTAMENTO EM ANDAMENTO: cliente quer horário mais cedo do que ${data.pendingReschedule.oldTime} hoje com ${data.pendingReschedule.oldProfName}`);
    } else {
      known.push(`REAGENDAMENTO EM ANDAMENTO: cancelar agendamento de ${formatDate(data.pendingReschedule.oldDate)} às ${data.pendingReschedule.oldTime} com ${data.pendingReschedule.oldProfName}`);
      if (!data.date) known.push(`Nova data: ainda não informada -- pergunte`);
    }
  }

  // Operating hours
  const _ohLines = (() => {
    if (!operatingHours || Object.keys(operatingHours).length === 0) return '';
    const DOW_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const lines: string[] = [];
    for (let d = 0; d < 7; d++) {
      const cfg = (operatingHours as any)[d];
      lines.push(cfg?.active ? `- ${DOW_SHORT[d]}: ${cfg.start || '??'}--${cfg.end || '??'}` : `- ${DOW_SHORT[d]}: FECHADO`);
    }
    return lines.join('\n');
  })();

  // Slots
  const _slotsDateLabel = data.date ? ` para ${formatDate(data.date)}` : '';
  const slotsContent = availableSlots?.length
    ? `Horários disponíveis${_slotsDateLabel} (use APENAS estes, NUNCA invente outros):\n${availableSlots.map(s => `- ${s}`).join('\n')}`
    : (data.professionalId && data.date
      ? (data.serviceId
        ? `NENHUM HORÁRIO DISPONÍVEL${_slotsDateLabel} -- a agenda está CHEIA. Diga "agenda cheia" e ofereça outro dia. NUNCA diga "não abre", "fechado", "não atende".`
        : `SERVIÇO NÃO DEFINIDO -- PROIBIDO mencionar horários específicos (ex: 07:00, 15:00, etc). Pergunte: "Qual procedimento você gostaria?"`)
      : `HORÁRIOS NÃO VERIFICADOS -- PROIBIDO mencionar QUALQUER horário específico (ex: 07:00, 09:00, 15:00). Colete serviço, profissional e dia primeiro. Só depois o sistema mostrará os horários reais.`);

  const histStr = history.slice(-10).map((h: any) => `${h.role === 'user' ? 'Cliente' : 'Agente'}: ${h.text}`).join('\n');
  const isFirst = history.filter((h: any) => h.role === 'bot').length === 0;

  // Professional selection (conditional)
  const profSelectionSection = professionals.length > 1 && !data.professionalId
    ? `\n## Seleção de Profissional
Profissional ainda não definido. Disponíveis: ${professionals.map((p: any) => `${p.name} (ID:"${p.id}")`).join(', ')}
- Cliente mencionou um nome nesta mensagem -> extraia o professionalId e confirme.
- Cliente disse "qualquer um", "tanto faz" -> escolha automaticamente ${professionals[0]?.name}. Diga: "Pode ser com ${professionals[0]?.name} então! Tem algum dia de preferência?" e defina o professionalId.
- Não mencionou e não disse "qualquer" -> pergunte: "Com qual profissional prefere? Temos: ${professionals.map((p: any) => p.name).join(', ')}"
- NUNCA repita a pergunta se o cliente já disse um nome.
- Cliente questionou sua escolha -> "Desculpe! Com qual prefere? ${professionals.map((p: any) => p.name).join(' ou ')}?" e retorne professionalId: null.\n`
    : '';

  // Date calculations
  const todayISOClean = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : (() => {
    const m = today.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : today;
  })();
  const [ty, tm, td] = todayISOClean.split('-').map(Number);
  const tomorrowDate = new Date(Date.UTC(ty, tm-1, td+1));
  const tomorrowISO = `${tomorrowDate.getUTCFullYear()}-${pad(tomorrowDate.getUTCMonth()+1)}-${pad(tomorrowDate.getUTCDate())}`;
  const todayFormatted = formatDate(todayISOClean);
  const todayDow = DOW_PT[new Date(todayISOClean+'T12:00:00Z').getUTCDay()];
  const tomorrowDow = DOW_PT[tomorrowDate.getUTCDay()];

  // ── System Prompt (static rules — # markdown headers for GPT-4.1-mini) ──
  const systemPrompt = `# Papel
Você é o atendente de WhatsApp de "${tenantName}". Hoje é ${todayFormatted} (${todayDow}).
Atendente brasileiro -- informal, caloroso, direto. Máximo 2-3 linhas por resposta.
${customSystemPrompt ? `\n## Regras do Estabelecimento\n${customSystemPrompt}\n` : ''}
# Fluxo de Agendamento
Siga nesta ordem, pule etapas já presentes no CONTEXTO ATUAL:
1. SERVIÇO -> 2. PROFISSIONAL -> 3. DIA -> 4. HORÁRIO -> 5. CONFIRMAÇÃO

- Se cliente perguntar sobre horários SEM mencionar dia E NÃO houver Data no CONTEXTO ATUAL -> assuma HOJE e mostre horários.
- Se CONTEXTO ATUAL já contém uma Data -> todos os horários disponíveis são para AQUELE dia, NÃO para hoje. NUNCA diga "hoje não temos" quando a data é outro dia.

## Quando não há horário disponível
1. Mesmo dia: "Esse horário não está disponível, mas ainda tenho [lista]. Algum serve?"
2. Cliente recusou todos (ou não há mais): sugira o horário desejado no próximo dia disponível.
3. Horário desejado não existe no próximo dia: ofereça o mais próximo disponível.
4. Cliente diz que não pode durante a semana (ex: "esses dias estou trabalhando", "só consigo fim de semana"): ofereça SÁBADO como alternativa, pois a maioria das pessoas folga no sábado. Se sábado não tem vaga, tente o próximo sábado.
5. Quando o cliente pede um horário específico que não existe (ex: "20h"), ofereça o PRÓXIMO horário disponível mais PRÓXIMO do pedido. Ex: "Não temos às 20:00, mas o mais próximo é às 19:00. Serve?"
${profSelectionSection}
# Regras de Comportamento

## Data Já Definida
- Se CONTEXTO ATUAL já contém Data (ex: "sábado, 14/03/2026"), os horários disponíveis são daquele dia.
- NUNCA diga "hoje não temos horários" quando a data no contexto é outro dia.
- Data definida + serviço informado -> ofereça os horários daquele dia diretamente.

## Correção de Serviço
- "Só corte", "somente barba", "apenas X" = cliente CORRIGINDO o serviço. Respeite: mude para o serviço correto. NUNCA insista no serviço anterior.
- "Eu falei X", "eu pedi X", "é só X" = mesma coisa, correção.
- Se o CONTEXTO ATUAL mostra um serviço diferente do que o cliente acabou de pedir -> atualize para o que o cliente quer AGORA.

## Quando cliente quer ver horários
- "Quero todos os horários", "me mostra tudo", "quais horários tem?" = LISTE TODOS os horários da seção "Horários disponíveis". Não pergunte período.
- "O que tiver", "qualquer horário", "tanto faz" = liste os horários disponíveis e pergunte qual prefere. NÃO pergunte "manhã ou tarde?", apenas liste.
- "Quero todos" referente a horários = NÃO é "marcar todos", é "ver todos". Liste-os.

## Armadilhas -- NUNCA faça
- "Quero cortar amanhã" -> NÃO agende sem profissional + horário confirmados.
- "Tem horário?" sem dia E sem Data no contexto -> assuma HOJE, mostre horários + "Qual serviço?"
- "De manhã" / "de tarde" / "próxima semana" = tempo vago -> mostre opções, nunca escolha sozinho.
- "Mesmo de sempre" -> sem memória histórica -> "Pode confirmar o serviço e horário preferido?"
- "Pode ser com o [prof]?" com serviço já no contexto -> NÃO pergunte serviço, confirme: "Ótimo, com o [prof]! Qual dia prefere?"
- Profissional já definido no contexto -> NÃO pergunte de novo.
- NUNCA invente horários. Se a seção "Horários" diz "NÃO VERIFICADOS", NÃO sugira nenhum horário (ex: "07:00", "às 9"). Apenas pergunte a preferência e colete as informações que faltam.
- NUNCA diga que um dia "não abre" ou "tá fechado". O sistema cuida disso. Apenas extraia a data.

## Protocolo de Cancelamento
1. Localizar: "Encontrei seu agendamento: [data/hora/serviço]."
2. Confirmar: "Confirmo o cancelamento?"
3. Só então: "cancelled":true
- "Não vou poder ir" / "não consigo ir" / "não vou chegar a tempo" = intenção implícita -> perguntar: "Quer que eu cancele? Se quiser remarcar, posso ajudar!"
- "Não consigo mudar meu horário" = agenda pessoal não permite (NÃO é recusa de reagendamento) -> tratar como cancelamento implícito.
- "Tchau" junto com relato de impossibilidade = despedida + cancelamento.
- Múltiplos agendamentos futuros -> listar todos e perguntar qual cancelar.
- Linguagem informal ("desisti", "tira meu nome") -> identificar agendamento + confirmar antes de cancelar.

## Protocolo de Reagendamento
- "Mais cedo" / "mais tarde" = vago -> clarificar: "Mais cedo no mesmo dia ou em outra data?"
- "Semana que vem mesmo horário" -> VERIFICAR disponibilidade ANTES de confirmar.
- "Atrasou" / "Vou atrasar" / "Estou atrasado" = AVISO DE ATRASO, NÃO reagendamento -> "Entendido! Vou avisar ao [profissional]. Te esperamos!" NÃO altere data/hora/cancelled.
- "Trocar de barbeiro, manter horário" -> verificar disponibilidade do novo prof ANTES de confirmar.
- "Primeiro horário do [prof]" = cancelar atual + agendar novo -> confirmar as duas juntas.

## Profissional de Férias
- SOMENTE diga que um profissional está de férias se ele aparecer na seção "Profissionais de Férias" nos dados abaixo.
- NUNCA invente férias. "Dia fechado" NÃO significa férias -- significa que o estabelecimento não abre.
- Cliente pede profissional de férias -> informe férias + quando retorna. Ofereça alternativa UMA VEZ.
- Cliente insiste -> respeite: "Entendido! O [nome] retorna [data]. Posso te avisar quando ele voltar?"

## Dias Abertos e Fechados — REGRA CRÍTICA
- VOCÊ NÃO INFORMA SOBRE DIAS FECHADOS. O SISTEMA faz isso automaticamente antes de você responder.
- Se o cliente pedir um dia fechado, APENAS extraia a data normalmente. O sistema interceptará e informará sobre o dia fechado.
- Dia ABERTO mas sem vagas -> diga "agenda cheia/lotada".
- PROIBIDO usar estas frases: "não abre", "não atende", "tá fechado", "estamos fechados", "não funciona", "não abrimos", "não trabalha", "a gente não abre". NUNCA, em nenhuma circunstância.
- Se a Data já está no CONTEXTO ATUAL, o sistema já validou que é um dia aberto. Confie nisso.
- O "Horário de Funcionamento" abaixo serve APENAS para você saber os horários de abertura/fechamento, NÃO para você informar quais dias são fechados.

## Consultas Informativas
- "Vocês trabalham domingo?" / "qual o horário?" -> consulte Horário de Funcionamento, informe; depois ofereça agendar.
- "Quanto tempo demora?" -> informe duração; depois ofereça agendar.
- "O [prof] tá disponível?" -> informe disponibilidade; depois ofereça agendar.
- "Tem vaga?" sem dia -> mostre horários de HOJE + "Qual serviço?" NÃO crie agendamento ainda.

## Linguagem Coloquial de Serviços
Quando o cliente usa termo informal que mapeia para um serviço, preencha extracted.serviceId automaticamente:
- CORTE: "corte", "corta", "cabelo", "cabeça", "cortar", "aparar", "zerar", "na máquina", "cabecinha", "franja", "degradê", "degrade", "social", "navalhado"
- BARBA: "barba", "fazer a barba", "modelar a barba", "barba e bigode", "barbinha"
- BIGODE: "bigode", "aparar o bigode"
- SOBRANCELHA: "sobrancelha", "design de sobrancelha"
- COLORAÇÃO: "pintar o cabelo", "colorir", "mechas", "reflexo", "tingir"
- ALISAMENTO: "progressiva", "alisar", "botox capilar"
- ESCOVA: "escova", "modelar o cabelo"
Regra: se identifica claramente UM serviço, assuma-o. NÃO peça confirmação, prossiga para data/horário.
MULTI-SERVIÇO: O sistema AUTOMATICAMENTE detecta TODOS os serviços mencionados pelo cliente (ex: "barba, cortar o cabelo, produtinho, sobrancelha" = 4 serviços). O CONTEXTO ATUAL já terá o combo calculado com duração e preço totais. Apenas CONFIRME todos os serviços listados — NUNCA ignore nenhum serviço que o cliente pediu. Se o CONTEXTO diz "Serviço: X + Y + Z", use EXATAMENTE isso.

## Horários Coloquiais
O sistema detecta automaticamente horários informais: "5 e meia"=17:30, "as 3"=15:00, "meio dia"=12:00.
Se o CONTEXTO ATUAL tiver "HORÁRIO DETECTADO" ou "HORÁRIO PEDIDO", use esse horário — NÃO pergunte de novo. NÃO reinicie o fluxo.

## Mensagens Sem Relação com Agendamento
Nem toda mensagem é sobre agendar. Se o cliente enviar algo fora do contexto de agendamento, responda naturalmente SEM forçar o fluxo de agendamento:
- Elogio ("ficou top!", "amei o corte") -> agradeça com carinho: "Que bom que curtiu! Ficamos felizes 😊"
- Reclamação ("não gostei", "ficou ruim") -> peça desculpas com empatia e ofereça resolver: "Poxa, sinto muito! Quer passar aqui pra gente ajustar?"
- Pergunta geral ("vocês vendem produtos?", "aceita pix?", "tem estacionamento?") -> responda se souber (baseado nas Regras do Estabelecimento), senão diga que vai verificar.
- Conversa casual ("tudo bem?", "como tá aí?", "bom dia") -> responda de forma calorosa e breve, depois pergunte se pode ajudar.
- Feedback ("o atendimento foi ótimo", "o [prof] é muito bom") -> agradeça genuinamente.
- Fotos/mídias sem contexto -> "Que legal! Posso te ajudar com alguma coisa?"
- Assunto completamente fora ("meu time ganhou", "tá chovendo aí?") -> responda brevemente de forma simpática e pergunte se precisa de algo.
REGRA: NÃO force agendamento quando o cliente claramente NÃO está pedindo um. Responda o que ele perguntou/disse primeiro. Só ofereça agendar se fizer sentido no contexto.

## Mensagens Ambíguas
- Saudação simples ("oi", "tudo bem?") -> cumprimentar + "Como posso te ajudar?"
- "Acabei de sair do trabalho" -> "Que horas você chega? Nosso último horário hoje é às [hora]."
- Dois pedidos numa mensagem -> atender ambos na mesma resposta.

# Formato de Resposta

## Estilo
- Máximo 2-3 linhas.
- Tom informal brasileiro.
- Emojis: use APENAS na saudação inicial ou ao confirmar agendamento. Demais mensagens sem emoji.
- Sempre termine com pergunta.

## Ao Oferecer Horário (profissional já definido)
- ERRADO: "Temos disponível às 15:00"
- CERTO: "Com o [profissional] às 15:00 pode ser?"

## Horário Indisponível
Explique + ofereça alternativa + pergunte "Serve?"

## Confirmação
"confirmed":true -> responda apenas "Agendado! Te esperamos"

## Desistência
Aceite naturalmente, sem drama.

## Casos Especiais
- Múltiplos serviços ("barba, cabelo, sobrancelha, produtinho") -> O sistema já detectou e somou tudo no CONTEXTO ATUAL. Confirme TODOS os serviços listados. NUNCA ignore nenhum. Use o nome combinado do CONTEXTO.
- 2 pessoas -> descubra o serviço do cliente primeiro, depois pergunte sobre o acompanhante.
- Preço -> informe direto: "Corte está R$40,00"
- Agenda cheia -> sugira outra semana.
- Lista de espera: cliente pediu "se alguém cancelar me avisa" -> responda que anotou; defina waitlist:true.
- Reagendamento em andamento:
  - Nova data no contexto -> mostre resumo, aguarde confirmação.
  - Nova data ausente -> pergunte "Para qual data quer remarcar?"
  - Após confirmação -> defina confirmed:true.
  - Cliente confuso -> pare: "Desculpe a confusão! O que posso fazer por você?"
- Adiantamento em andamento:
  - Ofereça horários mais cedo.
  - Cliente escolheu -> extraia time, confirmed:true.
  - Cliente prefere manter -> "Mantenho o das [hora_original] então!", confirmed:false.

# Regras de Extração
- Horários: "nove horas"->"09:00", "três da tarde"->"15:00", "meio dia"->"12:00", "5 e meia"->"17:30", "as 4"->"16:00"
- O sistema já detecta horários coloquiais automaticamente. Se CONTEXTO ATUAL tem "HORÁRIO DETECTADO", extraia esse time.
- NUNCA repita perguntas sobre info já no CONTEXTO ATUAL.
- Use horários SOMENTE da lista disponível.
- waitlist: true se cliente pediu lista de espera.
- reschedule: true se cliente quer reagendar horário existente.

## Extração de Datas (sempre YYYY-MM-DD)
- "hoje" -> ${todayISOClean} (${todayDow})
- "amanhã" -> ${tomorrowISO} (${tomorrowDow})
- Dia da semana (ex: "sábado") -> calcule o PRÓXIMO a partir de hoje (${todayISOClean}, ${todayDow}).
- Nunca extraia datas no passado; se o dia já passou esta semana, use a próxima.

# Schema JSON de Saída
Responda APENAS com JSON válido (sem markdown, sem backticks):
{"reply":"...","extracted":{"clientName":null,"serviceId":null,"professionalId":null,"date":null,"time":null,"confirmed":null,"cancelled":null,"waitlist":null,"reschedule":null}}

# Lembretes Críticos
1. PERSISTÊNCIA: Continue o fluxo até resolver o pedido do cliente. Sempre termine com pergunta de acompanhamento.
2. PRECISÃO: Use APENAS horários da lista "Horários disponíveis". NUNCA invente horários. Se não há lista, NÃO mencione horários específicos.
3. CONTEXTO: Quando CONTEXTO ATUAL já contém Data, os horários são daquele dia. Quando contém "RESUMO JÁ MOSTRADO" e cliente afirma ("sim","ok","beleza","pode","bora","fechou","isso"), defina "confirmed":true OBRIGATORIAMENTE.
4. PROIBIDO: NUNCA diga "não abre", "não atende", "estamos fechados", "não funciona". Se sem vagas, diga "agenda cheia". Se Data no contexto, o dia já foi validado pelo sistema.
5. RECONHECIMENTO: Se o cliente já informou serviço, data ou horário na mesma mensagem, NÃO pergunte de novo. Extraia tudo de uma vez.
6. FLUXO: NUNCA reinicie o fluxo quando CONTEXTO ATUAL já tem dados coletados. Se Serviço, Profissional, Data já estão no contexto, NÃO pergunte "Qual procedimento?" de novo. Continue de onde parou.
7. MULTI-SERVIÇO: Quando o CONTEXTO diz "MULTI-SERVIÇO", confirme TODOS os serviços listados. Nunca mencione apenas um.`;

  // ── User Prompt (dynamic per-turn data) ──────────────────────────
  const userPrompt = `## Serviços
${svcList}

## Profissionais
${profList}
${vacationCtx ? `\n## Profissionais de Férias\n${vacationCtx}\n` : ''}${_ohLines ? `\n## Horário de Funcionamento\n${_ohLines}\n` : ''}
## Horários
${slotsContent}

## Contexto Atual
${known.length > 0 ? known.join('\n') : 'Nenhuma informação coletada ainda.'}
${data.pendingConfirm ? '\nRESUMO JÁ MOSTRADO -- se cliente afirmar ("sim","ok","pode","beleza","bora","fechou","isso","confirma") -> "confirmed":true OBRIGATÓRIO.' : ''}
${shouldGreet ? `\n## Primeira Saudação do Dia\nCumprimente com "${brasiliaGreeting}!" de forma calorosa e apresente o estabelecimento: "${tenantName}".\nPergunte apenas "Como posso te ajudar?" -- nada mais.\nNÃO liste serviços, profissionais, preços nem horários na saudação.\nExemplo: "${brasiliaGreeting}! Seja bem-vindo ao ${tenantName} Como posso te ajudar?"\n` : ''}${isFirst && !shouldGreet ? `\n## Primeira Mensagem\nO cliente já enviou uma solicitação com contexto. NÃO cumprimente ("Boa noite! Seja bem-vindo..."), vá direto ao ponto. Processe tudo que o cliente informou sem perguntar de novo. Se já houver Data e Preferência de horário no CONTEXTO ATUAL, confirme-os.\n` : ''}
## Histórico (mais recente no final)
${histStr}`;

  // ── API calls ─────────────────────────────────────────────────────
  try {
    if (apiKey.startsWith('sk-')) {
      // OpenAI path: system + user messages (optimized for GPT-4.1-mini)
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
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
          input_tokens: d.usage?.prompt_tokens ?? estimateTokens(systemPrompt + userPrompt),
          output_tokens: d.usage?.completion_tokens ?? estimateTokens(result?.reply ?? ''),
          model: 'gpt-4.1-mini', success: !!result,
        }).catch(() => {});
      }
      return result;
    } else {
      // Gemini path: single user message (no system prompt support)
      const geminiPrompt = systemPrompt + '\n\n---\n\n' + userPrompt;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: geminiPrompt }] }], generationConfig: { responseMimeType: 'application/json' } })
      });
      if (!res.ok) { console.error('[Brain] Gemini', res.status, await res.text().catch(() => '')); return null; }
      const gd = await res.json();
      if (!gd.candidates?.[0]?.content?.parts?.[0]?.text) {
        console.error('[Brain] Gemini empty response:', JSON.stringify({ blockReason: gd.promptFeedback?.blockReason, finishReason: gd.candidates?.[0]?.finishReason }));
        return null;
      }
      const gResult = JSON.parse(gd.candidates[0].content.parts[0].text);
      if (tenantId) {
        const usage = gd.usageMetadata;
        logAIUsage({
          tenant_id: tenantId, phone_number: phone,
          input_tokens: usage?.promptTokenCount ?? estimateTokens(geminiPrompt),
          output_tokens: usage?.candidatesTokenCount ?? estimateTokens(gResult?.reply ?? ''),
          model: 'gemini-2.5-flash', success: !!gResult,
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

// ── Send "typing..." presence indicator ──────────────────────────────
async function sendTyping(instanceName: string, phone: string, delayMs = 3000) {
  try {
    await fetch(`${EVO_URL}/chat/sendPresence/${instanceName}`, {
      method: 'POST', headers: EVO_HEADERS,
      body: JSON.stringify({ number: phone, options: { delay: delayMs, presence: 'composing' } }),
    });
  } catch { /* non-fatal */ }
}

// ── Send WhatsApp message ─────────────────────────────────────────────
async function sendMsg(instanceName: string, phone: string, text: string, tenantId?: string) {
  if (_isWDuplicate(phone, text)) {
    console.log(`[sendMsg] Dedup: blocked duplicate → ${phone.slice(0, 2)}***${phone.slice(-4)}`);
    return;
  }
  // Send with composing presence (simulates typing before message)
  await fetch(`${EVO_URL}/message/sendText/${instanceName}`, {
    method: 'POST', headers: EVO_HEADERS,
    body: JSON.stringify({ number: phone, text: text, options: { delay: 1200, presence: 'composing', linkPreview: false } }),
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

// ── Send WhatsApp interactive buttons (max 3) ────────────────────────
async function sendButtons(instanceName: string, phone: string, title: string, description: string, buttons: Array<{id: string; text: string}>, tenantId?: string) {
  try {
    await fetch(`${EVO_URL}/message/sendButtons/${instanceName}`, {
      method: 'POST', headers: EVO_HEADERS,
      body: JSON.stringify({
        number: phone, title, description, footerText: 'AgendeZap',
        buttons: buttons.slice(0, 3).map(b => ({ buttonId: b.id, buttonText: { displayText: b.text } })),
      }),
    });
    if (tenantId) {
      saveWaMsg(tenantId, `out_btn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        phone, `[Botões: ${buttons.map(b => b.text).join(' | ')}]`, Math.floor(Date.now() / 1000), 'Bot', 'buttons', true
      ).catch(() => {});
    }
  } catch (e) { console.error('[sendButtons] error:', e); }
}

// ── Send WhatsApp list message (many options) ─────────────────────────
async function sendListMessage(instanceName: string, phone: string, title: string, description: string, buttonText: string, sections: Array<{title: string; rows: Array<{id: string; title: string; description?: string}>}>, tenantId?: string) {
  try {
    await fetch(`${EVO_URL}/message/sendList/${instanceName}`, {
      method: 'POST', headers: EVO_HEADERS,
      body: JSON.stringify({
        number: phone, title, description, buttonText, footerText: 'AgendeZap',
        sections: sections.map(sec => ({
          title: sec.title,
          rows: sec.rows.slice(0, 10).map(r => ({ rowId: r.id, title: (r.title || '').slice(0, 24), description: (r.description || '').slice(0, 72) })),
        })).slice(0, 10),
      }),
    });
    if (tenantId) {
      const rowCount = sections.reduce((s, sec) => s + sec.rows.length, 0);
      saveWaMsg(tenantId, `out_list_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        phone, `[Lista: ${rowCount} opções]`, Math.floor(Date.now() / 1000), 'Bot', 'list', true
      ).catch(() => {});
    }
  } catch (e) { console.error('[sendListMessage] error:', e); }
}

// ── Decide and send interactive buttons based on session state ────────
type PendingButtons = { type: 'service' | 'professional' | 'time' | 'confirmation'; options: Array<{id: string; label: string}>; sentAt: number };

async function maybeSendInteractiveButtons(
  instanceName: string, phone: string, sessionData: any,
  services: Array<{id: string; name: string; durationMinutes: number; price: number}>,
  professionals: Array<{id: string; name: string}>,
  availableSlots: string[] | undefined, tenantId: string
): Promise<PendingButtons | null> {
  try {
    // POINT 1: Service Selection
    if (!sessionData.serviceId && services.length >= 2) {
      const rows = services.map(s => ({ id: `svc_${s.id}`, title: (s.name || 'Serviço').slice(0, 24), description: `${s.durationMinutes || 30}min — R$${(Number(s.price) || 0).toFixed(2)}` }));
      if (services.length <= 3) {
        await sendButtons(instanceName, phone, 'Serviços', 'Qual serviço deseja?', rows.map(r => ({ id: r.id, text: r.title })), tenantId);
      } else {
        await sendListMessage(instanceName, phone, 'Serviços', 'Escolha o serviço desejado:', 'Ver serviços', [{ title: 'Serviços disponíveis', rows }], tenantId);
      }
      return { type: 'service', options: rows.map(r => ({ id: r.id, label: r.title })), sentAt: Date.now() };
    }

    // POINT 2: Professional Selection
    if (sessionData.serviceId && !sessionData.professionalId && professionals.length >= 2) {
      if (professionals.length <= 3) {
        const btns = professionals.map(p => ({ id: `prof_${p.id}`, text: (p.name || 'Profissional').slice(0, 20) }));
        await sendButtons(instanceName, phone, 'Profissional', 'Com qual profissional?', btns, tenantId);
      } else {
        const rows = professionals.map(p => ({ id: `prof_${p.id}`, title: (p.name || 'Profissional').slice(0, 24) }));
        await sendListMessage(instanceName, phone, 'Profissionais', 'Com qual profissional?', 'Ver profissionais', [{ title: 'Profissionais disponíveis', rows }], tenantId);
      }
      return { type: 'professional', options: professionals.map(p => ({ id: `prof_${p.id}`, label: p.name || 'Profissional' })), sentAt: Date.now() };
    }

    // POINT 3: Time Slot Selection
    if (sessionData.serviceId && sessionData.professionalId && sessionData.date && !sessionData.time && availableSlots && availableSlots.length > 0) {
      const slotsToShow = availableSlots.slice(0, 10);
      const rows = slotsToShow.map(s => ({ id: `slot_${s.replace(':', '')}`, title: s }));
      await sendListMessage(instanceName, phone, 'Horários', 'Escolha um horário:', 'Ver horários', [{ title: `Horários disponíveis`, rows }], tenantId);
      return { type: 'time', options: rows.map(r => ({ id: r.id, label: r.title })), sentAt: Date.now() };
    }

    // POINT 4: Confirmation
    if (sessionData.pendingConfirm && sessionData.serviceId && sessionData.professionalId && sessionData.date && sessionData.time) {
      await sendButtons(instanceName, phone, 'Confirmar Agendamento',
        `${sessionData.serviceName || 'Serviço'} — ${sessionData.date} às ${sessionData.time} com ${sessionData.professionalName || 'Profissional'}`,
        [{ id: 'confirm_yes', text: 'Confirmar ✅' }, { id: 'confirm_change', text: 'Alterar horário' }, { id: 'confirm_cancel', text: 'Cancelar' }],
        tenantId
      );
      return { type: 'confirmation', options: [{ id: 'confirm_yes', label: 'Confirmar' }, { id: 'confirm_change', label: 'Alterar' }, { id: 'confirm_cancel', label: 'Cancelar' }], sentAt: Date.now() };
    }
  } catch (e) { console.error('[maybeSendInteractiveButtons] error:', e); }
  return null;
}

// ── Notify waitlist leads when a slot opens (appointment cancelled) ────
async function notifyWaitlistLeadsInline(tenantId: string, date?: string) {
  try {
    const { data: tenantRow } = await supabase.from('tenants').select('evolution_instance, nome').eq('id', tenantId).maybeSingle();
    const inst: string = tenantRow?.evolution_instance || '';
    if (!inst) return;
    const tenantName: string = tenantRow?.nome || 'Nosso estabelecimento';

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

// ── Service synonym map (shared) ──────────────────────────────────────
const SVC_SYNONYMS: Record<string, string[]> = {
  'corte': ['corte', 'corta', 'cabelo', 'cabeca', 'cabecinha', 'cortar', 'aparar', 'zerar', 'degrade', 'social', 'navalhado', 'franja', 'maquina'],
  'barba': ['barba', 'barbinha', 'bigode'],
  'sobrancelha': ['sobrancelha', 'design'],
  'coloracao': ['pintar', 'colorir', 'mechas', 'reflexo', 'tingir', 'coloracao'],
  'progressiva': ['progressiva', 'alisar', 'alisamento', 'botox', 'produtinho', 'produto'],
  'escova': ['escova', 'modelar'],
  'relaxamento': ['relaxamento', 'relaxar'],
};
const SVC_STOP = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'com', 'no', 'na', 'em', 'o', 'a', 'os', 'as', 'um', 'uma', 'pra', 'para', 'por', 'que', 'nao', 'sim', 'hoje', 'amanha', 'horas', 'hora', 'marca', 'marcar', 'agendar', 'reservar', 'quero', 'preciso', 'gostaria', 'favor', 'pode', 'vou', 'vai', 'ter', 'tem', 'boa', 'bom', 'tarde', 'noite', 'dia', 'manha', 'voce', 'viu', 'deixa', 'agendado', 'tambem', 'aquele', 'fazer', 'querer']);
const svcNorm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim();

// ── Detect ALL service categories mentioned in text ──────────────────
function detectServiceCategories(text: string): Set<string> {
  const normText = svcNorm(text);
  const msgWords = normText.split(/\s+/).filter(w => w.length >= 3 && !SVC_STOP.has(w));
  const mentions = new Set<string>();
  for (const mw of msgWords) {
    for (const [canon, syns] of Object.entries(SVC_SYNONYMS)) {
      if (syns.some(s => s.includes(mw) || mw.includes(s))) {
        mentions.add(canon);
      }
    }
  }
  return mentions;
}

// ── Match ALL services from text (multi-service aware) ────────────────
// Returns array of matched services + detected categories.
// "barba, cortar cabelo, produtinho, sobrancelha" → 4 services matched.
function matchAllServices(
  text: string,
  services: Array<{ id: string; name: string; durationMinutes: number; price: number }>
): { matched: Array<{ id: string; name: string; durationMinutes: number; price: number }>; categories: string[] } {
  const normText = svcNorm(text);
  const categories = detectServiceCategories(text);
  const cats = [...categories];
  if (cats.length === 0) return { matched: [], categories: [] };

  // For each category, find the best matching service
  const usedIds = new Set<string>();
  const matched: Array<{ id: string; name: string; durationMinutes: number; price: number }> = [];

  // First: try to find combo services that cover 2+ categories at once
  for (const svc of services) {
    const sn = svcNorm(svc.name);
    let covers = 0;
    const coveredCats: string[] = [];
    for (const cat of cats) {
      const syns = SVC_SYNONYMS[cat] || [cat];
      if (syns.some(s => sn.includes(s))) { covers++; coveredCats.push(cat); }
    }
    if (covers >= 2 && !usedIds.has(svc.id)) {
      matched.push(svc);
      usedIds.add(svc.id);
      coveredCats.forEach(c => categories.delete(c));
    }
  }

  // Second: for remaining uncovered categories, find individual services
  for (const cat of [...categories]) {
    const syns = SVC_SYNONYMS[cat] || [cat];
    const candidateSvcs = services.filter(s => !usedIds.has(s.id) && syns.some(syn => svcNorm(s.name).includes(syn)));
    // Prefer most specific service: fewest extra category matches, then shortest name
    const best = candidateSvcs.sort((a, b) => {
      const snA = svcNorm(a.name), snB = svcNorm(b.name);
      // Count how many OTHER categories each service name matches (besides target)
      const extraA = Object.entries(SVC_SYNONYMS).filter(([c, ss]) => c !== cat && ss.some(s => snA.includes(s))).length;
      const extraB = Object.entries(SVC_SYNONYMS).filter(([c, ss]) => c !== cat && ss.some(s => snB.includes(s))).length;
      if (extraA !== extraB) return extraA - extraB; // fewer extra = more specific
      return snA.length - snB.length; // shorter name = more specific
    })[0];
    if (best) {
      matched.push(best);
      usedIds.add(best.id);
      categories.delete(cat);
    }
  }

  console.log(`[matchAllSvcs] Detected categories: ${cats.join(', ')} → Matched: ${matched.map(s => s.name).join(', ')}`);
  return { matched, categories: cats };
}

// ── Single service matcher (backwards-compatible) ─────────────────────
function matchServiceByKeywords(
  text: string,
  services: Array<{ id: string; name: string; durationMinutes: number; price: number }>
): { id: string; name: string; durationMinutes: number; price: number; _comboCategories?: string[]; _allMatched?: Array<{ id: string; name: string; durationMinutes: number; price: number }> } | null {
  const { matched, categories } = matchAllServices(text, services);
  if (matched.length === 0) return null;

  if (matched.length === 1) return matched[0];

  // Multiple services: sum durations and prices, build combined name
  const totalDuration = matched.reduce((sum, s) => sum + s.durationMinutes, 0);
  const totalPrice = matched.reduce((sum, s) => sum + s.price, 0);
  // Use the longest service as the "primary" for ID (booking uses this)
  const primary = matched.sort((a, b) => b.durationMinutes - a.durationMinutes)[0];
  const combinedName = matched.map(s => s.name).join(' + ');

  return {
    ...primary,
    name: combinedName,
    durationMinutes: totalDuration,
    price: totalPrice,
    _comboCategories: categories,
    _allMatched: matched,
  };
}

// ── Colloquial time parser (TypeScript layer) ─────────────────────────
// Parses informal Brazilian time expressions into HH:MM format.
// "5 e meia" → "17:30", "as 3" → "15:00", "meio dia" → "12:00"
function parseColloquialTime(text: string): string | null {
  const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, ' ').trim();

  // Word-to-number map
  const NUM: Record<string, number> = {
    'uma': 1, 'duas': 2, 'tres': 3, 'quatro': 4, 'cinco': 5, 'seis': 6,
    'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10, 'onze': 11, 'doze': 12,
    'meia': -1, // special marker
  };

  // "agora" / "agora mesmo" → current Brasília time rounded up to next 15min
  if (/\bagora\b/.test(t)) {
    const _bra = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const _h = _bra.getUTCHours();
    const _m = Math.ceil(_bra.getUTCMinutes() / 15) * 15;
    const h = _m >= 60 ? _h + 1 : _h;
    const m = _m >= 60 ? 0 : _m;
    const r = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    console.log(`[parseTime] "agora" → ${r} (Brasília)`);
    return r;
  }

  // "meio dia" / "meio-dia"
  if (/\bmeio[\s-]?dia\b/.test(t)) return '12:00';
  // "meia noite" / "meia-noite"
  if (/\bmeia[\s-]?noite\b/.test(t)) return '00:00';

  // Pattern: [as/às] <number> [e meia / e <minutes>]
  // Examples: "as 5 e meia", "5 e meia", "às 3", "as cinco e meia", "17:30", "17h30", "5h"
  const patterns = [
    // "5 e meia", "as 5 e meia", "cinco e meia"
    /(?:as?\s+)?(\d{1,2}|uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s+e\s+meia\b/,
    // "5 e 15", "as 3 e 45"
    /(?:as?\s+)?(\d{1,2}|uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s+e\s+(\d{1,2})\b/,
    // "as 5", "às 17", "la pelas 3"
    /(?:as?\s+|la\s+pelas?\s+)(\d{1,2}|uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s*(?:hora|horas|h)?\b/,
    // "17h30", "17:30", "5h"
    /\b(\d{1,2})\s*[h:]\s*(\d{2})?\b/,
    // Standalone "cedo" — context-dependent, skip
  ];

  for (let i = 0; i < patterns.length; i++) {
    const m = t.match(patterns[i]);
    if (!m) continue;

    let hour: number;
    const rawH = m[1];
    hour = NUM[rawH] !== undefined ? NUM[rawH] : parseInt(rawH, 10);
    if (isNaN(hour) || hour < 0) continue;

    let min = 0;
    if (i === 0) {
      // "e meia" = :30
      min = 30;
    } else if (i === 1 && m[2]) {
      min = parseInt(m[2], 10);
    } else if (i === 3 && m[2]) {
      min = parseInt(m[2], 10);
    }

    // Smart AM/PM: hours 1-11 likely mean PM for a barbershop (operating hours ~8-20)
    if (hour >= 1 && hour <= 6) hour += 12; // 1→13, 5→17, 6→18
    // 7-11 could be AM or PM — check context
    if (hour >= 7 && hour <= 11) {
      // If "da tarde" or "da noite" → PM
      if (/da\s+tarde|da\s+noite/.test(t)) hour += 12;
      // Otherwise keep as AM (morning appointments)
    }

    if (hour >= 0 && hour <= 23 && min >= 0 && min <= 59) {
      const result = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      console.log(`[parseTime] "${text}" → ${result}`);
      return result;
    }
  }

  return null;
}

// ── Brasília greeting ─────────────────────────────────────────────────
function getBrasiliaGreeting(): { greeting: string; dateStr: string } {
  const b = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const h = b.getUTCHours();
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    greeting: h < 12 ? 'bom dia' : h < 19 ? 'boa tarde' : 'boa noite',
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

  // ── Re-check aiActive + aiPaused after debounce (settings may have changed) ──
  const { data: _freshSettings } = await supabase.from('tenant_settings')
    .select('ai_active, follow_up').eq('tenant_id', tenantId).maybeSingle();
  if (!_freshSettings?.ai_active) {
    console.log(`[debouncedRun] AI desativada durante debounce para ${phone.slice(0,2)}***`);
    return;
  }
  const _freshCd = (_freshSettings.follow_up?._customerData || {}) as Record<string, { aiPaused?: boolean }>;
  if (_freshCd[`phone:${phone}`]?.aiPaused) {
    console.log(`[debouncedRun] IA pausada (phone key) durante debounce para ${phone.slice(0,2)}***`);
    return;
  }
  const _phoneSuffix = phone.replace(/\D/g, '').slice(-10);
  const { data: _custCheck } = await supabase.from('customers')
    .select('id').eq('tenant_id', tenantId).like('telefone', `%${_phoneSuffix}`).limit(1);
  if (_custCheck?.[0] && _freshCd[_custCheck[0].id]?.aiPaused) {
    console.log(`[debouncedRun] IA pausada (customer) durante debounce para ${phone.slice(0,2)}***`);
    return;
  }

  // Show "typing..." indicator while AI processes the message
  const instanceName = tenant.evolution_instance || `agz_${(tenant.slug || '').replace(/[^a-z0-9]/g, '')}`;
  await sendTyping(instanceName, phone, 15000);

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

  // ── Agent pause check: if loop was detected, reset on next real message ──
  const _pauseCheck = await getSession(tenantId, phone);
  if (_pauseCheck?.data?._agentPaused) {
    console.log(`[Agent] Agent was paused for ${phone}, resetting on new message`);
    _pauseCheck.data._agentPaused = undefined;
    _pauseCheck.data._botSendTs = undefined;
    // Clear stale booking data that was causing the loop
    _pauseCheck.data._suggestedTime = undefined;
    _pauseCheck.data.availableSlots = undefined;
    await saveSession(tenantId, phone, _pauseCheck.data, _pauseCheck.history);
  }

  let lowerText = text.toLowerCase();
  let isCancellation = ['cancelar', 'cancela', 'cancele', 'cancelamento'].some(k => lowerText.includes(k));
  // isReset: only trigger on very short messages (≤40 chars) to prevent false positives.
  // e.g. "vou sair cedinho" is NOT a reset command — the lead is just saying they're leaving.
  let isReset = lowerText.trim().length <= 40 &&
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

  // Pre-check: pending audio transcription confirmation
  if (preSession?.data?._pendingAudioText) {
    const pendingAudioText = preSession.data._pendingAudioText as string;
    const normAC = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const AFFIRM_AC = ['sim', 'ok', 'pode', 'certo', 'isso', 'correto', 'exato', 'bora', 'claro', 'ta certo', 'esta certo'];
    const DENY_AC = ['nao', 'errado', 'errei', 'incorreto', 'nope', 'negativo'];
    const AFFIRM_EMOJI_AC = /[\u{1F44D}\u{2705}\u{1F44A}\u{1F919}]/u;
    const isAffirmAC = AFFIRM_AC.some(a => normAC === a || normAC.includes(a)) || AFFIRM_EMOJI_AC.test(text);
    const isDenyAC = normAC.split(/\s+/).length <= 5 && DENY_AC.some(d => normAC === d || normAC.includes(d)) && !isAffirmAC;

    if (isAffirmAC) {
      // User confirmed → use cleaned audio text
      text = pendingAudioText;
      lowerText = text.toLowerCase();
      isCancellation = ['cancelar', 'cancela', 'cancele', 'cancelamento'].some(k => lowerText.includes(k));
      isReset = lowerText.trim().length <= 40 &&
        ['sair', 'reiniciar', 'recomeçar', 'recomecar', 'esquece', 'esquecer'].some(k => lowerText.includes(k));
      preSession.data._pendingAudioText = undefined;
      preSession.data._pendingAudioRaw = undefined;
      await saveSession(tenantId, phone, preSession.data, preSession.history);
      console.log(`[Agent] Audio confirmed, processing: "${text}"`);
      // Fall through to normal processing with the cleaned audio text
    } else if (isDenyAC) {
      // User denied → ask to type
      preSession.data._pendingAudioText = undefined;
      preSession.data._pendingAudioRaw = undefined;
      preSession.history.push({ role: 'user', text }, { role: 'bot', text: 'Ok! Pode digitar o que precisa que eu te ajudo 😊' });
      await saveSession(tenantId, phone, preSession.data, preSession.history);
      await sendMsg(instanceName, phone, 'Ok! Pode digitar o que precisa que eu te ajudo 😊', tenantId);
      return;
    } else {
      // User typed something else → treat as the corrected text
      preSession.data._pendingAudioText = undefined;
      preSession.data._pendingAudioRaw = undefined;
      await saveSession(tenantId, phone, preSession.data, preSession.history);
      console.log(`[Agent] Audio correction, using typed text: "${text}"`);
      // Fall through to normal processing with the user's typed text
    }
  }

  if (isReset) {
    await clearSession(tenantId, phone);
    await sendMsg(instanceName, phone, `Tudo bem! Quando quiser agendar, é só me chamar. 😊`, tenantId);
    return;
  }

  if (isCancellation) {
    const sess = preSession || { data: {}, history: [] };
    sess.data.pendingCancelReason = true;
    sess.data.greetedAt = getBrasiliaGreeting().dateStr;
    sess.history.push({ role: 'user', text }, { role: 'bot', text: 'Que pena que precisou cancelar! 😕' });
    await saveSession(tenantId, phone, sess.data, sess.history);
    await sendMsg(instanceName, phone, `Que pena que precisou cancelar! 😕\n\nPode nos contar o motivo? Isso nos ajuda a melhorar o atendimento. 🙏`, tenantId);
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
    id: s.id, name: (s.nome || 'Serviço').trim(), durationMinutes: s.duracao_minutos || 30, price: Number(s.preco || 0)
  }));

  // Build custom system prompt with variable substitution
  let customPrompt = (settings.systemPrompt || '').trim();
  if (customPrompt) {
    const hoje = nowBrasilia.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    customPrompt = customPrompt
      .replace(/\$\{tenant\.nome\}/g, tenantName)
      .replace(/\$\{hoje\}/g, hoje)
      .replace(/\$\{tenant\.nicho\}/g, tenant.nicho || 'estabelecimento')
      .replace(/\$\{profStr\}/g, professionals.map(p => p.name || 'Profissional').join(', '))
      .replace(/\$\{svcStr\}/g, services.map(s => `${s.name || 'Serviço'} (R$${(Number(s.price) || 0).toFixed(2)})`).join(', '));
  }

  // Get/create session
  let session = await getSession(tenantId, phone);
  if (!session) {
    const { data: existing } = await supabase.from('customers').select('nome')
      .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
    const knownName = existing?.nome || (pushName && pushName !== 'Cliente' ? pushName : null);
    session = { data: knownName ? { clientName: knownName } : {}, history: [] };

    // ── Welcome message ──────────────────────────────────────────────────
    if (!existing) {
      // Brand-new lead
      const _welcomeMsg = `Olá! 👋 Bem-vindo(a) a *${tenantName}*!\n\nNosso atendimento é automatizado e funciona 24/7 🕐\n\nComo posso te ajudar? 😊`;
      await sendMsg(instanceName, phone, _welcomeMsg, tenantId);
      console.log(`[welcome] First-contact welcome sent → ${phone.slice(-4)}`);
      session.data.greetedAt = getBrasiliaGreeting().dateStr;
    } else {
      // Returning lead — new session
      const _welcomeBack = `Olá! 👋 Bem-vindo(a) novamente a *${tenantName}*!\n\nNosso atendimento é automatizado e funciona 24/7 🕐\n\nComo posso te ajudar? 😊`;
      await sendMsg(instanceName, phone, _welcomeBack, tenantId);
      console.log(`[welcome] Returning-lead welcome sent → ${phone.slice(-4)}`);
      session.data.greetedAt = getBrasiliaGreeting().dateStr;
    }
  }

  // ── Button response resolution ─────────────────────────────────────
  // If incoming message matches a pending button ID, resolve to session data + natural text
  const _pb = session.data._pendingButtons as PendingButtons | undefined;
  if (_pb && _pb.sentAt > Date.now() - 30 * 60 * 1000) {
    const _normText = text.trim().toLowerCase();
    const _matched = _pb.options.find(o =>
      _normText === o.id.toLowerCase() || _normText === o.label.toLowerCase() ||
      text.includes(o.id) || text.includes(o.label)
    );
    if (_matched) {
      const _id = _matched.id;
      if (_pb.type === 'service' && _id.startsWith('svc_')) {
        const _svcId = _id.replace('svc_', '');
        const _svc = services.find(s => s.id === _svcId);
        if (_svc) {
          session.data.serviceId = _svc.id;
          session.data.serviceName = _svc.name;
          session.data.serviceDuration = _svc.durationMinutes;
          session.data.servicePrice = _svc.price;
          text = _svc.name;
          console.log(`[Buttons] Service selected: ${_svc.name}`);
        }
      } else if (_pb.type === 'professional' && _id.startsWith('prof_')) {
        const _profId = _id.replace('prof_', '');
        const _prof = professionals.find(p => p.id === _profId);
        if (_prof) {
          session.data.professionalId = _prof.id;
          session.data.professionalName = _prof.name;
          text = _prof.name;
          console.log(`[Buttons] Professional selected: ${_prof.name}`);
        }
      } else if (_pb.type === 'time' && _id.startsWith('slot_')) {
        const _timeRaw = _id.replace('slot_', '');
        const _formatted = _timeRaw.length === 4 ? `${_timeRaw.slice(0,2)}:${_timeRaw.slice(2)}` : _timeRaw;
        session.data.time = _formatted;
        text = _formatted;
        console.log(`[Buttons] Time selected: ${_formatted}`);
      } else if (_pb.type === 'confirmation') {
        if (_id === 'confirm_yes') text = 'sim, confirmar';
        else if (_id === 'confirm_change') { text = 'quero alterar o horário'; session.data.time = undefined; session.data.pendingConfirm = undefined; }
        else if (_id === 'confirm_cancel') text = 'cancelar';
        console.log(`[Buttons] Confirmation: ${_id} → "${text}"`);
      }
      session.data._pendingButtons = undefined;
      // Refresh lowerText and derived flags after button resolution
      lowerText = text.toLowerCase();
      isCancellation = ['cancelar', 'cancela', 'cancele', 'cancelamento'].some(k => lowerText.includes(k));
      isReset = lowerText.trim().length <= 40 && ['sair', 'reiniciar', 'recomeçar', 'recomecar', 'esquece', 'esquecer'].some(k => lowerText.includes(k));
    } else {
      // No match — clear stale buttons, let text flow through normally
      session.data._pendingButtons = undefined;
    }
  }

  // Greeting flag (persisted in session to survive cold starts)
  const { greeting: brasiliaGreeting, dateStr: brasiliaDate } = getBrasiliaGreeting();
  // Skip AI greeting if we just sent a welcome message (new lead)
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

  // ── "Walk-in / fit me in now" detection ──────────────────────────────
  // Must run BEFORE on-the-way detection to prevent "encaixar agora? to chegando"
  // from being treated as "I'm on my way to an existing appointment".
  const _normFitIn = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
  const FIT_IN_KW = ['encaixar agora', 'encaixe agora', 'tem como encaixar', 'encaixa agora',
    'encaixar hoje', 'encaixe hoje', 'quero encaixar', 'da pra encaixar',
    'tem encaixe', 'horario agora', 'atender agora', 'vaga agora'];
  const isFitInRequest = FIT_IN_KW.some(k => _normFitIn.includes(k));
  if (isFitInRequest) {
    console.log('[Agent] Walk-in / fit-in-now request detected — skipping on-the-way, routing to booking flow');
    // Set date=today and _suggestedTime=now so slot prefetch runs
    const _bNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const _nowH = _bNow.getUTCHours();
    const _nowM = _bNow.getUTCMinutes();
    // Round up to next 15-minute slot
    const _roundedM = Math.ceil(_nowM / 15) * 15;
    const _fitH = _roundedM >= 60 ? _nowH + 1 : _nowH;
    const _fitM = _roundedM >= 60 ? 0 : _roundedM;
    session.data.date = todayISO;
    session.data._suggestedTime = `${String(_fitH).padStart(2, '0')}:${String(_fitM).padStart(2, '0')}`;
    (session.data as any)._fitInNow = true;
    console.log(`[Agent] Fit-in: date=${todayISO}, suggestedTime=${session.data._suggestedTime}`);
    // Fall through to AI — it will handle the booking flow
  }

  // ── "On the way / running late" detection (TypeScript layer) ──────────
  // Lead is heading to their appointment (possibly late).
  // Must run BEFORE implicit-cancel so "vou atrasar mas tô indo" doesn't cancel.
  // e.g.: "tô indo embora", "saindo agora", "acho que vou atrasar", "logo chego"
  // SKIP if this is a fit-in request (already detected above)
  if (!isFitInRequest && !session.data.pendingConfirm && !session.data.pendingReschedule && !session.data.pendingCancelConfirm) {
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

  // Detect target date from message or session for vacation checks
  const _tomorrowBrasilia = new Date(nowBrasilia.getTime() + 86400000);
  const _tomorrowISO = `${_tomorrowBrasilia.getUTCFullYear()}-${pad(_tomorrowBrasilia.getUTCMonth()+1)}-${pad(_tomorrowBrasilia.getUTCDate())}`;
  const _mentionsTomorrow = /\bamanha\b|\bamanh[ãa]\b/i.test(lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const _vacCheckDate = session.data.date || (_mentionsTomorrow ? _tomorrowISO : todayISO);

  // Professional name pre-extraction (TypeScript layer — more reliable than LLM)
  // Vacation check runs for any # of professionals. Personal-contact-flow only for multi-prof.
  if (!session.data.professionalId && !session.data.pendingProfContact) {
    const matched = matchProfessionalName(lowerText, professionals);
    if (matched) {
      // ── Vacation check: always runs regardless of professional count ──
      const _vacBreakWh1 = (settings.breaks || []).find((b: any) => {
        if (!b.professionalId || b.professionalId !== matched.id) return false;
        if (b.type !== 'vacation') return false;
        const vacStart: string = b.date || '';
        const vacEnd: string = b.vacationEndDate || b.date || '';
        return !!vacStart && _vacCheckDate >= vacStart && _vacCheckDate <= vacEnd;
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
            if (!b.professionalId || b.professionalId !== p.id) return false;
            if (b.type !== 'vacation') return false;
            const vs: string = b.date || '', ve: string = b.vacationEndDate || b.date || '';
            return !!vs && _vacCheckDate >= vs && _vacCheckDate <= ve;
          }));
        const othersStr = othersAvail.map((p: any) => p.name).join(' ou ');
        const vacMsg = `*${matched.name}* está de férias no momento!${_returnInfo1} 🏖️\n\n${othersStr ? `Mas o ${othersStr} pode te atender! Gostaria de agendar?` : 'Gostaria de agendar com outro profissional?'}`;
        // Store vacation context so next message can be handled in TS
        if (othersAvail.length > 0) {
          (session.data as any).pendingVacationOffer = {
            vacProfName: matched.name,
            returnDate: _returnDate1,
            otherProfs: othersAvail.map((p: any) => ({ id: p.id, name: p.name })),
          };
        }
        session.history.push({ role: 'user', text });
        session.history.push({ role: 'bot', text: vacMsg });
        await sendMsg(instanceName, phone, vacMsg, tenantId);
        saveSession(tenantId, phone, session.data, session.history).catch(() => {});
        return;
      }

      if (professionals.length > 1) {
        // Multiple professionals: check for booking intent or personal-contact flow
        const normMsg2 = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '');
        const BOOK_KW2 = ['agendar', 'marcar', 'horario', 'reservar', 'procedimento', 'servico', 'corte', 'corta', 'cortar', 'barba', 'agendamento', 'cabelo', 'cabeca', 'cabecinha', 'cabeça', 'vaga', 'disponivel', 'disponibilidade', 'encaixe', 'encaixar', 'sobrancelha', 'progressiva', 'escova', 'pintar', 'colorir', 'alisar'];
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
  // BUT skip if the message contains cancellation/no-show intent (e.g. "amanhã não vou")
  {
    const _normCancel = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const CANCEL_PATTERNS = [
      /nao\s+(?:vou|posso|consigo|da|dou|tenho como|vai\s+dar)/,
      /(?:vou|posso|consigo|vai\s+dar)\s+(?:nao|não)/,
      /conseguir\s+ir\s+nao/,
      /nao\s+(?:vai|vou)\s+(?:dar|rolar|conseguir)/,
      /cancelar/, /desmarcar/, /remarcar/, /reagendar/,
      /nao\s+ir/, /ir\s+nao/,
      /(?:vou|preciso)\s+(?:faltar|desistir)/,
    ];
    const hasCancelIntent = CANCEL_PATTERNS.some(re => re.test(_normCancel));
    const resolved = resolveRelativeDate(lowerText, todayISO);
    if (resolved && resolved !== session.data.date && !hasCancelIntent) {
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
      // Prepend greeting if this is first interaction of the day
      const _cdGreetPrefix = shouldGreet ? `${brasiliaGreeting.charAt(0).toUpperCase() + brasiliaGreeting.slice(1)}! ` : '';
      if (shouldGreet) {
        session.data.greetedAt = brasiliaDate;
      }
      if (_nextOpenISO) {
        const _nextDowName = DOW_PT[_nextOpenDow];
        const _nextDD = _nextOpenISO.slice(8, 10);
        const _nextMM = _nextOpenISO.slice(5, 7);
        const _cdMsg = `${_cdGreetPrefix}${_closedLabel} (${_closedDowName}) a gente não abre 😕 Mas na ${_nextDowName}, dia ${_nextDD}/${_nextMM}, estamos abertos! Quer agendar pra esse dia?`;
        session.data.date = _nextOpenISO;
        session.history.push({ role: 'bot', text: _cdMsg });
        await sendMsg(instanceName, phone, _cdMsg, tenantId);
        saveSession(tenantId, phone, session.data, session.history).catch(() => {});
        return;
      } else {
        const _cdMsg = `${_cdGreetPrefix}Desculpe, não temos dias abertos nos próximos 14 dias 😕 Entre em contato novamente mais tarde!`;
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
      if (!b.professionalId || b.professionalId !== p.id) return false;
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
      if (!b.professionalId || b.professionalId !== session.data.professionalId) return false;
      const vs: string = b.date || '';
      const ve: string = b.vacationEndDate || b.date || '';
      return !!vs && _vacCheckDate >= vs && _vacCheckDate <= ve;
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
          if (!b.professionalId || b.professionalId !== p.id) return false;
          const vs: string = b.date || '', ve: string = b.vacationEndDate || b.date || '';
          return !!vs && _vacCheckDate >= vs && _vacCheckDate <= ve;
        }));
      const _othersStrWh = _othersAvailWh.map((p: any) => p.name).join(' ou ');
      const _vacMsgWh = `*${_vacProfNameWh}* está de férias no momento!${_returnInfoWh2} 🏖️\n\n${_othersStrWh ? `Mas o ${_othersStrWh} pode te atender! Gostaria de agendar?` : 'Pode agendar quando o profissional retornar.'}`;
      session.data.professionalId   = undefined;
      session.data.professionalName = undefined;
      session.data.date             = undefined;
      // Store vacation context so next message can be handled in TS
      if (_othersAvailWh.length > 0) {
        (session.data as any).pendingVacationOffer = {
          vacProfName: _vacProfNameWh,
          returnDate: _returnDateWh2,
          otherProfs: _othersAvailWh.map((p: any) => ({ id: p.id, name: p.name })),
        };
      }
      session.history.push({ role: 'bot', text: _vacMsgWh });
      await sendMsg(instanceName, phone, _vacMsgWh, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(() => {});
      return;
    }
  }

  // Affirmative emoji detection (👍👊✅🤙🙏💪👏🔥) — reused across handlers
  const AFFIRM_EMOJI_RE = /[\u{1F44D}\u{1F44A}\u{2705}\u{1F919}\u{1F64F}\u{1F4AA}\u{1F44F}\u{1F525}\u{1F91D}\u{1F60A}\u{1F609}\u{1F601}\u{1F973}]/u;
  const isEmojiAffirm = AFFIRM_EMOJI_RE.test(text) && text.replace(/[\s\u{FE0F}\u{200D}\u{20E3}]/gu, '').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '').length === 0;

  // ── Vacation offer response handler ─────────────────────────────────
  // After vacation message offers other professionals, handle the client's reply in TS.
  if ((session.data as any).pendingVacationOffer) {
    const _vacOffer = (session.data as any).pendingVacationOffer as {
      vacProfName: string; returnDate: string; otherProfs: { id: string; name: string }[];
    };
    const _normVac = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const _vacWords = _normVac.split(/\s+/);
    const AFFIRM_VAC = ['sim', 'pode', 'quero', 'ok', 'bora', 'beleza', 'blz', 'claro', 'isso', 'certo', 'vamos', 'vamo', 'fechou', 'show', 'dale', 'dale', 'perfeito', 'agendar', 'marcar', 'po', 'podemos'];
    const DECLINE_VAC = ['nao', 'quando voltar', 'quando ele voltar', 'quando ela voltar', 'vou esperar', 'esperar', 'depois', 'nada', 'valeu', 'obrigado', 'obrigada', 'tchau', 'flw', 'falou', 'ate', 'brigado', 'brigada', 'tmj', 'vlw'];
    const isAffirmVac = AFFIRM_VAC.some(a => _vacWords.includes(a)) || isEmojiAffirm;
    const isDeclineVac = DECLINE_VAC.some(d => _normVac.includes(d));
    // Check if client mentioned one of the other profs by name
    const _matchedOther = _vacOffer.otherProfs.find(p =>
      _normVac.includes(p.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    );

    if (_matchedOther) {
      // Client chose a specific professional
      session.data.professionalId = _matchedOther.id;
      session.data.professionalName = _matchedOther.name;
      (session.data as any).pendingVacationOffer = undefined;
      const _vacReply = `Boa! Vamos agendar com ${_matchedOther.name} então! Qual serviço você gostaria?`;
      session.history.push({ role: 'bot', text: _vacReply });
      await sendMsg(instanceName, phone, _vacReply, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(() => {});
      return;
    } else if (isAffirmVac && !isDeclineVac) {
      // Client said yes → pick first available prof or ask
      (session.data as any).pendingVacationOffer = undefined;
      if (_vacOffer.otherProfs.length === 1) {
        session.data.professionalId = _vacOffer.otherProfs[0].id;
        session.data.professionalName = _vacOffer.otherProfs[0].name;
        const _vacReply = `Vamos agendar com ${_vacOffer.otherProfs[0].name} então! 😊 Qual serviço você gostaria?`;
        session.history.push({ role: 'bot', text: _vacReply });
        await sendMsg(instanceName, phone, _vacReply, tenantId);
      } else {
        const _profNames = _vacOffer.otherProfs.map(p => p.name).join(' ou ');
        const _vacReply = `Com qual profissional prefere? ${_profNames}`;
        session.history.push({ role: 'bot', text: _vacReply });
        await sendMsg(instanceName, phone, _vacReply, tenantId);
      }
      saveSession(tenantId, phone, session.data, session.history).catch(() => {});
      return;
    } else if (isDeclineVac) {
      // Client wants to wait or declined
      (session.data as any).pendingVacationOffer = undefined;
      const _returnNote = _vacOffer.returnDate ? ` O ${_vacOffer.vacProfName} retorna ${_vacOffer.returnDate}.` : '';
      const _vacReply = `Sem problema!${_returnNote} Quando quiser agendar é só chamar aqui. 😊`;
      session.history.push({ role: 'bot', text: _vacReply });
      await sendMsg(instanceName, phone, _vacReply, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(() => {});
      return;
    }
    // Ambiguous — clear flag and fall through to AI
    (session.data as any).pendingVacationOffer = undefined;
  }

  // ── Rating context reply ────────────────────────────────────────────────
  // When ratingService sends a rating request, the next reply is intercepted here.
  // Expects a number 0-10. If valid, saves the review and thanks the customer.
  if ((session.data as any).pendingRating) {
    const ratingCtx = (session.data as any).pendingRating;
    const normR = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '').trim();
    const numMatch = normR.match(/\b(10|[0-9])\b/);

    if (numMatch) {
      const rating = parseInt(numMatch[1], 10);
      try {
        await supabase.from('reviews').insert({
          tenant_id: tenantId,
          customer_phone: phone,
          customer_name: ratingCtx.customerName || '',
          appointment_id: ratingCtx.apptId || '',
          rating,
          comment: text,
        });
      } catch (e: any) {
        console.error('[Rating-WH] Erro ao salvar review:', e);
      }

      (session.data as any).pendingRating = undefined;

      let ratingReply: string;
      if (rating >= 8) {
        const googleLink = ratingCtx.googlePlaceId
          ? `\n\nSe puder, deixe uma avaliação no Google também! Ajuda muito o nosso trabalho 🙏\nhttps://search.google.com/local/writereview?placeid=${ratingCtx.googlePlaceId}`
          : '';
        ratingReply = `Muito obrigado pela nota *${rating}*! 🌟 Ficamos felizes que você gostou! Até a próxima! 😊${googleLink}`;
      } else if (rating >= 5) {
        ratingReply = `Obrigado pela nota *${rating}*! Vamos trabalhar para melhorar cada vez mais. 💪`;
      } else {
        ratingReply = `Obrigado pelo feedback. Lamentamos que a experiência não foi a melhor. Vamos melhorar! 🙏`;
      }

      session.history.push({ role: 'user', text });
      session.history.push({ role: 'bot', text: ratingReply });
      await sendMsg(instanceName, phone, ratingReply, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(() => {});
      return;
    }

    // If client wants to book instead, clear rating and fall through to AI
    const hasBookingKw = ['agendar', 'marcar', 'horario', 'hora'].some(k => normR.includes(k));
    if (hasBookingKw) {
      (session.data as any).pendingRating = undefined;
      saveSession(tenantId, phone, session.data, session.history).catch(() => {});
      // fall through to AI
    } else {
      // Re-prompt for a number
      const reprompt = 'Por favor, envie uma nota de *0 a 10* para avaliar seu atendimento. ⭐';
      session.history.push({ role: 'user', text });
      session.history.push({ role: 'bot', text: reprompt });
      await sendMsg(instanceName, phone, reprompt, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(() => {});
      return;
    }
  }

  // ── Follow-up context: aviso/lembrete/reativacao ──────────────────────────
  // When followUpService sends a follow-up message it persists pendingFollowUpType
  // in the session. Handle the first reply here before falling through to the AI.
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
      // Mark as greeted today so any subsequent message doesn't trigger a new greeting
      const { dateStr: _fGreetDate } = getBrasiliaGreeting();
      session.data.greetedAt = _fGreetDate;
      session.history.push({ role: 'bot', text: reply });
      await sendMsg(instanceName, phone, reply, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(e => console.error('[Agent] followUp saveSession err:', e));
      return;
    }

    // reativacao: short denial → polite dismissal
    if (fType === 'reativacao' && isDeny) {
      const reply = `Tudo bem! Quando precisar, é só chamar. 😊`;
      session.data.pendingFollowUpType = undefined;
      const { dateStr: _fGreetDate2 } = getBrasiliaGreeting();
      session.data.greetedAt = _fGreetDate2;
      session.history.push({ role: 'bot', text: reply });
      await sendMsg(instanceName, phone, reply, tenantId);
      saveSession(tenantId, phone, session.data, session.history).catch(e => console.error('[Agent] followUp saveSession err:', e));
      return;
    }

    // Anything else → clear flag, mark greeted, and fall through to AI with full history context
    session.data.pendingFollowUpType = undefined;
    const { dateStr: _fGreetDate3 } = getBrasiliaGreeting();
    session.data.greetedAt = _fGreetDate3;
  }

  // ─── Follow-up fallback: session may have expired but appointment exists today ──
  // When no pendingFollowUpType (session expired) but client sends short affirmative
  // OR signals they're on their way → respond as context-aware confirmation instead of greeting.
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
    // Detect "on the way" signals — client informing they're heading to the appointment
    const OTW_SIGNALS = [
      /\b(saindo|saio|sai da|sai do)\b/,
      /\b(chegando|chego|chegar)\b/,
      /\b(to\s+indo|vou\s+indo|indo\s+ai|indo\s+la)\b/,
      /\b(a\s+caminho|em\s+caminho)\b/,
      /\b(ja\s+to\s+ai|ja\s+to\s+la|to\s+ai|to\s+la)\b/,
      /\b(em\s+breve|logo\s+chego|ja\s+chego|chego\s+ja)\b/,
      /\b(saindo\s+agora|saindo\s+de|saindo\s+do|saindo\s+da)\b/,
    ];
    const isOnTheWay = OTW_SIGNALS.some(re => re.test(normFb));
    if (isShortAffirm || isOnTheWay) {
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
            const reply = isOnTheWay
              ? `Perfeito! Te aguardamos às *${apptTime}* 😊`
              : `Show de bola! Aguardamos você às *${apptTime}*. 😊`;
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
      if (resolvedFm) {
        // Don't set date if message has cancellation/no-show intent (e.g. "amanhã não vou")
        const _normCancelFm = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
        const _cancelFm = [
          /nao\s+(?:vou|posso|consigo|da|dou|tenho como|vai\s+dar)/,
          /(?:vou|posso|consigo|vai\s+dar)\s+(?:nao|não)/,
          /conseguir\s+ir\s+nao/,
          /nao\s+(?:vai|vou)\s+(?:dar|rolar|conseguir)/,
          /cancelar/, /desmarcar/, /remarcar/, /reagendar/,
          /nao\s+ir/, /ir\s+nao/,
          /(?:vou|preciso)\s+(?:faltar|desistir)/,
        ];
        if (!_cancelFm.some(re => re.test(_normCancelFm))) {
          session.data.date = resolvedFm;
        }
      }
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
    const BOOK_KW_PC = ['agendar', 'marcar', 'horario', 'reservar', 'procedimento', 'servico', 'corte', 'corta', 'cortar', 'barba', 'agendamento', 'cabelo', 'cabeca', 'cabecinha', 'cabeça', 'vaga', 'disponivel', 'disponibilidade', 'encaixe', 'encaixar', 'sobrancelha', 'progressiva', 'escova', 'pintar', 'colorir', 'alisar'];
    const AFFIRM_PC  = ['sim', 'pode', 'ok', 'claro', 'isso', 'bora', 'gostaria', 'queria', 'favor', 'exato'];
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

  // ── Service correction: "só corte", "somente barba", "não, quero X" ──
  // If client is correcting the previously selected service, clear it and re-match
  if (session.data.serviceId) {
    const _normCorr = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim();
    const _hasCorrectionIntent = /\bso\b|\bsomente\b|\bapenas\b|\bsoh\b|\bsó\b/.test(_normCorr) ||
      /^(nao|n[aã]o),?\s/.test(_normCorr) || /\bnao (e|eh|era)\b/.test(_normCorr) ||
      /\bso\s+(corte|corta|barba|cabelo|sobrancelha|progressiva|escova)\b/.test(_normCorr) ||
      /\b(eu falei|eu disse|eu pedi|eu quero)\b/.test(_normCorr);
    if (_hasCorrectionIntent) {
      const _corrMatch = matchServiceByKeywords(_normCorr, services);
      if (_corrMatch && _corrMatch.id !== session.data.serviceId) {
        console.log(`[Agent] Service correction: "${session.data.serviceName}" → "${_corrMatch.name}"`);
        session.data.serviceId = _corrMatch.id;
        session.data.serviceName = _corrMatch.name;
        session.data.serviceDuration = _corrMatch.durationMinutes;
        session.data.servicePrice = _corrMatch.price;
        session.data._comboRequest = undefined;
        session.data._comboTotalDuration = undefined;
        session.data._comboTotalPrice = undefined;
        session.data._comboServiceIds = undefined;
        // Clear date/time so AI re-asks after service change
        session.data.date = undefined;
        session.data.time = undefined;
        session.data._suggestedTime = undefined;
      }
    }
  }

  // ── TypeScript-layer service keyword pre-extraction ─────────────────
  // Scans text word-by-word for ALL service categories mentioned.
  // "barba, cortar o cabelo, produtinho, sobrancelha" → 4 services matched.
  // Sums durations and prices, builds combined name for AI context.
  if (!session.data.serviceId) {
    const _matchedSvc = matchServiceByKeywords(lowerText, services);
    if (_matchedSvc) {
      session.data.serviceId = _matchedSvc.id;
      session.data.serviceName = _matchedSvc.name;
      session.data.serviceDuration = _matchedSvc.durationMinutes;
      session.data.servicePrice = _matchedSvc.price;
      // Store multi-service info so the AI mentions ALL services
      if (_matchedSvc._allMatched && _matchedSvc._allMatched.length >= 2) {
        session.data._comboRequest = _matchedSvc._allMatched.map(s => s.name).join(' + ');
        session.data._comboTotalDuration = _matchedSvc.durationMinutes;
        session.data._comboTotalPrice = _matchedSvc.price;
        session.data._comboServiceIds = _matchedSvc._allMatched.map(s => s.id);
        console.log('[Agent] TS multi-service:', session.data._comboRequest, `(${_matchedSvc.durationMinutes}min, R$${_matchedSvc.price})`);
      } else if (_matchedSvc._comboCategories && _matchedSvc._comboCategories.length >= 2) {
        session.data._comboRequest = _matchedSvc._comboCategories.join(' + ');
        console.log('[Agent] TS combo categories:', session.data._comboRequest);
      } else {
        console.log('[Agent] TS pre-extracted service:', _matchedSvc.name);
      }
    }
  }

  // ── TypeScript-layer colloquial time pre-extraction ─────────────────
  // Parses "5 e meia"→"17:30", "as 3"→"15:00", "meio dia"→"12:00"
  // Runs BEFORE brain call so the AI doesn't need to interpret these.
  if (!session.data.time && session.data.serviceId) {
    const _parsedTime = parseColloquialTime(lowerText);
    if (_parsedTime) {
      session.data._suggestedTime = _parsedTime;
      console.log('[Agent] TS parsed colloquial time:', _parsedTime);
    }
  }

  // ── Auto-select single professional (TS layer) ───────────────────────────
  // When there's exactly 1 active professional, select them automatically so
  // slot prefetch can run without the AI needing to ask "qual profissional?".
  if (!session.data.professionalId && professionals.length === 1) {
    session.data.professionalId   = professionals[0].id;
    session.data.professionalName = professionals[0].name;
    console.log('[Agent] TS auto-selected only professional:', professionals[0].name);
  }

  // ── Auto-assume TODAY when client asks about availability without specifying day ──
  // The flowSection tells the AI to assume today in these cases, but without setting
  // date in TS the slot prefetch never runs and AI hallucinates times (incl. past ones).
  if (!session.data.date) {
    const _normAvail = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const _availKws = ['tem horario', 'tem vaga', 'horario disponivel', 'horarios disponiveis',
      'como estao os horarios', 'tem horario hoje', 'tem vaga hoje', 'horario livre',
      'tem horario disponivel', 'quais horarios', 'que horarios', 'horario para hoje',
      'encaixar agora', 'encaixe agora', 'tem como encaixar', 'encaixa agora',
      'atender agora', 'vaga agora', 'horario agora'];
    const _asksAvailToday = _availKws.some(kw => _normAvail.includes(kw));
    if (_asksAvailToday) {
      session.data.date = todayISO;
      console.log('[Agent] TS auto-set date=today (availability inquiry)');
    }
  }

  // ── Clear stale availableSlots from session — always start fresh ──────────
  // Old slots from previous turns must never leak into the AI context.
  session.data.availableSlots = undefined;

  // Prefetch slots only when all 3 are known (professional + date + service).
  // Service is required because availability depends on duration.
  let prefetchedSlots: string[] | undefined;
  const _hasProf = !!session.data.professionalId;
  const _hasDate = !!session.data.date;
  const _hasSvc  = !!session.data.serviceId;
  if (_hasProf && _hasDate && _hasSvc) {
    const _slotDur = session.data.serviceDuration || 30;
    prefetchedSlots = await getAvailableSlots(tenantId, session.data.professionalId!, session.data.date!, _slotDur, settings);

    // ── Auto-accept suggested time if available in slots ──────────────
    if ((session.data as any)._suggestedTime && !session.data.time && prefetchedSlots.length > 0) {
      const suggested = (session.data as any)._suggestedTime as string;
      if (prefetchedSlots.includes(suggested)) {
        session.data.time = suggested;
        console.log(`[Agent] TS auto-accepted suggested time: ${suggested}`);
      } else {
        // Find nearest available slot to the suggested time
        const sugMin = parseInt(suggested.split(':')[0]) * 60 + parseInt(suggested.split(':')[1]);
        let nearest = prefetchedSlots[0];
        let nearestDiff = Infinity;
        for (const slot of prefetchedSlots) {
          const slotMin = parseInt(slot.split(':')[0]) * 60 + parseInt(slot.split(':')[1]);
          const diff = Math.abs(slotMin - sugMin);
          if (diff < nearestDiff) { nearestDiff = diff; nearest = slot; }
        }
        (session.data as any)._nearestSlot = nearest;
        console.log(`[Agent] TS suggested ${suggested} not available, nearest: ${nearest}`);
      }
    }

    // Empty slots = vacation or fully booked — handle immediately before calling brain
    if (prefetchedSlots.length === 0) {
      const _vacBreakWh3 = (settings.breaks || []).find((b: any) => {
        if (!b.professionalId || b.professionalId !== session.data.professionalId) return false;
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
        // Send time slot buttons for the alternative day
        if (_foundNextSlots.length > 0) {
          const _slotRows = _foundNextSlots.slice(0, 10).map(s => ({ id: `slot_${s.replace(':', '')}`, title: s }));
          await sendListMessage(instanceName, phone, 'Horários', 'Escolha um horário:', 'Ver horários', [{ title: 'Horários disponíveis', rows: _slotRows }], tenantId);
          session.data._pendingButtons = { type: 'time' as const, options: _slotRows.map(r => ({ id: r.id, label: r.title })), sentAt: Date.now() };
        }
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
      if (!b.professionalId || b.professionalId !== p.id) return false;
      const vs = b.date || '', ve = b.vacationEndDate || b.date || '';
      return !!vs && _targetDateWh >= vs && _targetDateWh <= ve;
    })
  );
  const _vacCtxWh = _profsOnVacWh.length > 0 ? `🏖️ PROFISSIONAIS DE FÉRIAS (NÃO disponíveis para agendamento):\n${_profsOnVacWh.map((p: any) => {
    const vb = _breaksWh.find((b: any) => {
      if (b.type !== 'vacation') return false;
      if (!b.professionalId || b.professionalId !== p.id) return false;
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

  // ── Build holiday context for AI prompt ──────────────────────────
  const _holidayWh = _breaksWh.find((b: any) => b.type === 'holiday' && !b.professionalId && b.date === _targetDateWh);
  let _holidayCtxWh = '';
  if (_holidayWh) {
    const isAllDay = _holidayWh.startTime === '00:00' && (_holidayWh.endTime === '23:59' || _holidayWh.endTime === '23:00');
    _holidayCtxWh = `\n🎉 FERIADO: ${_holidayWh.label || 'Feriado'} em ${formatDate(_targetDateWh)}${isAllDay ? ' — Estabelecimento FECHADO o dia todo' : ` — Fechado a partir das ${_holidayWh.startTime}`}. Informe o cliente e sugira outro dia.`;
  }
  const _fullCtxWh = [_vacCtxWh, _holidayCtxWh].filter(Boolean).join('\n') || undefined;

  // First brain call
  let brain = await callBrain(apiKey, tenantName, todayISO, services, professionalsVisible, session.history, session.data, prefetchedSlots, customPrompt || undefined, effectiveShouldGreet, brasiliaGreeting, tenantId, phone, _fullCtxWh, settings.operatingHours as any);

  // Fallback: if primary key failed and it was OpenAI, retry with Gemini key
  if (!brain && apiKey.startsWith('sk-')) {
    const geminiKey = (tenant.gemini_api_key || '').trim();
    if (geminiKey) {
      console.log(`[Agent] OpenAI failed, retrying with Gemini key for ${tenantId}`);
      brain = await callBrain(geminiKey, tenantName, todayISO, services, professionalsVisible, session.history, session.data, prefetchedSlots, customPrompt || undefined, effectiveShouldGreet, brasiliaGreeting, tenantId, phone, _fullCtxWh, settings.operatingHours as any);
    }
  }

  if (!brain) {
    console.error(`[Agent] All AI calls failed for ${tenantId}, key prefix: ${apiKey.slice(0, 6)}...`);
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
  // the reply. This is a hard guardrail since availability depends on service duration.
  if (!session.data.serviceId) {
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
    let brain2 = await callBrain(apiKey, tenantName, todayISO, services, professionalsVisible, session.history, session.data, newSlots, customPrompt || undefined, false, brasiliaGreeting, tenantId, phone, _fullCtxWh, settings.operatingHours as any);
    if (!brain2 && apiKey.startsWith('sk-') && (tenant.gemini_api_key || '').trim()) {
      brain2 = await callBrain(tenant.gemini_api_key.trim(), tenantName, todayISO, services, professionalsVisible, session.history, session.data, newSlots, customPrompt || undefined, false, brasiliaGreeting, tenantId, phone, _fullCtxWh, settings.operatingHours as any);
    }
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

  // ── TS guard: prevent AI from hallucinating booking confirmation ──────────
  // Only allow booking if client's message actually looks like a time selection
  // or confirmation — not a greeting, question, or unrelated message.
  const _bookConfirmRe = /(?:\d{1,2}\s*[:\sh]\s*\d{0,2}|\d{1,2}\s*(?:hora|hrs?|h\b)|(?:^|\s)(?:sim|s|ss|ok|pode|confirma|quero|isso|esse|essa|beleza|bora|vamos|fechar|fechado|agendar|marcar|primeiro|segundo|terceiro|ultimo|última|1º|2º|3º)(?:\s|$|[!.,?]))/i;
  if (brain.extracted.confirmed === true && session.data.time && !_bookConfirmRe.test(lowerText)) {
    brain.extracted.confirmed = false;
    console.log('[Agent] TS guard: blocked hallucinated booking confirmation — client msg:', lowerText.slice(0, 80));
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
        .select('id, customer_id')
        .eq('tenant_id', tenantId)
        .eq('professional_id', session.data.professionalId)
        .not('status', 'in', '("cancelado","CANCELLED")')
        .lt('inicio', endTimeStr)   // existing starts before new ends
        .gt('fim',    startTimeStr); // existing ends after new starts
      if (conflicting && conflicting.length > 0) {
        // Check if the conflicting appointment belongs to THIS customer (duplicate booking attempt)
        const { data: thisCust } = await supabase.from('customers').select('id')
          .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
        const isOwnBooking = thisCust && conflicting.some((c: any) => c.customer_id === thisCust.id);
        if (isOwnBooking) {
          // This customer already has this slot booked — it's a duplicate, not a conflict
          console.log('[Agent] Duplicate booking detected — customer already has this slot. Skipping conflict msg.');
          const alreadyMsg = `Tudo certo! Seu agendamento já está confirmado para ${formatDate(session.data.date)} às ${session.data.time} com ${session.data.professionalName}. Te esperamos! 😊`;
          session.history.push({ role: 'bot', text: alreadyMsg });
          await sendMsg(instanceName, phone, alreadyMsg, tenantId);
          await clearSession(tenantId, phone);
          return;
        }
        const freshSlots = await getAvailableSlots(tenantId, session.data.professionalId!, session.data.date!, dur, settings);
        session.data.time = undefined;
        session.data.availableSlots = freshSlots;
        const takenMsg = freshSlots.length > 0
          ? `Ops! Esse horário acabou de ser ocupado. 😕 Ainda temos:\n\n${freshSlots.slice(0, 6).map(s => `• ${s}`).join('\n')}\n\nQual você prefere?`
          : `Ops! Esse horário foi ocupado e não há mais vagas nesse dia. Para qual outro dia você prefere?`;
        if (freshSlots.length === 0) session.data.date = undefined;
        session.history.push({ role: 'bot', text: takenMsg });
        await sendMsg(instanceName, phone, takenMsg, tenantId);
        // Send time slot buttons for fresh alternatives
        if (freshSlots.length > 0) {
          const _freshRows = freshSlots.slice(0, 10).map(s => ({ id: `slot_${s.replace(':', '')}`, title: s }));
          await sendListMessage(instanceName, phone, 'Horários', 'Escolha um horário:', 'Ver horários', [{ title: 'Horários disponíveis', rows: _freshRows }], tenantId);
          session.data._pendingButtons = { type: 'time' as const, options: _freshRows.map(r => ({ id: r.id, label: r.title })), sentAt: Date.now() };
        }
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
        const cData = (settings.customerData || {})[customer.id] || {};
        if (cData.planId && cData.planStatus === 'ativo') {
          const plan = (settings.plans || []).find(p => p.id === cData.planId && p.active);
          if (plan) {
            // Migrate legacy plan format
            const quotas = plan.quotas && plan.quotas.length > 0
              ? plan.quotas
              : (plan.serviceId ? [{ serviceId: plan.serviceId, quantity: plan.proceduresPerMonth || 0 }] : []);

            const svcId = session.data.serviceId;
            const quota = quotas.find(q => q.serviceId === svcId);
            if (quota) {
              const usageKey = `${customer.id}::${svcId}`;
              const used = (settings.planUsage || {})[usageKey] || 0;
              if (used < quota.quantity) {
                isPlanAppt = true;
                // Increment usage in JSONB
                const newUsage = { ...(settings.planUsage || {}), [usageKey]: used + 1 };
                const { data: curSettings } = await supabase.from('tenant_settings')
                  .select('follow_up').eq('tenant_id', tenantId).maybeSingle();
                const curFu = curSettings?.follow_up || {};
                await supabase.from('tenant_settings').upsert({
                  tenant_id: tenantId,
                  follow_up: { ...curFu, _planUsage: newUsage }
                }, { onConflict: 'tenant_id' });
                if (!settings.planUsage) (settings as any).planUsage = {};
                settings.planUsage[usageKey] = used + 1; // update local copy too

                // Build balance message for all quotas
                const balParts: string[] = [];
                for (const q of quotas) {
                  const uKey = `${customer.id}::${q.serviceId}`;
                  const u = (settings.planUsage || {})[uKey] || 0;
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

      // Multi-service: create one row per service (same time slot)
      const _allSvcIds: string[] = (session.data._comboServiceIds && session.data._comboServiceIds.length >= 2)
        ? session.data._comboServiceIds
        : [session.data.serviceId];
      for (const _svcId of _allSvcIds) {
        await supabase.from('appointments').insert({
          tenant_id: tenantId,
          customer_id: customer.id,
          professional_id: session.data.professionalId,
          service_id: _svcId,
          inicio: startTimeStr,
          fim: endTimeStr,
          status: 'CONFIRMED',
          origem: 'AI',
          is_plan: isPlanAppt,
        });
      }

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

      const _priceStr = session.data._comboTotalPrice ? ` (R$${(Number(session.data._comboTotalPrice) || 0).toFixed(2).replace('.', ',')})` : (session.data.servicePrice ? ` (R$${(Number(session.data.servicePrice) || 0).toFixed(2).replace('.', ',')})` : '');
      const confirmMsg = wasReschedule
        ? `✅ *Reagendado!*\n\n` +
          `📅 *Dia:* ${formatDate(session.data.date)}\n` +
          `⏰ *Horário:* ${session.data.time}\n` +
          `✂️ *Procedimento:* ${session.data.serviceName || 'Procedimento'}${_priceStr}\n` +
          `💈 *Profissional:* ${session.data.professionalName || 'Profissional'}` +
          (isPlanAppt ? planBalanceMsg : '') +
          `\n\nTe esperamos! 😊`
        : `✅ *Agendamento confirmado!*\n\n` +
          `📅 *Dia:* ${formatDate(session.data.date)}\n` +
          `⏰ *Horário:* ${session.data.time}\n` +
          `✂️ *Procedimento:* ${session.data.serviceName || 'Procedimento'}${_priceStr}\n` +
          `💈 *Profissional:* ${session.data.professionalName || 'Profissional'}` +
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

  // ── ANTI-LOOP SYSTEM (3 layers) ──────────────────────────────────────────

  const _normForLoop = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim();
  const newReplyNorm = _normForLoop(brain.reply);
  const botMsgs = session.history.filter((h: any) => h.role === 'bot');
  const lastBotMsg = _normForLoop(botMsgs.slice(-1)[0]?.text || '');

  // Layer 1: Semantic repeat detection — if the AI is asking the same question again
  // Compare last 3 bot messages for similarity (shared words ratio)
  const _wordSim = (a: string, b: string): number => {
    if (!a || !b) return 0;
    const wa = new Set(a.split(/\s+/).filter(w => w.length >= 3));
    const wb = new Set(b.split(/\s+/).filter(w => w.length >= 3));
    if (wa.size === 0 || wb.size === 0) return 0;
    let shared = 0;
    for (const w of wa) if (wb.has(w)) shared++;
    return shared / Math.max(wa.size, wb.size);
  };

  const lastBotMsgs = botMsgs.slice(-3).map((h: any) => _normForLoop(h.text));
  const repeatCount = lastBotMsgs.filter(m => _wordSim(m, newReplyNorm) > 0.6).length;

  if (repeatCount >= 2) {
    // AI is repeating itself for the 3rd time — stop the loop
    console.log(`[Agent] LOOP DETECTED: reply similar to ${repeatCount} of last 3 bot msgs. Stopping loop.`);
    brain.reply = 'Percebi que não estamos nos entendendo 😅 Pode me explicar de outra forma o que precisa? Se preferir, pode ligar ou visitar a loja!';
    // Clear problematic session state to break the cycle
    session.data._suggestedTime = undefined;
    session.data.availableSlots = undefined;
  }

  // Layer 2: Rate limit — max 3 bot messages in 2 minutes without conversation progress
  const _now = Date.now();
  const _recentBotTs: number[] = ((session.data as any)._botSendTs || []).filter((t: number) => _now - t < 120_000);
  _recentBotTs.push(_now);
  (session.data as any)._botSendTs = _recentBotTs.slice(-10); // keep last 10

  if (_recentBotTs.length > 3 && repeatCount >= 1) {
    console.log(`[Agent] RATE LIMIT: ${_recentBotTs.length} bot msgs in 2min + repeating. Stopping.`);
    brain.reply = 'Parece que estamos dando voltas! 😅 Quando puder, me conta direitinho o que precisa que eu te ajudo. Se preferir, pode chamar no balcão!';
    session.data._suggestedTime = undefined;
    session.data.availableSlots = undefined;
  }

  // Layer 3: Max unanswered bot messages — if bot sent 5+ messages and client
  // keeps sending very short/non-responsive messages, stop interacting
  const _lastN = session.history.slice(-12);
  const _consecutiveBotOnly = (() => {
    let botCount = 0;
    // Count how many bot messages at the end have only short/non-responsive user msgs between them
    const recentPairs: Array<{ userLen: number; botSimilar: boolean }> = [];
    for (let i = _lastN.length - 1; i >= 1; i--) {
      if (_lastN[i].role === 'bot' && _lastN[i - 1]?.role === 'user') {
        const uLen = (_lastN[i - 1].text || '').trim().length;
        const bSim = _wordSim(_normForLoop(_lastN[i].text), newReplyNorm) > 0.5;
        recentPairs.push({ userLen: uLen, botSimilar: bSim });
      }
    }
    // If 4+ recent pairs have the bot repeating similar content, it's a loop
    return recentPairs.filter(p => p.botSimilar).length;
  })();

  if (_consecutiveBotOnly >= 4) {
    console.log(`[Agent] MAX INTERACTIONS: ${_consecutiveBotOnly} similar bot responses. Stopping.`);
    brain.reply = 'Vou dar uma pausa pra não te encher de mensagem! 😊 Quando estiver pronto, é só chamar que eu te ajudo a agendar.';
    // Mark session as paused — next message from client will reset
    (session.data as any)._agentPaused = true;
  }

  // Layer 1b: Generic greeting repeat (existing logic)
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

  if (shouldGreet || richFirstMessage) session.data.greetedAt = brasiliaDate;
  session.history.push({ role: 'bot', text: brain.reply });
  await sendMsg(instanceName, phone, brain.reply, tenantId);

  // ── Send interactive buttons after AI reply ──────────────────────────
  const _btnResult = await maybeSendInteractiveButtons(
    instanceName, phone, session.data, services, professionalsVisible,
    prefetchedSlots || session.data.availableSlots, tenantId
  );
  if (_btnResult) session.data._pendingButtons = _btnResult;

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

  // Background cleanup of old sessions + dedup entries (max once/hour)
  maybeCleanup();

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
      msgBufferSecs: fu._msgBufferSecs ?? 20,
      customerData: (fu._customerData || {}) as Record<string, { aiPaused?: boolean; planId?: string; planStatus?: string }>,
      plans: (fu._plans || []) as Array<{ id: string; active: boolean; quotas?: Array<{ serviceId: string; quantity: number }>; serviceId?: string; proceduresPerMonth?: number; price?: number }>,
      planUsage: (fu._planUsage || {}) as Record<string, number>,
    };

    // Process each message — ALWAYS persist (even if aiActive is off)
    for (const msg of messages) {
      if (!msg) continue;
      const remoteJid: string = msg.key?.remoteJid || '';
      if (remoteJid.includes('@g.us')) continue; // skip groups

      // ── OUTGOING (fromMe) — persist to DB, skip AI ──────────────────
      if (msg.key?.fromMe) {
        const _outPhone = extractPhone(msg);
        if (!_outPhone) continue;

        // Extract message body (text, audio, image, etc.)
        let _outBody = (msg.message?.conversation
          || msg.message?.extendedTextMessage?.text || '').trim();
        if (!_outBody) {
          const _outType = msg.messageType || msg.type || '';
          if (['audioMessage', 'pttMessage'].includes(_outType)
              || msg.message?.audioMessage || msg.message?.pttMessage) _outBody = '[áudio]';
          else if (msg.message?.imageMessage) _outBody = msg.message.imageMessage.caption || '[imagem]';
          else if (msg.message?.videoMessage) _outBody = msg.message.videoMessage?.caption || '[vídeo]';
          else if (msg.message?.documentMessage) _outBody = '[documento]';
          else if (msg.message?.stickerMessage) _outBody = '[sticker]';
          else if (msg.message?.contactMessage || msg.message?.contactsArrayMessage) _outBody = '[contato]';
          else if (msg.message?.locationMessage) _outBody = '[localização]';
        }
        if (!_outBody) continue; // protocol/status message — skip

        // Dedup: if sendMsg() already saved this message recently, skip
        const _outDedupKey = `${_outPhone.replace(/\D/g, '')}::${_outBody.trim().slice(0, 120)}`;
        const _outLastSent = _wSentDedup.get(_outDedupKey);
        if (_outLastSent && Date.now() - _outLastSent < _W_DEDUP_TTL) continue;

        const _outMsgId = msg.key?.id || `out_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        EdgeRuntime.waitUntil(saveWaMsg(
          tenant.id, _outMsgId, _outPhone, _outBody,
          msg.messageTimestamp || Math.floor(Date.now() / 1000),
          msg.pushName || '', msg.messageType || msg.type || 'text', true,
          { key: msg.key, message: msg.message, messageType: msg.messageType }
        ));
        continue; // Don't process outgoing with AI
      }

      // ── INCOMING — dedup, persist, then AI (if active) ──────────────
      const msgId: string = msg.key?.id || '';
      if (msgId) {
        // Claim by message ID (instant dedup)
        if (!await claimMsg(`wh::${msgId}`)) continue;
        // Also claim by fingerprint so browser polling skips this message
        const phone = extractPhone(msg);
        const rawText = msg.message?.conversation || msg.message?.extendedTextMessage?.text
          || msg.message?.buttonsResponseMessage?.selectedButtonId
          || msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId
          || msg.message?.templateButtonReplyMessage?.selectedId || '';
        if (phone && rawText) {
          await claimMsg(`${tenant.id}::${phone}::${rawText.trim().slice(0, 120)}`);
        }
      }

      // Resolve text (with audio transcription + confirmation if needed)
      let text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
      // ── Parse button/list interactive responses ─────────────────────────
      let _buttonResponseId: string | null = null;
      if (!text) {
        const _btnId = msg.message?.buttonsResponseMessage?.selectedButtonId
          || msg.message?.templateButtonReplyMessage?.selectedId || null;
        const _listId = msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId || null;
        let _interactiveId: string | null = null;
        try { const _nf = msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage; if (_nf?.params) { const _p = JSON.parse(_nf.params); _interactiveId = _p?.id || null; } } catch {}
        _buttonResponseId = _btnId || _listId || _interactiveId || null;
        if (_buttonResponseId) {
          text = msg.message?.buttonsResponseMessage?.selectedDisplayText
            || msg.message?.listResponseMessage?.title
            || _buttonResponseId;
          console.log(`[Buttons] Received interactive response: ${_buttonResponseId} → text="${text}"`);
        }
      }
      if (!text) {
        const msgType = msg.messageType || msg.type || '';
        const isAudio = ['audioMessage', 'pttMessage'].includes(msgType) || !!msg.message?.audioMessage || !!msg.message?.pttMessage;
        if (isAudio) {
          // Save audio placeholder to DB
          const _audioPhone = extractPhone(msg);
          if (_audioPhone) {
            EdgeRuntime.waitUntil(saveWaMsg(
              tenant.id,
              msgId || `${_audioPhone}_${msg.messageTimestamp || Date.now()}`,
              _audioPhone, '[áudio]',
              msg.messageTimestamp || Math.floor(Date.now() / 1000),
              msg.pushName || '', msgType || 'audioMessage', false,
              { key: msg.key, message: msg.message, messageType: msg.messageType }
            ));
          }

          if (!settings.aiActive) continue; // no AI → already saved placeholder

          // Check per-lead aiPaused for audio messages too
          if (_audioPhone) {
            const _aSuffix = _audioPhone.replace(/\D/g, '').slice(-10);
            if (settings.customerData[`phone:${_audioPhone}`]?.aiPaused) continue;
            const { data: _aCusts } = await supabase.from('customers')
              .select('id').eq('tenant_id', tenant.id).like('telefone', `%${_aSuffix}`).limit(1);
            if (_aCusts?.[0] && settings.customerData[_aCusts[0].id]?.aiPaused) continue;
          }

          // Get API key for transcription + cleanup
          let audioKey = (settings.openaiApiKey || '').trim();
          if (!audioKey) {
            let gRows: any[] = [];
            try { const { data } = await supabase.from('global_settings').select('key, value'); gRows = data || []; } catch {}
            audioKey = ((gRows).find((r: any) => r.key === 'shared_openai_key')?.value || '').trim() || (tenant.gemini_api_key || '').trim();
          }

          // Check audio duration — long audios (>15s) get a "please type" response
          const audioDuration = msg.message?.audioMessage?.seconds || msg.message?.pttMessage?.seconds || 0;
          if (audioDuration > 15) {
            const phone = extractPhone(msg);
            if (phone) await sendMsg(instanceName, phone, `Seu áudio ficou um pouquinho longo! 😅 Pode resumir em texto o que precisa? Fica mais fácil pra eu te ajudar certinho! 💬`, tenant.id);
            continue;
          }

          // Transcribe audio
          if (audioKey) {
            const audio = await fetchAudioBase64(instanceName, msg);
            if (audio) {
              const rawTranscription = await transcribeAudio(audioKey, audio.base64, audio.mimeType);
              if (rawTranscription) {
                // Cleanup: transform informal speech to structured text
                const cleanedText = await cleanupAudioTranscription(audioKey, rawTranscription);
                console.log(`[Audio] raw="${rawTranscription}" → cleaned="${cleanedText}"`);

                // Save pending audio in session and ask for confirmation
                const phone = extractPhone(msg);
                if (phone) {
                  const sess = await getSession(tenant.id, phone);
                  const sessData = sess?.data || {};
                  const sessHistory = sess?.history || [];
                  sessData._pendingAudioText = cleanedText;
                  sessData._pendingAudioRaw = rawTranscription;
                  await saveSession(tenant.id, phone, sessData, sessHistory);

                  const confirmMsg = `🎙️ Ouvi isso do seu áudio:\n\n_${cleanedText}_\n\nEstá correto? Responda *sim* para continuar ou digite o que quis dizer.`;
                  await sendMsg(instanceName, phone, confirmMsg, tenant.id);
                }
                continue; // Wait for confirmation before processing
              }
            }
          }

          // Transcription failed → ask for text
          if (!text) {
            const phone = extractPhone(msg);
            if (phone) await sendMsg(instanceName, phone, `Não consegui entender seu áudio 😅 Pode digitar sua mensagem? 💬`, tenant.id);
            continue;
          }
        }
      }

      // ── Persist media messages (image/video/doc/sticker) even without text ──
      if (!text) {
        const _mType = msg.messageType || msg.type || '';
        const _isImg = _mType === 'imageMessage' || !!msg.message?.imageMessage;
        const _isVid = _mType === 'videoMessage' || !!msg.message?.videoMessage;
        const _isDoc = _mType === 'documentMessage' || !!msg.message?.documentMessage;
        const _isStk = _mType === 'stickerMessage' || !!msg.message?.stickerMessage;
        if (_isImg || _isVid || _isDoc || _isStk) {
          const _mPhone = extractPhone(msg);
          if (_mPhone) {
            let _mBody = '[imagem]';
            if (_isImg) _mBody = msg.message?.imageMessage?.caption || '[imagem]';
            else if (_isVid) _mBody = msg.message?.videoMessage?.caption || '[vídeo]';
            else if (_isDoc) _mBody = '[documento]';
            else if (_isStk) _mBody = '[sticker]';
            EdgeRuntime.waitUntil(saveWaMsg(
              tenant.id, msgId || `${_mPhone}_${msg.messageTimestamp || Date.now()}`,
              _mPhone, _mBody, msg.messageTimestamp || Math.floor(Date.now() / 1000),
              msg.pushName || '', _mType, false,
              { key: msg.key, message: msg.message, messageType: msg.messageType }
            ));
          }
          continue;
        }
        continue;
      }
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

      // ── AI processing — only if aiActive ──────────────────────────
      if (!settings.aiActive) continue;

      // ── Plan gate: plano START não tem acesso ao agente IA ──────
      const tenantPlan = (tenant.plano || tenant.plan || 'START').toUpperCase();
      if (tenantPlan === 'START') continue;

      // Se aiLeadActive estiver desativado, ignora mensagens de números desconhecidos
      // Também verifica se a IA foi pausada manualmente para este lead específico
      const hasPausedCustomers = Object.values(settings.customerData).some(cd => cd?.aiPaused);
      const needsCustomerLookup = !settings.aiLeadActive || hasPausedCustomers;
      let resolvedCustomerId: string | null = null;
      if (needsCustomerLookup) {
        // Use suffix match (last 10 digits) — phone format may differ between
        // WhatsApp (5511999998888) and DB (11999998888)
        const phoneSuffix = phone.replace(/\D/g, '').slice(-10);
        const { data: custRows } = await supabase.from('customers')
          .select('id').eq('tenant_id', tenant.id).like('telefone', `%${phoneSuffix}`).limit(1);
        const existingCust = custRows?.[0] || null;
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
