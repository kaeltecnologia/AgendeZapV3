
export const EVOLUTION_API_URL = import.meta.env.VITE_EVOLUTION_API_URL || 'https://evolution-api-agendezap-evolution-api.xzftjp.easypanel.host';
export const EVOLUTION_API_KEY = import.meta.env.VITE_EVOLUTION_API_KEY || '429683C4C977415CAAFCCE10F7D57E11';

const headers = {
  "Content-Type": "application/json",
  "apikey": EVOLUTION_API_KEY
};

export interface SendMessageResponse {
  success: boolean;
  error?: string;
}

// ── Send-side dedup: prevents the exact same message from being sent twice
// to the same phone within a short window (regardless of which system triggers it)
const _sentDedup = new Map<string, number>();
const _SEND_DEDUP_TTL = 180_000; // 3 minutes — prevents duplicates across tab reloads/scheduler ticks

function _isSendDuplicate(phone: string, text: string): boolean {
  const key = `${phone.replace(/\D/g, '')}::${text.trim().slice(0, 150)}`;
  const now = Date.now();
  const last = _sentDedup.get(key);
  if (last !== undefined && now - last < _SEND_DEDUP_TTL) return true;
  _sentDedup.set(key, now);
  // Prune old entries
  if (_sentDedup.size > 200) {
    for (const [k, t] of _sentDedup) {
      if (now - t > _SEND_DEDUP_TTL) _sentDedup.delete(k);
    }
  }
  return false;
}

