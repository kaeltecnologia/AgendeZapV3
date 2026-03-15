/**
 * google-business-publish — Supabase Edge Function
 *
 * Publishes a photo as a Local Post on the tenant's Google Business Profile.
 * Handles token refresh automatically when the access token expires.
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

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (data.error) {
    console.error('[Google-Publish] Token refresh error:', data);
    return null;
  }
  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { tenantId, imageUrl, caption } = await req.json();
    if (!tenantId || !imageUrl) {
      return json({ error: 'Missing tenantId or imageUrl' }, 400);
    }

    // ── Step 1: Load tenant Google Business credentials
    const { data: settings } = await supabase
      .from('tenant_settings')
      .select('follow_up')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const fu = settings?.follow_up || {};
    let accessToken = fu._googleBusinessAccessToken || '';
    const refreshToken = fu._googleBusinessRefreshToken || '';
    const accountId = fu._googleAccountId || '';
    const locationId = fu._googleLocationId || '';

    if (!accessToken || !locationId || !accountId) {
      return json({ error: 'Google Business não conectado.' }, 400);
    }

    // ── Step 2: Try to create Local Post
    const locationName = locationId.startsWith('locations/')
      ? `${accountId}/${locationId}`
      : locationId;

    const postBody = {
      languageCode: 'pt-BR',
      summary: caption || '',
      topicType: 'STANDARD',
      media: [{ mediaFormat: 'PHOTO', sourceUrl: imageUrl }],
    };

    let postRes = await fetch(
      `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(postBody),
      }
    );

    // ── Step 3: If 401, refresh token and retry
    if (postRes.status === 401 && refreshToken) {
      const newToken = await refreshAccessToken(refreshToken);
      if (newToken) {
        accessToken = newToken;
        // Save new access token
        const updatedFu = { ...fu, _googleBusinessAccessToken: newToken };
        await supabase
          .from('tenant_settings')
          .upsert(
            { tenant_id: tenantId, follow_up: updatedFu },
            { onConflict: 'tenant_id' }
          );

        // Retry post
        postRes = await fetch(
          `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${newToken}`,
            },
            body: JSON.stringify(postBody),
          }
        );
      } else {
        return json({ error: 'Token expirado e não foi possível renovar. Reconecte o Google.' }, 401);
      }
    }

    const postData = await postRes.json();
    if (postData.error) {
      console.error('[Google-Publish] Post error:', postData.error);
      return json({ error: postData.error.message || 'Erro ao publicar no Google' }, 400);
    }

    console.log(`[Google-Publish] Post created for tenant ${tenantId}`);
    return json({ success: true });
  } catch (e: any) {
    console.error('[Google-Publish] Unexpected error:', e);
    return json({ error: e.message || 'Erro inesperado' }, 500);
  }
});
