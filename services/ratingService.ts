/**
 * ratingService.ts
 *
 * Post-service rating request:
 *   After an appointment is FINISHED, sends a WhatsApp message asking
 *   the customer to rate from 0 to 10. Runs on the 60-second scheduler
 *   tick in AiPollingManager alongside followUpService.
 *
 *   Dedup: uses db.claimMessage() for cross-tab and in-memory sentinel
 *   for same-tab. Tracks sent ratings in settings._ratingSent.
 */

import { db } from './mockDb';
import { evolutionService } from './evolutionService';
import { AppointmentStatus } from '../types';
import { registerRatingContext } from './agentService';
import { maskPhone } from './security';

const runningTenants = new Set<string>();
const ratingSentMemory = new Set<string>();

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

const DEFAULT_RATING_MSG =
  'Olá {nome}! 😊\n\nComo foi seu *{servico}* hoje? Dê uma nota de *0 a 10* para nos ajudar a melhorar! ⭐';

/**
 * Main entry — called from AiPollingManager every 60s.
 * Scans FINISHED appointments from the last 24h and sends rating requests.
 */
export async function runRatingRequests(tenant: any): Promise<void> {
  const tenantId = tenant.id;

  if (runningTenants.has(tenantId)) return;
  runningTenants.add(tenantId);

  try {
    const settings = await db.getSettings(tenantId);

    // Feature toggle — admin must enable rating
    if (!(settings as any).ratingEnabled) return;

    const instanceName = tenant.evolution_instance || `agendezap_${tenant.slug}`;
    const connStatus = await evolutionService.checkStatus(instanceName);
    if (connStatus !== 'open') return;

    // Brasilia time
    const nowBr = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const nowDate = nowBr.toISOString().slice(0, 10);

    // Appointments from last 24h
    const since = new Date(nowBr.getTime() - 24 * 60 * 60 * 1000);
    const sinceISO = since.toISOString().slice(0, 10);

    const appointments = await db.getAppointments(tenantId);
    const customers = await db.getCustomers(tenantId);
    const services = await db.getServices(tenantId);
    const professionals = await db.getProfessionals(tenantId);

    const findCust = (id: string) => customers.find(c => c.id === id);
    const findSvc = (id: string) => services.find(s => s.id === id);
    const findProf = (id: string) => professionals.find(p => p.id === id);

    const ratingSent: Record<string, string> = (settings as any).ratingSent || {};
    const msgTemplate: string = (settings as any).ratingMessage || DEFAULT_RATING_MSG;
    let newSent = { ...ratingSent };
    let anySent = false;

    for (const appt of appointments) {
      // Only FINISHED appointments
      if (appt.status !== AppointmentStatus.FINISHED) continue;

      // Only within last 24h
      const apptDate = appt.startTime.slice(0, 10);
      if (apptDate < sinceISO) continue;

      // Already sent?
      const sentKey = `rating::${appt.id}`;
      if (newSent[sentKey]) continue;
      if (ratingSentMemory.has(sentKey)) continue;

      // Already has review in DB?
      const reviewed = await db.hasReview(appt.id);
      if (reviewed) {
        newSent[sentKey] = nowDate;
        continue;
      }

      const cust = findCust(appt.customer_id);
      if (!cust?.phone) continue;

      const svc = findSvc(appt.service_id);
      const prof = findProf(appt.professional_id);

      // Cross-tab dedup
      const claimKey = `rating::${appt.id}`;
      const claimed = await db.claimMessage(claimKey);
      if (!claimed) continue;
      ratingSentMemory.add(sentKey);

      const msg = interpolate(msgTemplate, {
        nome: cust.name,
        servico: svc?.name || 'procedimento',
        profissional: prof?.name || '',
      });

      try {
        await evolutionService.sendMessage(instanceName, cust.phone, msg);
        newSent[sentKey] = nowDate;
        anySent = true;
        console.log(`[Rating] Pedido de avaliação enviado → ${cust.name} (${maskPhone(cust.phone)})`);

        // Register context so the reply is intercepted as a rating
        registerRatingContext(tenantId, cust.phone, msg, {
          apptId: appt.id,
          serviceName: svc?.name || '',
          customerName: cust.name,
          professionalName: prof?.name || '',
        });
      } catch (e: any) {
        console.error(`[Rating] Erro ao enviar para ${maskPhone(cust.phone)}:`, e.message);
      }
    }

    if (anySent) {
      await db.updateSettings(tenantId, { ratingSent: newSent } as any);
    }
  } catch (e: any) {
    console.error(`[Rating] Erro geral tenant ${tenantId}:`, e.message);
  } finally {
    runningTenants.delete(tenantId);
  }
}
