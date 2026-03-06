import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../services/mockDb';
import { evolutionService, EVOLUTION_API_URL, EVOLUTION_API_KEY } from '../services/evolutionService';
import { supabase } from '../services/supabase';
import { Customer, Service, Professional, AppointmentStatus, BookingSource } from '../types';
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

// ── Profile pic cache (localStorage, 24h TTL) ────────────────────────────────
const PIC_CACHE_KEY = 'agz_profile_pics';
function loadPicCache(): Record<string, { url: string; ts: number }> {
  try { return JSON.parse(localStorage.getItem(PIC_CACHE_KEY) || '{}'); } catch { return {}; }
}
function savePicCache(cache: Record<string, { url: string; ts: number }>) {
  try { localStorage.setItem(PIC_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

const ConversationsView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [instanceName, setInstanceName] = useState('');
  const [connected, setConnected] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Profile pictures: phone → url
  const [profilePics, setProfilePics] = useState<Record<string, string>>(() => {
    const cache = loadPicCache();
    const now = Date.now();
    const valid: Record<string, string> = {};
    for (const [phone, { url, ts }] of Object.entries(cache)) {
      if (url && now - ts < 24 * 3600 * 1000) valid[phone] = url;
    }
    return valid;
  });

  // Seen timestamps: phone → lastTimestamp when human last opened that conv
  const [seenAt, setSeenAt] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(`agz_conv_seen_${tenantId}`) || '{}'); } catch { return {}; }
  });

  // Track whether the initial 10-day bulk import from Evolution API has been done
  const importedRef = useRef(false);

  // Reply
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  // New conversation modal
  const [showNewConv, setShowNewConv] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [contactSearch, setContactSearch] = useState('');

  // AI pause per lead + waitlist alert
  const [customerData, setCustomerData] = useState<Record<string, { aiPaused?: boolean; waitlistAlert?: boolean }>>({});
  const [togglingAi, setTogglingAi] = useState(false);

  // Audio transcription
  const [transcriptions, setTranscriptions] = useState<Record<string, string>>({});
  const [transcribing, setTranscribing] = useState<Set<string>>(new Set());
  const [apiKey, setApiKey] = useState('');

  // Quick booking modal
  const [showBooking, setShowBooking] = useState(false);
  const [bookingProfs, setBookingProfs] = useState<Professional[]>([]);
  const [bookingServices, setBookingServices] = useState<Service[]>([]);
  const [bookingCustomerId, setBookingCustomerId] = useState('');
  const [bookingProfId, setBookingProfId] = useState('');
  const [bookingServiceId, setBookingServiceId] = useState('');
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [bookingSaving, setBookingSaving] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [bookingSlots, setBookingSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [dayClosed, setDayClosed] = useState(false);

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

  // Mark conversation as seen + select it
  const handleSelectConv = (phone: string) => {
    setSelectedPhone(phone);
    const conv = conversations.find(c => c.phone === phone);
    if (conv) {
      const updated = { ...seenAt, [phone]: conv.lastTimestamp };
      setSeenAt(updated);
      try { localStorage.setItem(`agz_conv_seen_${tenantId}`, JSON.stringify(updated)); } catch {}
    }
  };

  // Whether a conversation has unread messages (has incoming msgs after last seen)
  const isUnread = (conv: Conversation) => {
    const seen = seenAt[conv.phone] ?? 0;
    return conv.lastTimestamp > seen && conv.messages.some(m => !m.fromMe);
  };

  // Fetch profile pics via batch endpoint (findContacts) — single call for all contacts
  useEffect(() => {
    if (!instanceName || !connected || conversations.length === 0) return;
    const cache = loadPicCache();
    const now = Date.now();
    // Check if any conversation needs a refresh (not cached or expired)
    const needsRefresh = conversations.some(c => {
      const cached = cache[c.phone];
      return !cached || now - cached.ts > 24 * 3600 * 1000;
    });
    if (!needsRefresh) return;

    (async () => {
      try {
        const res = await fetch(
          `${EVOLUTION_API_URL}/chat/findContacts/${instanceName}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
            body: '{}',
          }
        );
        if (!res.ok) return;
        const contacts: any[] = await res.json();
        if (!Array.isArray(contacts)) return;

        const newCache = loadPicCache();
        const newPics: Record<string, string> = {};
        const ts = Date.now();

        for (const contact of contacts) {
          // remoteJid format: "554499241914@s.whatsapp.net"
          const jid: string = contact.remoteJid || contact.id || '';
          if (!jid || jid.includes('@g.us')) continue;
          const phone = jid.replace(/@.*/, '').replace(/\D/g, '');
          if (!phone) continue;
          const url: string = contact.profilePicUrl || contact.profilePictureUrl || '';
          newCache[phone] = { url, ts };
          if (url) newPics[phone] = url;
        }

        savePicCache(newCache);
        if (Object.keys(newPics).length > 0) {
          setProfilePics(prev => ({ ...prev, ...newPics }));
        }
      } catch {}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length, instanceName, connected]);

  const toggleAiForLead = async (phone: string) => {
    if (togglingAi) return;
    const cust = findCustomerByPhone(phone);
    const key = cust ? cust.id : `phone:${phone}`;
    setTogglingAi(true);
    try {
      const settings = await db.getSettings(tenantId);
      const current = settings.customerData || {};
      const custEntry = current[key] || {};
      const newPaused = !custEntry.aiPaused;
      const updated = { ...current, [key]: { ...custEntry, aiPaused: newPaused } };
      await db.updateSettings(tenantId, { customerData: updated });
      setCustomerData(updated);
    } finally {
      setTogglingAi(false);
    }
  };

  const clearWaitlistAlert = async (phone: string) => {
    const cust = findCustomerByPhone(phone);
    if (!cust) return;
    try {
      const settings = await db.getSettings(tenantId);
      const current = settings.customerData || {};
      const custEntry = current[cust.id] || {};
      const updated = { ...current, [cust.id]: { ...custEntry, waitlistAlert: false } };
      await db.updateSettings(tenantId, { customerData: updated });
      setCustomerData(updated);
    } catch (e) { console.error('clearWaitlistAlert error:', e); }
  };

  // Recompute available slots whenever prof / date / service changes while modal is open
  useEffect(() => {
    if (!showBooking || !bookingProfId || !bookingDate || !bookingServiceId) {
      setBookingSlots([]);
      setDayClosed(false);
      return;
    }
    setSlotsLoading(true);
    setBookingTime('');
    (async () => {
      try {
        const settings = await db.getSettings(tenantId);
        // Day of week for chosen date (avoid DST: use midday)
        const dow = new Date(`${bookingDate}T12:00:00`).getDay();
        const dayConfig = settings.operatingHours?.[dow];
        if (!dayConfig?.active) {
          setDayClosed(true);
          setBookingSlots([]);
          return;
        }
        setDayClosed(false);
        const [openStr, closeStr] = (dayConfig.range || '08:00-20:00').split('-');
        const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        const openMin = toMin(openStr);
        const closeMin = toMin(closeStr);
        const svc = bookingServices.find(s => s.id === bookingServiceId);
        const dur = svc?.durationMinutes || 30;

        // Generate all possible start slots
        const allSlots: string[] = [];
        for (let cur = openMin; cur + dur <= closeMin; cur += dur) {
          allSlots.push(`${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`);
        }

        // Fetch booked appointments for this prof on this day
        const allAppts = await db.getAppointments(tenantId);
        const todayAppts = allAppts.filter(a =>
          a.professional_id === bookingProfId &&
          a.status !== AppointmentStatus.CANCELLED &&
          new Date(a.startTime).toLocaleDateString('en-CA') === bookingDate
        );

        // Filter: slot is available if it doesn't overlap any existing appointment
        const nowMin = bookingDate === new Date().toISOString().slice(0, 10)
          ? new Date().getHours() * 60 + new Date().getMinutes()
          : 0;

        const available = allSlots.filter(slot => {
          const slotStart = toMin(slot);
          if (slotStart <= nowMin) return false; // skip past slots on today
          const slotEnd = slotStart + dur;
          return !todayAppts.some(a => {
            const aStart = new Date(a.startTime);
            const aStartMin = aStart.getHours() * 60 + aStart.getMinutes();
            const aEndMin = aStartMin + (a.durationMinutes || 30);
            return slotStart < aEndMin && slotEnd > aStartMin;
          });
        });

        setBookingSlots(available);
      } catch { setBookingSlots([]); }
      finally { setSlotsLoading(false); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBooking, bookingProfId, bookingDate, bookingServiceId]);

  const openBookingModal = async () => {
    setBookingSuccess(false);
    setBookingError('');
    setBookingSaving(false);
    // Default date = today, time reset (will be chosen from slots)
    setBookingDate(new Date().toISOString().slice(0, 10));
    setBookingTime('');
    // Pre-select customer from selected conversation
    if (selectedPhone) {
      const cust = findCustomerByPhone(selectedPhone);
      setBookingCustomerId(cust?.id || '');
    } else {
      setBookingCustomerId('');
    }
    setBookingProfId('');
    setBookingServiceId('');
    // Load profs + services if not yet loaded
    if (bookingProfs.length === 0 || bookingServices.length === 0) {
      const [profs, svcs] = await Promise.all([
        db.getProfessionals(tenantId),
        db.getServices(tenantId),
      ]);
      setBookingProfs(profs.filter((p: Professional) => p.active !== false));
      setBookingServices(svcs.filter((s: Service) => s.active !== false));
      if (profs.length > 0) setBookingProfId(profs[0].id);
      if (svcs.length > 0) setBookingServiceId(svcs[0].id);
    } else {
      if (bookingProfId === '' && bookingProfs.length > 0) setBookingProfId(bookingProfs[0].id);
      if (bookingServiceId === '' && bookingServices.length > 0) setBookingServiceId(bookingServices[0].id);
    }
    setShowBooking(true);
  };

  const saveBooking = async () => {
    if (!bookingCustomerId || !bookingProfId || !bookingServiceId || !bookingDate) {
      setBookingError('Preencha todos os campos.');
      return;
    }
    if (!bookingTime) {
      setBookingError('Selecione um horário disponível.');
      return;
    }
    setBookingSaving(true);
    setBookingError('');
    try {
      const svc = bookingServices.find(s => s.id === bookingServiceId);
      const startTime = new Date(`${bookingDate}T${bookingTime}:00`).toISOString();
      await db.addAppointment({
        tenant_id: tenantId,
        customer_id: bookingCustomerId,
        professional_id: bookingProfId,
        service_id: bookingServiceId,
        startTime,
        durationMinutes: svc?.durationMinutes || 30,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WEB,
      });
      setBookingSuccess(true);
      setTimeout(() => setShowBooking(false), 1500);
    } catch (e: any) {
      setBookingError(e?.message || 'Erro ao agendar.');
    } finally {
      setBookingSaving(false);
    }
  };

  const openContact = (phone: string, name: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    const existing = conversations.find(c => c.phone === cleanPhone || c.phone.slice(-11) === cleanPhone.slice(-11));
    if (existing) {
      handleSelectConv(existing.phone);
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
      handleSelectConv(cleanPhone);
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
        <div className="flex gap-2">
          <button
            onClick={openBookingModal}
            className="bg-orange-500 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-orange-600 transition-all"
          >
            + Agendar
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="bg-black text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-orange-500 transition-all disabled:opacity-50"
          >
            {loading ? 'Carregando...' : '↺ Atualizar'}
          </button>
        </div>
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
                    onClick={() => handleSelectConv(conv.phone)}
                    className={`w-full text-left px-4 py-3.5 border-b border-slate-50 hover:bg-slate-100 transition-all ${selectedPhone === conv.phone ? 'bg-orange-50 border-l-[3px] border-l-orange-500' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Avatar with unread dot */}
                      <div className="relative flex-shrink-0">
                        {profilePics[conv.phone] ? (
                          <img
                            src={profilePics[conv.phone]}
                            alt={conv.name}
                            className="w-10 h-10 rounded-full object-cover"
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-base ${conv.isProfessional ? 'bg-orange-100' : 'bg-slate-100'}`}>
                            {conv.isProfessional ? '💈' : '👤'}
                          </div>
                        )}
                        {isUnread(conv) && selectedPhone !== conv.phone && (
                          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-orange-500 rounded-full border-2 border-white" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline gap-1">
                          <span className={`text-[11px] truncate ${isUnread(conv) && selectedPhone !== conv.phone ? 'font-black text-black' : 'font-bold text-slate-700'}`}>
                            {conv.professionalName || conv.name}
                          </span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {(() => {
                              const cId = findCustomerByPhone(conv.phone)?.id;
                              return cId && customerData[cId]?.waitlistAlert
                                ? <span title="Lista de espera — aguardando horário" className="text-yellow-500 text-sm leading-none">⚠️</span>
                                : null;
                            })()}
                            <span className={`text-[9px] font-bold ${isUnread(conv) && selectedPhone !== conv.phone ? 'text-orange-500' : 'text-slate-400'}`}>{formatDateLabel(conv.lastTimestamp)}</span>
                          </div>
                        </div>
                        {conv.isProfessional && (
                          <span className="text-[8px] font-black text-orange-500 uppercase tracking-widest">Barbeiro</span>
                        )}
                        <p className={`text-[10px] truncate mt-0.5 ${isUnread(conv) && selectedPhone !== conv.phone ? 'text-slate-600 font-semibold' : 'text-slate-400'}`}>{conv.lastMessage}</p>
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
                    {/* AI pause toggle — all conversations */}
                    {(() => {
                      const cust = findCustomerByPhone(selectedConv.phone);
                      const key = cust ? cust.id : `phone:${selectedConv.phone}`;
                      const isPaused = !!customerData[key]?.aiPaused;
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

                  {/* Waitlist alert banner */}
                  {(() => {
                    const cust = findCustomerByPhone(selectedConv.phone);
                    return cust && customerData[cust.id]?.waitlistAlert ? (
                      <div className="mx-4 mt-2 mb-1 flex items-center gap-3 bg-yellow-50 border-2 border-yellow-200 rounded-2xl px-4 py-2.5">
                        <span className="text-lg">⚠️</span>
                        <p className="text-[11px] font-black text-yellow-800 flex-1 uppercase tracking-wide">Lista de espera — agendar manualmente se abrir horário</p>
                        <button
                          onClick={() => clearWaitlistAlert(selectedConv.phone)}
                          title="Marcar como resolvido"
                          className="text-[10px] font-black text-yellow-600 hover:text-yellow-900 bg-yellow-100 hover:bg-yellow-200 px-3 py-1 rounded-xl transition-all uppercase tracking-widest"
                        >
                          Resolver
                        </button>
                      </div>
                    ) : null;
                  })()}

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

      {/* ── Quick Booking Modal ─────────────── */}
      {showBooking && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-md p-8 space-y-5 animate-scaleUp shadow-2xl">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-black text-black uppercase tracking-tight">Novo Agendamento</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Agendamento manual</p>
              </div>
              <button onClick={() => setShowBooking(false)} className="text-slate-300 hover:text-red-500 font-black text-xl transition-colors">✕</button>
            </div>

            {bookingSuccess ? (
              <div className="py-10 flex flex-col items-center gap-3">
                <div className="text-5xl">✅</div>
                <p className="text-sm font-black text-green-600 uppercase tracking-widest">Agendado com sucesso!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Cliente */}
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Cliente</label>
                  <select
                    value={bookingCustomerId}
                    onChange={e => setBookingCustomerId(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 rounded-2xl text-xs font-bold outline-none border-2 border-transparent focus:border-orange-500 transition-all"
                  >
                    <option value="">Selecione o cliente...</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>
                    ))}
                  </select>
                </div>

                {/* Profissional + Serviço */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Profissional</label>
                    <select
                      value={bookingProfId}
                      onChange={e => setBookingProfId(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 rounded-2xl text-xs font-bold outline-none border-2 border-transparent focus:border-orange-500 transition-all"
                    >
                      <option value="">Selecione...</option>
                      {bookingProfs.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Serviço</label>
                    <select
                      value={bookingServiceId}
                      onChange={e => setBookingServiceId(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 rounded-2xl text-xs font-bold outline-none border-2 border-transparent focus:border-orange-500 transition-all"
                    >
                      <option value="">Selecione...</option>
                      {bookingServices.map(s => (
                        <option key={s.id} value={s.id}>{s.name} ({s.durationMinutes}min)</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Data */}
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Data</label>
                  <input
                    type="date"
                    value={bookingDate}
                    onChange={e => setBookingDate(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 rounded-2xl text-xs font-bold outline-none border-2 border-transparent focus:border-orange-500 transition-all"
                  />
                </div>

                {/* Horários disponíveis */}
                {bookingProfId && bookingDate && bookingServiceId && (
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                      Horários disponíveis
                      {bookingTime && <span className="ml-2 text-orange-500">— {bookingTime} selecionado</span>}
                    </label>
                    {slotsLoading ? (
                      <p className="text-[10px] font-black text-slate-300 uppercase animate-pulse">Calculando horários...</p>
                    ) : dayClosed ? (
                      <p className="text-[10px] font-black text-red-400 uppercase">Dia fechado</p>
                    ) : bookingSlots.length === 0 ? (
                      <p className="text-[10px] font-black text-slate-400 uppercase">Nenhum horário disponível</p>
                    ) : (
                      <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto custom-scrollbar pr-1">
                        {bookingSlots.map(slot => (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => setBookingTime(slot)}
                            className={`px-3 py-1.5 rounded-xl font-black text-[11px] transition-all border-2 ${
                              bookingTime === slot
                                ? 'bg-orange-500 text-white border-orange-500'
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-orange-400 hover:text-orange-500'
                            }`}
                          >
                            {slot}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {bookingError && (
                  <p className="text-[11px] font-black text-red-500 uppercase tracking-wide">{bookingError}</p>
                )}

                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setShowBooking(false)}
                    className="flex-1 py-3 rounded-2xl font-black text-xs uppercase tracking-widest border-2 border-slate-200 text-slate-500 hover:bg-slate-50 transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={saveBooking}
                    disabled={bookingSaving}
                    className="flex-1 py-3 bg-orange-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-orange-600 transition-all disabled:opacity-50"
                  >
                    {bookingSaving ? 'Salvando...' : '✓ Confirmar'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ConversationsView;
