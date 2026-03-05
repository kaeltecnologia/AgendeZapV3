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
const SESSION_TTL_MS = 30 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');

function capitalizeName(s: string): string {
  return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
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
    // prune old entries (fire-and-forget)
    (async () => { try { await supabase.from('msg_dedup').delete().lt('ts', new Date(Date.now() - 120_000).toISOString()); } catch {} })();
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
  tenantId?: string, phone?: string
): Promise<any | null> {
  const svcList = services.map(s => `• ${s.name} (${s.durationMinutes}min, R$${s.price.toFixed(2)}) — ID:"${s.id}"`).join('\n');
  const profList = professionals.length > 0 ? professionals.map(p => `• ${p.name} — ID:"${p.id}"`).join('\n') : '• (apenas um profissional disponível)';

  const known: string[] = [];
  if (data.clientName) known.push(`Nome: ${data.clientName}`);
  if (data.serviceName) known.push(`Serviço: ${data.serviceName}`);
  if (data.professionalName) known.push(`Profissional: ${data.professionalName}`);
  if (data.date) known.push(`Data: ${formatDate(data.date)}`);
  if (data.time) known.push(`Horário: ${data.time}`);

  const slotsSection = availableSlots?.length
    ? `\nHORÁRIOS DISPONÍVEIS (use APENAS estes):\n${availableSlots.slice(0, 12).map(s => `• ${s}`).join('\n')}`
    : (data.professionalId && data.date
      ? (data.serviceId
        ? '\n(Horários ainda não verificados — NÃO sugira horários específicos)'
        : '\n⚠️ SERVIÇO NÃO DEFINIDO — Descubra qual serviço o cliente quer ANTES de buscar horários. Pergunte o serviço agora.')
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
1️⃣ SERVIÇO → 2️⃣ PROFISSIONAL → 3️⃣ DIA → 4️⃣ HORÁRIO → 5️⃣ CONFIRMAÇÃO\n`;

  const behaviorRules = `
⛔ ARMADILHAS — NUNCA FAÇA:
• "Quero cortar amanhã" → NÃO agende sem profissional + horário confirmados
• "Tem horário hoje?" = CONSULTA, não pedido de agendamento → mostre opções disponíveis + "Quer agendar? Qual serviço?"
• "De manhã" / "de tarde" / "próxima semana" = tempo VAGO → mostre as opções daquele período/semana, nunca escolha por conta própria
• "Mesmo de sempre" → sem memória histórica → "Pode confirmar o serviço e horário preferido?"
• "Pode ser com o [prof]?" → faltam serviço + data + horário → pergunte antes de confirmar

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
• "Tem vaga hoje?" → mostre os horários disponíveis + "Qual serviço você quer?" — NÃO crie agendamento ainda

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

  const [ty, tm, td] = today.split('-').map(Number);
  const tomorrowDate = new Date(Date.UTC(ty, tm-1, td+1));
  const tomorrowISO = `${tomorrowDate.getUTCFullYear()}-${pad(tomorrowDate.getUTCMonth()+1)}-${pad(tomorrowDate.getUTCDate())}`;

  const prompt = `Você é o ATENDENTE DE WHATSAPP de "${tenantName}". Hoje é ${today} (${DOW_PT[new Date(today+'T12:00:00Z').getUTCDay()]}).
Atendente brasileiro — informal, caloroso, direto. Máximo 2-3 linhas por resposta.
${customSystemPrompt ? `\n--- REGRAS DO ESTABELECIMENTO ---\n${customSystemPrompt}\n---\n` : ''}${greetSection}
SERVIÇOS: ${svcList}
PROFISSIONAIS: ${profList}${slotsSection}

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

${isFirst && !shouldGreet ? '📥 PRIMEIRA MENSAGEM: processe tudo que o cliente já informou sem perguntar de novo.\n' : ''}
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

════════════════════════════════
EXTRAÇÃO:
════════════════════════════════
• Horários: "nove horas"→"09:00", "três da tarde"→"15:00", "meio dia"→"12:00"
• NUNCA repita perguntas sobre info já no CONTEXTO ATUAL
• Use horários SOMENTE da lista disponível
📅 DATAS (retorne SEMPRE em YYYY-MM-DD):
• "hoje" → ${today} | "amanhã" → ${tomorrowISO}
• Dia da semana (ex: "sábado") → calcule o PRÓXIMO a partir de hoje (${today}, ${DOW_PT[new Date(today+'T12:00:00Z').getUTCDay()]})
• Nunca extraia datas no passado — se o dia já passou esta semana, use a próxima semana

RESPONDA APENAS COM JSON VÁLIDO (sem markdown, sem \`\`\`):
{"reply":"...","extracted":{"clientName":null,"serviceId":null,"professionalId":null,"date":null,"time":null,"confirmed":null,"cancelled":null}}`;

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

// ── Send WhatsApp message ─────────────────────────────────────────────
async function sendMsg(instanceName: string, phone: string, text: string, tenantId?: string) {
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
      if (diff < 0 || (diff === 0 && isNext)) diff += 7;
      return addDays(diff);
    }
  }
  return null;
}

