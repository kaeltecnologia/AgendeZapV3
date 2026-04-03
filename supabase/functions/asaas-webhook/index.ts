/**
 * asaas-webhook — Supabase Edge Function
 *
 * Receives webhook events from Asaas (payment/subscription status changes)
 * and updates the tenant's status accordingly.
 *
 * Configure in Asaas dashboard:
 *   URL: https://cnnfnqrnjckntnxdgwae.supabase.co/functions/v1/asaas-webhook
 *   Events: PAYMENT_RECEIVED, PAYMENT_OVERDUE, PAYMENT_CONFIRMED, SUBSCRIPTION_INACTIVATED
 *   Auth token: set as ASAAS_WEBHOOK_TOKEN secret
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_TOKEN = Deno.env.get('ASAAS_WEBHOOK_TOKEN') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, asaas-access-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Resolve planId and cycle from subscription externalReference ("tenantId::PLAN::CYCLE")
function parseRef(ref?: string): { planId: string | null; cycle: string | null } {
  if (!ref) return { planId: null, cycle: null };
  const parts = ref.split('::');
  return { planId: parts[1] || null, cycle: parts[2] || null };
}

// Plan prices (must match planConfig.ts)
const PLAN_PRICES: Record<string, number> = {
  START: 39.90,
  PROFISSIONAL: 89.90,
  ELITE: 149.90,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Verify webhook token ──────────────────────────────────────────
    if (WEBHOOK_TOKEN) {
      const token = req.headers.get('asaas-access-token') || '';
      if (token !== WEBHOOK_TOKEN) {
        console.warn('[asaas-webhook] Invalid token');
        return json({ error: 'Unauthorized' }, 401);
      }
    }

    const body = await req.json();
    const event = body.event as string;
    const payment = body.payment;

    const subscription = body.subscription; // for subscription-level events

    console.log(`[asaas-webhook] Event: ${event}, payment: ${payment?.id || 'N/A'}, subscription: ${payment?.subscription || subscription?.id || 'N/A'}`);

    if (!event) {
      return json({ error: 'Missing event' }, 400);
    }

    // ── Find tenant by subscription ID or externalReference ─────────────
    const subscriptionId = payment?.subscription || subscription?.id;
    const extRef = payment?.externalReference || subscription?.externalReference || '';

    let tenantId: string | null = null;
    let fup: any = {};
    let rows: any[] | null = null;

    if (subscriptionId) {
      // Normal flow: find by subscription ID
      const { data } = await supabase
        .from('tenant_settings')
        .select('tenant_id, follow_up')
        .filter('follow_up->>_asaasSubscriptionId', 'eq', subscriptionId);
      rows = data;
    }

    // Fallback: find by tenantId in externalReference (for standalone upgrade charges)
    if ((!rows || rows.length === 0) && extRef) {
      const refTenantId = extRef.split('::')[0];
      if (refTenantId) {
        const { data } = await supabase
          .from('tenant_settings')
          .select('tenant_id, follow_up')
          .eq('tenant_id', refTenantId);
        rows = data;
      }
    }

    if (!rows || rows.length === 0) {
      console.warn(`[asaas-webhook] No tenant found for subscription ${subscriptionId || 'N/A'}, ref ${extRef}`);
      return json({ ok: true, skipped: true });
    }

    tenantId = rows[0].tenant_id;
    fup = rows[0].follow_up || {};
    const ref = parseRef(extRef);
    const planId = ref.planId || fup._asaasPlanId || 'START';
    const cycle = ref.cycle || fup._asaasCycle || 'MONTHLY';

    console.log(`[asaas-webhook] Tenant: ${tenantId}, plan: ${planId}, cycle: ${cycle}, event: ${event}`);

    // ── Handle events ─────────────────────────────────────────────────
    switch (event) {
      case 'PAYMENT_RECEIVED': {
        // Activate tenant: remove trial, set plan, status = ATIVA
        await supabase.from('tenants').update({
          status: 'ATIVA',
          plan: planId,
          mensalidade: PLAN_PRICES[planId] || payment?.value || 0,
        }).eq('id', tenantId);

        // Clear trial, enable AI, save last payment date
        const payDate = new Date();
        const payDateStr = `${payDate.getFullYear()}-${String(payDate.getMonth() + 1).padStart(2, '0')}-${String(payDate.getDate()).padStart(2, '0')}`;
        const updatedFup = {
          ...fup,
          trialStartDate: null,
          trialWarningSent: false,
          _asaasLastPaymentDate: payDateStr,
        };
        await supabase.from('tenant_settings').update({
          follow_up: updatedFup,
          ai_active: true,
        }).eq('tenant_id', tenantId);

        console.log(`[asaas-webhook] ✅ Tenant ${tenantId} ACTIVATED — plan=${planId}, paymentDate=${payDateStr}`);
        break;
      }

      case 'PAYMENT_OVERDUE': {
        // Mark as pending payment
        await supabase.from('tenants').update({
          status: 'PAGAMENTO PENDENTE',
        }).eq('id', tenantId);

        console.log(`[asaas-webhook] ⚠️ Tenant ${tenantId} PAYMENT OVERDUE`);
        break;
      }

      case 'PAYMENT_CONFIRMED': {
        // Intermediate state — just log, wait for PAYMENT_RECEIVED
        console.log(`[asaas-webhook] Payment confirmed for tenant ${tenantId}, waiting for RECEIVED`);
        break;
      }

      case 'SUBSCRIPTION_CREATED': {
        // Log subscription creation and save IDs (in case checkout didn't persist them)
        const updatedFupCreated = {
          ...fup,
          _asaasSubscriptionId: subscriptionId,
          _asaasPlanId: planId,
          _asaasCycle: cycle,
        };
        await supabase.from('tenant_settings').update({
          follow_up: updatedFupCreated,
        }).eq('tenant_id', tenantId);

        console.log(`[asaas-webhook] Subscription created for tenant ${tenantId}: plan=${planId}, cycle=${cycle}`);
        break;
      }

      case 'SUBSCRIPTION_INACTIVATED':
      case 'SUBSCRIPTION_DELETED': {
        // Block tenant and disable AI
        await supabase.from('tenants').update({
          status: 'BLOQUEADA',
        }).eq('id', tenantId);

        await supabase.from('tenant_settings').update({
          ai_active: false,
        }).eq('tenant_id', tenantId);

        console.log(`[asaas-webhook] 🚫 Tenant ${tenantId} BLOCKED — subscription inactive`);
        break;
      }

      default:
        console.log(`[asaas-webhook] Unhandled event: ${event}`);
    }

    return json({ ok: true, event, tenantId });

  } catch (err: any) {
    console.error('[asaas-webhook] Error:', err);
    return json({ error: err.message || 'Internal error' }, 500);
  }
});
