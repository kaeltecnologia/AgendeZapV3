/**
 * asaas-checkout — Supabase Edge Function
 *
 * Creates an Asaas customer + subscription for a tenant,
 * returns the invoiceUrl so the frontend can redirect the user to pay.
 *
 * UPGRADE PRO-RATA RULE:
 *   Dias 1-15 após pagamento → desconto = 100% do plano atual
 *   Dia 16+                  → desconto = proporcional aos dias restantes
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
  return Math.round(total * 100) / 100;
}

/**
 * Calculate pro-rata upgrade discount.
 * Days 1-15:  100% of current plan price
 * Days 16+:   proportional to remaining days (of 30-day cycle)
 */
function calcUpgradeDiscount(currentPlanPrice: number, lastPaymentDate: string): { discount: number; daysElapsed: number; daysRemaining: number } {
  const last = new Date(lastPaymentDate + 'T00:00:00Z');
  const now = new Date();
  const diffMs = now.getTime() - last.getTime();
  const daysElapsed = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  if (daysElapsed <= 15) {
    return { discount: currentPlanPrice, daysElapsed, daysRemaining: 30 - daysElapsed };
  }

  const daysRemaining = Math.max(0, 30 - daysElapsed);
  const discount = Math.round(currentPlanPrice * (daysRemaining / 30) * 100) / 100;
  return { discount, daysElapsed, daysRemaining };
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

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nextMonthStr() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { tenantId, planId, billingType, cycle = 'MONTHLY', cpfCnpj, addon, extraProfessionals = 0 } = body;

    // ── Validate input ──────────────────────────────────────────────────
    if (!tenantId || !billingType) {
      return json({ error: 'Missing tenantId or billingType' }, 400);
    }
    if (!['PIX', 'CREDIT_CARD'].includes(billingType)) {
      return json({ error: `Invalid billingType: ${billingType}. Use PIX or CREDIT_CARD` }, 400);
    }

    // ── Fetch tenant ────────────────────────────────────────────────────
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, nome, email, phone, plan')
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
          cpfCnpj: cpfCnpj || undefined,
          externalReference: tenantId,
        }),
      });
      asaasCustomerId = customerData.id;
      console.log(`[asaas] Customer created: ${asaasCustomerId}`);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ADDON: Additional professional (R$19.90/month)
    // ══════════════════════════════════════════════════════════════════════
    if (addon === 'additional_professional') {
      const ADDON_PRICE = 19.90;

      const addonSub = await asaasFetch('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          customer: asaasCustomerId,
          billingType,
          value: ADDON_PRICE,
          cycle: 'MONTHLY',
          nextDueDate: todayStr(),
          description: 'AgendeZap — Profissional Adicional',
          externalReference: `${tenantId}::ADDON_PROF`,
        }),
      });

      console.log(`[asaas] Addon subscription created: ${addonSub.id}`);

      await new Promise(r => setTimeout(r, 1500));

      const addonPayments = await asaasFetch(`/subscriptions/${addonSub.id}/payments`);
      const firstPay = addonPayments.data?.[0];
      let invoiceUrl = firstPay?.invoiceUrl || '';
      if (!invoiceUrl && firstPay?.id) {
        invoiceUrl = `https://www.asaas.com/i/${firstPay.id}`;
      }

      const extraPros = (fup._extraProfessionals || 0) + 1;
      const addonSubs = fup._addonSubscriptions || [];
      addonSubs.push(addonSub.id);

      const updatedFup = {
        ...fup,
        _asaasCustomerId: asaasCustomerId,
        _extraProfessionals: extraPros,
        _addonSubscriptions: addonSubs,
      };

      await supabase.from('tenant_settings').upsert(
        { tenant_id: tenantId, follow_up: updatedFup },
        { onConflict: 'tenant_id' }
      );

      const currentPlan = fup._asaasPlanId || 'START';
      const baseMensalidade = PLAN_PRICES[currentPlan] || 39.90;
      await supabase.from('tenants').update({
        mensalidade: baseMensalidade + (extraPros * ADDON_PRICE),
      }).eq('id', tenantId);

      console.log(`[asaas] Addon complete for tenant ${tenantId}: extraPros=${extraPros}`);

      return json({
        invoiceUrl,
        subscriptionId: addonSub.id,
        customerId: asaasCustomerId,
        extraProfessionals: extraPros,
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // PLAN SUBSCRIPTION (new or upgrade)
    // ══════════════════════════════════════════════════════════════════════
    if (!planId) {
      return json({ error: 'Missing planId' }, 400);
    }
    if (!PLAN_PRICES[planId]) {
      return json({ error: `Invalid planId: ${planId}` }, 400);
    }
    if (!CYCLE_CONFIG[cycle]) {
      return json({ error: `Invalid cycle: ${cycle}. Use MONTHLY, QUARTERLY, SEMIANNUALLY, or YEARLY` }, 400);
    }

    const cycleCfg = CYCLE_CONFIG[cycle];
    const cycleValue = calcCycleValue(PLAN_PRICES[planId], cycle);

    // ── Detect upgrade ──────────────────────────────────────────────────
    const oldSubId = fup._asaasSubscriptionId || null;
    const oldPlanId = fup._asaasPlanId || null;
    const lastPaymentDate = fup._asaasLastPaymentDate || null;
    const isUpgrade = !!(oldSubId && oldPlanId && PLAN_PRICES[oldPlanId] && planId !== oldPlanId && lastPaymentDate);

    let upgradeDiscount = 0;
    let upgradeInfo: any = null;

    if (isUpgrade) {
      const result = calcUpgradeDiscount(PLAN_PRICES[oldPlanId], lastPaymentDate);
      upgradeDiscount = result.discount;
      upgradeInfo = result;
      console.log(`[asaas] UPGRADE detected: ${oldPlanId} → ${planId}, days elapsed: ${result.daysElapsed}, discount: R$${upgradeDiscount.toFixed(2)}`);
    }

    if (isUpgrade && upgradeDiscount > 0) {
      // ══════════════════════════════════════════════════════════════════
      // UPGRADE FLOW: standalone charge (discounted) + new subscription
      // ══════════════════════════════════════════════════════════════════

      const firstMonthValue = Math.max(0, Math.round((PLAN_PRICES[planId] - upgradeDiscount) * 100) / 100);

      // 1. Create new subscription starting NEXT month (full price)
      const subscriptionData = await asaasFetch('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          customer: asaasCustomerId,
          billingType,
          value: cycleValue,
          cycle: cycleCfg.asaasCycle,
          nextDueDate: nextMonthStr(),
          description: `${PLAN_NAMES[planId]} — Assinatura ${cycleCfg.label}`,
          externalReference: `${tenantId}::${planId}::${cycle}`,
        }),
      });

      const newSubId = subscriptionData.id;
      console.log(`[asaas] New subscription created: ${newSubId} (starts next month)`);

      // 2. Update tenant_settings with NEW sub ID BEFORE canceling old
      //    (so webhook SUBSCRIPTION_DELETED for old sub won't find a match → skips)
      const updatedFup = {
        ...fup,
        _asaasCustomerId: asaasCustomerId,
        _asaasSubscriptionId: newSubId,
        _asaasPlanId: planId,
        _asaasCycle: cycle,
        _asaasLastPaymentDate: todayStr(),
        _asaasUpgradeFrom: oldPlanId,
        _asaasUpgradeDiscount: upgradeDiscount,
      };

      await supabase.from('tenant_settings').upsert(
        { tenant_id: tenantId, follow_up: updatedFup },
        { onConflict: 'tenant_id' }
      );

      // 3. Cancel old subscription
      try {
        await asaasFetch(`/subscriptions/${oldSubId}`, { method: 'DELETE' });
        console.log(`[asaas] Old subscription ${oldSubId} canceled`);
      } catch (e) {
        console.error(`[asaas] Failed to cancel old subscription ${oldSubId}:`, e);
      }

      // 4. Create standalone charge for this month (discounted)
      let invoiceUrl = '';
      if (firstMonthValue > 0) {
        const chargeData = await asaasFetch('/payments', {
          method: 'POST',
          body: JSON.stringify({
            customer: asaasCustomerId,
            billingType,
            value: firstMonthValue,
            dueDate: todayStr(),
            description: `Upgrade ${PLAN_NAMES[oldPlanId] || oldPlanId} → ${PLAN_NAMES[planId]} (desconto pro-rata: -R$${upgradeDiscount.toFixed(2)})`,
            externalReference: `${tenantId}::UPGRADE::${planId}`,
          }),
        });

        invoiceUrl = chargeData.invoiceUrl || '';
        if (!invoiceUrl && chargeData.id) {
          invoiceUrl = `https://www.asaas.com/i/${chargeData.id}`;
        }
        console.log(`[asaas] Upgrade charge created: R$${firstMonthValue.toFixed(2)} (discount: R$${upgradeDiscount.toFixed(2)})`);
      }

      // 5. Update tenant plan optimistically
      const totalExtra = updatedFup._extraProfessionals || 0;
      const ADDON_PRICE = 19.90;
      await supabase.from('tenants').update({
        plan: planId,
        mensalidade: PLAN_PRICES[planId] + (totalExtra * ADDON_PRICE),
      }).eq('id', tenantId);

      console.log(`[asaas] Upgrade complete: ${oldPlanId} → ${planId}, tenant ${tenantId}`);

      return json({
        invoiceUrl,
        subscriptionId: newSubId,
        customerId: asaasCustomerId,
        upgrade: true,
        discount: upgradeDiscount,
        firstMonthValue,
        fullMonthlyValue: PLAN_PRICES[planId],
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // NORMAL FLOW: New subscription (no upgrade discount)
    // ══════════════════════════════════════════════════════════════════════
    const subscriptionData = await asaasFetch('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        customer: asaasCustomerId,
        billingType,
        value: cycleValue,
        cycle: cycleCfg.asaasCycle,
        nextDueDate: todayStr(),
        description: `${PLAN_NAMES[planId]} — Assinatura ${cycleCfg.label}`,
        externalReference: `${tenantId}::${planId}::${cycle}`,
      }),
    });

    const subscriptionId = subscriptionData.id;
    console.log(`[asaas] Subscription created: ${subscriptionId}`);

    // ── Get first payment to retrieve invoiceUrl ────────────────────────
    await new Promise(r => setTimeout(r, 1500));

    const paymentsData = await asaasFetch(`/subscriptions/${subscriptionId}/payments`);
    const firstPayment = paymentsData.data?.[0];

    let invoiceUrl = firstPayment?.invoiceUrl || '';
    if (!invoiceUrl && firstPayment?.id) {
      invoiceUrl = `https://www.asaas.com/i/${firstPayment.id}`;
    }

    // ── Create addon subscriptions for extra professionals ───────────────
    const addonSubs: string[] = [];
    const ADDON_PRICE = 19.90;
    for (let i = 0; i < extraProfessionals; i++) {
      try {
        const addonSub = await asaasFetch('/subscriptions', {
          method: 'POST',
          body: JSON.stringify({
            customer: asaasCustomerId,
            billingType,
            value: ADDON_PRICE,
            cycle: 'MONTHLY',
            nextDueDate: todayStr(),
            description: 'AgendeZap — Profissional Adicional',
            externalReference: `${tenantId}::ADDON_PROF::${i + 1}`,
          }),
        });
        addonSubs.push(addonSub.id);
        console.log(`[asaas] Addon subscription created: ${addonSub.id}`);
      } catch (e) {
        console.error(`[asaas] Failed to create addon subscription ${i + 1}:`, e);
      }
    }

    // ── Save Asaas IDs in tenant_settings JSONB ─────────────────────────
    const updatedFup = {
      ...fup,
      _asaasCustomerId: asaasCustomerId,
      _asaasSubscriptionId: subscriptionId,
      _asaasPlanId: planId,
      _asaasCycle: cycle,
      _asaasLastPaymentDate: todayStr(),
      ...(extraProfessionals > 0 ? {
        _extraProfessionals: extraProfessionals,
        _addonSubscriptions: [...(fup._addonSubscriptions || []), ...addonSubs],
      } : {}),
    };

    await supabase.from('tenant_settings').upsert(
      { tenant_id: tenantId, follow_up: updatedFup },
      { onConflict: 'tenant_id' }
    );

    // Also update tenant plan optimistically
    const totalExtra = updatedFup._extraProfessionals || 0;
    await supabase.from('tenants').update({
      plan: planId,
      mensalidade: cycleValue + (totalExtra * ADDON_PRICE),
    }).eq('id', tenantId);

    console.log(`[asaas] Checkout complete for tenant ${tenantId}: plan=${planId}, sub=${subscriptionId}, extraPros=${totalExtra}`);

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
