/**
 * instagram-oauth — Supabase Edge Function
 *
 * Handles the server-side OAuth token exchange for Instagram Business Login.
 * Receives an authorization code from the frontend, exchanges it for a
 * long-lived access token, resolves the IG user ID and username, and
 * persists everything in tenant_settings.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const IG_APP_ID = Deno.env.get('INSTAGRAM_APP_ID')!;
const IG_APP_SECRET = Deno.env.get('INSTAGRAM_APP_SECRET')!;

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
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { code, redirectUri, tenantId } = await req.json();
    if (!code || !redirectUri || !tenantId) {
      return json({ error: 'Missing code, redirectUri, or tenantId' }, 400);
    }

    // ── Step 1: Exchange code for short-lived access token (Instagram API)
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: IG_APP_ID,
        client_secret: IG_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error_type || tokenData.error_message) {
      console.error('[IG-OAuth] Token exchange error:', tokenData);
      return json({ error: tokenData.error_message || 'Token exchange failed' }, 400);
    }
    const shortLivedToken = tokenData.access_token;
    const igUserId = String(tokenData.user_id);

    // ── Step 2: Exchange short-lived → long-lived token (60 days)
    const longUrl = `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${IG_APP_SECRET}&access_token=${shortLivedToken}`;
    const longRes = await fetch(longUrl);
    const longData = await longRes.json();
    if (longData.error) {
      console.error('[IG-OAuth] Long-lived token error:', longData.error);
      return json({ error: longData.error.message || 'Long-lived token exchange failed' }, 400);
    }
    const accessToken = longData.access_token;

    // ── Step 3: Get IG username
    const userRes = await fetch(`https://graph.instagram.com/v21.0/me?fields=username&access_token=${accessToken}`);
    const userData = await userRes.json();
    const igUsername = userData.username || '';

    // ── Step 4: Save to tenant_settings
    const { data: existing } = await supabase
      .from('tenant_settings')
      .select('follow_up')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const fu = existing?.follow_up || {};
    const updatedFu = {
      ...fu,
      _instagramAccessToken: accessToken,
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
