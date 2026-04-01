/**
 * asaas-verify — Supabase Edge Function
 *
 * Checks the Asaas subscription payment status for a tenant
 * and activates the account if payment is confirmed.
 * Used as a fallback when the webhook doesn't fire (e.g., sandbox).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ASAAS_API_KEY = Deno.env.get('ASAAS_API_KEY')!;
const ASAAS_API_URL = Deno.env.get('ASAAS_API_URL') || 'https://api.asaas.com/v3';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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
    const { tenantId } = await req.json();

    if (!tenantId) {
      return json({ error: 'Missing tenantId' }, 400);
    }

    // Get tenant settings with Asaas subscription ID
    const { data: settingsRow } = await supabase
      .from('tenant_settings')
      .select('follow_up')
      .eq('tenant_id', tenantId)
      .single();

    const fup = settingsRow?.follow_up || {};
    const subscriptionId = fup._asaasSubscriptionId;

    if (!subscriptionId) {
      return json({ error: 'No subscription found', status: 'no_subscription' });
    }

    // Check subscription payments via Asaas API
    const res = await fetch(`${ASAAS_API_URL}/subscriptions/${subscriptionId}/payments`, {
      headers: { 'access_token': ASAAS_API_KEY },
    });

    if (!res.ok) {
      return json({ error: 'Failed to check Asaas payments', status: 'error' });
    }

    const paymentsData = await res.json();
    const payments = paymentsData.data || [];

    // Check if any payment is confirmed or received
    const paidPayment = payments.find((p: any) =>
      ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(p.status)
    );

    if (paidPayment) {
      const planId = fup._asaasPlanId || 'START';

      // Activate tenant
      await supabase.from('tenants').update({
        status: 'ATIVA',
        plan: planId,
        mensalidade: PLAN_PRICES[planId] || paidPayment.value || 0,
      }).eq('id', tenantId);

      // Clear trial and enable AI
      const updatedFup = { ...fup, trialStartDate: null, trialWarningSent: false };
      await supabase.from('tenant_settings').update({
        follow_up: updatedFup,
        ai_active: true,
      }).eq('tenant_id', tenantId);

      console.log(`[asaas-verify] Tenant ${tenantId} ACTIVATED via manual check`);
      return json({ status: 'activated', plan: planId });
    }

    // Check if payment is pending/awaiting
    const pendingPayment = payments.find((p: any) =>
      ['PENDING', 'AWAITING_RISK_ANALYSIS'].includes(p.status)
    );

    if (pendingPayment) {
      return json({ status: 'pending', billingType: pendingPayment.billingType });
    }

    return json({ status: 'not_paid', paymentsCount: payments.length });

  } catch (err: any) {
    console.error('[asaas-verify] Error:', err);
    return json({ error: err.message || 'Internal error' }, 500);
  }
});
