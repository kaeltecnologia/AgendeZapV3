/**
 * AgendeZap — Agente Conversacional para Profissionais
 *
 * Identifica o profissional pelo número do WhatsApp. Nenhuma consulta é
 * respondida sem validação de perfil.
 *
 * Regras de Permissão:
 *   admin  → acesso total: agenda/histórico de qualquer profissional, faturamento
 *            total, faturamento individual, quantidade de cortes por profissional,
 *            ranking, comissão de qualquer profissional, despesas, lucro, margem, metas.
 *   colab  → acesso restrito: apenas própria agenda, histórico, quantidade de cortes,
 *            faturamento pessoal e comissão pessoal.
 *
 * Regra de Bloqueio:
 *   Colaborador NÃO pode: ver agenda/faturamento de outro profissional, ranking,
 *   faturamento total, despesas, lucro, fazer comparações entre profissionais.
 *   Resposta de bloqueio: "Você não possui permissão para consultar esse tipo de informação."
 *
 * Regra de Respostas Estruturadas:
 *   Todas as respostas são objetivas, baseadas apenas em dados do sistema,
 *   sem opiniões, sem comentários adicionais, com valores exatos e datas específicas.
 */

import { supabase } from './supabase';
import { db } from './mockDb';
import { GoogleGenAI, Type } from '@google/genai';
import { AppointmentStatus, BookingSource } from '../types';

// =====================================================================
// CONSTANTS
// =====================================================================

const ACCESS_DENIED = 'Você não possui permissão para consultar esse tipo de informação.';

// ── In-process dedup: prevents double-responses when both Edge Function
// webhook AND polling manager process the same message simultaneously ──
const _profDedup = new Map<string, number>(); // key → timestamp
const _PROF_DEDUP_TTL = 30_000; // 30 seconds

// Intents that are exclusively for admin
const ADMIN_ONLY_INTENTS: ProfIntentType[] = ['FINANCIAL', 'EXPENSES', 'PROFIT', 'RANKING', 'GOALS'];

// =====================================================================
// HELPERS
// =====================================================================

const _pad = (n: number) => String(n).padStart(2, '0');

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
}

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
}

function datePT(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit',
  });
}

// =====================================================================
// PROFESSIONAL SESSION (pending booking confirmation)
// =====================================================================

interface PendingBook {
  clientName: string;
  date: string;
  suggestedTime: string;
  serviceId: string;
  serviceName: string;
  serviceDuration: number;
  profId: string;
}

interface ProfSession {
  pendingBook: PendingBook | null;
  updatedAt: number;
}

const profSessions = new Map<string, ProfSession>();
const PROF_SESSION_TTL = 5 * 60 * 1000; // 5 minutes

function getProfSession(tenantId: string, phone: string): ProfSession {
  const key = `${tenantId}::${phone}`;
  const s = profSessions.get(key);
  if (!s || Date.now() - s.updatedAt > PROF_SESSION_TTL) return { pendingBook: null, updatedAt: 0 };
  return s;
}

function saveProfSession(tenantId: string, phone: string, session: ProfSession) {
  profSessions.set(`${tenantId}::${phone}`, { ...session, updatedAt: Date.now() });
}

function clearProfSession(tenantId: string, phone: string) {
  profSessions.delete(`${tenantId}::${phone}`);
}

// =====================================================================
// INTENT CLASSIFICATION
// =====================================================================

type ProfIntentType =
  | 'LIST_APPOINTMENTS'  // agenda (colab: própria; admin: qualquer)
  | 'AVAILABLE_SLOTS'    // horários livres/disponíveis (colab: própria; admin: qualquer)
  | 'COUNT_PROCEDURES'   // contagem de atendimentos + receita própria (colab: própria; admin: qualquer)
  | 'BOOK'               // agendar cliente
  | 'CONFIRM_BOOK'       // confirmar agendamento pendente
  | 'FINANCIAL'          // faturamento total/breakdown da barbearia (admin only)
  | 'COMMISSION'         // comissão (colab: própria; admin: qualquer)
  | 'EXPENSES'           // despesas/gastos (admin only)
  | 'PROFIT'             // lucro/margem/resultado (admin only)
  | 'RANKING'            // ranking de atendimentos entre profissionais (admin only)
  | 'GOALS'              // metas mensais de desempenho (admin only)
  | 'HELP';

interface ProfIntent {
  intent: ProfIntentType;
  /** 'today' | 'tomorrow' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'YYYY-MM-DD' */
  dateRef: string;
  clientName: string;
  time: string;         // HH:mm
  serviceRef: string;   // service name hint (optional)
  targetProfName: string; // admin asking about a specific professional
}

/** Resolve dateRef from raw text — works with or without accents */
function resolveDateRefFromText(lower: string): string {
  if (lower.includes('amanhã') || lower.includes('amanha')) return 'tomorrow';
  if (lower.includes('semana pass') || lower.includes('semana anterior')) return 'last_week';
  if (lower.includes('essa semana') || lower.includes('esta semana') || lower.includes('semana atual')) return 'this_week';
  if (lower.includes('mes pass') || lower.includes('mês pass') || lower.includes('mes anterior') || lower.includes('mês anterior')) return 'last_month';
  if (lower.includes('esse mes') || lower.includes('este mes') || lower.includes('esse mês') || lower.includes('este mês') || lower.includes('mes atual') || lower.includes('mês atual')) return 'this_month';
  if (lower.includes('hoje')) return 'today';
  const DAYS: [string, string][] = [['domingo','0'],['segunda','1'],['terca','2'],['terça','2'],['quarta','3'],['quinta','4'],['sexta','5'],['sabado','6'],['sábado','6']];
  for (const [name] of DAYS) if (lower.includes(name)) return name;
  return 'today';
}

