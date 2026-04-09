/**
 * instagram-publish — Supabase Edge Function
 *
 * Server-side Instagram Content Publishing via Graph API.
 * Reads access token from tenant_settings, creates media container,
 * and publishes it. This avoids browser CORS/restrictions.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GRAPH = 'https://graph.instagram.com/v21.0';

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
    const { tenantId, imageUrl, caption, mediaType } = await req.json();
    if (!tenantId || !imageUrl) {
      return json({ error: 'Missing tenantId or imageUrl' }, 400);
    }

    // Read token from tenant_settings
    const { data: row } = await supabase
      .from('tenant_settings')
      .select('follow_up')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const fu = row?.follow_up || {};
    const token = (fu._instagramAccessToken || '').trim();
    const igUserId = fu._instagramUserId || '';

    if (!token || !igUserId) {
      return json({ error: 'Instagram não conectado. Vá em Conexões > Instagram.' }, 400);
    }

    // Verify token with /me
    const meRes = await fetch(`${GRAPH}/me?fields=id,username&access_token=${encodeURIComponent(token)}`);
    const meData = await meRes.json();
    console.log('[IG-Publish] Token check:', JSON.stringify(meData));
    if (meData.error) {
      return json({ error: `Token inválido: ${meData.error.message}. Reconecte o Instagram.` }, 401);
    }

    // Step 1: Create media container
    const type = mediaType || 'STORIES';
    const createParams = new URLSearchParams({
      image_url: imageUrl,
      access_token: token,
    });
    if (type === 'STORIES') createParams.set('media_type', 'STORIES');
    if (caption) createParams.set('caption', caption);

    const createRes = await fetch(`${GRAPH}/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createParams.toString(),
    });
    const createData = await createRes.json();
    console.log('[IG-Publish] Step1:', createRes.status, JSON.stringify(createData).substring(0, 500));

    if (createData.error) {
      return json({
        error: createData.error.message || 'Erro ao criar mídia',
        code: createData.error.code,
        detail: createData.error,
      }, 400);
    }
    if (!createData.id) {
      return json({ error: 'Nenhum ID de mídia retornado' }, 500);
    }

    // Step 1.5: Wait for container to finish processing
    const containerId = createData.id;
    const maxWait = 30_000; // 30 seconds max
    const interval = 3_000; // check every 3s
    let waited = 0;
    let status = '';

    while (waited < maxWait) {
      await new Promise(r => setTimeout(r, interval));
      waited += interval;

      const statusRes = await fetch(
        `${GRAPH}/${containerId}?fields=status_code&access_token=${encodeURIComponent(token)}`
      );
      const statusData = await statusRes.json();
      status = statusData.status_code || '';
      console.log(`[IG-Publish] Container status after ${waited}ms:`, status, JSON.stringify(statusData).substring(0, 200));

      if (status === 'FINISHED') break;
      if (status === 'ERROR') {
        return json({ error: `Container falhou: ${statusData.status || 'erro desconhecido'}` }, 400);
      }
    }

    if (status !== 'FINISHED') {
      return json({ error: `Container não ficou pronto em ${maxWait / 1000}s (status: ${status || 'unknown'})` }, 408);
    }

    // Step 2: Publish the container
    const pubParams = new URLSearchParams({
      creation_id: containerId,
      access_token: token,
    });
    const pubRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: pubParams.toString(),
    });
    const pubData = await pubRes.json();
    console.log('[IG-Publish] Step2:', pubRes.status, JSON.stringify(pubData).substring(0, 500));

    if (pubData.error) {
      return json({
        error: pubData.error.message || 'Erro ao publicar',
        code: pubData.error.code,
        detail: pubData.error,
      }, 400);
    }

    console.log(`[IG-Publish] Success for tenant ${tenantId}, media ${pubData.id}`);
    return json({ ok: true, mediaId: pubData.id });
  } catch (e: any) {
    console.error('[IG-Publish] Exception:', e);
    return json({ error: e.message || 'Erro inesperado' }, 500);
  }
});
