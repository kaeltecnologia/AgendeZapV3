import React, { useEffect } from 'react';
import { evolutionService } from '../services/evolutionService';
import { db } from '../services/mockDb';
import { supabase } from '../services/supabase';
import { handleMessage } from '../services/agentService';
import { handleProfessionalMessage } from '../services/professionalAgentService';
import { runFollowUp, runDailyProfessionalAgenda } from '../services/followUpService';
import { runRatingRequests } from '../services/ratingService';
import { fetchAudioBase64, transcribeAudio } from '../services/pollingService';
import { maskPhone } from '../services/security';

// ── Module-level singletons — survive component remounts ──────────────
// useRef resets every time the component unmounts/remounts (e.g. tab navigation).
// Module-level variables live for the entire browser session, so messages
// are never reprocessed even if the component re-renders.
const _processedIds = new Set<string>();
const _sessionStart = Math.floor(Date.now() / 1000);
// _processAfter: only process messages newer than this timestamp.
// Updated every poll cycle while AI is OFF, so when AI is re-enabled all
// "stale" messages (received while AI was off) are naturally skipped.
let _processAfter = _sessionStart;
let _isBusy = false;
// _backfillDone: startup backfill runs exactly once per browser session
let _backfillDone = false;
// _aiWasActive: tracks previous AI state to detect OFF→ON transition
let _aiWasActive = false;

// ── Status callback — shared with App.tsx for header badge ────────────
let _statusCallback: ((connected: boolean, aiActive: boolean) => void) | null = null;

// ── Persistent dedup via localStorage ────────────────────────────────
// IDs marked as processed are persisted for 30 min so page reloads and
// multiple-tab restarts never re-process the same message.
const _LS_KEY = 'agz_pid';
const _LS_TTL = 30 * 60 * 1000; // 30 minutes

function _loadPersistedIds(): void {
  try {
    const raw = localStorage.getItem(_LS_KEY);
    if (!raw) return;
    const items: Array<[string, number]> = JSON.parse(raw);
    const cutoff = Date.now() - _LS_TTL;
    for (const [id, ts] of items) {
      if (ts > cutoff) _processedIds.add(id);
    }
  } catch { /* ignore parse errors */ }
}

function _persistId(id: string): void {
  _processedIds.add(id);
  try {
    const raw = localStorage.getItem(_LS_KEY);
    const items: Array<[string, number]> = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - _LS_TTL;
    const fresh = items.filter(([, ts]) => ts > cutoff);
    fresh.push([id, Date.now()]);
    localStorage.setItem(_LS_KEY, JSON.stringify(fresh.slice(-500)));
  } catch { /* ignore storage errors */ }
}

// Populate _processedIds from localStorage on module load
_loadPersistedIds();

// ── Message buffer — accumulate messages per phone, only process
// after N seconds of silence from that number (configurable via settings)
const _lastMsgTime = new Map<string, number>();       // phone → timestamp of last seen msg
const _pendingMsgs  = new Map<string, any[]>();        // phone → accumulated text msgs (most-recent wins)
const _pendingAudio = new Map<string, any[]>();        // phone → audio msgs (bypass silence buffer)

// ── Cross-tab dedup via BroadcastChannel ─────────────────────────────
// When one tab marks a message as processed, all other tabs learn immediately
// so they never re-process the same message if the lock happens to rotate.
let _bc: BroadcastChannel | null = null;
try {
  _bc = new BroadcastChannel('agz_dedup');
  _bc.onmessage = (e: MessageEvent) => {
    if (e.data?.type === 'PROCESSED' && e.data.id) _processedIds.add(e.data.id);
    if (e.data?.type === 'PENDING_PHONE' && e.data.phone) {
      // Another tab is buffering messages from this phone — reset our timer
      // so we don't accidentally fire a duplicate response after 30s.
      _lastMsgTime.set(e.data.phone, e.data.ts ?? Date.now());
    }
  };
} catch { /* BroadcastChannel not available (e.g. some privacy modes) */ }

function broadcastProcessed(msgId: string) {
  try { _bc?.postMessage({ type: 'PROCESSED', id: msgId }); } catch {}
}

function broadcastPending(phone: string) {
  try { _bc?.postMessage({ type: 'PENDING_PHONE', phone, ts: Date.now() }); } catch {}
}

