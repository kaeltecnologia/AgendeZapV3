/**
 * instagram-oauth — Supabase Edge Function
 *
 * Handles the server-side OAuth token exchange for Instagram integration.
 * Receives an authorization code from the frontend, exchanges it for a
 * long-lived access token, resolves the IG Business Account ID, and
 * persists everything in tenant_settings.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FB_APP_ID = Deno.env.get('FACEBOOK_APP_ID')!;
const FB_APP_SECRET = Deno.env.get('FACEBOOK_APP_SECRET')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const GRAPH = 'https://graph.facebook.com/v21.0';

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
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { code, redirectUri, tenantId } = await req.json();
    if (!code || !redirectUri || !tenantId) {
      return json({ error: 'Missing code, redirectUri, or tenantId' }, 400);
    }

    // ── Step 1: Exchange code for short-lived user access token
    const tokenUrl = `${GRAPH}/oauth/access_token?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${FB_APP_SECRET}&code=${code}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      console.error('[IG-OAuth] Token exchange error:', tokenData.error);
      return json({ error: tokenData.error.message || 'Token exchange failed' }, 400);
    }
    const shortLivedToken = tokenData.access_token;

    // ── Step 2: Exchange short-lived → long-lived token (60 days)
    const longUrl = `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&fb_exchange_token=${shortLivedToken}`;
    const longRes = await fetch(longUrl);
    const longData = await longRes.json();
    if (longData.error) {
      console.error('[IG-OAuth] Long-lived token error:', longData.error);
      return json({ error: longData.error.message || 'Long-lived token exchange failed' }, 400);
    }
    const accessToken = longData.access_token;

    // ── Step 3: Get user's Facebook Pages
    const pagesRes = await fetch(`${GRAPH}/me/accounts?access_token=${accessToken}`);
    const pagesData = await pagesRes.json();
    if (!pagesData.data || pagesData.data.length === 0) {
      return json({ error: 'Nenhuma Facebook Page encontrada. Sua conta precisa ter uma Page conectada ao Instagram.' }, 400);
    }

    // ── Step 4: Find the first page with an Instagram Business Account
    let igUserId = '';
    let igUsername = '';
    let pageAccessToken = '';

    for (const page of pagesData.data) {
      const igRes = await fetch(`${GRAPH}/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`);
      const igData = await igRes.json();
      if (igData.instagram_business_account?.id) {
        igUserId = igData.instagram_business_account.id;
        pageAccessToken = page.access_token;
        break;
      }
    }

    if (!igUserId) {
      return json({ error: 'Nenhuma conta Instagram Business/Creator conectada à sua Facebook Page.' }, 400);
    }

    // ── Step 5: Get IG username
    const userRes = await fetch(`${GRAPH}/${igUserId}?fields=username&access_token=${pageAccessToken}`);
    const userData = await userRes.json();
    igUsername = userData.username || '';

    // ── Step 6: Exchange page token for long-lived page token
    const longPageUrl = `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&fb_exchange_token=${pageAccessToken}`;
    const longPageRes = await fetch(longPageUrl);
    const longPageData = await longPageRes.json();
    const finalToken = longPageData.access_token || pageAccessToken;

    // ── Step 7: Save to tenant_settings
    const { data: existing } = await supabase
      .from('tenant_settings')
      .select('follow_up')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const fu = existing?.follow_up || {};
    const updatedFu = {
      ...fu,
      _instagramAccessToken: finalToken,
      _instagramUserId: igUserId,
      _instagramUsername: igUsername,
    };

    const { error: upsertErr } = await supabase
      .from('tenant_settings')
      .upsert(
        { tenant_id: tenantId, follow_up: updatedFu },
        { onConflict: 'tenant_id' }
      );

    if (upsertErr) {
      console.error('[IG-OAuth] Upsert error:', upsertErr);
      return json({ error: 'Erro ao salvar credenciais.' }, 500);
    }

    console.log(`[IG-OAuth] Connected @${igUsername} (${igUserId}) for tenant ${tenantId}`);

    return json({ ok: true, username: igUsername, igUserId });
  } catch (e: any) {
    console.error('[IG-OAuth] Unexpected error:', e);
    return json({ error: e.message || 'Erro inesperado' }, 500);
  }
});
