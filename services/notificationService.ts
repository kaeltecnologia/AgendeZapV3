
import { db } from './mockDb';
import { Appointment } from '../types';
import { evolutionService } from './evolutionService';

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