// ── Web Locks — only ONE browser tab polls at a time ─────────────────
// Prevents duplicate processing when the user has multiple tabs open.
async function pollLocked(tenantId: string) {
  const lockName = `agz_poll_${tenantId}`;
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    // ifAvailable: true — if another tab holds the lock, skip this cycle
    await (navigator as any).locks.request(lockName, { ifAvailable: true }, async (lock: any) => {
      if (!lock) return; // another tab is already polling
      await poll(tenantId);
    });
  } else {
    // Fallback for browsers without Web Locks API
    await poll(tenantId);
  }
}

function extrairNumero(msg: any): string | null {
  const candidatos = [
    msg.key?.remoteJidAlt,
    msg.key?.participantAlt,
    msg.key?.remoteJid,
    msg.participant,
    msg.key?.participant,
  ];
  for (const c of candidatos) {
    if (!c) continue;
    if (c.includes('@lid') || c.includes('@g.us')) continue;
    const numero = c.replace(/@.*/, '').replace(/\D/g, '');
    if (numero.length >= 10 && numero.length <= 13) return numero;
  }
  return null;
}

async function processarMensagem(tenant: any, msg: any, settings?: any) {
  const cleanPhone = extrairNumero(msg);
  if (!cleanPhone) return;

  // ── Check per-lead aiPaused ──────────────────────────────────────────
  if (settings?.customerData) {
    let isPaused = !!settings.customerData[`phone:${cleanPhone}`]?.aiPaused;
    if (!isPaused) {
      try {
        const { data: existingCust } = await supabase.from('customers')
          .select('id').eq('tenant_id', tenant.id).eq('telefone', cleanPhone).maybeSingle();
        if (existingCust && settings.customerData[existingCust.id]?.aiPaused) {
          isPaused = true;
        }
      } catch {}
    }
    if (isPaused) {
      console.log(`[AiPolling] IA pausada para ${maskPhone(cleanPhone)} — ignorando`);
      return;
    }
  }

  let text = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.body || msg.text || ''
  ).trim();

  // ── Audio transcription ──────────────────────────────────────────────
  let audioReceived = false;
  let wasTranscribed = false;
  if (!text) {
    const msgType = msg.messageType || msg.type || '';
    const isAudio =
      ['audioMessage', 'pttMessage'].includes(msgType) ||
      !!msg.message?.audioMessage ||
      !!msg.message?.pttMessage;
    if (isAudio) {
      audioReceived = true;
      const geminiKey: string = (settings?.openaiApiKey || '').trim() || (tenant as any).gemini_api_key || '';
      console.log('[AiPolling] Áudio detectado. geminiKey presente:', !!geminiKey, '| msgType:', msgType);
      if (geminiKey) {
        const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
        console.log('[AiPolling] Buscando base64 do áudio — instância:', instanceName);
        const audio = await fetchAudioBase64(instanceName, msg);
        console.log('[AiPolling] fetchAudioBase64 retornou:', audio ? `mimeType=${audio.mimeType}, base64len=${audio.base64.length}` : 'null');
        if (audio) {
          const transcribed = await transcribeAudio(geminiKey, audio.base64, audio.mimeType);
          console.log('[AiPolling] Transcrição:', transcribed ?? 'null');
          if (transcribed) {
            text = transcribed;
            wasTranscribed = true;
          }
        }
      } else {
        console.warn('[AiPolling] Chave Gemini não configurada — áudio ignorado');
      }
    }
  }

  // If audio was received but transcription failed, send a friendly fallback
  if (!text && audioReceived) {
    const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
    await evolutionService.sendMessage(
      instanceName, cleanPhone,
      'Recebi seu áudio! 🎵\n\nPoderia escrever sua mensagem? Assim consigo te atender melhor. 😊'
    );
    return;
  }

  if (!text) return;

  try {
    console.log(`[AiPolling] processarMensagem: phone=${maskPhone(cleanPhone)} text="${text.substring(0, 50)}" geminiKey=${!!(tenant as any).gemini_api_key}`);
    const profReply = await handleProfessionalMessage(tenant, cleanPhone, text);
    const reply = profReply !== null
      ? profReply
      : await handleMessage(tenant, cleanPhone, text, msg.pushName || 'Cliente', { isAudio: wasTranscribed });
    console.log(`[AiPolling] reply: ${reply ? `"${reply.substring(0, 60)}..."` : 'null'}`);
    if (reply) {
      const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
      await evolutionService.sendMessage(instanceName, cleanPhone, reply);
    }
  } catch (e: any) {
    console.error('[AiPolling] Erro ao processar mensagem:', e.message, e.stack);
  }
}

