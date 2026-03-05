import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../services/mockDb';
import { evolutionService } from '../services/evolutionService';
import { supabase } from '../services/supabase';
import { Customer } from '../types';
import { fetchAudioBase64, transcribeAudio } from '../services/pollingService';

interface ConvMessage {
  id: string;
  phone: string;
  pushName: string;
  text: string;
  timestamp: number;
  fromMe: boolean;
  isAudio?: boolean;
  rawMsg?: any; // raw Evolution API message (kept for audio transcription)
}

interface Conversation {
  phone: string;
  name: string;
  lastMessage: string;
  lastTimestamp: number;
  isProfessional: boolean;
  professionalName?: string;
  messages: ConvMessage[];
}

// Normalize a raw Evolution API message into the DB row format
function normalizeEvoMsg(msg: any, extrairNumero: (m: any) => string | null) {
  const remoteJid = msg.key?.remoteJid || '';
  if (remoteJid.includes('@g.us')) return null;
  const phone = extrairNumero(msg);
  if (!phone) return null;
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.body || msg.text || '';
  const msgType = msg.messageType || msg.type || '';
  const isAudio =
    ['audioMessage', 'pttMessage'].includes(msgType) ||
    !!msg.message?.audioMessage ||
    !!msg.message?.pttMessage;
  return {
    msg_id:    msg.key?.id || `${phone}_${msg.messageTimestamp || Date.now()}`,
    phone,
    direction: (msg.key?.fromMe ? 'out' : 'in') as 'in' | 'out',
    body:      text || (isAudio ? '[áudio]' : ''),
    msg_type:  msgType || 'text',
    push_name: msg.pushName || phone,
    from_me:   !!msg.key?.fromMe,
    ts:        msg.messageTimestamp || 0,
    raw:       msg,
  };
}