async function classifyIntent(text: string, apiKey: string, today: string): Promise<ProfIntent> {
  const fallback: ProfIntent = { intent: 'HELP', dateRef: 'today', clientName: '', time: '', serviceRef: '', targetProfName: '' };
  const lower = text.toLowerCase().trim();

  // 1. Confirmation (always rule-based)
  if (/^(sim|yes|confirma|confirmado|pode|ok|bora|s|yep)[\s!.]*$/.test(lower)) {
    return { ...fallback, intent: 'CONFIRM_BOOK' };
  }

  // 2. Numbered shortcuts
  const shortcutMatch = lower.match(/^([1-9])\s*(.*)/s);
  if (shortcutMatch) {
    const num = shortcutMatch[1];
    const rest = shortcutMatch[2].trim();
    const shortDateRef = rest ? resolveDateRefFromText(rest) : 'today';
    if (num === '1') return { ...fallback, intent: 'LIST_APPOINTMENTS', dateRef: shortDateRef };
    if (num === '2') return { ...fallback, intent: 'COUNT_PROCEDURES', dateRef: shortDateRef };
    if (num === '4') return { ...fallback, intent: 'FINANCIAL', dateRef: shortDateRef };
    if (num === '5') return { ...fallback, intent: 'COMMISSION', dateRef: shortDateRef };
    if (num === '6') return { ...fallback, intent: 'EXPENSES', dateRef: shortDateRef };
    if (num === '7') return { ...fallback, intent: 'PROFIT', dateRef: shortDateRef };
    if (num === '8') return { ...fallback, intent: 'RANKING', dateRef: shortDateRef };
    if (num === '9') return { ...fallback, intent: 'GOALS', dateRef: shortDateRef };
    if (num === '3') {
      const timeMatch = rest.match(/(\d{1,2})[h:](\d{2})?/);
      const parsedTime = timeMatch
        ? `${timeMatch[1].padStart(2, '0')}:${(timeMatch[2] || '00').padStart(2, '0')}`
        : '';
      const bookDateRef = resolveDateRefFromText(rest);
      // Extract target professional: "com Gil", "para o Gil", "pro Gil"
      const bookProfMatch = rest.match(/(?:\bcom\s+(?:o|a)?\s*|\bpara\s+(?:o|a)\s*|\bpro\s+)([a-záéíóúàèìòùâêîôûãõçäëïöü]+)/i);
      const targetProfNameBook = bookProfMatch ? bookProfMatch[1].trim() : '';
      const clientName = rest
        .replace(/(\d{1,2})[h:]\d{0,2}/g, '')
        .replace(/\b(amanha|amanhã|hoje|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo|essa semana|esta semana)\b/gi, '')
        .replace(bookProfMatch?.[0] || '\x00', '')
        .trim();
      return { ...fallback, intent: 'BOOK', clientName, time: parsedTime, dateRef: bookDateRef, targetProfName: targetProfNameBook };
    }
  }

  const dateRef = resolveDateRefFromText(lower);

  // 3. Context continuations: "e o irineu?" / "e a maria?"
  if (/^e\s+(o|a|os|as)\s+/.test(lower)) {
    const nameMatch = lower.match(/^e\s+(?:o|a|os|as)\s+([\w\s]+?)[\?\!\.\s]*$/);
    if (nameMatch) {
      const target = nameMatch[1].trim();
      if (/^outros(\s+barbeiros?)?$/.test(target) || target === 'outras') {
        return { ...fallback, intent: 'LIST_APPOINTMENTS', targetProfName: '__ALL__', dateRef };
      }
      return { ...fallback, intent: 'LIST_APPOINTMENTS', targetProfName: target, dateRef };
    }
  }

  // 4. Try Gemini for rich entity extraction
  if (apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const resp = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents:
          `Hoje é ${today}. Um profissional de barbearia enviou: "${text}"\n` +
          `Classifique a intenção. Intents disponíveis:\n` +
          `- LIST_APPOINTMENTS: agenda/horários ocupados (ex: "quem atendo hoje?", "minha agenda amanhã", "horários do Gil amanhã", "agenda da Maria hoje")\n` +
          `- AVAILABLE_SLOTS: horários LIVRES/disponíveis (ex: "horários disponíveis do Gil", "que horas tem livre hoje?", "vagas do Carlos amanhã", "horários vagos")\n` +
          `- COUNT_PROCEDURES: contagem de procedimentos/faturamento próprio (ex: "quantos cortes fiz?", "quanto eu faturei?")\n` +
          `- BOOK: agendar cliente (ex: "marca João sexta às 10h", "marca João sexta às 10h com Gil", "marca João sexta às 10h pro Carlos")\n` +
          `- FINANCIAL: faturamento total da barbearia (ex: "faturamento do mês", "quanto faturamos?")\n` +
          `- COMMISSION: comissão do profissional (ex: "qual minha comissão?", "comissão do Carlos")\n` +
          `- EXPENSES: despesas/gastos (ex: "quais as despesas?", "quanto gastamos em produto?")\n` +
          `- PROFIT: lucro/margem/resultado (ex: "qual o lucro?", "qual a margem?", "resultado do mês")\n` +
          `- RANKING: ranking/comparação entre profissionais (ex: "quem mais atendeu?", "ranking do mês", "quem é o melhor?")\n` +
          `- GOALS: metas de desempenho (ex: "como estão as metas?", "qual minha meta?", "atingimos a meta?")\n` +
          `- HELP: quando não identificar claramente\n` +
          `dateRef: 'today','tomorrow','this_week','last_week','this_month','last_month' ou YYYY-MM-DD.\n` +
          `targetProfName: nome do profissional alvo extraído da mensagem (ex: "do Gil"→"Gil", "da Maria"→"Maria", "com o Carlos"→"Carlos", "pro Gil"→"Gil"). Vazio se for próprio, '__ALL__' se for todos/geral.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              intent: { type: Type.STRING, enum: ['LIST_APPOINTMENTS', 'AVAILABLE_SLOTS', 'COUNT_PROCEDURES', 'BOOK', 'FINANCIAL', 'COMMISSION', 'EXPENSES', 'PROFIT', 'RANKING', 'GOALS', 'HELP'] },
              dateRef: { type: Type.STRING },
              clientName: { type: Type.STRING },
              time: { type: Type.STRING },
              serviceRef: { type: Type.STRING },
              targetProfName: { type: Type.STRING }
            },
            required: ['intent', 'dateRef', 'clientName', 'time', 'serviceRef', 'targetProfName']
          }
        }
      });
      const parsed = JSON.parse(resp.text || '{}');
      if (parsed.intent && parsed.intent !== 'HELP') {
        return { ...fallback, ...parsed };
      }
    } catch (err) {
      console.warn('[ProfAgent] Gemini classifyIntent failed, falling back to rules:', err);
    }
  }

  // 5. Rule-based fallback
  const profNameMatch = lower.match(/(?:\bo\b|\ba\b)\s+([a-záéíóúàèìòùâêîôûãõçäëïöü]+)\s+(?:fez|atendeu|teve|realizou|tem|agendou)/);
  // Also extract "do Gil", "da Maria", "do Carlos" patterns
  const profNameMatchDo = lower.match(/(?:\bdo\b|\bda\b)\s+([a-záéíóúàèìòùâêîôûãõçäëïöü]+)/);
  const extractedProfName = profNameMatch ? profNameMatch[1] : (profNameMatchDo ? profNameMatchDo[1] : '');

  // Ranking / comparison detection (must come before COUNT_PROCEDURES to avoid misclassification)
  if (/ranking|quem mais|quem menos|quem foi o melhor|compar(ar|e|a)|melhor profissional|melhor barbeiro/.test(lower)) {
    return { ...fallback, intent: 'RANKING', dateRef };
  }

  // Expenses
  if (/\bdespesas?\b|\bgastos?\b|\bcustos?\b|\bpagamentos?\b.*\(produto|aluguel|material\)/.test(lower)) {
    return { ...fallback, intent: 'EXPENSES', dateRef };
  }

  // Profit / margin
  if (/\blucro\b|\bmargem\b|\bresultado\b|\bsaldo\b|\bl[ií]quido\b/.test(lower)) {
    return { ...fallback, intent: 'PROFIT', dateRef };
  }

  // Goals
  if (/\bmeta[s]?\b|\bobjetivo[s]?\b|\balvo\b|\batingi|\batingimos\b|\bquanto falta\b/.test(lower)) {
    return { ...fallback, intent: 'GOALS', dateRef };
  }

  // Commission
  if (/comiss[aã]o|comissoes|comissões|\brepasse\b|\bporcentagem\b|\btaxa\b.*\bprofissional\b|\bquanto fico\b|\bquanto eu fico\b/.test(lower)) {
    return { ...fallback, intent: 'COMMISSION', dateRef, targetProfName: extractedProfName };
  }

  // Available slots (must come BEFORE list appointments — "disponível/livre/vago" = free slots)
  if (/dispon[ií]ve[il]|livre[s]?|\bvago[s]?\b|\bvaga[s]?\b|\baberto[s]?\b|tem hora|tem hor[aá]rio/.test(lower)) {
    return { ...fallback, intent: 'AVAILABLE_SLOTS', dateRef, targetProfName: extractedProfName };
  }

  // Agenda/appointments (booked)
  if (/atend|agenda|horari|horári|quem vou|minha agenda|tenho hora|meus clien|meu dia|quais agend|para hoje|pra hoje|para amanha|pra amanha/.test(lower)) {
    return { ...fallback, intent: 'LIST_APPOINTMENTS', dateRef, targetProfName: extractedProfName };
  }

  // Count / own faturamento
  if (/quantos|quantas|\bfiz\b|\brealizei\b|procedimento|atendimento|quantid|total de|quanto\s+o|quanto\s+a|quanto eu|quanto fiz|quanto realizei|meu faturamento|faturei/.test(lower)) {
    return { ...fallback, intent: 'COUNT_PROCEDURES', dateRef, targetProfName: extractedProfName };
  }

  // Book — extract clientName, time, and target professional
  if (/\bmarca\b|\bmarcar\b|\bagendar\b|reserv|\bcadastra\b|anota|registra/.test(lower)) {
    const bookProfMatchFb = lower.match(/(?:\bcom\s+(?:o|a)?\s*|\bpara\s+(?:o|a)\s*|\bpro\s+)([a-záéíóúàèìòùâêîôûãõçäëïöü]+)/i);
    const targetProfFb = bookProfMatchFb ? bookProfMatchFb[1].trim() : '';
    // Extract time (supports: 8h, 8:30, 8h30, 8.30, 20:40, 20h40)
    const timeFbM = lower.match(/\b(\d{1,2})[h:.](\d{2})\b/) || lower.match(/\b(\d{1,2})h\b/);
    const timeFb = timeFbM
      ? timeFbM[2]
        ? `${timeFbM[1].padStart(2, '0')}:${timeFbM[2]}`
        : `${timeFbM[1].padStart(2, '0')}:00`
      : '';
    // Extract clientName: strip trigger, time, date keywords, prof reference, prepositions
    const clientFb = lower
      .replace(/\b(marca|marcar|agendar|reservar|cadastrar|anotar|registrar)\b/gi, '')
      .replace(/\b(\d{1,2})[h:.](\d{2})\b/g, '')
      .replace(/\b(\d{1,2})h\b/gi, '')
      .replace(/\b(amanha|amanhã|hoje|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)\b/gi, '')
      .replace(bookProfMatchFb?.[0] ?? '\x00', '')
      .replace(/\b(as|às|pra|para|no|na|de|do|da|pro|pros)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return { ...fallback, intent: 'BOOK', clientName: clientFb, time: timeFb, dateRef, targetProfName: targetProfFb };
  }

  // Financial (total barbearia)
  if (/faturamento|receita|financeiro|dinheiro.*total|total.*barbearia|quanto fiz|quanto ganhei|quanto recebi/.test(lower)) {
    return { ...fallback, intent: 'FINANCIAL', dateRef };
  }

  return fallback;
}

// =====================================================================
// DATE RANGE RESOLVER
// =====================================================================

interface DateRange { start: string; end: string; label: string; }

function resolveDateRange(dateRef: string): DateRange {
  const now = new Date();
  const today = todayISO();

  switch (dateRef) {
    case 'today':
      return { start: today, end: today, label: 'hoje' };

    case 'tomorrow': {
      const t = isoOffset(1);
      return { start: t, end: t, label: 'amanhã' };
    }

    case 'this_week': {
      const dow = now.getDay();
      const monday = isoOffset(-(dow === 0 ? 6 : dow - 1));
      const sunday = isoOffset(7 - (dow === 0 ? 7 : dow));
      return { start: monday, end: sunday, label: 'esta semana' };
    }

    case 'last_week': {
      const dow = now.getDay();
      const daysToLastMonday = (dow === 0 ? 6 : dow - 1) + 7;
      const lastMonday = isoOffset(-daysToLastMonday);
      const lastSunday = isoOffset(-daysToLastMonday + 6);
      return { start: lastMonday, end: lastSunday, label: 'semana passada' };
    }

    case 'this_month': {
      const start = `${now.getFullYear()}-${_pad(now.getMonth() + 1)}-01`;
      return { start, end: today, label: 'este mês' };
    }

    case 'last_month': {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        start: `${lm.getFullYear()}-${_pad(lm.getMonth() + 1)}-01`,
        end: `${lmEnd.getFullYear()}-${_pad(lmEnd.getMonth() + 1)}-${_pad(lmEnd.getDate())}`,
        label: 'mês passado'
      };
    }

    default: {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateRef))
        return { start: dateRef, end: dateRef, label: datePT(dateRef) };
      const WEEKDAY_NAMES: Record<string, number> = {
        'domingo': 0, 'segunda': 1, 'terca': 2, 'terça': 2,
        'quarta': 3, 'quinta': 4, 'sexta': 5, 'sabado': 6, 'sábado': 6
      };
      if (WEEKDAY_NAMES[dateRef] !== undefined) {
        const target = WEEKDAY_NAMES[dateRef];
        const d = new Date();
        // If today IS that weekday (diff=0), use today; otherwise next occurrence
        const diff = (target - d.getDay() + 7) % 7;
        d.setDate(d.getDate() + diff);
        const iso = `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
        return { start: iso, end: iso, label: datePT(iso) };
      }
      return { start: today, end: today, label: 'hoje' };
    }
  }
}