async function poll(tenantId: string) {
  if (_isBusy) return;
  _isBusy = true;

  // ── Safety timeout: if poll hangs > 20 s, release the lock ──────────
  const _busyTimeout = setTimeout(() => {
    if (_isBusy) {
      console.warn('[AiPolling] Poll timeout — releasing busy lock after 20 s');
      _isBusy = false;
    }
  }, 20_000);

  try {
    const settings = await db.getSettings(tenantId);
    if (!settings.aiActive) {
      // Advance _processAfter while AI is off so that when it's re-enabled,
      // all messages received during the off period are treated as "already past"
      // and won't trigger stale responses.
      _processAfter = Math.floor(Date.now() / 1000);
      _aiWasActive = false;
      _statusCallback?.(false, false);
      return;
    }

    // ── OFF → ON transition: skip this first cycle and bump _processAfter ──
    // Prevents the 4-second race window where a message sent just before
    // activation would slip through and cause a double response.
    if (!_aiWasActive) {
      _processAfter = Math.floor(Date.now() / 1000);
      _aiWasActive = true;
      return;
    }
    _aiWasActive = true;

    const tenant = await db.getTenant(tenantId);
    if (!tenant) return;

    const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
    const connectionStatus = await evolutionService.checkStatus(instanceName);
    const isConnected = connectionStatus === 'open';
    _statusCallback?.(isConnected, true);
    if (!isConnected) return;

    const messages = await evolutionService.fetchRecentMessages(instanceName, 10);
    if (!messages || !Array.isArray(messages)) return;

    const sorted = [...messages].sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));

    const now = Date.now();
    // Diagnostic: log new message candidates on each poll
    const newMsgs = sorted.filter(m => m.key?.id && !_processedIds.has(m.key.id) && !m.key?.fromMe);
    if (newMsgs.length > 0) {
      console.log(`[AiPolling] ${sorted.length} msgs fetched, ${newMsgs.length} new (sessionStart=${_sessionStart})`);
    }

    // ── Pre-filter: skip messages already handled by Edge Function webhook ──
    // The Edge Function claims "wh::<msgId>" in msg_dedup for every message it processes.
    // If found, add to _processedIds so Phase 1 skips them (and future polls too).
    const candidateIds = newMsgs.map(m => m.key?.id as string).filter(Boolean);
    if (candidateIds.length > 0) {
      try {
        const fps = candidateIds.map(id => `wh::${id}`);
        const { data: handled } = await supabase.from('msg_dedup').select('fp').in('fp', fps);
        for (const row of (handled || [])) {
          const msgId = (row.fp as string).replace(/^wh::/, '');
          _persistId(msgId);
          broadcastProcessed(msgId);
        }
      } catch { /* non-fatal — polling continues normally if check fails */ }
    }

    // ── Phase 1: accumulate new messages into the per-phone buffer ──
    for (const msg of sorted) {
      const msgId = msg.key?.id;
      if (!msgId || _processedIds.has(msgId)) continue;

      // Mark processed immediately — persists to localStorage so page reloads
      // and other tabs never reprocess this message ID.
      _persistId(msgId);
      broadcastProcessed(msgId); // tell all other tabs right away

      const msgTimestamp = msg.messageTimestamp || msg.timestamp || 0;

      // Skip messages older than _processAfter.
      // _processAfter = session start, but gets bumped to "now" every poll
      // cycle while AI is off — so stale messages from the AI-off period are skipped.
      // Also skip messages with no timestamp (0) — they are likely echoes of bot-sent
      // messages that Evolution API returned without a proper timestamp.
      if (msgTimestamp === 0 || msgTimestamp < _processAfter) continue;

      // Skip own messages — check both key.fromMe and top-level fromMe (Evolution API
      // may place the field at different depths depending on the message type/version)
      if (msg.key?.fromMe || (msg as any).fromMe) continue;

      // Skip group messages
      const remoteJid = msg.key?.remoteJid || '';
      const remoteJidAlt = msg.key?.remoteJidAlt || '';
      if (remoteJid.includes('@g.us') || remoteJidAlt.includes('@g.us')) continue;

      const phone = extrairNumero(msg);
      if (!phone) continue;

      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.content || msg.text || '';
      const msgType = msg.messageType || msg.type || '';
      const isAudio = ['audioMessage', 'pttMessage'].includes(msgType) || !!msg.message?.audioMessage || !!msg.message?.pttMessage;

      if (isAudio) {
        // Audio bypasses the silence buffer — processed on the very next poll cycle (≤ 4 s)
        console.log('[AiPolling] Phase1: áudio enfileirado para', maskPhone(phone), '| msgType:', msgType);
        if (!_pendingAudio.has(phone)) _pendingAudio.set(phone, []);
        _pendingAudio.get(phone)!.push(msg);
      } else if (text.trim()) {
        // Text message goes into the silence buffer
        if (!_pendingMsgs.has(phone)) _pendingMsgs.set(phone, []);
        _pendingMsgs.get(phone)!.push(msg);
        _lastMsgTime.set(phone, now);
        broadcastPending(phone); // tell other tabs this phone has pending msgs
      }
    }

    // ── Phase 2a: process audio messages immediately (no silence buffer) ──
    for (const [phone, audioMsgs] of Array.from(_pendingAudio.entries())) {
      _pendingAudio.delete(phone);
      // Process each audio in order (usually just one)
      for (const audioMsg of audioMsgs) {
        try {
          await processarMensagem(tenant, audioMsg, settings);
        } catch (e: any) {
          console.error('[AiPolling] Áudio:', e.message);
        }
      }
    }

    // ── Phase 2b: for each phone whose text buffer has been silent long enough,
    //             process the LAST (most recent) accumulated text message ──────
    const bufferMs = (settings.msgBufferSecs ?? 20) * 1_000;
    for (const [phone, msgs] of Array.from(_pendingMsgs.entries())) {
      const lastTime = _lastMsgTime.get(phone) ?? 0;
      if (now - lastTime < bufferMs) continue; // still within silence window

      // Drain the buffer
      _pendingMsgs.delete(phone);
      _lastMsgTime.delete(phone);

      // Join all buffered messages into one combined text so the AI has full context.
      // If the lead sent "quero agendar", "com o Matheus", "pra amanhã" separately,
      // the agent sees the complete intent instead of just the last fragment.
      const lastMsg = msgs[msgs.length - 1];
      const extractText = (m: any) =>
        (m.message?.conversation || m.message?.extendedTextMessage?.text || m.body || m.text || '').trim();
      const combinedText = msgs.map(extractText).filter(Boolean).join(' ');
      const msgToProcess = (msgs.length > 1 && combinedText)
        ? { ...lastMsg, message: { ...lastMsg.message, conversation: combinedText } }
        : lastMsg;
      try {
        await processarMensagem(tenant, msgToProcess, settings);
      } catch (e: any) {
        console.error('[AiPolling] Processamento:', e.message);
      }
    }
  } catch (e: any) {
    console.error('[AiPolling] Poll error:', e.message);
  } finally {
    clearTimeout(_busyTimeout);
    _isBusy = false;
  }
}

