/**
 * instagramService — Client-side Instagram Graph API helper
 *
 * Publishes Stories and feed posts via the Instagram Content Publishing API.
 * Uses the long-lived access token stored in tenant_settings.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

export interface IgPublishResult {
  success: boolean;
  error?: string;
}

export const instagramService = {
  /**
   * Publish an image as an Instagram Story.
   */
  async publishStory(igUserId: string, accessToken: string, imageUrl: string): Promise<IgPublishResult> {
    try {
      // Step 1: Create media container (STORIES type)
      const createRes = await fetch(`${GRAPH}/${igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          media_type: 'STORIES',
          access_token: accessToken,
        }),
      });
      const createData = await createRes.json();
      if (createData.error) {
        console.error('[Instagram] Create media error:', createData.error);
        return { success: false, error: createData.error.message || 'Erro ao criar mídia' };
      }
      const creationId = createData.id;
      if (!creationId) {
        return { success: false, error: 'Nenhum ID de mídia retornado' };
      }

      // Step 2: Publish the container
      const pubRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: accessToken,
        }),
      });
      const pubData = await pubRes.json();
      if (pubData.error) {
        console.error('[Instagram] Publish error:', pubData.error);
        return { success: false, error: pubData.error.message || 'Erro ao publicar' };
      }

      return { success: true };
    } catch (e: any) {
      console.error('[Instagram] Unexpected error:', e);
      return { success: false, error: e.message || 'Erro inesperado' };
    }
  },

  /**
   * Publish an image as an Instagram feed post (with caption).
   */
  async publishPost(igUserId: string, accessToken: string, imageUrl: string, caption?: string): Promise<IgPublishResult> {
    try {
      const createRes = await fetch(`${GRAPH}/${igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          caption: caption || '',
          access_token: accessToken,
        }),
      });
      const createData = await createRes.json();
      if (createData.error) {
        return { success: false, error: createData.error.message || 'Erro ao criar mídia' };
      }

      const pubRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: createData.id,
          access_token: accessToken,
        }),
      });
      const pubData = await pubRes.json();
      if (pubData.error) {
        return { success: false, error: pubData.error.message || 'Erro ao publicar' };
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Erro inesperado' };
    }
  },
};