export const evolutionService = {
  async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  getInstanceName(slug: string) {
    if (!slug) return '';
    const cleanSlug = slug.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, '')
      .trim();
    return `agz_${cleanSlug}`;
  },

  async checkStatus(instanceName: string): Promise<'open' | 'close' | 'connecting' | 'notfound'> {
    if (!instanceName) return 'notfound';

    // Parse status from any known Evolution API response shape
    const parseStatusFromObj = (raw: any): 'open' | 'close' | 'connecting' | null => {
      if (!raw || typeof raw !== 'object') return null;
      const inner = raw.instance ?? raw.data ?? raw;
      const s = String(inner.connectionStatus ?? inner.state ?? inner.status ?? '').toUpperCase();
      if (['OPEN', 'CONNECTED', 'ONLINE'].includes(s)) return 'open';
      if (['CONNECTING', 'PAIRING', 'CONNECTING_SESSION', 'QRCODE'].includes(s)) return 'connecting';
      if (['CLOSE', 'CLOSED', 'DISCONNECTED'].includes(s)) return 'close';
      return null;
    };

    // Strategy 1: GET /instance/connectionState/{name}
    try {
      const res = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`, { method: 'GET', headers });
      const data = res.ok ? await res.json().catch(() => null) : null;
      console.log('[checkStatus] connectionState HTTP', res.status, JSON.stringify(data).slice(0, 200));
      if (res.ok && data) {
        const s = parseStatusFromObj(data);
        if (s !== null) return s;
      }
    } catch { /* fall through */ }

    // Strategy 2: GET /instance/fetchInstances (ALL instances, no filter — filter unsupported in some versions)
    try {
      const res = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, { method: 'GET', headers });
      const raw = res.ok ? await res.json().catch(() => null) : null;
      console.log('[checkStatus] fetchInstances HTTP', res.status, JSON.stringify(raw).slice(0, 400));
      if (res.ok && raw) {
        const list: any[] = Array.isArray(raw) ? raw : raw?.instances ?? [raw];
        for (const item of list) {
          const inner = item.instance ?? item.data ?? item;
          const name = String(inner.instanceName ?? inner.name ?? '').toLowerCase();
          if (name && name !== instanceName.toLowerCase()) continue; // different instance
          const s = parseStatusFromObj(item);
          if (s !== null) return s;
        }
        // Searched all instances and not found
        if (list.length > 0) return 'notfound';
      }
    } catch { /* ignore */ }

    return 'close';
  },

  async fetchRecentMessages(instanceName: string, count: number = 20) {
    if (!instanceName) return null;
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/chat/findMessages/${instanceName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          where: {},
          orderBy: { messageTimestamp: 'desc' },
          limit: count
        })
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.messages?.records || data.records || data;
    } catch (error) {
      return null;
    }
  },

  // Fetch message history for a specific contact — tries strategies in order
  async fetchContactMessages(instanceName: string, phone: string, limit = 150): Promise<any[]> {
    if (!instanceName || !phone) return [];
    const cleanPhone = phone.replace(/\D/g, '');
    const jidFull   = `${cleanPhone}@s.whatsapp.net`;
    const jidLegacy = `${cleanPhone}@c.us`;

    const filterByPhone = (msgs: any[]) =>
      msgs.filter((m: any) => {
        const jid: string = m.key?.remoteJid || '';
        return jid.replace(/@.*/, '').replace(/\D/g, '').slice(-11) === cleanPhone.slice(-11);
      });

    const query = async (where: object, lim: number) => {
      try {
        const r = await fetch(`${EVOLUTION_API_URL}/chat/findMessages/${instanceName}`, {
          method: 'POST', headers,
          body: JSON.stringify({ where, orderBy: { messageTimestamp: 'desc' }, limit: lim })
        });
        if (!r.ok) return null;
        const d = await r.json();
        return d.messages?.records || d.records || (Array.isArray(d) ? d : null);
      } catch { return null; }
    };

    // 0. fetchMessages — pulls directly from WhatsApp servers (full cross-session history)
    // Try plain number, then with JID suffixes (API varies by version)
    for (const numArg of [cleanPhone, jidFull, jidLegacy]) {
      try {
        const r0 = await fetch(`${EVOLUTION_API_URL}/chat/fetchMessages/${instanceName}`, {
          method: 'POST', headers,
          body: JSON.stringify({ number: numArg, msgCount: limit })
        });
        if (r0.ok) {
          const d0 = await r0.json();
          const msgs0: any[] = Array.isArray(d0) ? d0 : (d0.messages || d0.records || []);
          const f = filterByPhone(msgs0);
          if (f.length > 0) return f;
        }
      } catch { /* try next format */ }
    }

    // 1. Top-level remoteJid filter (standard Evolution API v2+)
    const r1 = await query({ remoteJid: jidFull }, limit);
    if (r1?.length) { const f = filterByPhone(r1); if (f.length) return f; }

    // 2. Legacy JID format
    const r2 = await query({ remoteJid: jidLegacy }, limit);
    if (r2?.length) { const f = filterByPhone(r2); if (f.length) return f; }

    // 3. No filter — fetch large batch, filter client-side (fallback for all versions)
    const r3 = await query({}, limit * 6);
    if (r3?.length) return filterByPhone(r3);

    return [];
  },

  async sendTyping(instanceName: string, phone: string, delayMs = 3000): Promise<void> {
    if (!instanceName) return;
    try {
      await fetch(`${EVOLUTION_API_URL}/chat/sendPresence/${instanceName}`, {
        method: 'POST', headers,
        body: JSON.stringify({ number: phone.replace(/\D/g, ''), options: { delay: delayMs, presence: 'composing' } }),
      });
    } catch { /* non-fatal */ }
  },

  async sendToWhatsApp(instanceName: string, to: string, text: string): Promise<SendMessageResponse> {
    let cleanNumber = to.replace(/\D/g, '');
    // Always ensure Brazil country code (55) is present
    if (cleanNumber && !cleanNumber.startsWith('55')) cleanNumber = '55' + cleanNumber;
    if (!instanceName) return { success: false, error: "Instância não definida" };
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          number: cleanNumber,
          text: text,
          options: { delay: 1200, presence: 'composing', linkPreview: false }
        })
      });
      if (response.ok) return { success: true };

      // Retry once on 404 — zombie instance (shows 'open' in connectionState but rejects sends)
      if (response.status === 404) {
        console.warn(`[Evolution] sendText 404 — zombie instance, aguardando 2s e reenviando`);
        await new Promise(r => setTimeout(r, 2000));
        try {
          const retry = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              number: cleanNumber,
              text: text,
              options: { delay: 1200, presence: 'composing', linkPreview: false }
            })
          });
          if (retry.ok) return { success: true };
          const retryErr = await retry.json().catch(() => ({}));
          console.error(`[Evolution] sendText retry ${retry.status}:`, JSON.stringify(retryErr).substring(0, 300));
          return { success: false, error: retryErr.message || `HTTP ${retry.status}` };
        } catch (e2: any) {
          return { success: false, error: e2.message };
        }
      }

      const errData = await response.json().catch(() => ({}));
      console.error(`[Evolution] sendText ${response.status}:`, JSON.stringify(errData).substring(0, 500), '| instance:', instanceName, '| number:', cleanNumber.slice(0, 4) + '***');
      return { success: false, error: errData.message || `HTTP ${response.status}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  async sendMessage(instanceName: string, recipient: string, text: string): Promise<SendMessageResponse> {
    if (_isSendDuplicate(recipient, text)) {
      console.log(`[Evolution] Dedup: mensagem duplicada bloqueada para ${recipient.slice(-4)}`);
      return { success: true }; // already sent — silently succeed
    }
    return this.sendToWhatsApp(instanceName, recipient, text);
  },

  async logoutInstance(instanceName: string): Promise<{ ok: boolean; status?: number; body?: any }> {
    if (!instanceName) return { ok: false, body: 'instanceName vazio' };
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/instance/logout/${instanceName}`, {
        method: 'DELETE',
        headers
      });
      const body = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, body };
    } catch (e: any) {
      return { ok: false, body: e?.message || 'network error' };
    }
  },

  async deleteInstance(instanceName: string): Promise<boolean> {
    if (!instanceName) return false;
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/instance/delete/${instanceName}`, {
        method: 'DELETE',
        headers
      });
      return response.ok;
    } catch (e) {
      return false;
    }
  },

  // Checks if an instance already exists in Evolution API.
  // Handles both v1 ({ instanceName }) and v2 ({ instance: { instanceName } }) response formats.
  async instanceExists(instanceName: string): Promise<boolean> {
    try {
      const res = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances?instanceName=${instanceName}`, {
        method: 'GET',
        headers
      });
      if (!res.ok) return false;
      const data = await res.json();
      const list: any[] = Array.isArray(data) ? data : [];
      return list.some(
        (i: any) =>
          i.instanceName === instanceName ||
          i.instance?.instanceName === instanceName ||
          i.name === instanceName
      );
    } catch {
      return false;
    }
  },

  // Restarts an existing (disconnected) instance so we can get a fresh QR code.
  // Tries PUT (v2) then POST (some forks) as fallback.
  async restartInstance(instanceName: string): Promise<boolean> {
    try {
      let res = await fetch(`${EVOLUTION_API_URL}/instance/restart/${instanceName}`, {
        method: 'PUT',
        headers
      });
      if (!res.ok && res.status === 404) {
        // Some Evolution API forks use POST instead of PUT
        res = await fetch(`${EVOLUTION_API_URL}/instance/restart/${instanceName}`, {
          method: 'POST',
          headers
        });
      }
      return res.ok;
    } catch {
      return false;
    }
  },

  // Connects (or reconnects) to get a QR code.
  // Strategy:
  //   1. Fetch instance info once (existence + state + disconnectionReasonCode)
  //   2. Truly connected (open, no disc code) → return success immediately
  //   3. Stuck (open + disconnectionReasonCode) OR forceQr → logout → restart → connect
  //   4. Disconnected (close/connecting) → restart → connect
  //   5. Not found → create → connect
  async createAndFetchQr(instanceName: string, forceQr = false): Promise<any> {
    if (!instanceName) return { status: 'error', message: 'Nome da instância inválido.' };
    try {
      // ── Step 1: fetch instance info once (covers existence + state + disc code)
      const infoRes = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances?instanceName=${instanceName}`, { method: 'GET', headers });
      const infoList: any[] = infoRes.ok ? (await infoRes.json().catch(() => [])) : [];
      const inst = Array.isArray(infoList) ? infoList[0] : null;
      const exists = !!inst && (inst.name === instanceName || inst.instanceName === instanceName);
      const connStatus = ((inst?.connectionStatus) || '').toUpperCase();
      const discCode = inst?.disconnectionReasonCode;
      // Instance is truly open when connectionStatus=OPEN and no disconnect code
      const trulyOpen = exists && connStatus === 'OPEN' && !discCode;
      // Instance is stuck when Evolution reports OPEN but there's a disconnection code
      const isStuck = exists && connStatus === 'OPEN' && !!discCode;

      // ── Step 2: fast-path for truly connected instances
      if (!forceQr && trulyOpen) {
        return { status: 'success', qrcode: null, message: 'Conectado.' };
      }

      // ── Step 3: prepare the instance
      if (exists) {
        if (forceQr || isStuck) {
          // Stuck/forced: logout to clear the dead session, then restart for fresh QR
          await this.logoutInstance(instanceName);
          await this.sleep(1500);
        }
        // Restart: if it fails (unsupported endpoint), delete + recreate as fallback
        const restarted = await this.restartInstance(instanceName);
        if (!restarted) {
          // Restart endpoint not available on this Evolution API version — delete and recreate
          await this.deleteInstance(instanceName);
          await this.sleep(1500);
          const createRes = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              instanceName,
              token: EVOLUTION_API_KEY,
              qrcode: true,
              integration: "WHATSAPP-BAILEYS"
            })
          });
          if (!createRes.ok && createRes.status !== 409) {
            const errData = await createRes.json().catch(() => ({}));
            throw new Error(`${errData.message || 'Erro ao recriar instância.'} (HTTP ${createRes.status})`);
          }
        }
        await this.sleep(2000);
      } else {
        // Instance doesn't exist → create it
        const createRes = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            instanceName,
            token: EVOLUTION_API_KEY,
            qrcode: true,
            integration: "WHATSAPP-BAILEYS"
          })
        });
        // 409 = already exists (race condition) — safe to continue
        if (!createRes.ok && createRes.status !== 409) {
          const errData = await createRes.json().catch(() => ({}));
          const httpInfo = `HTTP ${createRes.status}`;
          throw new Error(`${errData.message || 'Erro ao criar instância no servidor Evolution.'} (${httpInfo})`);
        }
        await this.sleep(1500);
      }

      // ── Step 4: request QR code / connection
      const connectResponse = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
        method: 'GET',
        headers
      });
      if (!connectResponse.ok) {
        throw new Error(`Servidor Evolution não respondeu ao pedido de conexão. HTTP ${connectResponse.status}`);
      }

      const data = await connectResponse.json();
      // Only trust "open" from connect when we know the instance is truly stable
      // (not in stuck/forced mode which cleared the session)
      if (!forceQr && !isStuck && (data.instance?.state === 'open' || data.state === 'open')) {
        return { status: 'success', qrcode: null, message: 'Conectado.' };
      }

      const qr = data.base64 || data.code || null;
      if (!qr) {
        return { status: 'error', message: 'QR Code ainda não disponível. Tente novamente em alguns segundos.' };
      }

      return { status: 'success', qrcode: qr, message: 'QR Code Gerado.' };
    } catch (e: any) {
      return { status: 'error', message: e.message || 'Erro inesperado na Evolution API.' };
    }
  },

  // Enables the Edge Function webhook so Evolution API posts messages to it 24/7.
  async enableWebhook(instanceName: string, webhookUrl: string): Promise<boolean> {
    if (!instanceName || !webhookUrl) return false;
    // Evolution API v2+ requires the payload wrapped in a "webhook" object
    const body = JSON.stringify({
      webhook: {
        url: webhookUrl,
        enabled: true,
        webhook_by_events: false,
        webhook_base64: true,
        events: ['MESSAGES_UPSERT']
      }
    });
    try {
      await fetch(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, { method: 'POST', headers, body });
    } catch { /* ignore */ }
    return true;
  },

  // NOTE: setWebhook intentionally calls disableWebhook — the external webhook server
  // must NEVER be re-registered. Frontend polling is the sole message processor.
  async setWebhook(instanceName: string): Promise<boolean> {
    return this.disableWebhook(instanceName);
  },

  // Posts an image to the connected WhatsApp Status (visible to all contacts).
  async sendStatusImage(instanceName: string, imageUrl: string, caption?: string): Promise<SendMessageResponse> {
    if (!instanceName) return { success: false, error: 'Instância não definida' };
    try {
      const res = await fetch(`${EVOLUTION_API_URL}/message/sendStatus/${instanceName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'image',
          content: imageUrl,
          caption: caption || '',
          allContacts: true,
        })
      });
      if (res.ok) return { success: true };
      const err = await res.json().catch(() => ({}));
      console.error(`[Evolution] sendStatusImage ${res.status}:`, JSON.stringify(err).substring(0, 500));
      return { success: false, error: err.message || `HTTP ${res.status}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  // Disables the external webhook so only frontend polling processes messages.
  // Tries EVERY known Evolution API endpoint variant (v1, v2, forks) to guarantee
  // the webhook is cleared regardless of which API version is running.
  async disableWebhook(instanceName: string): Promise<boolean> {
    if (!instanceName) return false;

    // Use the Evolution API's own base URL as the noop webhook target.
    // Requests hit the same server, return a quick non-200 at /noop, and are
    // discarded — no external server ever receives or processes the message.
    const noopUrl = `${EVOLUTION_API_URL}/noop-disabled`;
    const body = JSON.stringify({
      url: noopUrl,
      enabled: false,
      webhook_by_events: false,
      events: []
    });

    const tries: Promise<any>[] = [
      // v1 / v2: POST set with enabled:false
      fetch(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, { method: 'POST', headers, body }).catch(() => null),
      // Some forks: DELETE on /webhook/{name}
      fetch(`${EVOLUTION_API_URL}/webhook/${instanceName}`, { method: 'DELETE', headers }).catch(() => null),
      // Some forks: DELETE on /webhook/set/{name}
      fetch(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, { method: 'DELETE', headers }).catch(() => null),
    ];

    await Promise.allSettled(tries);

    // Verify: read back the configured webhook and warn if still enabled
    try {
      const check = await fetch(`${EVOLUTION_API_URL}/webhook/find/${instanceName}`, { method: 'GET', headers });
      if (check.ok) {
        const cfg = await check.json().catch(() => ({}));
        const enabled = cfg?.webhook?.enabled ?? cfg?.enabled;
        const url: string = cfg?.webhook?.url ?? cfg?.url ?? '';
        if (enabled === true && url.includes('agendezap-api-handler')) {
          console.warn('[evolutionService] disableWebhook: webhook still enabled after attempts — Evolution API may be restoring it on reconnect.');
        }
      }
    } catch { /* ignore — just a verification step */ }

    return true;
  }
};