// ── Day of week in Portuguese ─────────────────────────────────────────
const DOW_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

// ── Professional name matcher ─────────────────────────────────────────
function matchProfessionalName(text: string, professionals: Array<{ id: string; name: string }>): { id: string; name: string } | null {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim();
  const normText = norm(text);
  for (const p of professionals) {
    if (normText.includes(norm(p.name))) return p;
  }
  for (const p of professionals) {
    const first = norm(p.name).split(' ')[0];
    if (first.length >= 3 && new RegExp(`\\b${first}\\b`).test(normText)) return p;
  }
  // Nickname/abbreviation: any word (4+ chars) in the message is a substring of a name part
  // e.g. "Lipe" inside "Felipe", "Beto" inside "Roberto"
  for (const p of professionals) {
    const nameParts = norm(p.name).split(' ');
    for (const word of normText.split(/\s+/).filter((w: string) => w.length >= 4)) {
      if (nameParts.some((part: string) => part.includes(word))) return p;
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
  const isReset = ['sair', 'reiniciar', 'recomeçar', 'recomecar', 'esquece', 'esquecer'].some(k => lowerText.includes(k));

  // Pre-check: user providing cancel reason
  const preSession = await getSession(tenantId, phone);
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
      const profIsOnVacation = (settings.breaks || []).some((b: any) => {
        if (b.professionalId && b.professionalId !== matched.id) return false;
        if (b.type !== 'vacation') return false;
        const vacStart: string = b.date || '';
        const vacEnd: string = b.vacationEndDate || b.date || '';
        return !!vacStart && todayISO >= vacStart && todayISO <= vacEnd;
      });
      if (profIsOnVacation) {
        const othersAvail = (professionals as any[])
          .filter((p: any) => p.id !== matched.id)
          .filter((p: any) => !(settings.breaks || []).some((b: any) => {
            if (b.professionalId && b.professionalId !== p.id) return false;
            if (b.type !== 'vacation') return false;
            const vs: string = b.date || '', ve: string = b.vacationEndDate || b.date || '';
            return !!vs && todayISO >= vs && todayISO <= ve;
          }));
        const othersStr = othersAvail.map((p: any) => p.name).join(' ou ');
        const vacMsg = `*${matched.name}* está de férias no momento! 🏖️\n\n${othersStr ? `Gostaria de agendar com ${othersStr}?` : 'Gostaria de agendar com outro profissional?'}`;
        session.history.push({ role: 'user', text });
        session.history.push({ role: 'bot', text: vacMsg });
        await sendMsg(instanceName, phone, vacMsg, tenantId);
        saveSession(tenantId, phone, session.data, session.history).catch(() => {});
        return;
      }

      if (professionals.length > 1) {
        // Multiple professionals: check for booking intent or personal-contact flow
        const normMsg2 = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '');
        const BOOK_KW2 = ['agendar', 'marcar', 'horario', 'reservar', 'procedimento', 'servico', 'corte', 'barba', 'agendamento'];
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
  if (!session.data.date) {
    const resolved = resolveRelativeDate(lowerText, todayISO);
    if (resolved) session.data.date = resolved;
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
    const _curProfOnVacWh = (settings.breaks || []).some((b: any) => {
      if (b.type !== 'vacation') return false;
      if (b.professionalId && b.professionalId !== session.data.professionalId) return false;
      const vs: string = b.date || '';
      const ve: string = b.vacationEndDate || b.date || '';
      return !!vs && todayISO >= vs && todayISO <= ve;
    });
    if (_curProfOnVacWh) {
      const _vacProfNameWh = session.data.professionalName || 'O profissional';
      const _othersAvailWh = professionals.filter((p: any) => p.id !== session.data.professionalId)
        .filter((p: any) => !(settings.breaks || []).some((b: any) => {
          if (b.type !== 'vacation') return false;
          if (b.professionalId && b.professionalId !== p.id) return false;
          const vs: string = b.date || '', ve: string = b.vacationEndDate || b.date || '';
          return !!vs && todayISO >= vs && todayISO <= ve;
        }));
      const _othersStrWh = _othersAvailWh.map((p: any) => p.name).join(' ou ');
      const _vacMsgWh = `*${_vacProfNameWh}* está de férias no momento! 🏖️\n\n${_othersStrWh ? `Gostaria de agendar com ${_othersStrWh}?` : 'Pode agendar quando o profissional retornar.'}`;
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
      'sim', 'ok', 'pode', 'certo', 'confirmado', 'quero', 'bora', 'beleza',
      'combinado', 'claro', 'perfeito', 'otimo', 'obrigado', 'obrigada', 'vlw',
      'valeu', 'vou', 'estarei', 'ta', 'yes', 'blz', 'show', 'tenho', 'posso',
      'afirmativo', 'ate la', 'to la', 'boa',
    ];
    const DENY_WORDS = [
      'nao', 'nope', 'negativo', 'impossivel', 'nao vou', 'nao consigo', 'nao quero',
      'cancela', 'cancelar',
    ];

    const wantsReschedule = RESCHEDULE_WORDS.some(k => fNorm.includes(k));
    const hasBookingKw    = wantsReschedule || ['agendar', 'marcar', 'horario', 'mudar', 'trocar', 'reagendar'].some(k => fNorm.includes(k));
    const isAffirm        = !hasBookingKw && AFFIRM_WORDS.some(a => fWds.includes(a) || fNorm === a) && fWds.length <= 8;
    const isDeny          = DENY_WORDS.some(d => fWds.includes(d)) && fWds.length <= 6;
    // Brazilian "Não, [affirmative]" filler: "nao" used as emphasis before affirming
    // e.g. "Não, tá confirmado, mais que confirmado, preciso cortar o cabelo"
    const denyAsFiller    = DENY_WORDS.some(d => fWds.includes(d)) && AFFIRM_WORDS.filter(a => fWds.includes(a)).length >= 2;

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

    // aviso/lembrete: rescheduling → find and offer slots
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

  // ─── Professional contact inquiry response ──────────────────────────
  if (session.data.pendingProfContact) {
    const { profId, profName, profPhone } = session.data.pendingProfContact as { profId: string; profName: string; profPhone: string };
    const normMsgPc = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '');
    const normWdsPc = normMsgPc.split(/\s+/);
    const BOOK_KW_PC = ['agendar', 'marcar', 'horario', 'reservar', 'procedimento', 'servico', 'corte', 'barba', 'agendamento'];
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

  // Prefetch slots only when service is known (duration required for accuracy)
  let prefetchedSlots: string[] | undefined;
  if (session.data.professionalId && session.data.date && session.data.serviceId) {
    const _slotDur = session.data.serviceDuration || 30;
    prefetchedSlots = await getAvailableSlots(tenantId, session.data.professionalId, session.data.date, _slotDur, settings);

    // Empty slots = vacation or fully booked — handle immediately before calling brain
    if (prefetchedSlots.length === 0) {
      const isVacation = (settings.breaks || []).some((b: any) => {
        if (b.professionalId && b.professionalId !== session.data.professionalId) return false;
        if (b.type !== 'vacation') return false;
        const vacStart = b.date || '';
        const vacEnd = b.vacationEndDate || b.date || '';
        return !!vacStart && session.data.date >= vacStart && session.data.date <= vacEnd;
      });
      const profName = session.data.professionalName || 'O profissional';
      if (isVacation) {
        const noAvail = `${profName} está de férias neste período! 🏖️\n\nGostaria de escolher outro profissional ou outra data?`;
        session.data.date = undefined;
        session.data.professionalId = undefined;
        session.data.professionalName = undefined;
        session.history.push({ role: 'bot', text: noAvail });
        await sendMsg(instanceName, phone, noAvail, tenantId);
        saveSession(tenantId, phone, session.data, session.history).catch(e => console.error('[Agent] saveSession err:', e));
        return;
      }
      // Fully booked — proactively check the next day
      const _bookedDate = session.data.date;
      const _nextDate = (() => {
        const d = new Date(_bookedDate + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        const p = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      })();
      const _nextDur = session.data.serviceDuration || (services.length > 0
        ? Math.min(...services.map((s: any) => s.durationMinutes || 30))
        : 30);
      const _nextSlots = await getAvailableSlots(tenantId, session.data.professionalId!, _nextDate, _nextDur, settings);
      if (_nextSlots.length > 0) {
        const _isToday = _bookedDate === todayISO;
        const _fullLabel = _isToday ? 'Hoje' : `Em ${formatDate(_bookedDate)}`;
        const _nextLabel = _isToday ? 'amanhã' : `em ${formatDate(_nextDate)}`;
        const noAvail = `${_fullLabel} o ${profName} está com a agenda cheia 😕 Mas ${_nextLabel} tem horário! Quer marcar?`;
        session.data.date = _nextDate;
        session.data.availableSlots = _nextSlots;
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

  // First brain call
  let brain = await callBrain(apiKey, tenantName, todayISO, services, professionalsVisible, session.history, session.data, prefetchedSlots, customPrompt || undefined, shouldGreet, brasiliaGreeting, tenantId, phone);
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

  // Re-run with real slots if we just got prof+date+service
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
    const brain2 = await callBrain(apiKey, tenantName, todayISO, services, professionalsVisible, session.history, session.data, newSlots, customPrompt || undefined, false, brasiliaGreeting, tenantId, phone);
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
        }
      }
    } catch (e) { console.error('[Agent] cancelled extraction error:', e); }
    await clearSession(tenantId, phone);
    session.history.push({ role: 'bot', text: brain.reply });
    await sendMsg(instanceName, phone, brain.reply, tenantId);
    return;
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

      await supabase.from('appointments').insert({
        tenant_id: tenantId,
        customer_id: customer.id,
        professional_id: session.data.professionalId,
        service_id: session.data.serviceId,
        inicio: startTimeStr,
        fim: endTimeStr,
        status: 'CONFIRMED',
        origem: 'AI',
        is_plan: false,
      });

      await clearSession(tenantId, phone);

      const confirmMsg =
        `✅ *Agendamento confirmado!*\n\n` +
        `📅 *Dia:* ${formatDate(session.data.date)}\n` +
        `⏰ *Horário:* ${session.data.time}\n` +
        `✂️ *Procedimento:* ${session.data.serviceName}\n` +
        `💈 *Profissional:* ${session.data.professionalName}\n\nTe esperamos! 😊`;
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

  if (shouldGreet) session.data.greetedAt = brasiliaDate;
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
      customerData: (fu._customerData || {}) as Record<string, { aiPaused?: boolean }>,
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
