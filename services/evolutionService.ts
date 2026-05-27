
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

function _dedupKey(phone: string, text: string): string {
  return `${phone.replace(/\D/g, '')}::${text.trim().slice(0, 150)}`;
}

function _checkSendDuplicate(phone: string, text: string): boolean {
  const now = Date.now();
  const last = _sentDedup.get(_dedupKey(phone, text));
  return last !== undefined && now - last < _SEND_DEDUP_TTL;
}

function _registerSendDedup(phone: string, text: string): void {
  const now = Date.now();
  _sentDedup.set(_dedupKey(phone, text), now);
  // Prune old entries
  if (_sentDedup.size > 200) {
    for (const [k, t] of _sentDedup) {
      if (now - t > _SEND_DEDUP_TTL) _sentDedup.delete(k);
    }
  }
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

  async checkStatus(
    instanceName: string,
    onDebug?: (msg: string) => void
  ): Promise<'open' | 'close' | 'connecting' | 'notfound'> {
    if (!instanceName) return 'notfound';
    const dbg = (msg: string) => { console.log('[checkStatus]', msg); onDebug?.(msg); };
    try {
      const res = await fetch(
        `${EVOLUTION_API_URL}/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
        { method: 'GET', headers }
      );
      dbg(`HTTP ${res.status}`);
      if (!res.ok) return res.status === 404 ? 'notfound' : 'close';
      const body = await res.json().catch(() => null);
      dbg(`body: ${JSON.stringify(body).slice(0, 300)}`);
      const list: any[] = Array.isArray(body) ? body : (body ? [body] : []);
      if (list.length === 0) {
        // Fallback: busca sem filtro e procura por nome
        const res2 = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, { method: 'GET', headers });
        if (!res2.ok) return 'notfound';
        const all: any[] = await res2.json().catch(() => []);
        dbg(`fallback: ${all.length} instâncias`);
        const nameLow = instanceName.toLowerCase();
        const found = all.find((i: any) => {
          const n = (i?.name ?? i?.instanceName ?? '').toLowerCase();
          return n === nameLow || n === nameLow.replace(/^agz_/, '') || nameLow === n.replace(/^agz_/, '');
        });
        if (!found) return 'notfound';
        dbg(`fallback encontrado: ${JSON.stringify(found).slice(0, 300)}`);
        const cs2 = (
          found.connectionStatus ?? found.instance?.connectionStatus ??
          found.state ?? found.instance?.state ?? ''
        ).toString().toUpperCase();
        if (['OPEN', 'CONNECTED', 'ONLINE'].includes(cs2)) return 'open';
        if (['CONNECTING', 'PAIRING', 'QRCODE'].includes(cs2)) return 'connecting';
        return 'close';
      }
      const inst = list[0];
      // Log do objeto bruto para diagnóstico — mostra o formato exato retornado pela API
      dbg(`inst: ${JSON.stringify(inst).slice(0, 500)}`);
      // Suporta raiz OU aninhado em inst.instance (varia por versão da Evolution API)
      const connStatus = (
        inst.connectionStatus ?? inst.instance?.connectionStatus ??
        inst.state ?? inst.instance?.state ?? ''
      ).toString().toUpperCase();
      dbg(`connStatus="${connStatus}"`);
      if (['OPEN', 'CONNECTED', 'ONLINE'].includes(connStatus)) return 'open';
      if (['CONNECTING', 'PAIRING', 'QRCODE', 'CONNECTING_SESSION'].includes(connStatus)) return 'connecting';
      return 'close';
    } catch (e: any) {
      dbg(`erro: ${e?.message}`);
      return 'close';
    }
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

      // Retry once on 400 Connection Closed — transient socket drop even when instance is connected
      if (response.status === 400) {
        const errData400 = await response.json().catch(() => ({}));
        const errMsg400 = JSON.stringify(errData400);
        if (errMsg400.toLowerCase().includes('connection closed')) {
          console.warn(`[Evolution] sendText 400 Connection Closed — aguardando 3s e reenviando | instance: ${instanceName}`);
          await new Promise(r => setTimeout(r, 3000));
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
            console.error(`[Evolution] sendText 400 retry ${retry.status}:`, JSON.stringify(retryErr).substring(0, 300));
            return { success: false, error: retryErr.message || `HTTP ${retry.status}` };
          } catch (e2: any) {
            return { success: false, error: e2.message };
          }
        }
        console.error(`[Evolution] sendText 400:`, errMsg400.substring(0, 500), '| instance:', instanceName, '| number:', cleanNumber.slice(0, 4) + '***');
        return { success: false, error: errData400.message || 'HTTP 400' };
      }

      const errData = await response.json().catch(() => ({}));
      console.error(`[Evolution] sendText ${response.status}:`, JSON.stringify(errData).substring(0, 500), '| instance:', instanceName, '| number:', cleanNumber.slice(0, 4) + '***');
      return { success: false, error: errData.message || `HTTP ${response.status}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  async sendMessage(instanceName: string, recipient: string, text: string): Promise<SendMessageResponse> {
    if (_checkSendDuplicate(recipient, text)) {
      console.log(`[Evolution] Dedup: mensagem duplicada bloqueada para ${recipient.slice(-4)}`);
      return { success: true }; // already sent — silently succeed
    }
    const result = await this.sendToWhatsApp(instanceName, recipient, text);
    if (result.success) {
      // Only register dedup AFTER a confirmed successful send — prevents failed
      // attempts from blocking legitimate retries (e.g. user retrying after reconnect)
      _registerSendDedup(recipient, text);
    }
    return result;
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
      if (!res.ok) return false;
      // Guard against HTTP 200 with {error:true} in body (some Evolution API versions do this)
      try {
        const body = await res.clone().json();
        if (body?.error === true || body?.status === 'error') return false;
      } catch { /* body not JSON — treat as success */ }
      return true;
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
      // Normalise to array — some Evolution API versions return a single object instead of array
      const list: any[] = Array.isArray(infoList) ? infoList : (infoList ? [infoList] : []);
      const inst = list[0] ?? null;
      // Support flat { name, instanceName } AND nested { instance: { name, instanceName } } formats
      const instName = inst?.name ?? inst?.instanceName ?? inst?.instance?.name ?? inst?.instance?.instanceName ?? '';
      const exists = !!inst && instName === instanceName;
      // Check connectionStatus at root level AND nested inside inst.instance (varies by API version)
      const connStatus = (
        inst?.connectionStatus ?? inst?.instance?.connectionStatus ??
        inst?.state ?? inst?.instance?.state ?? ''
      ).toString().toUpperCase();
      const trulyOpen = exists && ['OPEN', 'CONNECTED', 'ONLINE'].includes(connStatus);
      // Stuck instance: has a disconnectionReasonCode (session terminated abnormally)
      // These must be fully deleted+recreated — restart is unreliable in this state
      const discCode = inst?.disconnectionReasonCode ?? inst?.instance?.disconnectionReasonCode;
      const isStuck = !!discCode && !trulyOpen;

      // ── Step 2: fast-path for truly connected instances
      if (!forceQr && trulyOpen) {
        return { status: 'success', qrcode: null, message: 'Conectado.' };
      }

      // ── Step 3: prepare the instance
      if (exists) {
        if (forceQr || isStuck) {
          // Forced reset OR stuck session (disconnectionReasonCode set):
          // logout + delete + recreate for a guaranteed clean slate
          await this.logoutInstance(instanceName);
          await this.sleep(1000);
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
        } else {
          // Normal disconnect: try restart first (faster), fall back to delete+create
          const restarted = await this.restartInstance(instanceName);
          if (!restarted) {
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
      // (not in forced-reset mode which cleared the session)
      if (!forceQr && (data.instance?.state === 'open' || data.state === 'open')) {
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
    const events = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'];
    const bodyV2 = JSON.stringify({ webhook: { url: webhookUrl, enabled: true, webhookByEvents: false, webhookBase64: false, events } });
    const bodyV1 = JSON.stringify({ url: webhookUrl, enabled: true, webhookByEvents: false, webhookBase64: false, events });
    // Tenta POST v2, POST v1, PUT v2 — aceita o primeiro 2xx
    try {
      for (const [method, body] of [['POST', bodyV2], ['POST', bodyV1], ['PUT', bodyV2]] as const) {
        const r = await fetch(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, { method, headers, body });
        if (r.ok) return true;
      }
    } catch { /* ignore */ }
    return false;
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