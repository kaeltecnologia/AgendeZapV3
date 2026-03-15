/**
 * google-business-oauth — Supabase Edge Function
 *
 * Handles the server-side OAuth token exchange for Google Business Profile.
 * Receives an authorization code from the frontend, exchanges it for
 * access + refresh tokens, resolves the account/location IDs, and
 * persists everything in tenant_settings.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { code, redirectUri, tenantId } = await req.json();
    if (!code || !redirectUri || !tenantId) {
      return json({ error: 'Missing code, redirectUri, or tenantId' }, 400);
    }

    // ── Step 1: Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      console.error('[Google-OAuth] Token exchange error:', tokenData);
      return json({ error: tokenData.error_description || tokenData.error }, 400);
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || '';

    // ── Step 2: Get Google Business accounts
    const accountsRes = await fetch(
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const accountsData = await accountsRes.json();
    if (accountsData.error) {
      console.error('[Google-OAuth] Accounts error:', accountsData.error);
      return json({ error: accountsData.error.message || 'Erro ao buscar contas Google Business' }, 400);
    }

    const accounts = accountsData.accounts || [];
    if (accounts.length === 0) {
      return json({ error: 'Nenhuma conta Google Meu Negócio encontrada. Crie uma em business.google.com' }, 400);
    }

    const account = accounts[0];
    const accountId = account.name; // e.g. "accounts/123456789"

    // ── Step 3: Get locations for this account
    const locationsRes = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountId}/locations?readMask=name,title`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const locationsData = await locationsRes.json();
    if (locationsData.error) {
      console.error('[Google-OAuth] Locations error:', locationsData.error);
      return json({ error: locationsData.error.message || 'Erro ao buscar localizações' }, 400);
    }

    const locations = locationsData.locations || [];
    if (locations.length === 0) {
      return json({ error: 'Nenhuma localização encontrada na conta Google Business.' }, 400);
    }

    const location = locations[0];
    const locationId = location.name; // e.g. "locations/456789"
    const businessName = location.title || account.accountName || 'Meu Negócio';

    // ── Step 4: Save to tenant_settings
    const { data: existing } = await supabase
      .from('tenant_settings')
      .select('follow_up')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const fu = existing?.follow_up || {};
    const updatedFu = {
      ...fu,
      _googleBusinessAccessToken: accessToken,
      _googleBusinessRefreshToken: refreshToken,
      _googleAccountId: accountId,
      _googleLocationId: locationId,
      _googleBusinessName: businessName,
    };

    const { error: upsertErr } = await supabase
      .from('tenant_settings')
      .upsert(
        { tenant_id: tenantId, follow_up: updatedFu },
        { onConflict: 'tenant_id' }
      );

    if (upsertErr) {
      console.error('[Google-OAuth] Upsert error:', upsertErr);
      return json({ error: 'Erro ao salvar credenciais.' }, 500);
    }

    console.log(`[Google-OAuth] Connected "${businessName}" for tenant ${tenantId}`);

    return json({ ok: true, businessName, accountId, locationId });
  } catch (e: any) {
    console.error('[Google-OAuth] Unexpected error:', e);
    return json({ error: e.message || 'Erro inesperado' }, 500);
  }
});
