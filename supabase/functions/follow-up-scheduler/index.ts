/**
 * AgendeZap — Edge Function: follow-up-scheduler
 *
 * Roda via pg_cron a cada 1 minuto. Processa os 5 jobs de follow-up
 * para TODOS os tenants ativos, sem depender do navegador aberto.
 *
 * Jobs: aviso, lembrete, reativação, agenda diária, rating, payment reminder, relatório semanal.
 *
 * Deploy: supabase functions deploy follow-up-scheduler
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Config ────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EVO_URL = Deno.env.get('EVOLUTION_API_URL') || 'https://evolution-api-agendezap-evolution-api.xzftjp.easypanel.host';
const EVO_KEY = Deno.env.get('EVOLUTION_API_KEY') || '429683C4C977415CAAFCCE10F7D57E11';
const EVO_HEADERS: Record<string, string> = { 'Content-Type': 'application/json', apikey: EVO_KEY };

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, '0'); }

/** Brasília = UTC-3 */
function nowBrasilia(): Date {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

function localDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function localHHMM(d: Date): string {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function formatDateBR(d: Date): string {
  const days = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  return `${days[d.getUTCDay()]}, ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
}

function formatTimeBR(isoStr: string): string {
  // "2026-03-13T14:30:00" → "14:30"
  return isoStr.substring(11, 16);
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{nome\}/gi, vars.nome || '')
    .replace(/\{dia\}/gi, vars.dia || '')
    .replace(/\{hora\}/gi, vars.hora || '')
    .replace(/\{servico\}/gi, vars.servico || '')
    .replace(/\{profissional\}/gi, vars.profissional || '');
}

// ── Evolution API ─────────────────────────────────────────────────────

async function sendWhatsApp(instance: string, phone: string, text: string): Promise<boolean> {
  const cleanNumber = phone.replace(/\D/g, '');
  try {
    const res = await fetch(`${EVO_URL}/message/sendText/${instance}`, {
      method: 'POST',
      headers: EVO_HEADERS,
      body: JSON.stringify({
        number: cleanNumber,
        text,
        options: { delay: 1200, presence: 'composing', linkPreview: false },
      }),
    });
    if (!res.ok) {
      console.error(`[EVO] sendText ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error(`[EVO] sendText error:`, e.message);
    return false;
  }
}

async function checkWhatsAppStatus(instance: string): Promise<string> {
  try {
    const res = await fetch(`${EVO_URL}/instance/connectionState/${instance}`, {
      headers: EVO_HEADERS,
    });
    if (!res.ok) return 'close';
    const json = await res.json();
    return json?.instance?.state || json?.state || 'close';
  } catch {
    return 'close';
  }
}

// ── Dedup (msg_dedup table) ───────────────────────────────────────────

async function claimMessage(fp: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('msg_dedup').insert({ fp });
    if (error?.code === '23505') return false; // unique violation = already claimed
    if (error) return true; // fail open
    return true;
  } catch {
    return true;
  }
}

// ── Agent Sessions (context registration) ─────────────────────────────