// ── Startup backfill: catch follow-up replies missed while computer was off ─
// When the machine restarts, Evolution API may have lost the webhook config.
// This function runs ONCE per session, checks for sessions with
// pendingFollowUpType, fetches messages for those phones from Evolution API,
// and processes any unhandled client replies.
async function backfillFollowUpReplies(tenantId: string, tenant: any, instanceName: string, settings: any) {
  if (_backfillDone) return;
  _backfillDone = true;
  try {
    const cutoff = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString();
    const { data: sessRows } = await supabase
      .from('agent_sessions')
      .select('phone, data, updated_at')
      .eq('tenant_id', tenantId)
      .gte('updated_at', cutoff);
    if (!sessRows || sessRows.length === 0) return;

    const pending = sessRows.filter((s: any) => s.data?.pendingFollowUpType);
    if (pending.length === 0) return;

    console.log(`[AiPolling] Backfill: ${pending.length} session(s) with pendingFollowUpType`);

    for (const sess of pending) {
      const phone = sess.phone as string;
      const sessUpdatedSec = Math.floor(new Date(sess.updated_at as string).getTime() / 1000);
      const msgs = await evolutionService.fetchContactMessages(instanceName, phone, 15);
      if (!msgs || msgs.length === 0) continue;

      // Client replies after the aviso was sent
      const replies = msgs.filter((m: any) => {
        if (m.key?.fromMe || (m as any).fromMe) return false;
        const ts = m.messageTimestamp || m.timestamp || 0;
        return ts > sessUpdatedSec;
      });
      if (replies.length === 0) continue;

      // Skip replies already handled by Edge Function webhook
      const replyIds = replies.map((m: any) => m.key?.id as string).filter(Boolean);
      const fps = replyIds.map(id => `wh::${id}`);
      const { data: handled } = await supabase.from('msg_dedup').select('fp').in('fp', fps);
      const handledFps = new Set((handled || []).map((h: any) => h.fp as string));

      const unhandled = replies.filter((m: any) => {
        const msgId = m.key?.id as string;
        return msgId && !handledFps.has(`wh::${msgId}`) && !_processedIds.has(msgId);
      });
      if (unhandled.length === 0) continue;

      // Replies are newest-first from fetchContactMessages; process the most recent
      const latestReply = unhandled[0];
      const msgId = latestReply.key?.id as string;
      if (msgId) { _persistId(msgId); broadcastProcessed(msgId); }
      console.log(`[AiPolling] Backfill: processing missed reply from ${maskPhone(phone)}`);
      await processarMensagem(tenant, latestReply, settings);
    }
  } catch (e: any) {
    console.error('[AiPolling] Backfill error:', e.message);
  }
}

