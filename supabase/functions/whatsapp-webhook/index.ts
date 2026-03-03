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

// ── Dedup (shares msg_dedup table with browser polling) ──────────────
async function claimMsg(key: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('msg_dedup').insert({ fp: key });
    if (error?.code === '23505') return false; // already processed
    if (error) return true;  // table missing → fail open
    // prune old entries
    void supabase.from('msg_dedup')
      .delete().lt('ts', new Date(Date.now() - 120_000).toISOString()).catch(() => {});
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
    .neq('status', 'cancelado').gte('inicio', `${date}T00:00:00`).lte('inicio', `${date}T23:59:59`);

  const breaks: any[] = settings.breaks || [];
  const now = new Date();
  const todayLocal = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const isToday = date === todayLocal;
  const slots: string[] = [];
  let cursor = startH * 60 + startM;

  while (cursor + durationMinutes <= endH * 60 + endM) {
    const h = Math.floor(cursor / 60), m = cursor % 60;
    const label = `${pad(h)}:${pad(m)}`;
    const slotStart = new Date(`${date}T${label}:00`);
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);
    const slotEndLabel = `${pad(slotEnd.getHours())}:${pad(slotEnd.getMinutes())}`;

    if (isToday && slotStart <= now) { cursor += 30; continue; }
    const conflict = (appts || []).some((a: any) => new Date(a.inicio) < slotEnd && new Date(a.fim) > slotStart);
    if (conflict) { cursor += 30; continue; }
    const brk = breaks.some((b: any) => {
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

// ── AI Brain ─────────────────────────────────────────────────────────
async function callBrain(
  apiKey: string, tenantName: string, today: string,
  services: any[], professionals: any[],
  history: any[], data: any,
  availableSlots?: string[], customSystemPrompt?: string,
  shouldGreet?: boolean, brasiliaGreeting?: string
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
    : (data.professionalId && data.date ? '\n(Horários ainda não verificados — NÃO sugira horários específicos)' : '');

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

  const profSelectionRule = professionals.length > 1 && !data.professionalId
    ? `\n⚠️ PROFISSIONAL — ainda não definido. Profissionais disponíveis: ${professionals.map(p => `${p.name} (ID:"${p.id}")`).join(', ')}
• Se o cliente mencionou um nome NESTA MENSAGEM → extraia o professionalId e confirme.
• Se NÃO mencionou → pergunte: "Com qual profissional prefere? Temos: ${professionals.map(p => p.name).join(', ')}"
• NUNCA escolha sozinho. NUNCA repita a pergunta se o cliente já disse um nome.
• Se o cliente questionar uma escolha sua → "Desculpe! Com qual prefere? ${professionals.map(p => p.name).join(' ou ')}?" e retorne professionalId: null.\n`
    : '';

  const prompt = `Você é o ATENDENTE DE WHATSAPP de "${tenantName}". Hoje é ${today}.
Atendente brasileiro — informal, caloroso, direto. Máximo 2-3 linhas por resposta.
${customSystemPrompt ? `\n--- REGRAS DO ESTABELECIMENTO ---\n${customSystemPrompt}\n---\n` : ''}${greetSection}
SERVIÇOS: ${svcList}
PROFISSIONAIS: ${profList}${slotsSection}

CONTEXTO ATUAL: ${known.length > 0 ? known.join(' | ') : 'nenhuma informação coletada ainda'}
${data.pendingConfirm ? '\n⚠️ RESUMO JÁ MOSTRADO — se cliente afirmar ("sim","ok","pode","beleza","bora","fechou","isso","confirma") → "confirmed":true OBRIGATORIAMENTE.' : ''}

HISTÓRICO (mais recente no final):
${histStr}
${flowSection}${profSelectionRule}
════════════════════════════════
COMO RESPONDER:
════════════════════════════════

📏 FORMATO:
• Máximo 2-3 linhas • Tom informal brasileiro • 1 emoji no máximo • Sempre termine com pergunta

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
      return JSON.parse((await res.json()).choices?.[0]?.message?.content || 'null');
    } else {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } })
      });
      if (!res.ok) { console.error('[Brain] Gemini', res.status); return null; }
      return JSON.parse((await res.json()).candidates?.[0]?.content?.parts?.[0]?.text || 'null');
    }
  } catch (e) { console.error('[Brain] error:', e); return null; }
}

// ── Send WhatsApp message ─────────────────────────────────────────────
async function sendMsg(instanceName: string, phone: string, text: string) {
  await fetch(`${EVO_URL}/message/sendText/${instanceName}`, {
    method: 'POST', headers: EVO_HEADERS,
    body: JSON.stringify({ number: phone, text, linkPreview: false }),
  }).catch(e => console.error('[sendMsg] error:', e));
}

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

// ── Main agent logic ──────────────────────────────────────────────────
async function runAgent(tenant: any, phone: string, text: string, settings: any, pushName?: string) {
  const tenantId = tenant.id;
  const tenantName = tenant.nome || tenant.name || 'Barbearia';
  const instanceName = tenant.evolution_instance || `agz_${(tenant.slug || '').replace(/[^a-z0-9]/g, '')}`;

  // Key hierarchy: tenant key → global shared key → Gemini
  let apiKey = (settings.openaiApiKey || '').trim();
  if (!apiKey) {
    const { data: globalRows } = await supabase.from('global_settings').select('key, value').catch(() => ({ data: [] }));
    const sharedKey = ((globalRows || []).find((r: any) => r.key === 'shared_openai_key')?.value || '').trim();
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
          .eq('tenant_id', tenantId).eq('customer_id', customer.id).eq('status', 'confirmado')
          .gte('inicio', nowLocal).order('inicio', { ascending: true }).limit(1);
        if (appts && appts.length > 0) {
          await supabase.from('appointments').update({ status: 'cancelado' }).eq('id', appts[0].id);
          const dateFmt = new Date(appts[0].inicio.substring(0, 10) + 'T12:00:00')
            .toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
          await sendMsg(instanceName, phone, `✅ Agendamento de *${dateFmt}* cancelado!\n\nMotivo registrado. Obrigado pelo feedback! 😊`);
          return;
        }
      }
    } catch (e) { console.error('[Agent] cancel-reason error:', e); }
    await sendMsg(instanceName, phone, `Cancelamento registrado! Obrigado por nos avisar. 😊`);
    return;
  }

  if (isReset) {
    await clearSession(tenantId, phone);
    await sendMsg(instanceName, phone, `Tudo bem! Quando quiser agendar, é só me chamar. 😊`);
    return;
  }

  if (isCancellation) {
    const sess = preSession || { data: {}, history: [] };
    sess.data.pendingCancelReason = true;
    await saveSession(tenantId, phone, sess.data, sess.history);
    await sendMsg(instanceName, phone, `Que pena que precisou cancelar! 😕\n\nPode nos contar o motivo? Isso nos ajuda a melhorar o atendimento. 🙏`);
    return;
  }

  // Load data
  const [profsRes, svcsRes] = await Promise.all([
    supabase.from('professionals').select('id, nome, ativo').eq('tenant_id', tenantId).eq('ativo', true),
    supabase.from('services').select('id, nome, preco, duracao_minutos, ativo').eq('tenant_id', tenantId).eq('ativo', true),
  ]);

  const professionals = (profsRes.data || []).map((p: any) => ({ id: p.id, name: (p.nome || '').trim() }));
  const services = (svcsRes.data || []).map((s: any) => ({
    id: s.id, name: s.nome, durationMinutes: s.duracao_minutos, price: Number(s.preco || 0)
  }));

  const now = new Date();
  const todayISO = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;

  // Build custom system prompt with variable substitution
  let customPrompt = (settings.systemPrompt || '').trim();
  if (customPrompt) {
    const hoje = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
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

  // Professional name pre-extraction (TypeScript layer — more reliable than LLM)
  if (!session.data.professionalId && professionals.length > 1) {
    const matched = matchProfessionalName(lowerText, professionals);
    if (matched) {
      session.data.professionalId = matched.id;
      session.data.professionalName = matched.name;
    }
  }

  session.history.push({ role: 'user', text });

  // Prefetch slots if we know prof+date
  let prefetchedSlots: string[] | undefined;
  if (session.data.professionalId && session.data.date) {
    prefetchedSlots = await getAvailableSlots(tenantId, session.data.professionalId, session.data.date, session.data.serviceDuration || 60, settings);
  }

  // First brain call
  let brain = await callBrain(apiKey, tenantName, todayISO, services, professionals, session.history, session.data, prefetchedSlots, customPrompt || undefined, shouldGreet, brasiliaGreeting);
  if (!brain) {
    const fallback = `Desculpe, tive um problema técnico. Pode repetir? 😅`;
    session.history.push({ role: 'bot', text: fallback });
    await saveSession(tenantId, phone, session.data, session.history);
    await sendMsg(instanceName, phone, fallback);
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

  // Re-run with real slots if we just got prof+date
  const justGotProfAndDate = !prefetchedSlots && session.data.professionalId && session.data.date;
  if (justGotProfAndDate) {
    const newSlots = await getAvailableSlots(tenantId, session.data.professionalId!, session.data.date!, session.data.serviceDuration || 60, settings);
    if (newSlots.length === 0) {
      const msg = `Que pena! Não tem horário disponível em ${formatDate(session.data.date!)} com ${session.data.professionalName}. 😕\n\nPara qual outro dia você prefere?`;
      session.data.date = undefined;
      session.history.push({ role: 'bot', text: msg });
      await saveSession(tenantId, phone, session.data, session.history);
      await sendMsg(instanceName, phone, msg);
      return;
    }
    const brain2 = await callBrain(apiKey, tenantName, todayISO, services, professionals, session.history, session.data, newSlots, customPrompt || undefined, false, brasiliaGreeting);
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

  // Handle booking
  if (brain.extracted.confirmed === true && session.data.serviceId && session.data.professionalId && session.data.date && session.data.time) {
    try {
      // Find or create customer
      let { data: customer } = await supabase.from('customers').select('id')
        .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
      if (!customer) {
        const { data: newC } = await supabase.from('customers')
          .insert({ tenant_id: tenantId, telefone: phone, nome: session.data.clientName || pushName || 'Cliente' })
          .select('id').single();
        customer = newC;
      }

      const startTimeStr = `${session.data.date}T${session.data.time}:00`;
      const endTime = new Date(startTimeStr);
      endTime.setMinutes(endTime.getMinutes() + (session.data.serviceDuration || 60));
      const endTimeStr = `${session.data.date}T${pad(endTime.getHours())}:${pad(endTime.getMinutes())}:00`;

      await supabase.from('appointments').insert({
        tenant_id: tenantId,
        customer_id: customer.id,
        professional_id: session.data.professionalId,
        service_id: session.data.serviceId,
        inicio: startTimeStr,
        fim: endTimeStr,
        status: 'confirmado',
        origem: 'ai',
        is_plan: false,
      });

      await clearSession(tenantId, phone);
      await sendMsg(instanceName, phone,
        `✅ *Agendamento confirmado!*\n\n` +
        `📅 *Dia:* ${formatDate(session.data.date)}\n` +
        `⏰ *Horário:* ${session.data.time}\n` +
        `✂️ *Procedimento:* ${session.data.serviceName}\n` +
        `💈 *Profissional:* ${session.data.professionalName}\n\nTe esperamos! 😊`
      );
      return;
    } catch (e) {
      console.error('[Agent] booking error:', e);
      await sendMsg(instanceName, phone, `Ocorreu um erro ao confirmar. Por favor, tente novamente.`);
      return;
    }
  }

  // Set pendingConfirm when all info is known
  if (session.data.serviceId && session.data.professionalId && session.data.date && session.data.time) {
    session.data.pendingConfirm = true;
  }

  if (shouldGreet) session.data.greetedAt = brasiliaDate;
  session.history.push({ role: 'bot', text: brain.reply });
  await saveSession(tenantId, phone, session.data, session.history);
  await sendMsg(instanceName, phone, brain.reply);
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
      openaiApiKey: fu._openaiApiKey || '',
      systemPrompt: fu._systemPrompt || '',
      operatingHours: settingsRow?.operating_hours || fu._operatingHours || {},
      breaks: fu._breaks || [],
      msgBufferSecs: fu._msgBufferSecs ?? 30,
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
            const { data: gRows } = await supabase.from('global_settings').select('key, value').catch(() => ({ data: [] }));
            audioKey = ((gRows || []).find((r: any) => r.key === 'shared_openai_key')?.value || '').trim() || (tenant.gemini_api_key || '').trim();
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
            if (phone) await sendMsg(instanceName, phone, `Recebi seu áudio! 🎵 Pode digitar sua mensagem? 😊`);
            continue;
          }
        }
      }

      if (!text) continue;
      const phone = extractPhone(msg);
      if (!phone) continue;

      await runAgent(tenant, phone, text, settings, msg.pushName).catch(e =>
        console.error('[Webhook] runAgent error:', e)
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