// =====================================================================
// SLOT AVAILABILITY (mirrors agentService logic)
// =====================================================================

async function getAvailableSlots(
  tenantId: string, profId: string, date: string, durationMinutes: number, settings: any
): Promise<string[]> {
  const dateObj = new Date(date + 'T12:00:00');
  const dayIndex = dateObj.getDay();
  const dayConfig = settings.operatingHours?.[dayIndex];
  if (!dayConfig?.active) return [];

  // Férias: retorna vazio se profissional está de férias nesta data
  const isOnVacation = (settings.breaks || []).some((b: any) => {
    if (b.professionalId && b.professionalId !== profId) return false;
    if (b.type !== 'vacation') return false;
    const vacStart = b.date || '';
    const vacEnd = b.vacationEndDate || b.date || '';
    return !!vacStart && date >= vacStart && date <= vacEnd;
  });
  if (isOnVacation) return [];

  const [startRange, endRange] = dayConfig.range.split('-');
  const [startH, startM] = startRange.split(':').map(Number);
  const [endH, endM] = endRange.split(':').map(Number);

  const { data: appts } = await supabase
    .from('appointments')
    .select('inicio, fim')
    .eq('tenant_id', tenantId)
    .eq('professional_id', profId)
    .neq('status', AppointmentStatus.CANCELLED)
    .gte('inicio', `${date}T00:00:00`)
    .lte('inicio', `${date}T23:59:59`);

  const now = new Date();
  const isToday = date === todayISO();
  const INTERVAL = 30;
  const slots: string[] = [];

  let cursor = startH * 60 + startM;
  const endCursor = endH * 60 + endM;
  const loopLimit = dayConfig.acceptLastSlot ? endCursor : endCursor - durationMinutes;

  while (cursor <= loopLimit) {
    const h = Math.floor(cursor / 60);
    const m = cursor % 60;
    const label = `${_pad(h)}:${_pad(m)}`;
    const slotStart = new Date(`${date}T${label}:00`);
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);

    if (isToday && slotStart <= now) { cursor += INTERVAL; continue; }

    const BUFFER_MS = 11 * 60 * 1000;
    const conflict = (appts || []).some((a: any) => {
      const aStart = new Date(a.inicio);
      const aEnd = new Date(a.fim);
      if (!(aStart < slotEnd && aEnd > slotStart)) return false;
      return slotStart.getTime() < aEnd.getTime() - BUFFER_MS;
    });
    if (!conflict) slots.push(label);
    cursor += INTERVAL;
  }

  return slots;
}