const AiPollingManager: React.FC<{
  tenantId: string;
  onStatus?: (connected: boolean, aiActive: boolean) => void;
}> = ({ tenantId, onStatus }) => {

  // ── Wire up the module-level status callback ──────────────────────────
  useEffect(() => {
    _statusCallback = onStatus ?? null;
    return () => { _statusCallback = null; };
  });

  // ── Activate Edge Function webhook for 24/7 operation ────────────────
  // Runs on mount and every 5 min to re-register if Evolution API resets it.
  useEffect(() => {
    if (!tenantId) return;

    const WEBHOOK_URL = 'https://cnnfnqrnjckntnxdgwae.supabase.co/functions/v1/whatsapp-webhook';

    const activateWebhook = async () => {
      try {
        const settings = await db.getSettings(tenantId);
        if (!settings.aiActive) return;
        const tenant = await db.getTenant(tenantId);
        if (!tenant) return;
        const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
        if (instanceName) {
          await evolutionService.enableWebhook(instanceName, WEBHOOK_URL);
          await backfillFollowUpReplies(tenantId, tenant, instanceName, settings);
        }
      } catch (e) { /* silent */ }
    };

    activateWebhook();
    const interval = setInterval(activateWebhook, 5 * 60 * 1000); // re-register every 5 min
    return () => clearInterval(interval);
  }, [tenantId]);

  // ── AI message polling (every 4 s) — uses Web Locks for single-tab enforcement ──
  useEffect(() => {
    if (!tenantId) return;
    const interval = setInterval(() => pollLocked(tenantId), 4000);
    return () => clearInterval(interval);
  }, [tenantId]);

  // ── Follow-up scheduler (every 60 s) ───────────────────────────────
  useEffect(() => {
    if (!tenantId) return;

    const tick = async () => {
      try {
        // Generate missing recurring plan appointments (next 4 weeks)
        await db.generateRecurringAppointments(tenantId);

        const tenant = await db.getTenant(tenantId);
        if (tenant) await runFollowUp(tenant);
        if (tenant) await runDailyProfessionalAgenda(tenant);
        if (tenant) await runRatingRequests(tenant);

        // ── Trial Day 6 warning ─────────────────────────────────────
        const settings = await db.getSettings(tenantId);
        if (settings.trialStartDate && !settings.trialWarningSent && tenant?.phone) {
          const daysPassed = Math.floor(
            (Date.now() - new Date(settings.trialStartDate).getTime()) / 86_400_000
          );
          if (daysPassed >= 6) {
            const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
            const connStatus = await evolutionService.checkStatus(instanceName);
            if (connStatus === 'open') {
              await evolutionService.sendMessage(
                instanceName,
                tenant.phone,
                `⏰ *Seu teste gratuito termina amanhã!*\n\nPara continuar usando o AgendeZap com IA de agendamento, escolha um plano:\n\n🟢 *Start* — R$ 39,90/mês\n🔵 *Profissional* — R$ 89,90/mês\n🟣 *Elite* — R$ 149,90/mês\n\nAcesse o sistema e clique em "Ver planos" para continuar. 🚀`
              );
              await db.updateSettings(tenantId, { trialWarningSent: true });
              console.log('[Trial] Aviso do dia 6 enviado para', maskPhone(tenant.phone));
            }
          }
        }
      } catch (e: any) {
        console.error('[FollowUp] Erro no scheduler:', e.message);
      }
    };

    tick();
    const interval = setInterval(() => { if (!document.hidden) tick(); }, 120_000);
    return () => clearInterval(interval);
  }, [tenantId]);

  return null;
};

export default AiPollingManager;
