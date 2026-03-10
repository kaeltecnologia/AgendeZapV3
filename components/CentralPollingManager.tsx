/**
 * CentralPollingManager.tsx
 *
 * Polls the Central WhatsApp instance for incoming messages and routes them
 * to the centralAgentService. Same pattern as AiPollingManager but for the
 * single Central instance (multi-tenant).
 *
 * Rendered inside SuperAdminView when Central is active.
 */

import React, { useEffect } from 'react';
import { evolutionService } from '../services/evolutionService';
import { handleCentralMessage, cleanupCentralSessions } from '../services/centralAgentService';
import { maskPhone } from '../services/security';

// Module-level singletons
let _isBusy = false;
const _processedIds = new Set<string>();
const _pendingMsgs = new Map<string, any[]>();
const _lastMsgTime = new Map<string, number>();

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

async function poll(instanceName: string) {
  if (_isBusy || !instanceName) return;
  _isBusy = true;

  const timeout = setTimeout(() => { _isBusy = false; }, 20_000);

  try {
    const connStatus = await evolutionService.checkStatus(instanceName);
    if (connStatus !== 'open') return;

    const messages = await evolutionService.fetchRecentMessages(instanceName, 10);
    if (!messages || !Array.isArray(messages)) return;

    const sorted = [...messages].sort((a: any, b: any) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));
    const now = Date.now();

    // Phase 1: buffer messages per phone
    for (const msg of sorted) {
      const msgId = msg.key?.id;
      if (!msgId || _processedIds.has(msgId)) continue;
      _processedIds.add(msgId);

      if (msg.key?.fromMe) continue;

      const remoteJid = msg.key?.remoteJid || '';
      if (remoteJid.includes('@g.us')) continue;

      const phone = extrairNumero(msg);
      if (!phone) continue;

      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.content || msg.text || '';
      if (!text.trim()) continue;

      if (!_pendingMsgs.has(phone)) _pendingMsgs.set(phone, []);
      _pendingMsgs.get(phone)!.push(msg);
      _lastMsgTime.set(phone, now);
    }

    // Phase 2: process after 15s silence buffer
    const BUFFER_MS = 15_000;
    for (const [phone, msgs] of Array.from(_pendingMsgs.entries())) {
      const lastTime = _lastMsgTime.get(phone) ?? 0;
      if (now - lastTime < BUFFER_MS) continue;

      _pendingMsgs.delete(phone);
      _lastMsgTime.delete(phone);

      const lastMsg = msgs[msgs.length - 1];
      const text = lastMsg.message?.conversation || lastMsg.message?.extendedTextMessage?.text || lastMsg.content || lastMsg.text || '';
      const pushName = lastMsg.pushName || 'Cliente';

      try {
        console.log(`[Central] Processando: ${maskPhone(phone)} → "${text.substring(0, 60)}"`);
        const reply = await handleCentralMessage(instanceName, phone, text.trim(), pushName);
        if (reply) {
          await evolutionService.sendMessage(instanceName, phone, reply);
        }
      } catch (e: any) {
        console.error('[Central] Error processing:', e.message);
      }
    }

    // Cleanup old sessions periodically
    cleanupCentralSessions();
  } catch (e: any) {
    console.error('[Central] Poll error:', e.message);
  } finally {
    clearTimeout(timeout);
    _isBusy = false;
  }
}

async function pollLocked(instanceName: string) {
  const lockName = 'agz_central_poll';
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    await (navigator as any).locks.request(lockName, { ifAvailable: true }, async (lock: any) => {
      if (!lock) return;
      await poll(instanceName);
    });
  } else {
    await poll(instanceName);
  }
}

// Prune processed IDs cache (keep last 500)
function pruneProcessedIds() {
  if (_processedIds.size > 500) {
    const arr = [..._processedIds];
    arr.splice(0, arr.length - 500).forEach(id => _processedIds.delete(id));
  }
}

interface Props {
  instanceName: string;
  active: boolean;
}

const CentralPollingManager: React.FC<Props> = ({ instanceName, active }) => {
  useEffect(() => {
    if (!active || !instanceName) return;

    const interval = setInterval(() => {
      pollLocked(instanceName);
      pruneProcessedIds();
    }, 4000);

    return () => clearInterval(interval);
  }, [instanceName, active]);

  return null; // invisible component
};

export default CentralPollingManager;
