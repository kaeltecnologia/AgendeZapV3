
import { db } from './mockDb';
import { Appointment } from '../types';
import { evolutionService } from './evolutionService';

export const sendApptConfirmationToClient = async (tenantId: string, appt: Appointment): Promise<boolean> => {
  try {
    const [professionals, services, customers, tenants] = await Promise.all([
      db.getProfessionals(appt.tenant_id),
      db.getServices(appt.tenant_id),
      db.getCustomers(appt.tenant_id),
      db.getAllTenants(),
    ]);
    const prof = professionals.find(p => p.id === appt.professional_id);
    const cust = customers.find(c => c.id === appt.customer_id);
    const tenant = tenants.find(t => t.id === appt.tenant_id);
    const svcIds = appt.serviceIds?.length ? appt.serviceIds : [appt.service_id];
    const svcs = services.filter(s => svcIds.includes(s.id));
    if (!cust?.phone || !tenant) return false;

    const startDt = new Date(appt.startTime);
    const endDt = new Date(startDt.getTime() + (appt.durationMinutes || 0) * 60000);
    const fmt = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const dateStr = startDt.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

    const lines = [
      `📅 *Agendamento Confirmado*`,
      ``,
      `Olá *${cust.name}*! Segue o resumo do seu agendamento:`,
      ``,
      `📆 *Data:* ${dateStr}`,
      `⏰ *Horário:* ${fmt(startDt)} – ${fmt(endDt)}`,
      svcs.length > 0 ? `✂️ *Serviço(s):* ${svcs.map(s => s.name).join(', ')}` : '',
      prof ? `👤 *Profissional:* ${prof.name}` : '',
      ``,
      `_${tenant.name} — AgendeZap_`,
    ].filter(Boolean);

    const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
    const result = await evolutionService.sendMessage(instanceName, cust.phone, lines.join('\n'));
    if (!result.success) {
      // Sync connection status so the UI reflects the real state immediately
      evolutionService.checkStatus(instanceName).then(liveStatus => {
        if (liveStatus !== 'open') {
          db.updateSettings(appt.tenant_id, { connectionStatus: liveStatus }).catch(() => {});
        }
      }).catch(() => {});
    }
    return result.success;
  } catch (err) {
    console.error('[sendApptConfirmationToClient]', err);
    return false;
  }
};

/** Envia múltiplos agendamentos do mesmo cliente em uma única mensagem WhatsApp. */
export const sendMultiApptConfirmationToClient = async (tenantId: string, appts: Appointment[]): Promise<boolean> => {
  if (appts.length === 0) return false;
  if (appts.length === 1) return sendApptConfirmationToClient(tenantId, appts[0]);
  try {
    const [professionals, services, customers, tenants] = await Promise.all([
      db.getProfessionals(tenantId),
      db.getServices(tenantId),
      db.getCustomers(tenantId),
      db.getAllTenants(),
    ]);
    const sorted = [...appts].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const cust = customers.find(c => c.id === sorted[0].customer_id);
    const tenant = tenants.find(t => t.id === tenantId);
    if (!cust?.phone || !tenant) return false;

    const fmt = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const dateStr = new Date(sorted[0].startTime).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

    const nums = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
    const blocks = sorted.map((appt, i) => {
      const startDt = new Date(appt.startTime);
      const endDt = new Date(startDt.getTime() + (appt.durationMinutes || 0) * 60000);
      const svcIds = appt.serviceIds?.length ? appt.serviceIds : [appt.service_id];
      const svcs = services.filter(s => svcIds.includes(s.id));
      const prof = professionals.find(p => p.id === appt.professional_id);
      const lines = [
        `${nums[i] ?? `${i + 1}.`} ${svcs.map(s => s.name).join(', ')}`,
        prof ? `   👤 ${prof.name}` : '',
        `   ⏰ ${fmt(startDt)} – ${fmt(endDt)}`,
      ].filter(Boolean);
      return lines.join('\n');
    });

    const msg = [
      `📅 *Agendamentos do dia*`,
      ``,
      `Olá *${cust.name}*! Confira seus agendamentos de ${dateStr}:`,
      ``,
      ...blocks,
      ``,
      `_${tenant.name} — AgendeZap_`,
    ].join('\n');

    const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
    const result = await evolutionService.sendMessage(instanceName, cust.phone, msg);
    return result.success;
  } catch (err) {
    console.error('[sendMultiApptConfirmationToClient]', err);
    return false;
  }
};

// Notifications on new appointments are disabled — professionals receive a
// daily summary at 00:01 via runDailyProfessionalAgenda instead.
export const sendProfessionalNotification = async (_app: Appointment): Promise<void> => {
  return;
};

export const sendClientArrivedNotification = async (app: Appointment) => {
  const [professionals, services, customers, tenants] = await Promise.all([
    db.getProfessionals(app.tenant_id),
    db.getServices(app.tenant_id),
    db.getCustomers(app.tenant_id),
    db.getAllTenants()
  ]);

  const prof = professionals.find(p => p.id === app.professional_id);
  const svc = services.find(s => s.id === app.service_id);
  const cus = customers.find(c => c.id === app.customer_id);
  const tenant = tenants.find(t => t.id === app.tenant_id);

  if (!prof || !svc || !cus || !tenant) return;

  const timeFormatted = new Date(app.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const message = `
🚶 *CLIENTE CHEGOU!*

Olá *${prof.name}*, seu cliente está aguardando atendimento:

👤 *Cliente:* ${cus.name}
✂️ *Serviço:* ${svc.name}
⏰ *Horário agendado:* ${timeFormatted}

_Comanda aberta automaticamente — AgendeZap_
  `.trim();

  const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
  await evolutionService.sendMessage(instanceName, prof.phone, message);
};
