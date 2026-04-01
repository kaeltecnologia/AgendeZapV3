/**
 * asaas-checkout — Supabase Edge Function
 *
 * Creates an Asaas customer + subscription for a tenant,
 * returns the invoiceUrl so the frontend can redirect the user to pay.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ASAAS_API_KEY = Deno.env.get('ASAAS_API_KEY')!;
const ASAAS_API_URL = Deno.env.get('ASAAS_API_URL') || 'https://api-sandbox.asaas.com/v3';

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

// Plan monthly prices (must match planConfig.ts)
const PLAN_PRICES: Record<string, number> = {
  START: 39.90,
  PROFISSIONAL: 89.90,
  ELITE: 149.90,
};

const PLAN_NAMES: Record<string, string> = {
  START: 'AgendeZap Start',
  PROFISSIONAL: 'AgendeZap Profissional',
  ELITE: 'AgendeZap Elite',
};

// Cycle config: Asaas cycle name, multiplier (months), discount
const CYCLE_CONFIG: Record<string, { asaasCycle: string; months: number; discount: number; label: string }> = {
  MONTHLY:      { asaasCycle: 'MONTHLY',      months: 1,  discount: 0,    label: 'Mensal' },
  QUARTERLY:    { asaasCycle: 'QUARTERLY',    months: 3,  discount: 0.10, label: 'Trimestral' },
  SEMIANNUALLY: { asaasCycle: 'SEMIANNUALLY', months: 6,  discount: 0.15, label: 'Semestral' },
  YEARLY:       { asaasCycle: 'YEARLY',       months: 12, discount: 0.25, label: 'Anual' },
};

function calcCycleValue(monthlyPrice: number, cycle: string): number {
  const cfg = CYCLE_CONFIG[cycle] || CYCLE_CONFIG.MONTHLY;
  const total = monthlyPrice * cfg.months * (1 - cfg.discount);
  return Math.round(total * 100) / 100; // round to 2 decimals
}

async function asaasFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${ASAAS_API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'access_token': ASAAS_API_KEY,
      ...(options.headers || {}),
    },
  });
  const body = await res.json();
  if (!res.ok) {
    console.error('[asaas] API error:', JSON.stringify(body));
    throw new Error(body.errors?.[0]?.description || `Asaas API error ${res.status}`);
  }
  return body;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { tenantId, planId, billingType, cycle = 'MONTHLY' } = await req.json();

    // ── Validate input ──────────────────────────────────────────────────
    if (!tenantId || !planId || !billingType) {
      return json({ error: 'Missing tenantId, planId, or billingType' }, 400);
    }
    if (!PLAN_PRICES[planId]) {
      return json({ error: `Invalid planId: ${planId}` }, 400);
    }
    if (!['PIX', 'CREDIT_CARD'].includes(billingType)) {
      return json({ error: `Invalid billingType: ${billingType}. Use PIX or CREDIT_CARD` }, 400);
    }
    if (!CYCLE_CONFIG[cycle]) {
      return json({ error: `Invalid cycle: ${cycle}. Use MONTHLY, QUARTERLY, SEMIANNUALLY, or YEARLY` }, 400);
    }

    // ── Fetch tenant ────────────────────────────────────────────────────
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, nome, email, phone')
      .eq('id', tenantId)
      .single();

    if (tenantErr || !tenant) {
      return json({ error: 'Tenant not found' }, 404);
    }

    // ── Check existing Asaas customer ID in settings ────────────────────
    const { data: settingsRow } = await supabase
      .from('tenant_settings')
      .select('follow_up')
      .eq('tenant_id', tenantId)
      .single();

    const fup = settingsRow?.follow_up || {};
    let asaasCustomerId = fup._asaasCustomerId || null;

    // ── Create Asaas customer if needed ─────────────────────────────────
    if (!asaasCustomerId) {
      const customerData = await asaasFetch('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: tenant.nome,
          email: tenant.email,
          phone: tenant.phone || undefined,
          externalReference: tenantId,
        }),
      });
      asaasCustomerId = customerData.id;
      console.log(`[asaas] Customer created: ${asaasCustomerId}`);
    }

    // ── Create subscription ─────────────────────────────────────────────
    const today = new Date();
    const nextDueDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const cycleCfg = CYCLE_CONFIG[cycle];
    const cycleValue = calcCycleValue(PLAN_PRICES[planId], cycle);

    const subscriptionData = await asaasFetch('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        customer: asaasCustomerId,
        billingType,
        value: cycleValue,
        cycle: cycleCfg.asaasCycle,
        nextDueDate,
        description: `${PLAN_NAMES[planId]} — Assinatura ${cycleCfg.label}`,
        externalReference: `${tenantId}::${planId}::${cycle}`,
      }),
    });

    const subscriptionId = subscriptionData.id;
    console.log(`[asaas] Subscription created: ${subscriptionId}`);

    // ── Get first payment to retrieve invoiceUrl ────────────────────────
    // Wait briefly for Asaas to generate the first payment
    await new Promise(r => setTimeout(r, 1500));

    const paymentsData = await asaasFetch(`/subscriptions/${subscriptionId}/payments`);
    const firstPayment = paymentsData.data?.[0];

    let invoiceUrl = firstPayment?.invoiceUrl || '';
    if (!invoiceUrl && firstPayment?.id) {
      // Fallback: construct the invoice URL
      invoiceUrl = `https://www.asaas.com/i/${firstPayment.id}`;
    }

    // ── Save Asaas IDs in tenant_settings JSONB ─────────────────────────
    const updatedFup = {
      ...fup,
      _asaasCustomerId: asaasCustomerId,
      _asaasSubscriptionId: subscriptionId,
      _asaasPlanId: planId,
      _asaasCycle: cycle,
    };

    await supabase.from('tenant_settings').upsert(
      { tenant_id: tenantId, follow_up: updatedFup },
      { onConflict: 'tenant_id' }
    );

    // Also update tenant plan optimistically
    await supabase.from('tenants').update({
      plan: planId,
      mensalidade: cycleValue,
    }).eq('id', tenantId);

    console.log(`[asaas] Checkout complete for tenant ${tenantId}: plan=${planId}, sub=${subscriptionId}`);

    return json({
      invoiceUrl,
      subscriptionId,
      customerId: asaasCustomerId,
    });

  } catch (err: any) {
    console.error('[asaas-checkout] Error:', err);
    return json({ error: err.message || 'Internal error' }, 500);
  }
});
