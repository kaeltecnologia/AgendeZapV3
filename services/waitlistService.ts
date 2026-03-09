/**
 * waitlistService.ts
 * When an appointment is cancelled, notify all leads that asked to be on the waitlist.
 */
import { db } from './mockDb';
import { evolutionService } from './evolutionService';
import { supabase } from './supabase';
import { maskPhone } from './security';

export interface WaitlistContext {
  professionalName?: string;
  date?: string;   // YYYY-MM-DD
  time?: string;   // HH:MM
}

/**
 * Finds all customers with waitlistAlert:true for this tenant,
 * sends them a WhatsApp notification that a slot opened,
 * then clears the flag so they don't receive duplicate messages.
 */
export async function notifyWaitlistLeads(
  tenantId: string,
  context?: WaitlistContext
): Promise<void> {
  try {
    // Get tenant row for instance name and display name
    const { data: tenantRow } = await supabase
      .from('tenants').select('evolution_instance, nome, name')
      .eq('id', tenantId).maybeSingle();
    const instanceName: string = tenantRow?.evolution_instance || '';
    if (!instanceName) return; // can't send without instance
    const tenantName: string = tenantRow?.nome || tenantRow?.name || 'Nosso estabelecimento';

    // Get customerData to find waitlist leads
    const settings = await db.getSettings(tenantId);
    const customerData = settings.customerData || {};

    const waitlistIds = Object.entries(customerData)
      .filter(([, v]) => (v as any)?.waitlistAlert === true)
      .map(([id]) => id);

    if (waitlistIds.length === 0) return;

    // Fetch phone + name for each waitlist customer
    const { data: customers } = await supabase
      .from('customers').select('id, nome, telefone')
      .in('id', waitlistIds).eq('tenant_id', tenantId);

    if (!customers || customers.length === 0) return;

    // Build context suffix
    const contextMsg = context?.professionalName && context?.date
      ? ` com *${context.professionalName}* no dia *${formatDate(context.date)}*${context.time ? ` às *${context.time}*` : ''}`
      : '';

    // Send notifications + clear flag
    const updatedCData = { ...customerData };

    for (const cust of customers) {
      if (!cust.telefone) continue;
      const firstName = (cust.nome as string)?.split(' ')[0] || 'cliente';
      const msg =
        `⚡ *Oi, ${firstName}!* Surgiu um horário disponível${contextMsg} aqui no *${tenantName}*!\n\n` +
        `Se ainda tiver interesse, é só me responder que a gente encaixa. 😊`;
      try {
        await evolutionService.sendMessage(instanceName, cust.telefone as string, msg);
        // Clear flag so they don't get duplicate notifications
        updatedCData[cust.id] = { ...(updatedCData[cust.id] || {}), waitlistAlert: false };
      } catch (e) {
        console.error(`[waitlistService] Failed to notify ${maskPhone(cust.telefone)}:`, e);
      }
    }

    // Persist cleared flags
    await db.updateSettings(tenantId, { customerData: updatedCData });
  } catch (e) {
    console.error('[waitlistService] notifyWaitlistLeads error:', e);
  }
}

function formatDate(iso: string): string {
  // iso = YYYY-MM-DD
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
