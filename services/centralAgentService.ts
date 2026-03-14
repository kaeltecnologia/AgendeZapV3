/**
 * centralAgentService.ts
 *
 * Multi-tenant Central WhatsApp Agent — receives leads from ads/marketplace,
 * suggests nearby partner businesses, and books appointments cross-tenant.
 *
 * Flow:
 * 1. Lead messages Central → asks procedure + location
 * 2. Geocodes address, finds nearby visible tenants
 * 3. Shows top 3 "cards" (name, rating, distance)
 * 4. Lead picks → loads services/professionals
 * 5. Collects: service → day → time
 * 6. Books appointment in partner's system
 * 7. Notifies partner via WhatsApp
 */

import { db } from './mockDb';
import { evolutionService } from './evolutionService';
import { supabase } from './supabase';
import { geocodeAddress, sortByDistance } from './geocodingService';
import { getAvailableSlots } from './agentService';
import { AppointmentStatus, BookingSource } from '../types';
import { maskPhone } from './security';

// ─── Session management ──────────────────────────────────────────────

interface CentralSessionData {
  name?: string;
  city?: string;
  nicho?: string;
  leadLat?: number;
  leadLng?: number;
  // Partner selection
  suggestedTenants?: Array<{ id: string; name: string; distance: number; rating: number; nicho?: string }>;
  chosenTenantId?: string;
  chosenTenantName?: string;
  // Booking flow
  serviceId?: string;
  serviceName?: string;
  serviceDuration?: number;
  servicePrice?: number;
  professionalId?: string;
  professionalName?: string;
  date?: string;
  time?: string;
  availableSlots?: string[];
  pendingConfirm?: boolean;
  step: 'greeting' | 'collect_info' | 'show_partners' | 'pick_partner' |
        'pick_service' | 'pick_date' | 'pick_time' | 'confirm' | 'done';
}

interface CentralSession {
  phone: string;
  data: CentralSessionData;
  history: Array<{ role: 'user' | 'bot'; text: string }>;
  updatedAt: number;
}

const sessions = new Map<string, CentralSession>();

function getSession(phone: string): CentralSession {
  let s = sessions.get(phone);
  if (!s) {
    s = { phone, data: { step: 'greeting' }, history: [], updatedAt: Date.now() };
    sessions.set(phone, s);
  }
  return s;
}

function clearSession(phone: string) {
  sessions.delete(phone);
}

// ─── Helpers ─────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

function todayBr(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function formatDatePT(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit',
  });
}