const ConversationsView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [instanceName, setInstanceName] = useState('');
  const [connected, setConnected] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Track whether the initial 10-day bulk import from Evolution API has been done
  const importedRef = useRef(false);

  // Reply
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  // New conversation modal
  const [showNewConv, setShowNewConv] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [contactSearch, setContactSearch] = useState('');

  // AI pause per lead
  const [customerData, setCustomerData] = useState<Record<string, { aiPaused?: boolean }>>({});
  const [togglingAi, setTogglingAi] = useState(false);

  // Audio transcription
  const [transcriptions, setTranscriptions] = useState<Record<string, string>>({});
  const [transcribing, setTranscribing] = useState<Set<string>>(new Set());
  const [apiKey, setApiKey] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Track message count per phone to detect only genuine new messages
  const prevMsgCountRef = useRef<Record<string, number>>({});

  const extrairNumero = (msg: any): string | null => {
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
  };

  const load = useCallback(async () => {
    if (!tenantId) return;
    // Only show the loading indicator on the very first load (no conversations yet)
    if (!importedRef.current) setLoading(true);
    try {
      const { data: tenants } = await supabase.from('tenants').select('*');
      const tenant = (tenants || []).find((t: any) => t.id === tenantId || t.slug === tenantId);
      if (!tenant) return;

      const inst = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
      setInstanceName(inst);

      const status = await evolutionService.checkStatus(inst);
      setConnected(status === 'open');

      const [professionals, custs, settings] = await Promise.all([
        db.getProfessionals(tenantId),
        db.getCustomers(tenantId),
        db.getSettings(tenantId),
      ]);
      setCustomers(custs);
      setCustomerData(settings.customerData || {});
      const key = (settings.openaiApiKey || '').trim() || (tenant.gemini_api_key || '').trim();
      setApiKey(key);

      // ── Sync from Evolution API → save to DB ──────────────────────────
      let evoNormalized: any[] = [];

      if (status === 'open') {
        if (!importedRef.current) {
          // FIRST load: full sync (up to 2000 msgs, no date filter) — AWAITED
          // This is the only time we do a heavy sync; subsequent loads only fetch 200.
          importedRef.current = true;
          const rawMsgs = await evolutionService.fetchRecentMessages(inst, 5000);
          if (rawMsgs?.length) {
            evoNormalized = rawMsgs
              .map((m: any) => normalizeEvoMsg(m, extrairNumero))
              .filter(Boolean) as any[];
            if (evoNormalized.length) await db.saveWaMessages(tenantId, evoNormalized);
          }
        } else {
          // Regular refresh: fetch only the last 200 messages (fast, for new arrivals)
          const recent = await evolutionService.fetchRecentMessages(inst, 200);
          if (recent?.length) {
            evoNormalized = recent
              .map((m: any) => normalizeEvoMsg(m, extrairNumero))
              .filter(Boolean) as any[];
            if (evoNormalized.length) await db.saveWaMessages(tenantId, evoNormalized);
          }
        }
      }

      // ── Load from DB (primary) — always merge evoNormalized so sort order is fresh ─
      let dbRows = await db.getWaMessages(tenantId, 365);
      if (evoNormalized.length > 0) {
        // Merge fresh Evolution API messages in case DB save failed or was partial
        const dbIds = new Set(dbRows.map((r: any) => r.msg_id));
        const newFromEvo = evoNormalized.filter((r: any) => !dbIds.has(r.msg_id));
        if (newFromEvo.length > 0) dbRows = [...dbRows, ...newFromEvo];
      } else if (dbRows.length === 0) {
        dbRows = evoNormalized;
      }

      const phonesMatch = (a: string, b: string) => {
        const ca = a.replace(/\D/g, '');
        const cb = b.replace(/\D/g, '');
        if (!ca || !cb) return false;
        if (ca === cb) return true;
        if (ca.slice(-11) === cb.slice(-11) && cb.slice(-11).length >= 10) return true;
        if (ca.slice(-10) === cb.slice(-10) && cb.slice(-10).length >= 10) return true;
        return false;
      };

      const convMap = new Map<string, Conversation>();

      for (const row of dbRows) {
        const { msg_id, phone, body, msg_type, push_name, from_me, ts, raw } = row;
        if (!body.trim() && body !== '[áudio]') continue;

        const isAudio =
          body === '[áudio]' ||
          ['audioMessage', 'pttMessage'].includes(msg_type || '');

        const matchedProf = professionals.find((p: any) => phonesMatch(p.phone || '', phone));
        const matchedCust = custs.find((c: any) => phonesMatch(c.phone, phone));

        const convMsg: ConvMessage = {
          id:        msg_id,
          phone,
          pushName:  push_name || phone,
          text:      isAudio && !body.startsWith('[') ? body : (isAudio ? '🎵 Áudio' : body),
          timestamp: ts,
          fromMe:    from_me,
          isAudio:   isAudio,
          rawMsg:    isAudio ? (raw || undefined) : undefined,
        };

        const existing = convMap.get(phone);
        if (existing) {
          existing.messages.push(convMsg);
          if (ts >= existing.lastTimestamp) {
            existing.lastMessage = body;
            existing.lastTimestamp = ts;
          }
          if (!from_me) existing.name = push_name || existing.name;
        } else {
          convMap.set(phone, {
            phone,
            name: matchedCust?.name || matchedProf?.name || push_name || phone,
            lastMessage: body,
            lastTimestamp: ts,
            isProfessional: !!matchedProf,
            professionalName: matchedProf?.name,
            messages: [convMsg],
          });
        }
      }

      setConversations(prev => {
        const next = Array.from(convMap.values()).sort((a, b) => b.lastTimestamp - a.lastTimestamp);
        // Preserve locally-sent messages that haven't been saved to DB yet
        return next.map(conv => {
          const old = prev.find(c => c.phone === conv.phone);
          if (!old) return conv;
          const dbIds = new Set(conv.messages.map(m => m.id));
          const localOnly = old.messages.filter(m => !dbIds.has(m.id));
          return { ...conv, messages: [...conv.messages, ...localOnly].sort((a, b) => a.timestamp - b.timestamp) };
        });
      });
    } catch (e) {
      console.error('ConversationsView error:', e);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => { load(); }, 5000);
    return () => clearInterval(interval);
  }, [load]);

  // When opening a conversation: fetch that contact's full history from Evolution API.
  // Only runs when the contact has few messages in the current state (avoids redundant calls).
  useEffect(() => {
    if (!selectedPhone || !instanceName || !connected || !tenantId) return;
    const existingCount = conversations.find(c => c.phone === selectedPhone)?.messages.length ?? 0;
    // Skip if we already have extensive history for this contact
    if (existingCount >= 200) return;

    let cancelled = false;
    evolutionService.fetchContactMessages(instanceName, selectedPhone, 500)
      .then(async (msgs) => {
        if (cancelled || !msgs.length) return;
        const toSave = msgs
          .map((m: any) => normalizeEvoMsg(m, extrairNumero))
          .filter(Boolean) as any[];
        if (!toSave.length) return;
        await db.saveWaMessages(tenantId, toSave);
        if (!cancelled) load();
      })
      .catch(console.error);
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhone, instanceName, connected, tenantId]);

  // 1. Scroll to bottom immediately when switching conversations
  useEffect(() => {
    if (!messagesEndRef.current) return;
    messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
    // Reset message count baseline for the new phone
    const conv = conversations.find(c => c.phone === selectedPhone);
    prevMsgCountRef.current[selectedPhone ?? ''] = conv?.messages.length ?? 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhone]);

  // 2. When conversations update: only scroll if a NEW message arrived AND user is near bottom
  useEffect(() => {
    if (!selectedPhone || !messagesContainerRef.current || !messagesEndRef.current) return;
    const conv = conversations.find(c => c.phone === selectedPhone);
    const count = conv?.messages.length ?? 0;
    const prev = prevMsgCountRef.current[selectedPhone] ?? count;
    if (count > prev) {
      prevMsgCountRef.current[selectedPhone] = count;
      const el = messagesContainerRef.current;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
      if (nearBottom) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversations, selectedPhone]);

  const selectedConv = conversations.find(c => c.phone === selectedPhone);

  const filtered = conversations.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone.includes(searchTerm)
  );

  const filteredContacts = customers.filter(c =>
    c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
    c.phone.includes(contactSearch)
  );

  const transcribeMsg = useCallback(async (msg: ConvMessage) => {
    if (!msg.rawMsg || !apiKey || !instanceName) return;
    if (transcriptions[msg.id] || transcribing.has(msg.id)) return;
    setTranscribing(prev => new Set(prev).add(msg.id));
    try {
      const audio = await fetchAudioBase64(instanceName, msg.rawMsg);
      if (!audio) return;
      const text = await transcribeAudio(apiKey, audio.base64, audio.mimeType);
      if (text) setTranscriptions(prev => ({ ...prev, [msg.id]: text }));
    } catch (e) {
      console.error('[ConversationsView] transcribeMsg error:', e);
    } finally {
      setTranscribing(prev => { const s = new Set(prev); s.delete(msg.id); return s; });
    }
  }, [apiKey, instanceName, transcriptions, transcribing]);

  const formatTime = (ts: number) => {
    if (!ts) return '';
    return new Date(ts * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateLabel = (ts: number) => {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return formatTime(ts);
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  const sendReply = async () => {
    if (!replyText.trim() || !selectedPhone || !instanceName || sending) return;
    setSending(true);
    const msgText = replyText.trim();
    setReplyText('');
    try {
      await evolutionService.sendMessage(instanceName, selectedPhone, msgText);
      const ts = Math.floor(Date.now() / 1000);
      const msgId = `out_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newMsg: ConvMessage = {
        id: msgId,
        phone: selectedPhone,
        pushName: 'Você',
        text: msgText,
        timestamp: ts,
        fromMe: true,
      };
      setConversations(prev => prev.map(c =>
        c.phone === selectedPhone
          ? { ...c, messages: [...c.messages, newMsg], lastMessage: msgText, lastTimestamp: ts }
          : c
      ));
      // Persist outgoing message to DB so it survives page reload
      db.saveWaMessages(tenantId, [{
        msg_id: msgId, phone: selectedPhone, direction: 'out',
        body: msgText, msg_type: 'text', push_name: 'Você',
        from_me: true, ts, raw: {},
      }]).catch(console.error);
    } catch (e) {
      console.error('Send error:', e);
      setReplyText(msgText); // restore on error
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const phonesMatch = (a: string, b: string) => {
    const clean = (s: string) => s.replace(/\D/g, '');
    const ca = clean(a); const cb = clean(b);
    if (!ca || !cb) return false;
    return ca === cb || ca.slice(-11) === cb.slice(-11) || ca.slice(-10) === cb.slice(-10);
  };

  const findCustomerByPhone = (phone: string) =>
    customers.find(c => phonesMatch(c.phone, phone));

  const toggleAiForLead = async (phone: string) => {
    const cust = findCustomerByPhone(phone);
    if (!cust || togglingAi) return;
    setTogglingAi(true);
    try {
      const settings = await db.getSettings(tenantId);
      const current = settings.customerData || {};
      const custEntry = current[cust.id] || {};
      const newPaused = !custEntry.aiPaused;
      const updated = { ...current, [cust.id]: { ...custEntry, aiPaused: newPaused } };
      await db.updateSettings(tenantId, { customerData: updated });
      setCustomerData(updated);
    } finally {
      setTogglingAi(false);
    }
  };

  const openContact = (phone: string, name: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    const existing = conversations.find(c => c.phone === cleanPhone || c.phone.slice(-11) === cleanPhone.slice(-11));
    if (existing) {
      setSelectedPhone(existing.phone);
    } else {
      // Create a virtual conversation
      const newConv: Conversation = {
        phone: cleanPhone,
        name,
        lastMessage: '',
        lastTimestamp: 0,
        isProfessional: false,
        messages: [],
      };
      setConversations(prev => [newConv, ...prev]);
      setSelectedPhone(cleanPhone);
    }
    setShowNewConv(false);
    setContactSearch('');
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">WhatsApp</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            {instanceName || '...'}
            {connected
              ? <span className="text-green-500 ml-2">● Online</span>
              : <span className="text-red-500 ml-2">● Offline</span>}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="bg-black text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-orange-500 transition-all disabled:opacity-50"
        >
          {loading ? 'Carregando...' : '↺ Atualizar'}
        </button>
      </div>

      {!connected && !loading && (
        <div className="bg-red-50 border-2 border-red-100 rounded-[24px] p-8 text-center">
          <p className="text-sm font-black text-red-600 uppercase">WhatsApp desconectado</p>
          <p className="text-xs font-bold text-red-400 mt-1">Conecte em Integrações → WhatsApp</p>
        </div>
      )}

      {connected && (
        <div
          className="bg-white border-2 border-slate-100 rounded-[30px] overflow-hidden shadow-xl shadow-slate-100/50"
          style={{ height: 'calc(100vh - 240px)', minHeight: '500px' }}
        >
          <div className="flex h-full">
            {/* ── Sidebar ──────────────────────── */}
            <div className="w-80 border-r-2 border-slate-100 flex flex-col flex-shrink-0">
              <div className="p-4 border-b border-slate-100 space-y-2">
                <input
                  placeholder="Buscar conversa..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 rounded-2xl text-xs font-bold outline-none border-2 border-transparent focus:border-orange-500 transition-all"
                />
                <button
                  onClick={() => setShowNewConv(true)}
                  className="w-full py-2.5 bg-orange-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-600 transition-all"
                >
                  + Nova Mensagem
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {loading && (
                  <div className="p-8 text-center text-slate-300 text-xs font-black uppercase animate-pulse">Carregando...</div>
                )}
                {!loading && filtered.length === 0 && (
                  <div className="p-8 text-center text-slate-300 text-xs font-black uppercase">Nenhuma conversa</div>
                )}
                {filtered.map(conv => (
                  <button
                    key={conv.phone}
                    onClick={() => setSelectedPhone(conv.phone)}
                    className={`w-full text-left px-4 py-3.5 border-b border-slate-50 hover:bg-slate-100 transition-all ${selectedPhone === conv.phone ? 'bg-orange-50 border-l-[3px] border-l-orange-500' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0 ${conv.isProfessional ? 'bg-orange-100' : 'bg-slate-100'}`}>
                        {conv.isProfessional ? '💈' : '👤'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline gap-1">
                          <span className="text-[11px] font-black text-black truncate">
                            {conv.professionalName || conv.name}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400 flex-shrink-0">{formatDateLabel(conv.lastTimestamp)}</span>
                        </div>
                        {conv.isProfessional && (
                          <span className="text-[8px] font-black text-orange-500 uppercase tracking-widest">Barbeiro</span>
                        )}
                        <p className="text-[10px] text-slate-400 truncate mt-0.5">{conv.lastMessage}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Message Panel ────────────────── */}
            <div className="flex-1 flex flex-col min-w-0">
              {!selectedConv ? (
                <div className="flex-1 flex items-center justify-center text-slate-200">
                  <div className="text-center space-y-3">
                    <div className="text-6xl">💬</div>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-300">Selecione uma conversa</p>
                    <p className="text-[10px] font-bold text-slate-200">ou clique em + Nova Mensagem</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Contact header */}
                  <div className="px-6 py-4 border-b-2 border-slate-100 flex items-center gap-4 flex-shrink-0">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-xl ${selectedConv.isProfessional ? 'bg-orange-100' : 'bg-slate-100'}`}>
                      {selectedConv.isProfessional ? '💈' : '👤'}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-black text-black">{selectedConv.professionalName || selectedConv.name}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{selectedConv.phone}</p>
                    </div>
                    {/* AI pause toggle — only for known customers */}
                    {findCustomerByPhone(selectedConv.phone) && (() => {
                      const cust = findCustomerByPhone(selectedConv.phone)!;
                      const isPaused = !!customerData[cust.id]?.aiPaused;
                      return (
                        <button
                          onClick={() => toggleAiForLead(selectedConv.phone)}
                          disabled={togglingAi}
                          title={isPaused ? 'IA pausada — clique para reativar' : 'IA ativa — clique para pausar'}
                          className={`flex items-center gap-2 px-4 py-2 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 ${
                            isPaused
                              ? 'bg-red-50 text-red-500 border-2 border-red-200 hover:bg-red-100'
                              : 'bg-green-50 text-green-600 border-2 border-green-200 hover:bg-green-100'
                          }`}
                        >
                          <span className="text-sm">{isPaused ? '🤖❌' : '🤖✅'}</span>
                          {isPaused ? 'IA pausada' : 'IA ativa'}
                        </button>
                      );
                    })()}
                  </div>

                  {/* Messages */}
                  <div ref={messagesContainerRef} className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-2 bg-slate-50/30">
                    {selectedConv.messages.length === 0 && (
                      <div className="h-full flex items-center justify-center">
                        <p className="text-xs font-black text-slate-200 uppercase">Nenhuma mensagem ainda. Envie a primeira!</p>
                      </div>
                    )}
                    {selectedConv.messages.map((msg, i) => {
                      // Group date separator
                      const prevMsg = selectedConv.messages[i - 1];
                      const msgDate = new Date(msg.timestamp * 1000).toDateString();
                      const prevDate = prevMsg ? new Date(prevMsg.timestamp * 1000).toDateString() : null;
                      const showDateSep = msgDate !== prevDate;

                      return (
                        <React.Fragment key={msg.id || i}>
                          {showDateSep && msg.timestamp > 0 && (
                            <div className="flex items-center gap-3 py-2">
                              <div className="flex-1 h-px bg-slate-100" />
                              <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest px-2">
                                {new Date(msg.timestamp * 1000).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                              </span>
                              <div className="flex-1 h-px bg-slate-100" />
                            </div>
                          )}
                          <div className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[72%] px-4 py-2.5 rounded-2xl text-xs font-medium shadow-sm ${
                              msg.fromMe
                                ? 'bg-orange-500 text-white rounded-br-sm'
                                : 'bg-white text-black border border-slate-100 rounded-bl-sm'
                            }`}>
                              {msg.isAudio ? (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2 py-0.5">
                                    <span className="text-base">🎵</span>
                                    {transcriptions[msg.id] ? (
                                      <p className="whitespace-pre-wrap leading-relaxed break-words text-xs">{transcriptions[msg.id]}</p>
                                    ) : transcribing.has(msg.id) ? (
                                      <span className={`text-[10px] font-black italic ${msg.fromMe ? 'text-orange-200' : 'text-slate-400'}`}>transcrevendo...</span>
                                    ) : (
                                      <button
                                        onClick={() => transcribeMsg(msg)}
                                        className={`text-[10px] font-black uppercase tracking-widest underline ${msg.fromMe ? 'text-orange-100 hover:text-white' : 'text-slate-400 hover:text-orange-500'}`}
                                      >Transcrever</button>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <p className="whitespace-pre-wrap leading-relaxed break-words">{msg.text}</p>
                              )}
                              <p className={`text-[9px] mt-1 text-right font-bold ${msg.fromMe ? 'text-orange-200' : 'text-slate-400'}`}>
                                {formatTime(msg.timestamp)}
                              </p>
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Reply box */}
                  <div className="flex-shrink-0 px-4 py-3 border-t-2 border-slate-100 bg-white">
                    <div className="flex gap-2 items-end">
                      <textarea
                        ref={textareaRef}
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendReply();
                          }
                        }}
                        placeholder="Digite sua mensagem... (Enter para enviar, Shift+Enter para nova linha)"
                        rows={2}
                        className="flex-1 px-4 py-3 bg-slate-50 rounded-2xl text-xs font-medium outline-none border-2 border-transparent focus:border-orange-500 transition-all resize-none"
                      />
                      <button
                        onClick={sendReply}
                        disabled={!replyText.trim() || sending}
                        className="px-5 py-3 bg-orange-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-600 transition-all disabled:opacity-40 flex-shrink-0 self-end"
                      >
                        {sending ? '...' : 'Enviar'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── New Conversation Modal ─────────────── */}
      {showNewConv && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-md p-8 space-y-6 animate-scaleUp shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-black text-black uppercase tracking-tight">Nova Mensagem</h2>
              <button onClick={() => { setShowNewConv(false); setContactSearch(''); }} className="text-slate-300 hover:text-red-500 font-black text-xl">✕</button>
            </div>

            <input
              placeholder="Buscar por nome ou telefone..."
              value={contactSearch}
              onChange={e => setContactSearch(e.target.value)}
              autoFocus
              className="w-full px-4 py-3 bg-slate-50 rounded-2xl text-xs font-bold outline-none border-2 border-transparent focus:border-orange-500 transition-all"
            />

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 min-h-0">
              {filteredContacts.length === 0 && (
                <p className="text-center text-slate-300 text-xs font-black uppercase py-8">Nenhum cliente encontrado</p>
              )}
              {filteredContacts.slice(0, 30).map(c => (
                <button
                  key={c.id}
                  onClick={() => openContact(c.phone, c.name)}
                  className="w-full text-left flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-slate-100 hover:border-slate-200 border-2 border-transparent transition-all"
                >
                  <div className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center text-base flex-shrink-0">👤</div>
                  <div>
                    <p className="text-xs font-black text-black">{c.name}</p>
                    <p className="text-[10px] font-bold text-slate-400">{c.phone}</p>
                  </div>
                </button>
              ))}

              {/* Manual phone entry */}
              {contactSearch.replace(/\D/g, '').length >= 10 && (
                <button
                  onClick={() => openContact(contactSearch.replace(/\D/g, ''), contactSearch)}
                  className="w-full text-left flex items-center gap-4 px-4 py-3 rounded-2xl border-2 border-dashed border-orange-200 hover:bg-slate-100 transition-all"
                >
                  <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center text-base flex-shrink-0">📱</div>
                  <div>
                    <p className="text-xs font-black text-black">Enviar para número avulso</p>
                    <p className="text-[10px] font-bold text-orange-500">{contactSearch}</p>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConversationsView;