// =====================================================================
// HANDLERS
// =====================================================================

async function handleListAppointments(
  tenantId: string, profId: string | null, range: DateRange, customers: any[], services: any[], professionals?: any[]
): Promise<string> {
  const appointments = await db.getAppointments(tenantId);

  const filtered = appointments
    .filter(a => {
      const d = a.startTime.split('T')[0];
      return (profId === null || a.professional_id === profId) &&
        d >= range.start && d <= range.end &&
        a.status !== AppointmentStatus.CANCELLED;
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  if (filtered.length === 0) return `Nenhum agendamento ${range.label}.`;

  const byDate = new Map<string, typeof filtered>();
  for (const a of filtered) {
    const d = a.startTime.split('T')[0];
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(a);
  }

  const lines: string[] = [];
  for (const [d, apps] of byDate) {
    if (byDate.size > 1) lines.push(`\n*${datePT(d)}*`);
    for (const a of apps) {
      const time = a.startTime.split('T')[1]?.substring(0, 5) || '??:??';
      const customer = customers.find(c => c.id === a.customer_id);
      const service = services.find(s => s.id === a.service_id);
      const status = a.status === AppointmentStatus.CONFIRMED ? '✅' : '🕐';
      const profName = profId === null && professionals
        ? (professionals.find(p => p.id === a.professional_id)?.name || 'Profissional')
        : null;
      const profTag = profName ? ` [${profName}]` : '';
      lines.push(`${status} *${time}* — ${customer?.name || 'Cliente'} (${service?.name || 'Serviço'})${profTag}`);
    }
  }

  const header = byDate.size === 1 ? `Agendamentos ${range.label}:` : `Agendamentos — ${range.label}:`;
  return `${header}\n${lines.join('\n')}`;
}

async function handleAvailableSlots(
  tenantId: string, profId: string | null, range: DateRange, settings: any, professionals: any[]
): Promise<string> {
  // Determine which professionals to show slots for
  const targetProfs = profId
    ? professionals.filter(p => p.id === profId && p.active)
    : professionals.filter(p => p.active);

  if (targetProfs.length === 0) return 'Profissional não encontrado.';

  // For ranges spanning multiple days, iterate each day
  const startDate = new Date(range.start + 'T12:00:00');
  const endDate = new Date(range.end + 'T12:00:00');
  const allLines: string[] = [];
  const days: string[] = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    days.push(`${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`);
  }
  // Cap at 7 days to avoid huge responses
  const daysToShow = days.slice(0, 7);

  for (const day of daysToShow) {
    const dayLines: string[] = [];
    for (const p of targetProfs) {
      const slots = await getAvailableSlots(tenantId, p.id, day, 30, settings);
      if (slots.length === 0) continue;
      const profTag = targetProfs.length > 1 ? ` [${p.name}]` : '';
      dayLines.push(`${profTag ? `*${p.name}*: ` : ''}${slots.join(', ')}`);
    }
    if (dayLines.length > 0) {
      if (daysToShow.length > 1) allLines.push(`\n*${datePT(day)}*`);
      allLines.push(...dayLines);
    }
  }

  if (allLines.length === 0) return `Nenhum horário disponível ${range.label}.`;

  const profName = targetProfs.length === 1 ? ` do ${targetProfs[0].name}` : '';
  const header = `Horários disponíveis${profName} ${range.label}:`;
  return `${header}\n${allLines.join('\n')}`;
}

async function handleCountProcedures(
  tenantId: string, profId: string | null, range: DateRange
): Promise<string> {
  const appointments = await db.getAppointments(tenantId);
  const filtered = appointments.filter(a => {
    const d = a.startTime.split('T')[0];
    return (profId === null || a.professional_id === profId) &&
      d >= range.start && d <= range.end &&
      a.status === AppointmentStatus.FINISHED;
  });

  const total = filtered.length;
  const revenue = filtered.reduce((acc, a) => acc + (a.amountPaid || 0), 0);

  return (
    `*${range.label.charAt(0).toUpperCase() + range.label.slice(1)}:*\n\n` +
    `✂️ *${total}* procedimento${total !== 1 ? 's' : ''} realizados\n` +
    `💰 Faturamento: *R$ ${revenue.toFixed(2)}*`
  );
}

async function handleBook(
  tenantId: string, callerProf: any, targetProf: any, intent: ProfIntent, settings: any, phone: string
): Promise<string> {
  const { clientName, time, serviceRef } = intent;

  if (!clientName.trim()) {
    const profHint = targetProf.id !== callerProf.id ? ` com ${targetProf.name}` : '';
    return `Para marcar, informe o nome do cliente.\nEx: _"marca João quinta às 10h${profHint}"_`;
  }

  let parsedTime = time?.trim() || '';
  // Normalize dot notation: "8.30" → "8:30", "20.30" → "20:30"
  parsedTime = parsedTime.replace(/^(\d{1,2})\.(\d{2})$/, '$1:$2');
  if (!parsedTime || !parsedTime.includes(':')) {
    const m = parsedTime.match(/^(\d{1,2})h?(\d{2})?$/);
    if (m) parsedTime = `${m[1].padStart(2, '0')}:${(m[2] || '00').padStart(2, '0')}`;
    else return `Horário não identificado. Informe assim: _"marca João quinta às 10h"_`;
  }

  const range = resolveDateRange(intent.dateRef);
  const date = range.start;

  const services = await db.getServices(tenantId);
  let service = serviceRef
    ? services.find(s => s.active && s.name.toLowerCase().includes(serviceRef.toLowerCase()))
    : null;
  if (!service) service = services.find(s => s.active);
  if (!service) return `Nenhum serviço cadastrado. Configure um serviço no painel.`;

  const startTimeStr = `${date}T${parsedTime}:00`;
  const startTime = new Date(startTimeStr);

  const { available, reason } = await db.isSlotAvailable(tenantId, targetProf.id, startTime, service.durationMinutes);

  if (!available) {
    const slots = await getAvailableSlots(tenantId, targetProf.id, date, service.durationMinutes, settings);
    const nearest = slots.find(s => s >= parsedTime) || slots[0];

    if (!nearest) {
      return (
        `❌ *${parsedTime}* indisponível em *${datePT(date)}*.\n` +
        `_Motivo: ${reason}_\n\n` +
        `Sem horários disponíveis neste dia.`
      );
    }

    saveProfSession(tenantId, phone, {
      pendingBook: {
        clientName: clientName.trim(),
        date,
        suggestedTime: nearest,
        serviceId: service.id,
        serviceName: service.name,
        serviceDuration: service.durationMinutes,
        profId: targetProf.id
      },
      updatedAt: Date.now()
    });

    const forWhom = targetProf.id !== callerProf.id ? ` com *${targetProf.name}*` : '';
    return (
      `❌ *${parsedTime}* ocupado em *${datePT(date)}*${forWhom}.\n\n` +
      `Próximo horário disponível: *${nearest}*.\n` +
      `Responda *"sim"* para confirmar *${clientName}* às *${nearest}*.`
    );
  }

  const customer = await db.findOrCreateCustomerByName(tenantId, clientName.trim());
  await db.addAppointment({
    tenant_id: tenantId,
    customer_id: customer.id,
    professional_id: targetProf.id,
    service_id: service.id,
    startTime: startTimeStr,
    durationMinutes: service.durationMinutes,
    status: AppointmentStatus.CONFIRMED,
    source: BookingSource.MANUAL
  });

  clearProfSession(tenantId, phone);
  const profLine = targetProf.id !== callerProf.id ? `\n💈 *Profissional:* ${targetProf.name}` : '';
  return (
    `✅ *Agendamento confirmado*\n\n` +
    `👤 *Cliente:* ${clientName}\n` +
    `📅 *Dia:* ${datePT(date)}\n` +
    `⏰ *Horário:* ${parsedTime}\n` +
    `✂️ *Serviço:* ${service.name}${profLine}`
  );
}

async function handleConfirmBook(
  tenantId: string, phone: string
): Promise<string> {
  const session = getProfSession(tenantId, phone);
  if (!session.pendingBook) {
    return `Nada para confirmar. Envie um comando como _"marca João sexta às 10h"_.`;
  }

  const { clientName, date, suggestedTime, serviceId, serviceName, serviceDuration, profId } = session.pendingBook;
  const startTimeStr = `${date}T${suggestedTime}:00`;
  const startTime = new Date(startTimeStr);
  const { available } = await db.isSlotAvailable(tenantId, profId, startTime, serviceDuration);

  if (!available) {
    // Slot got taken — search for next available and offer it
    const settings = await db.getSettings(tenantId);
    const slots = await getAvailableSlots(tenantId, profId, date, serviceDuration, settings);
    const next = slots.find(s => s > suggestedTime) || slots[0];
    if (next) {
      saveProfSession(tenantId, phone, {
        pendingBook: { ...session.pendingBook, suggestedTime: next },
        updatedAt: Date.now()
      });
      return `⚠️ *${suggestedTime}* acabou de ser ocupado.\n\nPróximo disponível: *${next}*.\nResponda *"sim"* para confirmar *${clientName}* às *${next}*.`;
    }
    clearProfSession(tenantId, phone);
    return `⚠️ *${suggestedTime}* foi ocupado e não há mais horários disponíveis em *${datePT(date)}*.\nTente outro dia.`;
  }

  const customer = await db.findOrCreateCustomerByName(tenantId, clientName);
  await db.addAppointment({
    tenant_id: tenantId,
    customer_id: customer.id,
    professional_id: profId,
    service_id: serviceId,
    startTime: startTimeStr,
    durationMinutes: serviceDuration,
    status: AppointmentStatus.CONFIRMED,
    source: BookingSource.MANUAL
  });

  clearProfSession(tenantId, phone);
  return (
    `✅ *Confirmado*\n\n` +
    `👤 *Cliente:* ${clientName}\n` +
    `📅 *Dia:* ${datePT(date)}\n` +
    `⏰ *Horário:* ${suggestedTime}\n` +
    `✂️ *Serviço:* ${serviceName}`
  );
}

// FINANCIAL — faturamento total da barbearia com breakdown por profissional (admin only)
async function handleFinancial(
  tenantId: string, range: DateRange, professionals: any[]
): Promise<string> {
  const appointments = await db.getAppointments(tenantId);

  const finished = appointments.filter(a => {
    const d = a.startTime.split('T')[0];
    return d >= range.start && d <= range.end &&
      a.status === AppointmentStatus.FINISHED && !a.isPlan;
  });

  const total = finished.length;
  const revenue = finished.reduce((acc, a) => acc + (a.amountPaid || 0), 0);

  const byPro: Record<string, { count: number; revenue: number }> = {};
  for (const a of finished) {
    if (!byPro[a.professional_id]) byPro[a.professional_id] = { count: 0, revenue: 0 };
    byPro[a.professional_id].count++;
    byPro[a.professional_id].revenue += (a.amountPaid || 0);
  }

  const proLines = professionals
    .filter(p => byPro[p.id])
    .sort((a, b) => (byPro[b.id]?.revenue || 0) - (byPro[a.id]?.revenue || 0))
    .map(p => `• *${p.name}:* ${byPro[p.id].count} atend. — R$ ${byPro[p.id].revenue.toFixed(2)}`);

  let msg =
    `*Faturamento — ${range.label}:*\n\n` +
    `📊 *${total}* atendimento${total !== 1 ? 's' : ''} finalizados\n` +
    `💰 Total: *R$ ${revenue.toFixed(2)}*`;

  if (proLines.length > 0) msg += `\n\n*Por profissional:*\n${proLines.join('\n')}`;
  return msg;
}

// COMMISSION — comissão de um ou todos os profissionais
async function handleCommission(
  tenantId: string, profId: string | null, range: DateRange, settings: any, professionals: any[]
): Promise<string> {
  const appointments = await db.getAppointments(tenantId);
  const profMeta = settings.professionalMeta || {};

  const getRevenue = (pid: string) =>
    appointments
      .filter(a => {
        const d = a.startTime.split('T')[0];
        return a.professional_id === pid &&
          d >= range.start && d <= range.end &&
          a.status === AppointmentStatus.FINISHED && !a.isPlan;
      })
      .reduce((acc, a) => acc + (a.amountPaid || 0), 0);

  const buildLine = (p: any) => {
    const revenue = getRevenue(p.id);
    const rate = profMeta[p.id]?.commissionRate;
    if (rate === undefined) {
      return `• *${p.name}:* Taxa não configurada — Faturamento: R$ ${revenue.toFixed(2)}`;
    }
    const commission = revenue * rate / 100;
    return `• *${p.name}:* ${rate}% sobre R$ ${revenue.toFixed(2)} = *R$ ${commission.toFixed(2)}*`;
  };

  if (profId !== null) {
    const p = professionals.find(pr => pr.id === profId);
    if (!p) return 'Profissional não encontrado.';
    const revenue = getRevenue(profId);
    const rate = profMeta[profId]?.commissionRate;
    if (rate === undefined) {
      return (
        `*Comissão — ${p.name} (${range.label}):*\n\n` +
        `Taxa de comissão não configurada.\n` +
        `💰 Faturamento gerado: *R$ ${revenue.toFixed(2)}*`
      );
    }
    const commission = revenue * rate / 100;
    return (
      `*Comissão — ${p.name} (${range.label}):*\n\n` +
      `💰 Faturamento gerado: R$ ${revenue.toFixed(2)}\n` +
      `📊 Taxa: ${rate}%\n` +
      `💵 Comissão: *R$ ${commission.toFixed(2)}*`
    );
  }

  // All professionals
  const lines = professionals.filter(p => p.active).map(buildLine);
  if (lines.length === 0) return `Sem dados de comissão para ${range.label}.`;
  return `*Comissão — ${range.label}:*\n\n${lines.join('\n')}`;
}

// EXPENSES — despesas registradas (admin only)
async function handleExpenses(tenantId: string, range: DateRange): Promise<string> {
  const expenses = await db.getExpenses(tenantId);
  const filtered = expenses.filter(e => {
    const d = (e.date || '').split('T')[0];
    return d >= range.start && d <= range.end;
  });

  if (filtered.length === 0) {
    return `Nenhuma despesa registrada ${range.label}.`;
  }

  const total = filtered.reduce((acc, e) => acc + (e.amount || 0), 0);

  const lines = filtered
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map(e => {
      const d = (e.date || '').split('T')[0].split('-').reverse().join('/');
      return `• ${d} — ${e.description}: *R$ ${(e.amount || 0).toFixed(2)}*`;
    });

  return (
    `*Despesas — ${range.label}:*\n\n` +
    `${lines.join('\n')}\n\n` +
    `💵 *Total: R$ ${total.toFixed(2)}*`
  );
}

// PROFIT — lucro e margem (admin only)
async function handleProfit(tenantId: string, range: DateRange): Promise<string> {
  const [appointments, expenses] = await Promise.all([
    db.getAppointments(tenantId),
    db.getExpenses(tenantId)
  ]);

  const revenue = appointments
    .filter(a => {
      const d = a.startTime.split('T')[0];
      return d >= range.start && d <= range.end &&
        a.status === AppointmentStatus.FINISHED && !a.isPlan;
    })
    .reduce((acc, a) => acc + (a.amountPaid || 0), 0);

  const totalExpenses = expenses
    .filter(e => {
      const d = (e.date || '').split('T')[0];
      return d >= range.start && d <= range.end;
    })
    .reduce((acc, e) => acc + (e.amount || 0), 0);

  const profit = revenue - totalExpenses;
  const margin = revenue > 0 ? (profit / revenue * 100) : 0;

  return (
    `*Resultado — ${range.label}:*\n\n` +
    `💰 Faturamento bruto: *R$ ${revenue.toFixed(2)}*\n` +
    `📉 Despesas: *R$ ${totalExpenses.toFixed(2)}*\n` +
    `💵 Lucro líquido: *R$ ${profit.toFixed(2)}*\n` +
    `📈 Margem: *${margin.toFixed(1)}%*`
  );
}

// RANKING — ranking de atendimentos entre profissionais (admin only)
async function handleRanking(
  tenantId: string, range: DateRange, professionals: any[]
): Promise<string> {
  const appointments = await db.getAppointments(tenantId);

  const stats: Record<string, { count: number; revenue: number }> = {};
  for (const a of appointments) {
    const d = a.startTime.split('T')[0];
    if (d < range.start || d > range.end) continue;
    if (a.status !== AppointmentStatus.FINISHED) continue;
    if (!stats[a.professional_id]) stats[a.professional_id] = { count: 0, revenue: 0 };
    stats[a.professional_id].count++;
    stats[a.professional_id].revenue += (a.amountPaid || 0);
  }

  const ranked = professionals
    .filter(p => p.active && stats[p.id])
    .sort((a, b) => (stats[b.id]?.count || 0) - (stats[a.id]?.count || 0));

  if (ranked.length === 0) {
    return `Nenhum atendimento finalizado ${range.label}.`;
  }

  const lines = ranked.map((p, i) => {
    const s = stats[p.id];
    return `*${i + 1}°* ${p.name} — ${s.count} atend. | R$ ${s.revenue.toFixed(2)}`;
  });

  return `*Ranking de atendimentos — ${range.label}:*\n\n${lines.join('\n')}`;
}

// GOALS — metas mensais de desempenho (admin only)
async function handleGoals(
  tenantId: string, profId: string | null, range: DateRange, settings: any, professionals: any[]
): Promise<string> {
  const appointments = await db.getAppointments(tenantId);
  const profMeta = settings.professionalMeta || {};

  const getRevenue = (pid: string) =>
    appointments
      .filter(a => {
        const d = a.startTime.split('T')[0];
        return a.professional_id === pid &&
          d >= range.start && d <= range.end &&
          a.status === AppointmentStatus.FINISHED && !a.isPlan;
      })
      .reduce((acc, a) => acc + (a.amountPaid || 0), 0);

  const buildLine = (p: any) => {
    const goal = profMeta[p.id]?.monthlyGoal;
    const revenue = getRevenue(p.id);
    if (goal === undefined) {
      return `• *${p.name}:* Meta não configurada — Realizado: R$ ${revenue.toFixed(2)}`;
    }
    const pct = goal > 0 ? Math.round(revenue / goal * 100) : 0;
    const icon = pct >= 100 ? '✅' : pct >= 70 ? '🟡' : '🔴';
    return `${icon} *${p.name}:* R$ ${revenue.toFixed(2)} / Meta R$ ${goal.toFixed(2)} (${pct}%)`;
  };

  const targets = profId !== null
    ? professionals.filter(p => p.id === profId)
    : professionals.filter(p => p.active);

  if (targets.length === 0) return 'Profissional não encontrado.';

  const lines = targets.map(buildLine);
  return `*Metas — ${range.label}:*\n\n${lines.join('\n')}`;
}

// =====================================================================
// PHONE MATCHING
// =====================================================================

function phonesMatch(stored: string, incoming: string): boolean {
  const a = (stored || '').replace(/\D/g, '');
  const b = (incoming || '').replace(/\D/g, '');
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.slice(-11) === b.slice(-11) && b.slice(-11).length >= 10) return true;
  if (a.slice(-10) === b.slice(-10) && b.slice(-10).length >= 10) return true;
  return false;
}