function nextWeekdayISO(dayOfWeek: number): string {
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const current = now.getUTCDay();
  let diff = dayOfWeek - current;
  if (diff <= 0) diff += 7;
  const target = new Date(now.getTime() + diff * 86400000);
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}`;
}

function parseDateFromText(text: string): string | null {
  const norm = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\bhoje\b/.test(norm)) return todayBr();
  if (/\bamanha\b/.test(norm)) {
    const d = new Date(Date.now() - 3 * 60 * 60 * 1000 + 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const dayMap: Record<string, number> = {
    'domingo': 0, 'segunda': 1, 'terca': 2, 'quarta': 3,
    'quinta': 4, 'sexta': 5, 'sabado': 6,
  };
  for (const [name, num] of Object.entries(dayMap)) {
    if (new RegExp(`\\b${name}\\b`).test(norm)) return nextWeekdayISO(num);
  }
  // dd/mm pattern
  const ddmm = norm.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (ddmm) {
    const year = new Date().getFullYear();
    return `${year}-${pad(parseInt(ddmm[2]))}-${pad(parseInt(ddmm[1]))}`;
  }
  return null;
}

// ─── AI brain for free-form conversation ─────────────────────────────

async function callCentralBrain(
  apiKey: string,
  context: string,
  history: Array<{ role: string; text: string }>,
  userMsg: string
): Promise<string> {
  const messages = [
    { role: 'system', content: context },
    ...history.slice(-10).map(h => ({
      role: h.role === 'bot' ? 'assistant' : 'user',
      content: h.text,
    })),
    { role: 'user', content: userMsg },
  ];

  // Try OpenAI first
  if (apiKey.startsWith('sk-')) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'gpt-4.1-mini', messages, max_tokens: 500, temperature: 0.7 }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
      }
    } catch {}
  }

  // Fallback: Gemini
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: context + '\n\n' + history.map(h => `${h.role}: ${h.text}`).join('\n') + '\nuser: ' + userMsg }],
        }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.7 },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
  } catch {}

  return 'Desculpe, estou com dificuldade técnica no momento. Tente novamente em instantes!';
}

// ─── Main handler ────────────────────────────────────────────────────

export async function handleCentralMessage(
  instanceName: string,
  phone: string,
  text: string,
  pushName?: string
): Promise<string | null> {
  const session = getSession(phone);
  const lowerText = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  // Save name from pushName
  if (pushName && !session.data.name) {
    session.data.name = pushName;
  }

  session.history.push({ role: 'user', text });

  let reply: string;

  try {
    switch (session.data.step) {
      case 'greeting':
        reply = await handleGreeting(session, text, lowerText);
        break;
      case 'collect_info':
        reply = await handleCollectInfo(session, text, lowerText);
        break;
      case 'show_partners':
      case 'pick_partner':
        reply = await handlePickPartner(session, text, lowerText);
        break;
      case 'pick_service':
        reply = await handlePickService(session, text, lowerText);
        break;
      case 'pick_date':
        reply = await handlePickDate(session, text, lowerText);
        break;
      case 'pick_time':
        reply = await handlePickTime(session, text, lowerText);
        break;
      case 'confirm':
        reply = await handleConfirm(session, text, lowerText, instanceName);
        break;
      case 'done':
        // Start over
        clearSession(phone);
        return handleCentralMessage(instanceName, phone, text, pushName);
      default:
        reply = 'Olá! Sou a Central AgendeZap. Qual procedimento você procura e em que cidade? 😊';
        session.data.step = 'collect_info';
    }
  } catch (e: any) {
    console.error('[Central] Error handling message:', e.message);
    reply = 'Ops, tive um problema técnico. Pode repetir? 🙏';
  }

  session.history.push({ role: 'bot', text: reply });
  if (session.history.length > 30) session.history = session.history.slice(-30);
  session.updatedAt = Date.now();

  return reply;
}

// ─── Step handlers ───────────────────────────────────────────────────

async function handleGreeting(session: CentralSession, text: string, norm: string): Promise<string> {
  const name = session.data.name ? `, ${session.data.name}` : '';

  // Save as marketplace lead
  try {
    await db.addMarketplaceLead({
      phone: session.phone,
      name: session.data.name,
      source: 'central_whatsapp',
    });
  } catch {}

  session.data.step = 'collect_info';

  // Check if first message already contains procedure + location info
  const hasLocation = /\b(cidade|bairro|perto|proximo|regiao|centro|zona)\b/.test(norm) ||
    norm.match(/\b[a-z]{3,}\s*[-\/]\s*[a-z]{2}\b/); // City-ST pattern
  const hasProcedure = norm.length > 10;

  if (hasLocation && hasProcedure) {
    return handleCollectInfo(session, text, norm);
  }

  return `Olá${name}! 👋\n\nSou a *Central AgendeZap* e vou te ajudar a encontrar o melhor lugar perto de você!\n\nMe conta:\n1️⃣ Qual *procedimento* você procura?\n2️⃣ Qual sua *cidade ou bairro*?`;
}

async function handleCollectInfo(session: CentralSession, text: string, norm: string): Promise<string> {
  // Try to extract city/location
  if (!session.data.city) {
    // Check common patterns: "em Maringá", "de Curitiba", city name after "cidade"
    const cityMatch = text.match(/(?:em|de|cidade|bairro|zona)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)*)/i);
    if (cityMatch) {
      session.data.city = cityMatch[1].trim();
    } else if (text.match(/[A-ZÀ-Ú][a-zà-ú]+\s*[-\/]\s*[A-Z]{2}/)) {
      // City-UF pattern
      session.data.city = text.match(/([A-ZÀ-Ú][a-zà-ú]+)\s*[-\/]\s*[A-Z]{2}/)?.[0] || text;
    }
  }

  // Try to detect nicho from procedure keywords
  if (!session.data.nicho) {
    const nichoMap: Record<string, string[]> = {
      'Barbearia': ['barba', 'cabelo', 'corte', 'barbeiro', 'degradê', 'degrade', 'pezinho', 'sobrancelha'],
      'Salão de Beleza': ['unha', 'manicure', 'pedicure', 'escova', 'tintura', 'mechas', 'alisamento'],
      'Estética': ['limpeza de pele', 'depilação', 'depilacao', 'microagulhamento', 'botox', 'peeling'],
      'Clínica': ['dentista', 'fisioterapia', 'psicólogo', 'nutricionista', 'consulta'],
    };
    for (const [nicho, keywords] of Object.entries(nichoMap)) {
      if (keywords.some(k => norm.includes(k))) {
        session.data.nicho = nicho;
        break;
      }
    }
  }

  // If we don't have city yet, ask
  if (!session.data.city) {
    return 'Entendi! E em qual *cidade ou bairro* você está? 📍';
  }

  // Geocode the location — check cached coords first
  if (!session.data.leadLat) {
    try {
      const existingLead = await db.getMarketplaceLeadByPhone(session.phone);
      if (existingLead?.latitude && existingLead?.longitude) {
        session.data.leadLat = existingLead.latitude;
        session.data.leadLng = existingLead.longitude;
        console.log('[Central] Using cached coords for', maskPhone(session.phone));
      }
    } catch {}
  }
  if (!session.data.leadLat) {
    const coords = await geocodeAddress(session.data.city);
    if (coords) {
      session.data.leadLat = coords.lat;
      session.data.leadLng = coords.lng;
    }
  }

  // Update lead with city + coords
  try {
    await db.addMarketplaceLead({
      phone: session.phone,
      name: session.data.name,
      city: session.data.city,
      nichoInterest: session.data.nicho,
      latitude: session.data.leadLat,
      longitude: session.data.leadLng,
      source: 'central_whatsapp',
    });
  } catch {}

  // Find partners
  return await showPartners(session);
}

async function showPartners(session: CentralSession): Promise<string> {
  const tenants = await db.getMarketplaceTenants({
    cidade: session.data.city || undefined,
    nicho: session.data.nicho || undefined,
  });

  if (tenants.length === 0) {
    // Broaden search — remove nicho filter
    const allTenants = await db.getMarketplaceTenants({ cidade: session.data.city || undefined });
    if (allTenants.length === 0) {
      session.data.step = 'collect_info';
      return '😕 Ainda não temos parceiros cadastrados na sua região.\n\nQuer tentar outra cidade ou bairro?';
    }
    return buildPartnerList(session, allTenants);
  }

  return buildPartnerList(session, tenants);
}

async function buildPartnerList(session: CentralSession, tenants: any[]): Promise<string> {
  // Sort by distance if we have coordinates
  let sorted: Array<{ tenant: any; distance: number; rating: number }>;

  if (session.data.leadLat && session.data.leadLng) {
    const byDist = sortByDistance(tenants, session.data.leadLat, session.data.leadLng);
    sorted = [];
    for (const item of byDist.slice(0, 5)) {
      const { average } = await db.getAverageRating(item.tenant.id);
      sorted.push({ tenant: item.tenant, distance: item.distance, rating: average });
    }
    // Re-sort by combo of distance and rating (weighted)
    sorted.sort((a, b) => (a.distance * 0.7 - a.rating * 3) - (b.distance * 0.7 - b.rating * 3));
  } else {
    sorted = [];
    for (const t of tenants.slice(0, 5)) {
      const { average } = await db.getAverageRating(t.id);
      sorted.push({ tenant: t, distance: 0, rating: average });
    }
    sorted.sort((a, b) => b.rating - a.rating);
  }

  const top3 = sorted.slice(0, 3);

  session.data.suggestedTenants = top3.map((item, i) => ({
    id: item.tenant.id,
    name: item.tenant.name,
    distance: item.distance,
    rating: item.rating,
    nicho: item.tenant.nicho,
  }));

  session.data.step = 'pick_partner';

  const stars = (r: number) => r > 0 ? `⭐ ${r}/10` : 'Novo';
  const dist = (d: number) => d > 0 ? `📍 ${d} km` : '';

  let msg = `Encontrei *${top3.length} opções* perto de você:\n\n`;
  top3.forEach((item, i) => {
    const distStr = dist(item.distance);
    msg += `*${i + 1}.* ${item.tenant.name}`;
    if (item.tenant.nicho) msg += ` (${item.tenant.nicho})`;
    msg += `\n   ${stars(item.rating)}`;
    if (distStr) msg += ` | ${distStr}`;
    if (item.tenant.endereco) msg += `\n   ${item.tenant.endereco}`;
    msg += '\n\n';
  });
  msg += 'Qual você prefere? Responda com o *número* (1, 2 ou 3) 😊';

  return msg;
}

async function handlePickPartner(session: CentralSession, text: string, norm: string): Promise<string> {
  const suggested = session.data.suggestedTenants;
  if (!suggested || suggested.length === 0) {
    session.data.step = 'collect_info';
    return 'Preciso procurar parceiros novamente. Qual sua cidade? 📍';
  }

  // Try to extract number choice
  const numMatch = norm.match(/\b([1-3])\b/);
  if (numMatch) {
    const idx = parseInt(numMatch[1]) - 1;
    if (idx >= 0 && idx < suggested.length) {
      session.data.chosenTenantId = suggested[idx].id;
      session.data.chosenTenantName = suggested[idx].name;
      return await showServices(session);
    }
  }

  // Try name match
  for (const s of suggested) {
    if (norm.includes(s.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) {
      session.data.chosenTenantId = s.id;
      session.data.chosenTenantName = s.name;
      return await showServices(session);
    }
  }

  return 'Por favor, responda com o *número* da opção (1, 2 ou 3) 😊';
}

async function showServices(session: CentralSession): Promise<string> {
  const tenantId = session.data.chosenTenantId!;
  const services = await db.getServices(tenantId);
  const active = services.filter(s => s.active);

  if (active.length === 0) {
    session.data.step = 'pick_partner';
    return `😕 ${session.data.chosenTenantName} não tem serviços disponíveis no momento. Escolha outra opção.`;
  }

  session.data.step = 'pick_service';

  let msg = `Ótima escolha! *${session.data.chosenTenantName}* 🎉\n\nServiços disponíveis:\n\n`;
  active.forEach((s, i) => {
    msg += `*${i + 1}.* ${s.name} — R$ ${s.price.toFixed(2)} (${s.durationMinutes} min)\n`;
  });
  msg += '\nQual serviço você deseja? Responda com o *número* 😊';

  return msg;
}

async function handlePickService(session: CentralSession, text: string, norm: string): Promise<string> {
  const tenantId = session.data.chosenTenantId!;
  const services = (await db.getServices(tenantId)).filter(s => s.active);

  // Try number
  const numMatch = norm.match(/\b(\d+)\b/);
  if (numMatch) {
    const idx = parseInt(numMatch[1]) - 1;
    if (idx >= 0 && idx < services.length) {
      const svc = services[idx];
      session.data.serviceId = svc.id;
      session.data.serviceName = svc.name;
      session.data.serviceDuration = svc.durationMinutes;
      session.data.servicePrice = svc.price;
      session.data.step = 'pick_date';
      return `*${svc.name}* selecionado! 👍\n\nQual *dia* você prefere? (ex: "hoje", "amanhã", "quinta", "15/03")`;
    }
  }

  // Try name match (stem-based)
  const stem = (w: string) => w.length >= 5 ? w.slice(0, w.length - 1) : w;
  const words = norm.split(/\s+/).filter(w => w.length >= 3);
  for (const svc of services) {
    const svcWords = svc.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/);
    const matches = words.filter(w => svcWords.some(sw => stem(w) === stem(sw) || sw.includes(w) || w.includes(sw)));
    if (matches.length >= 1) {
      session.data.serviceId = svc.id;
      session.data.serviceName = svc.name;
      session.data.serviceDuration = svc.durationMinutes;
      session.data.servicePrice = svc.price;
      session.data.step = 'pick_date';
      return `*${svc.name}* selecionado! 👍\n\nQual *dia* você prefere? (ex: "hoje", "amanhã", "quinta", "15/03")`;
    }
  }

  return 'Não identifiquei o serviço. Por favor, responda com o *número* da lista. 😊';
}

async function handlePickDate(session: CentralSession, text: string, norm: string): Promise<string> {
  const date = parseDateFromText(text);
  if (!date) {
    return 'Não entendi a data. Tente "hoje", "amanhã", "quinta" ou "15/03" 📅';
  }

  session.data.date = date;

  // Get professionals for this tenant
  const tenantId = session.data.chosenTenantId!;
  const professionals = (await db.getProfessionals(tenantId)).filter(p => p.active);
  const settings = await db.getSettings(tenantId);

  // Find first professional with available slots
  const duration = session.data.serviceDuration || 30;
  let allSlots: string[] = [];
  let chosenProf: any = null;

  for (const prof of professionals) {
    const slots = await getAvailableSlots(tenantId, prof.id, date, duration, settings);
    if (slots.length > 0) {
      allSlots = slots;
      chosenProf = prof;
      break;
    }
  }

  if (!chosenProf || allSlots.length === 0) {
    return `Sem horários disponíveis em *${formatDatePT(date)}*. Tente outro dia! 📅`;
  }

  session.data.professionalId = chosenProf.id;
  session.data.professionalName = chosenProf.name;
  session.data.availableSlots = allSlots;
  session.data.step = 'pick_time';

  // Group by period
  const manha = allSlots.filter(s => parseInt(s) < 12);
  const tarde = allSlots.filter(s => parseInt(s) >= 12 && parseInt(s) < 18);
  const noite = allSlots.filter(s => parseInt(s) >= 18);

  let msg = `Horários para *${formatDatePT(date)}* com *${chosenProf.name}*:\n\n`;
  if (manha.length) msg += `🌅 *Manhã:* ${manha.join(', ')}\n`;
  if (tarde.length) msg += `☀️ *Tarde:* ${tarde.join(', ')}\n`;
  if (noite.length) msg += `🌙 *Noite:* ${noite.join(', ')}\n`;
  msg += '\nQual horário? 🕐';

  return msg;
}

async function handlePickTime(session: CentralSession, text: string, norm: string): Promise<string> {
  const timeMatch = text.match(/\b(\d{1,2})[:\.](\d{2})\b/) || text.match(/\b(\d{1,2})\s*(?:h|hrs?)\s*(\d{0,2})\b/i);
  let time: string | null = null;

  if (timeMatch) {
    const h = parseInt(timeMatch[1]);
    const m = parseInt(timeMatch[2] || '0');
    time = `${pad(h)}:${pad(m)}`;
  }

  if (!time || !session.data.availableSlots?.includes(time)) {
    // Check if they sent just a number matching a slot
    const slots = session.data.availableSlots || [];
    const numMatch = norm.match(/\b(\d{1,2})\b/);
    if (numMatch) {
      const h = parseInt(numMatch[1]);
      const matching = slots.filter(s => parseInt(s) === h);
      if (matching.length === 1) {
        time = matching[0];
      } else if (matching.length > 1) {
        return `Encontrei vários horários às ${h}h: ${matching.join(', ')}. Qual deles?`;
      }
    }
  }

  if (!time || !session.data.availableSlots?.includes(time)) {
    return 'Horário não disponível. Escolha um dos horários listados. 🕐';
  }

  session.data.time = time;
  session.data.step = 'confirm';

  const name = session.data.name || 'Cliente';
  return `Perfeito! Confirma o agendamento?\n\n` +
    `📍 *${session.data.chosenTenantName}*\n` +
    `✂️ *${session.data.serviceName}*\n` +
    `👤 *${session.data.professionalName}*\n` +
    `📅 *${formatDatePT(session.data.date!)}*\n` +
    `🕐 *${time}*\n` +
    `💰 *R$ ${(session.data.servicePrice || 0).toFixed(2)}*\n\n` +
    `Responda *SIM* para confirmar ou *NÃO* para cancelar.`;
}

async function handleConfirm(
  session: CentralSession,
  text: string,
  norm: string,
  instanceName: string
): Promise<string> {
  const AFFIRM = ['sim', 'ok', 'pode', 'certo', 'confirma', 'confirmo', 'quero', 'bora', 'beleza'];
  const DENY = ['nao', 'não', 'cancelar', 'cancela', 'desisto'];

  const wds = norm.split(/\s+/);
  const isAffirm = AFFIRM.some(a => wds.includes(a));
  const isDeny = DENY.some(d => wds.includes(d));

  if (isDeny) {
    session.data.step = 'pick_date';
    return 'Agendamento cancelado. Quer escolher outro dia ou horário? 📅';
  }

  if (!isAffirm) {
    return 'Responda *SIM* para confirmar ou *NÃO* para cancelar. 😊';
  }

  // ── Book the appointment ──────────────────────────────────────────
  const tenantId = session.data.chosenTenantId!;
  const date = session.data.date!;
  const time = session.data.time!;
  const duration = session.data.serviceDuration || 30;

  // Find or create customer in the partner's system
  const customers = await db.getCustomers(tenantId);
  let customer = customers.find(c => c.phone.replace(/\D/g, '') === session.phone.replace(/\D/g, ''));

  if (!customer) {
    customer = await db.addCustomer({
      tenant_id: tenantId,
      name: session.data.name || 'Lead Central',
      phone: session.phone,
    });
  }

  // Create appointment
  const startTime = `${date}T${time}:00`;
  const endDate = new Date(new Date(startTime).getTime() + duration * 60000);
  const endTime = `${date}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:00`;

  try {
    const appt = await db.addAppointment({
      tenant_id: tenantId,
      customer_id: customer.id,
      professional_id: session.data.professionalId!,
      service_id: session.data.serviceId!,
      startTime,
      durationMinutes: duration,
      status: AppointmentStatus.CONFIRMED,
      source: BookingSource.WEB, // TODO: add CENTRAL source
    });

    // ── Cashback calculation ─────────────────────────────────
    let cashbackEarned = 0;
    let cashbackMsg = '';
    try {
      const globalCfg = await db.getGlobalConfig();
      const cashbackCfg = globalCfg['cashback_config'] ? JSON.parse(globalCfg['cashback_config']) : null;

      if (cashbackCfg?.active) {
        const servicePrice = session.data.servicePrice || 0;

        if (cashbackCfg.mode === 'percentual' && cashbackCfg.percent > 0) {
          cashbackEarned = Math.round(servicePrice * cashbackCfg.percent) / 100;
          if (cashbackEarned > 0) {
            await db.addCashback(session.phone, cashbackEarned);
            const bal = await db.getCashbackBalance(session.phone);
            cashbackMsg = `\n💰 Você ganhou *R$ ${cashbackEarned.toFixed(2)}* de cashback! Saldo: *R$ ${(bal?.balance || cashbackEarned).toFixed(2)}*`;
          }
        } else if (cashbackCfg.mode === 'fidelidade' && cashbackCfg.threshold > 0) {
          // Increment counter, check if threshold reached
          const bal = await db.getCashbackBalance(session.phone);
          const count = (bal?.bookingsCount || 0) + 1;
          // addCashback increments bookingsCount
          await db.addCashback(session.phone, 0);
          if (count % cashbackCfg.threshold === 0) {
            cashbackMsg = `\n🎉 Parabéns! Este é seu ${count}º agendamento via Central — o próximo é *GRÁTIS*!`;
          } else {
            const remaining = cashbackCfg.threshold - (count % cashbackCfg.threshold);
            cashbackMsg = `\n⭐ Faltam *${remaining}* agendamento${remaining > 1 ? 's' : ''} via Central para ganhar 1 grátis!`;
          }
        }
      }
    } catch (e: any) {
      console.error('[Central] Cashback error:', e.message);
    }

    // Save central booking record
    await db.addCentralBooking({
      leadPhone: session.phone,
      tenantId,
      appointmentId: appt.id,
      cashbackEarned,
    });

    // Notify the partner
    try {
      const { data: tenants } = await supabase.from('tenants').select('*').eq('id', tenantId);
      const tenant = tenants?.[0];
      if (tenant) {
        const partnerInstance = tenant.evolution_instance || `agendezap_${tenant.slug}`;
        const partnerPhone = tenant.telefone;
        if (partnerPhone) {
          await evolutionService.sendMessage(
            partnerInstance,
            partnerPhone,
            `🔔 *Novo agendamento via Central!*\n\n` +
            `👤 ${session.data.name || 'Cliente'} (${session.phone})\n` +
            `✂️ ${session.data.serviceName}\n` +
            `👤 ${session.data.professionalName}\n` +
            `📅 ${formatDatePT(date)} às ${time}\n\n` +
            `O cliente já foi confirmado automaticamente.`
          );
        }
      }
    } catch (e: any) {
      console.error('[Central] Erro ao notificar parceiro:', e.message);
    }

    session.data.step = 'done';

    return `✅ *Agendamento confirmado!*\n\n` +
      `📍 ${session.data.chosenTenantName}\n` +
      `📅 ${formatDatePT(date)} às ${time}\n` +
      `✂️ ${session.data.serviceName}` +
      cashbackMsg +
      `\n\nObrigado por usar a Central AgendeZap! 🚀\n` +
      `Se precisar de algo mais, é só me chamar.`;

  } catch (e: any) {
    console.error('[Central] Erro ao criar appointment:', e.message);
    return 'Ops, houve um erro ao confirmar o agendamento. Tente novamente. 🙏';
  }
}

/**
 * Cleanup stale sessions (older than 2 hours)
 */
export function cleanupCentralSessions(): void {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [key, session] of sessions) {
    if (session.updatedAt < cutoff) {
      sessions.delete(key);
    }
  }
}
