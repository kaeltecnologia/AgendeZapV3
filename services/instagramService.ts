/**
 * instagramService — Publishes to Instagram via server-side Edge Function.
 *
 * The Instagram Content Publishing API is designed for server-side use.
 * Browser-based calls fail with CORS/500 errors. This service routes
 * all publish calls through the `instagram-publish` Supabase Edge Function.
 */

import { projectUrl as SUPABASE_URL, anonKey as SUPABASE_ANON_KEY } from './supabase';

export interface IgPublishResult {
  success: boolean;
  error?: string;
}

async function callEdge(body: Record<string, string | undefined>): Promise<IgPublishResult> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/instagram-publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log('[Instagram] Edge response:', res.status, JSON.stringify(data).substring(0, 400));

    if (data.error) {
      return { success: false, error: data.error };
    }
    return { success: true };
  } catch (e: any) {
    console.error('[Instagram] Edge call failed:', e);
    return { success: false, error: e.message || 'Erro de conexão' };
  }
}

export const instagramService = {
  async publishStory(igUserId: string, _accessToken: string, imageUrl: string, tenantId?: string): Promise<IgPublishResult> {
    // tenantId is passed from PublicarView; igUserId kept for backward compat
    const tid = tenantId || '';
    if (!tid) {
      // Fallback: try to extract from imageUrl path (posts/{tenantId}_timestamp.ext)
      const m = imageUrl.match(/posts\/([^_]+)_/);
      if (m) return callEdge({ tenantId: m[1], imageUrl, mediaType: 'STORIES' });
      return { success: false, error: 'tenantId não disponível' };
    }
    return callEdge({ tenantId: tid, imageUrl, mediaType: 'STORIES' });
  },

  async publishPost(igUserId: string, _accessToken: string, imageUrl: string, caption?: string, tenantId?: string): Promise<IgPublishResult> {
    const tid = tenantId || '';
    if (!tid) {
      const m = imageUrl.match(/posts\/([^_]+)_/);
      if (m) return callEdge({ tenantId: m[1], imageUrl, caption, mediaType: 'FEED' });
      return { success: false, error: 'tenantId não disponível' };
    }
    return callEdge({ tenantId: tid, imageUrl, caption, mediaType: 'FEED' });
  },
};