// =====================================================================
// MAIN HANDLER — exported and called by AiPollingManager
// =====================================================================

export async function handleProfessionalMessage(
  tenant: any,
  phone: string,
  messageText: string
): Promise<string | null> {
  const tenantId: string = tenant.id;
  const geminiKey: string = tenant.gemini_api_key || '';
  const text = messageText.trim();
  if (!text) return null;

  // ── Saudações curtas: resposta amigável sem mostrar menu completo ──
  if (/^(oi|olá|ola|hey|ei|eai|e aí|bom dia|boa tarde|boa noite|salve|tudo bem|tudo bom|td bem|td bom)[\s!.?]*$/i.test(text)) {
    return null; // ignora saudações — não responde nada para não poluir o chat
  }

  // ── Dedup: skip if same message already processed in the last 30s ──
  // Prevents double responses when Edge Function webhook and polling
  // manager process the same message concurrently.
  const dedupKey = `${tenantId}::${phone}::${text.slice(0, 100)}`;
  const now = Date.now();
  // Purge stale entries
  for (const [k, t] of _profDedup) { if (now - t > _PROF_DEDUP_TTL) _profDedup.delete(k); }
  if (_profDedup.has(dedupKey)) {
    console.log('[ProfAgent] Dedup: skipping duplicate message from', phone);
    return null;
  }
  _profDedup.set(dedupKey, now);

  // ── Regra 1: Identificação pelo telefone ──────────────────────────
  const professionals = await db.getProfessionals(tenantId);
  const prof = professionals.find(p => phonesMatch(p.phone, phone));
  if (!prof) return null; // não é profissional → tratar como cliente

  const isAdmin = prof.role === 'admin';
  const today = todayISO();
  const todayFull = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
  });

  // ── Classificação de intenção ────────────────────────────────────
  const intent = await classifyIntent(text, geminiKey, `${today} (${todayFull})`);

  // ── Regra 2/4/5/6: Controle de acesso por perfil ────────────────

  // CONFIRM_BOOK é sempre permitido (não requer permissão extra)
  if (intent.intent === 'CONFIRM_BOOK') {
    return handleConfirmBook(tenantId, phone);
  }

  // Intents exclusivos de admin
  if (ADMIN_ONLY_INTENTS.includes(intent.intent) && !isAdmin) {
    return ACCESS_DENIED;
  }

  const [settings, customers, services] = await Promise.all([
    db.getSettings(tenantId),
    db.getCustomers(tenantId),
    db.getServices(tenantId)
  ]);

  // ── Resolve profissional alvo ────────────────────────────────────
  // Colaborador NÃO pode consultar dados de outro profissional
  let targetProfId: string | null = prof.id;
  if (intent.targetProfName?.trim()) {
    if (!isAdmin) {
      return ACCESS_DENIED;
    }
    if (intent.targetProfName === '__ALL__') {
      targetProfId = null;
    } else {
      const targetProf = professionals.find(p =>
        p.name.toLowerCase().includes(intent.targetProfName.toLowerCase())
      );
      if (targetProf) {
        targetProfId = targetProf.id;
      } else {
        return `Profissional *"${intent.targetProfName}"* não encontrado.\nProfissionais cadastrados: ${professionals.map(p => p.name).join(', ')}.`;
      }
    }
  }

  const range = resolveDateRange(intent.dateRef || 'today');

  // ── Roteamento por intenção ──────────────────────────────────────
  switch (intent.intent) {

    case 'LIST_APPOINTMENTS':
      return handleListAppointments(tenantId, targetProfId, range, customers, services, professionals);

    case 'AVAILABLE_SLOTS':
      return handleAvailableSlots(tenantId, targetProfId, range, settings, professionals);

    case 'COUNT_PROCEDURES':
      return handleCountProcedures(tenantId, targetProfId, range);

    case 'BOOK': {
      // Admin can book for another professional; colab always books for self
      const bookTargetProf = (isAdmin && targetProfId && targetProfId !== prof.id)
        ? (professionals.find(p => p.id === targetProfId) || prof)
        : prof;
      // Non-admin trying to book for someone else is already blocked above by ACCESS_DENIED
      return handleBook(tenantId, prof, bookTargetProf, intent, settings, phone);
    }

    case 'FINANCIAL':
      // admin only (já bloqueado acima para colabs)
      return handleFinancial(tenantId, range, professionals);

    case 'COMMISSION':
      // Colab: apenas própria (targetProfId = prof.id, targetProfName era vazio)
      // Admin: qualquer (targetProfId já resolvido)
      return handleCommission(tenantId, targetProfId, range, settings, professionals);

    case 'EXPENSES':
      // admin only
      return handleExpenses(tenantId, range);

    case 'PROFIT':
      // admin only
      return handleProfit(tenantId, range);

    case 'RANKING':
      // admin only
      return handleRanking(tenantId, range, professionals);

    case 'GOALS':
      // admin only — targetProfId: null = todos, ou id específico
      return handleGoals(tenantId, targetProfId, range, settings, professionals);

    default: {
      // ── Menu de ajuda (HELP) — personalizado por perfil ─────────
      const profNames = professionals.filter(p => p.active && p.id !== prof.id).map(p => p.name);
      const otherProfExample = profNames[0] || 'Carlos';
      if (isAdmin) {
        return (
          `Olá, *${prof.name}*! Basta enviar o comando direto. Exemplos:\n\n` +
          `📅 Para ver agenda: _"agenda hoje"_ ou _"agenda do ${otherProfExample} amanhã"_\n` +
          `✂️ Para ver procedimentos: _"procedimentos esta semana"_ ou _"procedimentos do ${otherProfExample} mês passado"_\n` +
          `➕ Para marcar cliente: _"marca João quinta às 10h"_ ou _"marca João quinta às 10h com ${otherProfExample}"_\n` +
          `💰 Para ver faturamento: _"faturamento este mês"_\n` +
          `💵 Para ver comissão: _"comissão do ${otherProfExample} este mês"_ ou _"comissão todos"_\n` +
          `📉 Para ver despesas: _"despesas este mês"_\n` +
          `📈 Para ver lucro: _"lucro este mês"_\n` +
          `🏆 Para ver ranking: _"ranking este mês"_\n` +
          `🎯 Para ver metas: _"metas este mês"_`
        );
      } else {
        return (
          `Olá, *${prof.name}*! Basta enviar o comando direto. Exemplos:\n\n` +
          `📅 Para ver sua agenda: _"agenda hoje"_ ou _"agenda amanhã"_\n` +
          `✂️ Para ver procedimentos: _"procedimentos esta semana"_ ou _"procedimentos mês passado"_\n` +
          `➕ Para marcar cliente: _"marca João quinta às 10h"_\n` +
          `💰 Para ver sua comissão: _"comissão este mês"_ ou _"comissão semana passada"_`
        );
      }
    }
  }
}
