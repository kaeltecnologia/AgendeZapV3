
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

    const instanceName = evolutionService.getInstanceName(tenant.slug);
    const result = await evolutionService.sendMessage(instanceName, cust.phone, lines.join('\n'));
    return result.success;
  } catch (err) {
    console.error('[sendApptConfirmationToClient]', err);
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

  const instanceName = evolutionService.getInstanceName(tenant.slug);
  await evolutionService.sendMessage(instanceName, prof.phone, message);
};
