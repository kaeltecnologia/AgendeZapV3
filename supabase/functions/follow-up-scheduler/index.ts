/**
 * AgendeZap — Edge Function: follow-up-scheduler
 *
 * Roda via pg_cron a cada 1 minuto. Processa os 5 jobs de follow-up
 * para TODOS os tenants ativos, sem depender do navegador aberto.
 *
 * Jobs: aviso, lembrete, reativação, agenda diária, rating.
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
    // Fetch all active tenants
    const { data: tenants, error: tErr } = await supabase
      .from('tenants')
      .select('id, nome, evolution_instance, status')
      .or('status.eq.active,status.eq.trial');
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

        processed++;
      } catch (e: any) {
        errors.push(`${tenant.nome || tenantId}: ${e.message}`);
        console.error(`[FollowUp] Error tenant ${tenant.nome}:`, e.message);
      }
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