async function registerFollowUpContext(
  tenantId: string, phone: string, type: string, sentMessage: string,
  ctx: { apptId?: string; apptTime?: string; serviceName?: string;
         clientName?: string; professionalId?: string; serviceId?: string }
) {
  try {
    const { data: existing } = await supabase
      .from('agent_sessions')
      .select('data, history')
      .eq('tenant_id', tenantId).eq('phone', phone)
      .maybeSingle();

    const data: Record<string, any> = existing?.data || {};
    const history: Array<{ role: string; text: string }> = existing?.history || [];

    data.pendingFollowUpType = type;
    if (ctx.apptId) data.followUpApptId = ctx.apptId;
    if (ctx.apptTime) data.followUpApptTime = ctx.apptTime;
    if (ctx.serviceName) data.followUpServiceName = ctx.serviceName;
    if (ctx.professionalId) data.followUpProfessionalId = ctx.professionalId;
    if (ctx.serviceId) data.followUpServiceId = ctx.serviceId;
    if (ctx.clientName && !data.clientName) data.clientName = ctx.clientName;

    history.push({ role: 'bot', text: sentMessage });
    if (history.length > 20) history.splice(0, history.length - 20);

    await supabase.from('agent_sessions').upsert({
      tenant_id: tenantId, phone, data, history,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,phone' });
  } catch (e: any) {
    console.error(`[Session] registerFollowUp error:`, e.message);
  }
}

async function registerRatingContext(
  tenantId: string, phone: string, sentMessage: string,
  ctx: { apptId: string; serviceName: string; customerName: string; professionalName: string }
) {
  try {
    const { data: existing } = await supabase
      .from('agent_sessions')
      .select('data, history')
      .eq('tenant_id', tenantId).eq('phone', phone)
      .maybeSingle();

    const data: Record<string, any> = existing?.data || {};
    const history: Array<{ role: string; text: string }> = existing?.history || [];

    data.pendingRating = {
      apptId: ctx.apptId,
      serviceName: ctx.serviceName,
      customerName: ctx.customerName,
      professionalName: ctx.professionalName,
    };

    history.push({ role: 'bot', text: sentMessage });
    if (history.length > 20) history.splice(0, history.length - 20);

    await supabase.from('agent_sessions').upsert({
      tenant_id: tenantId, phone, data, history,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,phone' });
  } catch (e: any) {
    console.error(`[Session] registerRating error:`, e.message);
  }
}

async function hasUnansweredBotMsg(tenantId: string, phone: string): Promise<boolean> {
  try {
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const { data } = await supabase
      .from('agent_sessions')
      .select('history, updated_at')
      .eq('tenant_id', tenantId).eq('phone', phone)
      .maybeSingle();
    if (!data) return false;
    const age = Date.now() - new Date(data.updated_at).getTime();
    if (age > TWO_HOURS) return false;
    const hist = data.history || [];
    const last = hist[hist.length - 1];
    return !!last && last.role === 'bot';
  } catch {
    return false;
  }
}

// ── Settings helpers ──────────────────────────────────────────────────

interface FollowUpSettings {
  avisoModes: any[];
  lembreteModes: any[];
  reativacaoModes: any[];
  customerData: Record<string, any>;
  followUpSent: Record<string, string>;
  profAgendaSent: Record<string, string>;
  agendaDiariaHora: string;
  ratingEnabled: boolean;
  ratingSent: Record<string, string>;
  ratingMessage: string;
  rawFollowUp: Record<string, any>; // original JSONB for merge-back
}

function parseSettings(row: any): FollowUpSettings {
  const fu = row?.follow_up || {};
  return {
    avisoModes: fu._avisoModes || [],
    lembreteModes: fu._lembreteModes || [],
    reativacaoModes: fu._reativacaoModes || [],
    customerData: fu._customerData || {},
    followUpSent: fu._followUpSent || {},
    profAgendaSent: fu._profAgendaSent || {},
    agendaDiariaHora: fu._agendaDiariaHora || '00:01',
    ratingEnabled: fu._ratingEnabled ?? false,
    ratingSent: fu._ratingSent || {},
    ratingMessage: fu._ratingMessage || '',
    rawFollowUp: fu,
  };
}

/** Merge a single _key back into follow_up JSONB and save */
async function saveFollowUpField(tenantId: string, rawFollowUp: Record<string, any>, key: string, value: any) {
  const updated = { ...rawFollowUp, [key]: value };
  await supabase.from('tenant_settings')
    .update({ follow_up: updated })
    .eq('tenant_id', tenantId);
}

// ── Customer mode helpers ─────────────────────────────────────────────

function getCustModeId(customerData: Record<string, any>, custId: string, type: 'aviso' | 'lembrete' | 'reativacao'): string {
  const cd = customerData[custId] || {};
  const key = `${type}ModeId`;
  return cd[key] || 'standard';
}

// ── Main handler ──────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const startMs = Date.now();
  const errors: string[] = [];
  let processed = 0;

  try {
    // Get central instance from global_settings (used by jobs 6 & 7)
    let centralInstance = 'central_AgendeZap';
    try {
      const { data: gRows } = await supabase.from('global_settings').select('key, value');
      const ciRow = (gRows || []).find((r: any) => r.key === 'central_instance');
      if (ciRow?.value) centralInstance = ciRow.value;
    } catch {}

    // Fetch all active tenants
    const { data: tenants, error: tErr } = await supabase
      .from('tenants')
      .select('id, nome, slug, phone, evolution_instance, status')
      .or('status.eq.active,status.eq.ATIVA,status.eq.trial,status.eq.TRIAL');
    if (tErr) throw tErr;
    if (!tenants?.length) {
      return new Response(JSON.stringify({ processed: 0, msg: 'no active tenants' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    for (const tenant of tenants) {
      const tenantId = tenant.id;
      const instance = tenant.evolution_instance;
      if (!instance) continue;

      try {
        // Load all data for this tenant in parallel
        const [settingsRow, apptsResult, custsResult, svcsResult, profsResult] = await Promise.all([
          supabase.from('tenant_settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
          supabase.from('appointments').select('*').eq('tenant_id', tenantId),
          supabase.from('customers').select('*').eq('tenant_id', tenantId),
          supabase.from('services').select('*').eq('tenant_id', tenantId),
          supabase.from('professionals').select('*').eq('tenant_id', tenantId),
        ]);

        const settings = parseSettings(settingsRow.data);
        const allAppts = (apptsResult.data || []).map((a: any) => ({
          ...a,
          startTime: a.inicio,
          service_id: a.service_id,
          customer_id: a.customer_id,
          professional_id: a.professional_id,
        }));
        const customers = (custsResult.data || []).map((c: any) => ({
          id: c.id,
          name: c.nome || 'Sem Nome',
          phone: c.telefone || '',
          avisoModeId: getCustModeId(settings.customerData, c.id, 'aviso'),
          lembreteModeId: getCustModeId(settings.customerData, c.id, 'lembrete'),
          reativacaoModeId: getCustModeId(settings.customerData, c.id, 'reativacao'),
        }));
        const services = (svcsResult.data || []).map((s: any) => ({
          id: s.id, name: s.nome || '',
        }));
        const professionals = (profsResult.data || []).map((p: any) => ({
          id: p.id, name: p.nome || '', phone: p.telefone || '', active: p.ativo !== false,
        }));

        const now = nowBrasilia();
        const nowMs = now.getTime();
        const nowDate = localDateStr(now);
        const nowHHMM = localHHMM(now);

        const findCust = (id: string) => customers.find((c: any) => c.id === id);
        const findSvc = (id: string) => services.find((s: any) => s.id === id);
        const findProf = (id: string) => professionals.find((p: any) => p.id === id);

        // Mutable tracking maps — will be saved at end
        const newFollowUpSent = { ...settings.followUpSent };
        const newProfAgendaSent = { ...settings.profAgendaSent };
        const newRatingSent = { ...settings.ratingSent };
        let anyFollowUpSent = false;
        let anyAgendaSent = false;
        let anyRatingSent = false;

        // ── 1. AVISO (check-in diário) ────────────────────────────────
        if (settings.avisoModes.length > 0) {
          for (const appt of allAppts) {
            if (appt.status !== 'PENDING' && appt.status !== 'CONFIRMED') continue;
            const apptDate = appt.startTime?.slice(0, 10);
            if (apptDate !== nowDate) continue;

            const cust = findCust(appt.customer_id);
            if (!cust?.phone) continue;

            const mode = settings.avisoModes.find((m: any) => m.id === cust.avisoModeId && m.active);
            if (!mode) continue;

            const sentKey = `aviso::${appt.id}`;
            const custDayKey = `aviso::cust::${cust.id}::${nowDate}`;
            if (newFollowUpSent[sentKey] || newFollowUpSent[custDayKey]) continue;

            const fixedHHMM = mode.fixedTime || '08:00';
            if (nowHHMM < fixedHHMM) continue;

            // Skip if agent has unanswered bot message
            if (await hasUnansweredBotMsg(tenantId, cust.phone)) continue;

            // Atomic claim
            if (!(await claimMessage(`fu::aviso::${cust.id}::${nowDate}`))) continue;

            const svc = findSvc(appt.service_id);
            const apptTime = formatTimeBR(appt.startTime);

            const msg = interpolate(mode.message, {
              nome: cust.name, dia: 'hoje', hora: apptTime, servico: svc?.name || '',
            });

            const sent = await sendWhatsApp(instance, cust.phone, msg);
            if (sent) {
              newFollowUpSent[sentKey] = nowDate;
              newFollowUpSent[custDayKey] = nowDate;
              anyFollowUpSent = true;
              console.log(`[Aviso] ${tenant.nome} → ${cust.name}`);
              await registerFollowUpContext(tenantId, cust.phone, 'aviso', msg, {
                apptId: appt.id, apptTime, serviceName: svc?.name || '',
                clientName: cust.name, professionalId: appt.professional_id,
                serviceId: appt.service_id,
              });
            }
          }
        }

        // ── 2. LEMBRETE (minutos antes) ───────────────────────────────
        if (settings.lembreteModes.length > 0) {
          for (const appt of allAppts) {
            if (appt.status !== 'PENDING' && appt.status !== 'CONFIRMED') continue;

            const apptMs = new Date(appt.startTime).getTime();
            const minutesUntil = (apptMs - nowMs) / 60000;
            if (minutesUntil <= 0 || minutesUntil > 240) continue;

            const cust = findCust(appt.customer_id);
            if (!cust?.phone) continue;

            const mode = settings.lembreteModes.find((m: any) => m.id === cust.lembreteModeId && m.active);
            if (!mode) continue;

            const sentKey = `lembrete::${appt.id}`;
            if (newFollowUpSent[sentKey]) continue;
            if (minutesUntil > mode.timing) continue;

            if (await hasUnansweredBotMsg(tenantId, cust.phone)) continue;
            if (!(await claimMessage(`fu::lembrete::${appt.id}`))) continue;

            const svc = findSvc(appt.service_id);
            const apptTime = formatTimeBR(appt.startTime);

            const msg = interpolate(mode.message, {
              nome: cust.name, dia: 'hoje', hora: apptTime, servico: svc?.name || '',
            });

            const sent = await sendWhatsApp(instance, cust.phone, msg);
            if (sent) {
              newFollowUpSent[sentKey] = new Date().toISOString();
              anyFollowUpSent = true;
              console.log(`[Lembrete] ${tenant.nome} → ${cust.name} (${Math.round(minutesUntil)}min)`);
              await registerFollowUpContext(tenantId, cust.phone, 'lembrete', msg, {
                apptId: appt.id, apptTime, serviceName: svc?.name || '',
                clientName: cust.name, professionalId: appt.professional_id,
                serviceId: appt.service_id,
              });
            }
          }
        }

        // ── 3. REATIVAÇÃO (cliente inativo) ───────────────────────────
        if (settings.reativacaoModes.length > 0) {
          // Build map: customerId → most recent FINISHED appointment
          const custLastFinished: Record<string, { appt: any; date: Date }> = {};
          for (const appt of allAppts) {
            if (appt.status !== 'FINISHED') continue;
            const d = new Date(appt.startTime);
            const prev = custLastFinished[appt.customer_id];
            if (!prev || d > prev.date) {
              custLastFinished[appt.customer_id] = { appt, date: d };
            }
          }

          for (const [custId, { appt: lastAppt, date: lastDate }] of Object.entries(custLastFinished)) {
            const cust = findCust(custId);
            if (!cust?.phone) continue;

            const mode = settings.reativacaoModes.find((m: any) => m.id === cust.reativacaoModeId && m.active);
            if (!mode) continue;

            const sentKey = `reativacao::${custId}::${lastAppt.id}`;
            if (newFollowUpSent[sentKey]) continue;

            const daysSince = (nowMs - lastDate.getTime()) / 86400000;
            if (daysSince < mode.timing) continue;

            // Check no new booking since
            const hasNewBooking = allAppts.some((a: any) =>
              a.customer_id === custId &&
              a.id !== lastAppt.id &&
              new Date(a.startTime) > lastDate &&
              (a.status === 'PENDING' || a.status === 'CONFIRMED' || a.status === 'FINISHED')
            );
            if (hasNewBooking) continue;

            if (!(await claimMessage(`fu::reativacao::${custId}::${lastAppt.id}`))) continue;

            const svc = findSvc(lastAppt.service_id);
            const msg = interpolate(mode.message, {
              nome: cust.name,
              dia: `${pad(lastDate.getUTCDate())}/${pad(lastDate.getUTCMonth() + 1)}`,
              hora: formatTimeBR(lastAppt.startTime),
              servico: svc?.name || '',
            });

            const sent = await sendWhatsApp(instance, cust.phone, msg);
            if (sent) {
              newFollowUpSent[sentKey] = nowDate;
              anyFollowUpSent = true;
              console.log(`[Reativação] ${tenant.nome} → ${cust.name} (${daysSince.toFixed(0)}d)`);
              await registerFollowUpContext(tenantId, cust.phone, 'reativacao', msg, {
                serviceName: svc?.name || '', clientName: cust.name,
              });
            }
          }
        }

        // ── 4. AGENDA DIÁRIA DOS PROFISSIONAIS ────────────────────────
        {
          const sendHHMM = settings.agendaDiariaHora || '00:01';
          if (nowHHMM >= sendHHMM) {
            const todayAppts = allAppts.filter((a: any) =>
              (a.status === 'PENDING' || a.status === 'CONFIRMED') &&
              a.startTime?.slice(0, 10) === nowDate
            );

            for (const prof of professionals) {
              if (!prof.active || !prof.phone) continue;

              const sentKey = `${prof.id}::${nowDate}`;
              if (newProfAgendaSent[sentKey]) continue;

              const profAppts = todayAppts
                .filter((a: any) => a.professional_id === prof.id)
                .sort((a: any, b: any) => a.startTime.localeCompare(b.startTime));

              if (profAppts.length === 0) {
                newProfAgendaSent[sentKey] = 'skip';
                anyAgendaSent = true;
                continue;
              }

              const dateFmt = formatDateBR(now);
              const lines = profAppts.map((a: any) => {
                const cust = findCust(a.customer_id);
                const svc = findSvc(a.service_id);
                const hora = formatTimeBR(a.startTime);
                return `⏰ ${hora} — ${cust?.name || 'Cliente'} | ${svc?.name || 'Procedimento'}`;
              });

              const msg =
                `📅 *Agenda de hoje — ${dateFmt}*\n\n` +
                `Olá, ${prof.name}! Aqui estão seus procedimentos de hoje:\n\n` +
                lines.join('\n') +
                `\n\n🔢 Total: ${profAppts.length} procedimento${profAppts.length > 1 ? 's' : ''}\n\nTenha um ótimo dia! 💪`;

              const sent = await sendWhatsApp(instance, prof.phone, msg);
              if (sent) {
                newProfAgendaSent[sentKey] = 'sent';
                anyAgendaSent = true;
                console.log(`[Agenda] ${tenant.nome} → ${prof.name} (${profAppts.length} appts)`);
              }
            }
          }
        }

        // ── 5. RATING (avaliação pós-atendimento) ─────────────────────
        if (settings.ratingEnabled) {
          const connStatus = await checkWhatsAppStatus(instance);
          if (connStatus === 'open') {
            // Last 24h of finished appointments
            const since24h = new Date(nowMs - 24 * 60 * 60 * 1000);
            const sinceDate = localDateStr(since24h);

            const defaultRatingMsg =
              'Olá {nome}! 😊\n\nComo foi seu *{servico}* hoje? Dê uma nota de *0 a 10* para nos ajudar a melhorar! ⭐';
            const msgTemplate = settings.ratingMessage || defaultRatingMsg;

            for (const appt of allAppts) {
              if (appt.status !== 'FINISHED') continue;
              const apptDate = appt.startTime?.slice(0, 10);
              if (!apptDate || apptDate < sinceDate) continue;

              const sentKey = `rating::${appt.id}`;
              if (newRatingSent[sentKey]) continue;

              // Check if already reviewed
              const { data: reviewData } = await supabase
                .from('reviews')
                .select('id')
                .eq('appointment_id', appt.id)
                .limit(1);
              if (reviewData && reviewData.length > 0) {
                newRatingSent[sentKey] = nowDate;
                continue;
              }

              const cust = findCust(appt.customer_id);
              if (!cust?.phone) continue;

              if (!(await claimMessage(`rating::${appt.id}`))) continue;

              const svc = findSvc(appt.service_id);
              const prof = findProf(appt.professional_id);

              const msg = interpolate(msgTemplate, {
                nome: cust.name,
                servico: svc?.name || 'procedimento',
                profissional: prof?.name || '',
              });

              const sent = await sendWhatsApp(instance, cust.phone, msg);
              if (sent) {
                newRatingSent[sentKey] = nowDate;
                anyRatingSent = true;
                console.log(`[Rating] ${tenant.nome} → ${cust.name}`);
                await registerRatingContext(tenantId, cust.phone, msg, {
                  apptId: appt.id,
                  serviceName: svc?.name || '',
                  customerName: cust.name,
                  professionalName: prof?.name || '',
                });
              }
            }
          }
        }

        // ── Persist updated tracking maps ─────────────────────────────
        if (anyFollowUpSent) {
          await saveFollowUpField(tenantId, settings.rawFollowUp, '_followUpSent', newFollowUpSent);
        }
        if (anyAgendaSent) {
          await saveFollowUpField(tenantId, settings.rawFollowUp, '_profAgendaSent', newProfAgendaSent);
        }
        if (anyRatingSent) {
          await saveFollowUpField(tenantId, settings.rawFollowUp, '_ratingSent', newRatingSent);
        }

        // ── 7. RELATÓRIO SEMANAL (domingo 09:00 → admins via WA) ────
        {
          const isDomingo = now.getUTCDay() === 0;
          const isReportWindow = nowHHMM >= '09:00' && nowHHMM < '09:10';
          const weekKey = `weeklyReport::${nowDate}`;
          const alreadySent = settings.rawFollowUp._weeklyReportSent === nowDate;

          if (isDomingo && isReportWindow && !alreadySent) {
            try {
              // Dedup
              if (await claimMessage(`weekly::${tenantId}::${nowDate}`)) {
                // Calculate week range (Mon-Sun)
                const weekEnd = new Date(now);
                const weekStart = new Date(now);
                weekStart.setUTCDate(weekStart.getUTCDate() - 6);
                const weekStartStr = localDateStr(weekStart);
                const weekEndStr = localDateStr(weekEnd);
                const weekStartBR = `${pad(weekStart.getUTCDate())}/${pad(weekStart.getUTCMonth() + 1)}`;
                const weekEndBR = `${pad(weekEnd.getUTCDate())}/${pad(weekEnd.getUTCMonth() + 1)}`;

                // Week appointments
                const weekAppts = allAppts.filter((a: any) => {
                  const d = a.startTime?.slice(0, 10);
                  return d >= weekStartStr && d <= weekEndStr;
                });
                const totalAppts = weekAppts.length;
                const confirmed = weekAppts.filter((a: any) => a.status === 'CONFIRMED' || a.status === 'COMPLETED' || a.status === 'FINISHED').length;
                const cancelled = weekAppts.filter((a: any) => a.status === 'CANCELLED').length;
                const noShow = weekAppts.filter((a: any) => a.status === 'NO_SHOW').length;
                const revenue = weekAppts.reduce((sum: number, a: any) => sum + (Number(a.amount_paid) || 0), 0);

                // New customers this week
                const weekCustIds = new Set(weekAppts.map((a: any) => a.customer_id));
                const prevAppts = allAppts.filter((a: any) => a.startTime?.slice(0, 10) < weekStartStr);
                const prevCustIds = new Set(prevAppts.map((a: any) => a.customer_id));
                let newClients = 0;
                weekCustIds.forEach(id => { if (!prevCustIds.has(id)) newClients++; });

                // Per professional
                const profStats: Record<string, { name: string; count: number }> = {};
                for (const a of weekAppts) {
                  const p = findProf(a.professional_id);
                  if (!p) continue;
                  if (!profStats[p.id]) profStats[p.id] = { name: p.name, count: 0 };
                  profStats[p.id].count++;
                }
                const profRanking = Object.values(profStats).sort((a, b) => b.count - a.count);

                // Top services
                const svcStats: Record<string, { name: string; count: number }> = {};
                for (const a of weekAppts) {
                  const s = findSvc(a.service_id);
                  if (!s) continue;
                  if (!svcStats[s.id]) svcStats[s.id] = { name: s.name, count: 0 };
                  svcStats[s.id].count++;
                }
                const topSvcs = Object.values(svcStats).sort((a, b) => b.count - a.count).slice(0, 3);

                // Previous week for comparison
                const prevWeekEnd = new Date(weekStart);
                prevWeekEnd.setUTCDate(prevWeekEnd.getUTCDate() - 1);
                const prevWeekStart = new Date(prevWeekEnd);
                prevWeekStart.setUTCDate(prevWeekStart.getUTCDate() - 6);
                const pwStartStr = localDateStr(prevWeekStart);
                const pwEndStr = localDateStr(prevWeekEnd);
                const prevWeekAppts = allAppts.filter((a: any) => {
                  const d = a.startTime?.slice(0, 10);
                  return d >= pwStartStr && d <= pwEndStr;
                });
                const prevTotal = prevWeekAppts.length;
                const growthPct = prevTotal > 0 ? Math.round(((totalAppts - prevTotal) / prevTotal) * 100) : 0;
                const growthText = prevTotal > 0
                  ? (growthPct > 0 ? `📈 *+${growthPct}% comparado com a semana anterior — vocês estão crescendo!*` : growthPct < 0 ? `📉 ${growthPct}% comparado com a semana anterior` : '📊 Mesmo volume da semana anterior — constância é tudo!')
                  : '';

                // AI usage hint
                const aiAppts = weekAppts.filter((a: any) => a.origem === 'AI').length;
                const manualPct = totalAppts > 0 ? Math.round(((totalAppts - aiAppts) / totalAppts) * 100) : 0;
                const aiHint = manualPct > 80 && totalAppts > 5
                  ? `\n💡 *Dica:* ${manualPct}% dos agendamentos ainda são manuais — ative o agente IA no WhatsApp e libere seu tempo! 🤖`
                  : '';

                // Build message
                const profLines = profRanking.map(p => `→ ${p.name}: ${p.count} atendimentos`).join('\n');
                const svcLines = topSvcs.map((s, i) => `${i + 1}. ${s.name} — ${s.count}`).join('\n');
                const ticketMedio = totalAppts > 0 && revenue > 0 ? `\n💳 *Ticket médio:* R$${(revenue / totalAppts).toFixed(2)}` : '';

                const msg = totalAppts > 0
                  ? `🔥 *Semana incrível, ${tenant.nome}!*\n\n` +
                    `Olha só o que vocês conquistaram de ${weekStartBR} a ${weekEndBR}:\n\n` +
                    `✅ *${totalAppts} clientes atendidos*\n` +
                    (revenue > 0 ? `💰 *R$${revenue.toFixed(2).replace('.', ',')} em receita*\n` : '') +
                    (newClients > 0 ? `🆕 *${newClients} novos clientes* descobriram vocês!\n` : '') +
                    ticketMedio + '\n\n' +
                    (growthText ? growthText + '\n\n' : '') +
                    `🏆 *Equipe:*\n${profLines}\n\n` +
                    `💈 *Top serviços:*\n${svcLines}\n\n` +
                    (cancelled > 0 || noShow > 0 ? `❌ Cancelamentos: ${cancelled} | Faltas: ${noShow}\n\n` : '') +
                    `⚡ *Com o AgendeZap organizando sua agenda, nenhum horário ficou perdido!*` +
                    aiHint +
                    `\n\n*Bora pra mais uma semana de sucesso!* 💪\n— Equipe AgendeZap`
                  : null; // Don't send if no appointments this week

                if (msg) {
                  // Find admin professionals (or fallback to tenant phone)
                  const profMeta = settings.rawFollowUp._professionalMeta || {};
                  const adminProfs = professionals.filter((p: any) => {
                    const meta = profMeta[p.id];
                    return meta?.role === 'admin' && p.phone;
                  });

                  const recipients: string[] = adminProfs.length > 0
                    ? adminProfs.map((p: any) => p.phone)
                    : (tenant.phone ? [tenant.phone] : []);

                  for (const phone of recipients) {
                    await sendWhatsApp(centralInstance, phone, msg);
                  }

                  if (recipients.length > 0) {
                    // Mark as sent using atomic function
                    try {
                      await supabase.rpc('set_follow_up_key', {
                        p_tenant_id: tenantId,
                        p_key: '_weeklyReportSent',
                        p_value: JSON.stringify(nowDate),
                      });
                    } catch {
                      await saveFollowUpField(tenantId, settings.rawFollowUp, '_weeklyReportSent', nowDate);
                    }
                    console.log(`[WeeklyReport] ${tenant.nome} → ${recipients.length} admin(s) (${totalAppts} appts, R$${revenue.toFixed(0)})`);
                  }
                }
              }
            } catch (e: any) {
              console.error(`[WeeklyReport] Error ${tenant.nome}:`, e.message);
            }
          }
        }

        // ── 8. MENSAGEM DE INDICAÇÃO (domingo ~09:05 → admins via WA, após relatório) ──
        {
          const isDomingo = now.getUTCDay() === 0;
          const isRefWindow = nowHHMM >= '09:05' && nowHHMM < '09:15';
          const alreadySentRef = settings.rawFollowUp._referralMsgSent === nowDate;

          if (isDomingo && isRefWindow && !alreadySentRef && tenant.slug) {
            try {
              if (await claimMessage(`referral::${tenantId}::${nowDate}`)) {
                // Count active referrals for this tenant
                let activeReferrals = 0;
                let totalRefRevenue = 0;
                try {
                  const { data: refData } = await supabase.rpc('referral_summary', { p_tenant_id: tenantId });
                  if (refData) {
                    activeReferrals = refData[0]?.active_referrals || 0;
                    totalRefRevenue = Number(refData[0]?.total_referral_revenue) || 0;
                  }
                } catch { /* function may not exist yet */ }

                const refLink = `https://www.agendezap.com/?ref=${tenant.slug}`;

                // Build referral status line
                let statusLine = '';
                if (activeReferrals > 0) {
                  const discount = activeReferrals * 20;
                  const cappedDiscount = Math.min(discount, 100);
                  statusLine = `\n\n🎯 *Suas indicações ativas: ${activeReferrals}*\n` +
                    `💸 Desconto atual: *${cappedDiscount}% na sua assinatura*`;
                  if (activeReferrals >= 5) {
                    const pixEarnings = totalRefRevenue * 0.10;
                    statusLine += `\n🤑 *Bônus PIX: R$${pixEarnings.toFixed(2).replace('.', ',')}* por mês (10% das assinaturas dos indicados)`;
                  } else {
                    statusLine += `\n📍 Faltam *${5 - activeReferrals}* indicações para começar a ganhar *10% via PIX* das assinaturas!`;
                  }
                }

                const msg = `💜 *Indique o AgendeZap e ganhe!*\n\n` +
                  `Você sabia que pode *reduzir sua assinatura a ZERO* e ainda *ganhar dinheiro via PIX* indicando parceiros?\n\n` +
                  `✅ *20% de desconto* na sua assinatura para cada indicação que *contratar um plano*\n` +
                  `✅ Receba *enquanto sua indicação mantiver a assinatura ativa*\n` +
                  `✅ A partir de *5 indicações ativas*, ganhe *10% do valor de cada assinatura via PIX* todo mês!\n\n` +
                  `🔗 *Seu link exclusivo de indicação:*\n${refLink}\n\n` +
                  `Envie para colegas, parceiros, amigos que têm negócio — salão, barbearia, clínica, consultório, estúdio...\n` +
                  `Quanto mais indicações, mais você ganha! 🚀` +
                  statusLine;

                // Send to same admin recipients as weekly report
                const profMeta = settings.rawFollowUp._professionalMeta || {};
                const adminProfs = professionals.filter((p: any) => {
                  const meta = profMeta[p.id];
                  return meta?.role === 'admin' && p.phone;
                });
                const recipients: string[] = adminProfs.length > 0
                  ? adminProfs.map((p: any) => p.phone)
                  : (tenant.phone ? [tenant.phone] : []);

                for (const phone of recipients) {
                  // Small delay so it arrives after the report
                  await new Promise(r => setTimeout(r, 3000));
                  await sendWhatsApp(centralInstance, phone, msg);
                }

                if (recipients.length > 0) {
                  try {
                    await supabase.rpc('set_follow_up_key', {
                      p_tenant_id: tenantId,
                      p_key: '_referralMsgSent',
                      p_value: JSON.stringify(nowDate),
                    });
                  } catch {
                    await saveFollowUpField(tenantId, settings.rawFollowUp, '_referralMsgSent', nowDate);
                  }
                  console.log(`[Referral] ${tenant.nome} → ${recipients.length} admin(s) (${activeReferrals} active refs)`);
                }
              }
            } catch (e: any) {
              console.error(`[Referral] Error ${tenant.nome}:`, e.message);
            }
          }
        }

        // ── 11. CUSTOMER REFERRAL PITCH (após atendimento finalizado) ─────
        {
          // Find FINISHED appointments in the last 24h
          const since24h = new Date(nowMs - 24 * 60 * 60 * 1000);
          const sinceStr = localDateStr(since24h);

          for (const appt of allAppts) {
            if (appt.status !== 'FINISHED') continue;
            const apptDate = appt.startTime?.slice(0, 10);
            if (!apptDate || apptDate < sinceStr) continue;

            // Check if at least 2h have passed since appointment time
            const apptTime = new Date(appt.startTime).getTime();
            const elapsed = nowMs + 3 * 60 * 60 * 1000 - apptTime; // adjust for Brasilia offset
            if (elapsed < 2 * 60 * 60 * 1000) continue; // skip if less than 2h

            const cust = findCust(appt.customer_id);
            if (!cust?.phone) continue;

            // Skip blocklisted phones
            const REFERRAL_BLOCKLIST = ['554488167383'];
            if (REFERRAL_BLOCKLIST.includes(cust.phone.replace(/\D/g, ''))) continue;

            // Dedup: only send ONCE per customer phone (ever)
            const fp = `cust_referral::${cust.phone}`;
            if (!(await claimMessage(fp))) continue;

            const cleanPhone = cust.phone.replace(/\D/g, '');
            const custName = cust.name || 'tudo bem';
            const msg = `Oi ${custName}! Você é cliente da *${tenant.nome}* 😊\n\n` +
              `Sabia que eles usam o *AgendeZap* para organizar agendamentos com IA, relatórios financeiros e muito mais?\n\n` +
              `Se você conhece algum profissional (barbeiro, cabeleireira, dentista, personal...) que poderia usar essa ferramenta, indique e ganhe!\n\n` +
              `💰 Você recebe *10% do valor da assinatura via PIX todo mês* enquanto sua indicação mantiver ativa!\n\n` +
              `🔗 Seu link de indicação:\nhttps://www.agendezap.com/?ref_c=${cleanPhone}\n\n` +
              `É super simples — compartilhe com quem pode se beneficiar! 🚀`;

            const sent = await sendWhatsApp(centralInstance, cust.phone, msg);
            if (sent) {
              console.log(`[CustReferral] ${tenant.nome} → ${cust.name} (${cust.phone})`);
            }
          }
        }

        processed++;
      } catch (e: any) {
        errors.push(`${tenant.nome || tenantId}: ${e.message}`);
        console.error(`[FollowUp] Error tenant ${tenant.nome}:`, e.message);
      }
    }
    // ── 6. PAYMENT PENDING REMINDER (central WA → tenants sem pagamento após 6h) ──
    try {
      // Find tenants with trial or pending payment status, created > 6h ago
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: pendingTenants } = await supabase
        .from('tenants')
        .select('id, nome, name, phone, email, status, created_at')
        .or('status.eq.trial,status.eq.TRIAL,status.eq.PAGAMENTO PENDENTE')
        .lt('created_at', sixHoursAgo);

      if (pendingTenants?.length) {
        // Check which ones DON'T have a subscription (never paid)
        for (const pt of pendingTenants) {
          if (!pt.phone) continue;
          try {
            const { data: stRow } = await supabase.from('tenant_settings')
              .select('follow_up').eq('tenant_id', pt.id).maybeSingle();
            const fu = stRow?.follow_up || {};

            // Skip if already has a subscription (already paid at some point)
            if (fu._asaasSubscriptionId) continue;
            // Skip if reminder already sent
            if (fu._paymentReminderSent) continue;

            const displayName = pt.nome || pt.name || 'parceiro(a)';
            const msg = `Olá ${displayName}! 😊\n\n` +
              `Vi que você começou seu cadastro no *AgendeZap* mas ainda não finalizou o pagamento.\n\n` +
              `Aconteceu algum problema? Posso te ajudar!\n\n` +
              `Se quiser finalizar, é rapidinho — acesse o painel e clique em "Assinar Plano". ` +
              `Qualquer dúvida estou por aqui! 🚀`;

            const sent = await sendWhatsApp(centralInstance, pt.phone, msg);
            if (sent) {
              // Mark as sent to avoid resending
              const updatedFu = { ...fu, _paymentReminderSent: new Date().toISOString() };
              await supabase.from('tenant_settings').update({ follow_up: updatedFu }).eq('tenant_id', pt.id);
              console.log(`[FollowUp] Payment reminder sent to ${displayName} (${pt.phone})`);
            }
          } catch (e: any) {
            console.error(`[FollowUp] Payment reminder error for ${pt.id}:`, e.message);
          }
        }
      }
    } catch (e: any) {
      errors.push(`payment-reminder: ${e.message}`);
      console.error('[FollowUp] Payment reminder job error:', e.message);
    }

    // ── 9a. NOTIFY REFERRER ON NEW REFERRAL SIGNUP ──────────────────────
    try {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: newReferrals } = await supabase
        .from('tenants')
        .select('id, nome, referred_by, created_at')
        .not('referred_by', 'is', null)
        .gt('created_at', thirtyMinAgo);

      for (const nr of (newReferrals || [])) {
        try {
          if (!(await claimMessage(`referral_notify::${nr.id}`))) continue;
          const { data: referrer } = await supabase
            .from('tenants').select('id, nome, phone').eq('id', nr.referred_by).single();
          if (!referrer?.phone) continue;

          const msg = `🎉 *Boa noticia!*\n\n` +
            `*${nr.nome || 'Novo parceiro'}* acabou de se cadastrar no AgendeZap pela sua indicação!\n\n` +
            `Quando contratar um plano, você ganha automaticamente *20% de desconto* na sua assinatura! 💜\n\n` +
            `Continue indicando — cada indicação ativa = mais desconto! 🚀`;

          await sendWhatsApp(centralInstance, referrer.phone, msg);
          console.log(`[Referral Notify] ${referrer.nome} notified about ${nr.nome}`);
        } catch (e: any) {
          console.error(`[Referral Notify] Error ${nr.id}:`, e.message);
        }
      }
    } catch (e: any) {
      errors.push(`referral-notify: ${e.message}`);
      console.error('[Referral Notify] Job error:', e.message);
    }

    // ── 9b. NOTIFY REFERRER WHEN REFERRAL PAYS (becomes ATIVA) ──────────
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: paidReferrals } = await supabase
        .from('tenants')
        .select('id, nome, referred_by')
        .not('referred_by', 'is', null)
        .eq('status', 'ATIVA')
        .gt('created_at', oneDayAgo);

      for (const pr of (paidReferrals || [])) {
        try {
          if (!(await claimMessage(`referral_paid_notify::${pr.id}`))) continue;
          const { data: referrer } = await supabase
            .from('tenants').select('id, nome, phone').eq('id', pr.referred_by).single();
          if (!referrer?.phone) continue;

          const { data: refCount } = await supabase.rpc('count_active_referrals', { p_tenant_id: referrer.id });
          const activeCount = refCount || 1;
          const discount = Math.min(activeCount * 20, 100);

          const msg = `🎊 *Parabéns!*\n\n` +
            `*${pr.nome}* (sua indicação) contratou um plano no AgendeZap!\n\n` +
            `🎯 Você agora tem *${activeCount} indicação(ões) ativa(s)*\n` +
            `💸 Seu desconto: *${discount}% na sua assinatura*\n` +
            (activeCount >= 5
              ? `🤑 *Bônus PIX ativado!* Você recebe 10% de cada assinatura dos seus indicados!\n`
              : `📍 Faltam *${5 - activeCount}* para ativar o bônus PIX de 10%!\n`) +
            `\nContinue indicando! 🚀`;

          await sendWhatsApp(centralInstance, referrer.phone, msg);
          console.log(`[Referral Paid] ${referrer.nome} notified (${activeCount} active)`);
        } catch (e: any) {
          console.error(`[Referral Paid] Error ${pr.id}:`, e.message);
        }
      }
    } catch (e: any) {
      errors.push(`referral-paid-notify: ${e.message}`);
      console.error('[Referral Paid] Job error:', e.message);
    }

    // ── 10. MONTHLY REFERRAL DISCOUNT RECALCULATION (1st of month 03:00) ──
    try {
      const gNow = nowBrasilia();
      const gHHMM = localHHMM(gNow);
      if (gNow.getUTCDate() === 1 && gHHMM >= '03:00' && gHHMM < '03:10') {
        const ASAAS_API_KEY = Deno.env.get('ASAAS_API_KEY') || '';
        const ASAAS_API_URL = Deno.env.get('ASAAS_API_URL') || 'https://api.asaas.com/v3';
        const PLAN_PRICES: Record<string, number> = { START: 39.90, PROFISSIONAL: 89.90, ELITE: 149.90 };
        const CYCLE_CFG: Record<string, { m: number; d: number }> = {
          MONTHLY: { m: 1, d: 0 }, QUARTERLY: { m: 3, d: 0.10 },
          SEMIANNUALLY: { m: 6, d: 0.15 }, YEARLY: { m: 12, d: 0.25 },
        };

        const { data: allSettings } = await supabase.from('tenant_settings').select('tenant_id, follow_up');

        for (const row of (allSettings || [])) {
          const fu = row.follow_up || {};
          const subId = fu._asaasSubscriptionId;
          const planId = fu._asaasPlanId;
          if (!subId || !planId || !PLAN_PRICES[planId]) continue;

          try {
            const { data: refCount } = await supabase.rpc('count_active_referrals', { p_tenant_id: row.tenant_id });
            const activeRefs = refCount || 0;
            const discountPct = Math.min(activeRefs * 20, 100);
            const cc = CYCLE_CFG[fu._asaasCycle || 'MONTHLY'] || CYCLE_CFG.MONTHLY;
            const newValue = Math.round(PLAN_PRICES[planId] * cc.m * (1 - cc.d) * (1 - discountPct / 100) * 100) / 100;

            const res = await fetch(`${ASAAS_API_URL}/subscriptions/${subId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'access_token': ASAAS_API_KEY },
              body: JSON.stringify({ value: newValue }),
            });

            if (res.ok) {
              await supabase.rpc('set_follow_up_key', {
                p_tenant_id: row.tenant_id,
                p_key: '_referralDiscount',
                p_value: JSON.stringify(discountPct),
              });
              await supabase.rpc('set_follow_up_key', {
                p_tenant_id: row.tenant_id,
                p_key: '_referralActiveCount',
                p_value: JSON.stringify(activeRefs),
              });
              console.log(`[ReferralRecalc] ${row.tenant_id}: ${activeRefs} refs, ${discountPct}%, R$${newValue}`);
            }
            await new Promise(r => setTimeout(r, 500)); // rate limit
          } catch (e: any) {
            console.error(`[ReferralRecalc] Error ${row.tenant_id}:`, e.message);
          }
        }
      }
    } catch (e: any) {
      errors.push(`referral-recalc: ${e.message}`);
      console.error('[ReferralRecalc] Job error:', e.message);
    }

    // ── 12a. NOTIFY CUSTOMER WHEN THEIR REFERRAL SIGNS UP ─────────────
    try {
      const thirtyMinAgo2 = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: custNewRefs } = await supabase
        .from('tenants')
        .select('id, nome, referred_by_customer, created_at')
        .not('referred_by_customer', 'is', null)
        .gt('created_at', thirtyMinAgo2);

      for (const cr of (custNewRefs || [])) {
        try {
          if (!(await claimMessage(`cust_referral_signup::${cr.id}`))) continue;
          const custPhone = cr.referred_by_customer;
          if (!custPhone) continue;

          const msg = `🎉 *Boa notícia!*\n\n` +
            `*${cr.nome || 'Um novo negócio'}* acabou de se cadastrar no AgendeZap pela sua indicação!\n\n` +
            `Quando contratar um plano, você começa a receber *10% do valor da assinatura via PIX* todo mês! 💰\n\n` +
            `Continue indicando — quanto mais indicações ativas, mais você ganha! 🚀`;

          await sendWhatsApp(centralInstance, custPhone, msg);
          console.log(`[CustReferral Signup] ${custPhone} notified about ${cr.nome}`);
        } catch (e: any) {
          console.error(`[CustReferral Signup] Error ${cr.id}:`, e.message);
        }
      }
    } catch (e: any) {
      errors.push(`cust-referral-signup: ${e.message}`);
      console.error('[CustReferral Signup] Job error:', e.message);
    }

    // ── 12b. NOTIFY CUSTOMER WHEN THEIR REFERRAL PAYS ─────────────────
    try {
      const oneDayAgo2 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: custPaidRefs } = await supabase
        .from('tenants')
        .select('id, nome, referred_by_customer, mensalidade')
        .not('referred_by_customer', 'is', null)
        .eq('status', 'ATIVA')
        .gt('created_at', oneDayAgo2);

      for (const cp of (custPaidRefs || [])) {
        try {
          if (!(await claimMessage(`cust_referral_paid::${cp.id}`))) continue;
          const custPhone = cp.referred_by_customer;
          if (!custPhone) continue;

          const { data: custRefCount } = await supabase.rpc('count_customer_referrals', { p_phone: custPhone });
          const activeCount = custRefCount || 1;
          const { data: custSummary } = await supabase.rpc('customer_referral_summary', { p_phone: custPhone });
          const totalRevenue = custSummary?.[0]?.total_referral_revenue || cp.mensalidade || 0;
          const pixBonus = Math.round(totalRevenue * 0.10 * 100) / 100;

          const msg = `🎊 *Parabéns!*\n\n` +
            `*${cp.nome}* (sua indicação) contratou um plano no AgendeZap!\n\n` +
            `🎯 Você tem *${activeCount} indicação(ões) ativa(s)*\n` +
            `💰 Bônus PIX mensal: *R$${pixBonus.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}*\n\n` +
            `Você recebe 10% do valor das assinaturas das suas indicações via PIX todo mês! 🚀`;

          await sendWhatsApp(centralInstance, custPhone, msg);
          console.log(`[CustReferral Paid] ${custPhone} notified (${activeCount} active, PIX R$${pixBonus})`);
        } catch (e: any) {
          console.error(`[CustReferral Paid] Error ${cp.id}:`, e.message);
        }
      }
    } catch (e: any) {
      errors.push(`cust-referral-paid: ${e.message}`);
      console.error('[CustReferral Paid] Job error:', e.message);
    }

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const elapsed = Date.now() - startMs;
  return new Response(JSON.stringify({ processed, errors, elapsed_ms: elapsed }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
