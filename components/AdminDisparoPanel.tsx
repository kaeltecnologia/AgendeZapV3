import React, { useState, useRef, useEffect } from 'react';
import { evolutionService } from '../services/evolutionService';
import { ProspectCampaign } from '../services/serperService';

// ── Helpers ──────────────────────────────────────────────────────────
const randRange = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const formatSeconds = (s: number) => {
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}h ${m > 0 ? m + 'm' : ''}`.trim();
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
};

function isInWindow(start: string, end: string): boolean {
  const now = new Date();
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return nowMins >= sh * 60 + sm && nowMins < eh * 60 + em;
}

function secondsUntilWindow(start: string): number {
  const now = new Date();
  const [sh, sm] = start.split(':').map(Number);
  const target = new Date(now);
  target.setHours(sh, sm, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return Math.ceil((target.getTime() - now.getTime()) / 1000);
}

// ── Types ─────────────────────────────────────────────────────────────
interface BroadcastProgress {
  sent: number;
  total: number;
  currentName: string;
  pausing: boolean;
  pauseSecondsLeft: number;
  nextDelay: number;
  done: boolean;
  stopped: boolean;
  errors: number;
  waitingWindow: boolean;
  waitingWindowSecondsLeft: number;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
}

interface Props {
  adminInstanceName: string;
  adminConnected: boolean;
  campaigns: ProspectCampaign[];
  initialCampaignId?: string;
  onGoToConexao: () => void;
  onDeleteCampaign?: (id: string) => void;
}

const AdminDisparoPanel: React.FC<Props> = ({
  adminInstanceName,
  adminConnected,
  campaigns,
  initialCampaignId,
  onGoToConexao,
  onDeleteCampaign,
}) => {
  // Source
  const [source, setSource] = useState<'campaign' | 'custom'>('campaign');
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set());
  const [customText, setCustomText] = useState('');

  // Messages
  const [messages, setMessages] = useState<string[]>(['']);

  // Timing
  const [delayMin, setDelayMin] = useState(30);
  const [delayMax, setDelayMax] = useState(60);
  const [pauseEvery, setPauseEvery] = useState(20);
  const [pauseMin, setPauseMin] = useState(120);
  const [pauseMax, setPauseMax] = useState(300);

  // Time window
  const [useTimeWindow, setUseTimeWindow] = useState(false);
  const [windowStart, setWindowStart] = useState('08:00');
  const [windowEnd, setWindowEnd] = useState('18:00');

  // Progress
  const [progress, setProgress] = useState<BroadcastProgress | null>(null);
  const abortRef = useRef(false);
  const pauseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // When navigating from prospecção, pre-select that campaign
  useEffect(() => {
    if (initialCampaignId) {
      setSelectedCampaignIds(new Set([initialCampaignId]));
      setSource('campaign');
    }
  }, [initialCampaignId]);

  // ── Campaign toggle ──────────────────────────────────────────────────
  const toggleCampaign = (id: string) => {
    setSelectedCampaignIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const selectAllCampaigns = () =>
    setSelectedCampaignIds(new Set(campaigns.map(c => c.id)));
  const clearAllCampaigns = () =>
    setSelectedCampaignIds(new Set());

  // ── Derived contacts (merged + deduped by phone) ─────────────────────
  const contacts: Contact[] = React.useMemo(() => {
    if (source === 'campaign') {
      const seenPhones = new Set<string>();
      const result: Contact[] = [];
      for (const camp of campaigns) {
        if (!selectedCampaignIds.has(camp.id)) continue;
        for (const c of camp.contacts) {
          if (!c.phone || seenPhones.has(c.phone)) continue;
          seenPhones.add(c.phone);
          result.push(c);
        }
      }
      return result;
    }
    return customText
      .split('\n')
      .map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          const name = trimmed.slice(0, colonIdx).trim();
          const phone = trimmed.slice(colonIdx + 1).replace(/\D/g, '');
          if (phone.length >= 10) return { id: `custom-${i}`, name, phone };
        }
        const phone = trimmed.replace(/\D/g, '');
        if (phone.length >= 10) return { id: `custom-${i}`, name: phone, phone };
        return null;
      })
      .filter(Boolean) as Contact[];
  }, [source, selectedCampaignIds, campaigns, customText]);

  // ── Message helpers ──────────────────────────────────────────────────
  const updateMsg = (i: number, val: string) =>
    setMessages(prev => { const n = [...prev]; n[i] = val; return n; });
  const addMsg = () => { if (messages.length < 5) setMessages(prev => [...prev, '']); };
  const removeMsg = (i: number) => setMessages(prev => prev.filter((_, idx) => idx !== i));
  const activeMessages = messages.filter(m => m.trim());

  // ── Broadcast ────────────────────────────────────────────────────────
  const startBroadcast = async () => {
    if (!adminConnected) { alert('WhatsApp do admin não está conectado!\nVá em Conversas para conectar.'); return; }
    if (activeMessages.length === 0) { alert('Adicione pelo menos uma mensagem.'); return; }
    if (contacts.length === 0) { alert('Nenhum contato selecionado.'); return; }
    if (delayMin > delayMax) { alert('Delay mínimo deve ser ≤ delay máximo.'); return; }
    if (useTimeWindow && !isInWindow(windowStart, windowEnd)) {
      const secs = secondsUntilWindow(windowStart);
      if (!confirm(`Fora da janela de envio.\nO disparo iniciará em ${formatSeconds(secs)} (às ${windowStart}).\nConfirmar?`)) return;
    }

    abortRef.current = false;
    let sentCount = 0;
    let errorCount = 0;

    setProgress({
      sent: 0, total: contacts.length, currentName: '', pausing: false,
      pauseSecondsLeft: 0, nextDelay: 0, done: false, stopped: false, errors: 0,
      waitingWindow: false, waitingWindowSecondsLeft: 0,
    });

    // Waits until the time window opens (checks every 60s to avoid spam)
    const waitForWindow = async () => {
      if (!useTimeWindow || isInWindow(windowStart, windowEnd)) return;
      setProgress(p => p ? {
        ...p, waitingWindow: true, waitingWindowSecondsLeft: secondsUntilWindow(windowStart),
      } : null);
      await new Promise<void>(resolve => {
        const tick = setInterval(() => {
          if (abortRef.current) { clearInterval(tick); resolve(); return; }
          if (isInWindow(windowStart, windowEnd)) { clearInterval(tick); resolve(); return; }
          setProgress(p => p ? { ...p, waitingWindowSecondsLeft: secondsUntilWindow(windowStart) } : null);
        }, 60_000);
        pauseTimerRef.current = tick;
      });
      setProgress(p => p ? { ...p, waitingWindow: false, waitingWindowSecondsLeft: 0 } : null);
    };

    for (let i = 0; i < contacts.length; i++) {
      if (abortRef.current) { setProgress(p => p ? { ...p, stopped: true } : null); break; }

      // Check window before every send
      await waitForWindow();
      if (abortRef.current) { setProgress(p => p ? { ...p, stopped: true } : null); break; }

      const contact = contacts[i];
      const msg = activeMessages[sentCount % activeMessages.length];
      setProgress(p => p ? { ...p, currentName: contact.name } : null);

      try {
        await evolutionService.sendMessage(adminInstanceName, contact.phone, msg);
        sentCount++;
      } catch {
        errorCount++;
        sentCount++;
      }

      setProgress(p => p ? { ...p, sent: sentCount, errors: errorCount } : null);

      if (i < contacts.length - 1) {
        const shouldPause = pauseEvery > 0 && sentCount % pauseEvery === 0;

        if (shouldPause) {
          const pauseSecs = randRange(pauseMin, pauseMax);
          let remaining = pauseSecs;
          setProgress(p => p ? { ...p, pausing: true, pauseSecondsLeft: remaining } : null);
          await new Promise<void>(resolve => {
            const tick = setInterval(() => {
              if (abortRef.current) { clearInterval(tick); resolve(); return; }
              remaining--;
              setProgress(p => p ? { ...p, pauseSecondsLeft: remaining } : null);
              if (remaining <= 0) { clearInterval(tick); resolve(); }
            }, 1000);
            pauseTimerRef.current = tick;
          });
          setProgress(p => p ? { ...p, pausing: false, pauseSecondsLeft: 0 } : null);
        } else {
          const delaySecs = randRange(delayMin, delayMax);
          let remaining = delaySecs;
          setProgress(p => p ? { ...p, nextDelay: remaining } : null);
          await new Promise<void>(resolve => {
            const tick = setInterval(() => {
              if (abortRef.current) { clearInterval(tick); resolve(); return; }
              remaining--;
              setProgress(p => p ? { ...p, nextDelay: remaining } : null);
              if (remaining <= 0) { clearInterval(tick); resolve(); }
            }, 1000);
          });
        }
      }
    }

    if (!abortRef.current) {
      setProgress(p => p ? { ...p, done: true, pausing: false, nextDelay: 0, waitingWindow: false } : null);
    }
  };

  const stopBroadcast = () => {
    abortRef.current = true;
    if (pauseTimerRef.current) clearInterval(pauseTimerRef.current);
  };

  const resetBroadcast = () => {
    abortRef.current = false;
    setProgress(null);
  };

  const isSending = progress !== null && !progress.done && !progress.stopped;

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Disparador Admin</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            Envio em massa para contatos prospectados ou personalizados
          </p>
        </div>
        {adminConnected ? (
          <div className="bg-green-50 border-2 border-green-100 px-5 py-3 rounded-2xl">
            <p className="text-[10px] font-black text-green-600 uppercase">● WhatsApp Admin Conectado</p>
          </div>
        ) : (
          <button
            onClick={onGoToConexao}
            className="bg-red-50 border-2 border-red-100 px-5 py-3 rounded-2xl hover:bg-red-100 transition-all"
          >
            <p className="text-[10px] font-black text-red-600 uppercase">⚠ WhatsApp desconectado — conectar</p>
          </button>
        )}
      </div>

      {/* Progress */}
      {progress && (
        <div className={`rounded-[28px] p-8 border-2 space-y-4 ${
          progress.done ? 'bg-green-50 border-green-100' :
          progress.stopped ? 'bg-red-50 border-red-100' :
          progress.waitingWindow ? 'bg-blue-50 border-blue-100' :
          'bg-orange-50 border-orange-100'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <p className={`text-lg font-black uppercase tracking-tight ${
                progress.done ? 'text-green-700' :
                progress.stopped ? 'text-red-700' :
                progress.waitingWindow ? 'text-blue-700' :
                'text-orange-700'
              }`}>
                {progress.done ? '✅ Disparo concluído!' :
                 progress.stopped ? '⛔ Disparo interrompido' :
                 progress.waitingWindow ? '⏰ Aguardando janela de envio...' :
                 '📤 Disparando...'}
              </p>
              {!progress.done && !progress.stopped && (
                <p className={`text-xs font-bold mt-1 ${progress.waitingWindow ? 'text-blue-500' : 'text-orange-500'}`}>
                  {progress.waitingWindow
                    ? `Fora do horário permitido — retomando às ${windowStart} (em ${formatSeconds(progress.waitingWindowSecondsLeft)})`
                    : progress.pausing
                      ? `⏸ Intervalo de proteção — retomando em ${formatSeconds(progress.pauseSecondsLeft)}`
                      : `Enviando para *${progress.currentName}* — próximo em ${formatSeconds(progress.nextDelay)}`}
                </p>
              )}
              {progress.errors > 0 && (
                <p className="text-[10px] font-bold text-red-400 mt-1">{progress.errors} erro(s) de envio</p>
              )}
            </div>
            <p className={`text-3xl font-black ${progress.done ? 'text-green-700' : progress.waitingWindow ? 'text-blue-700' : 'text-orange-700'}`}>
              {progress.sent}/{progress.total}
            </p>
          </div>

          <div className="h-3 bg-white rounded-full overflow-hidden border border-slate-100">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                progress.done ? 'bg-green-500' :
                progress.stopped ? 'bg-red-400' :
                progress.waitingWindow ? 'bg-blue-400' :
                'bg-orange-500'
              }`}
              style={{ width: `${progress.total > 0 ? (progress.sent / progress.total) * 100 : 0}%` }}
            />
          </div>

          <div className="flex gap-3">
            {isSending && (
              <button
                onClick={stopBroadcast}
                className="px-6 py-2.5 bg-red-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-red-600 transition-all"
              >
                ⛔ Parar
              </button>
            )}
            {(progress.done || progress.stopped) && (
              <button
                onClick={resetBroadcast}
                className="px-6 py-2.5 bg-black text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-500 transition-all"
              >
                ↺ Novo Disparo
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Contact Source */}
        <div className="bg-white border-2 border-slate-100 rounded-[28px] p-8 space-y-6 shadow-xl shadow-slate-100/50">
          <h2 className="text-sm font-black text-black uppercase tracking-widest">1. Selecionar Contatos</h2>

          {/* Source toggle */}
          <div className="flex gap-3">
            <button
              onClick={() => setSource('campaign')}
              className={`flex-1 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${
                source === 'campaign' ? 'bg-black text-white border-black' : 'bg-white text-slate-500 border-slate-200 hover:border-black'
              }`}
            >
              📋 Campanhas
            </button>
            <button
              onClick={() => setSource('custom')}
              className={`flex-1 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${
                source === 'custom' ? 'bg-black text-white border-black' : 'bg-white text-slate-500 border-slate-200 hover:border-black'
              }`}
            >
              ✏️ Personalizado
            </button>
          </div>

          {source === 'campaign' && (
            <div className="space-y-3">
              {campaigns.length === 0 ? (
                <div className="bg-slate-50 rounded-2xl p-6 text-center">
                  <p className="text-xs font-black text-slate-300 uppercase">Nenhuma campanha</p>
                  <p className="text-[10px] font-bold text-slate-300 mt-1">Crie uma campanha na aba Prospecção</p>
                </div>
              ) : (
                <>
                  {/* Select all / clear controls */}
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      {selectedCampaignIds.size} de {campaigns.length} campanha{campaigns.length !== 1 ? 's' : ''} selecionada{selectedCampaignIds.size !== 1 ? 's' : ''}
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={selectAllCampaigns}
                        disabled={isSending}
                        className="text-[9px] font-black text-orange-500 uppercase tracking-widest hover:underline disabled:opacity-40"
                      >
                        Todas
                      </button>
                      <span className="text-slate-200">|</span>
                      <button
                        onClick={clearAllCampaigns}
                        disabled={isSending}
                        className="text-[9px] font-black text-slate-400 uppercase tracking-widest hover:underline disabled:opacity-40"
                      >
                        Limpar
                      </button>
                    </div>
                  </div>

                  {/* Campaign checklist */}
                  <div className="max-h-52 overflow-y-auto custom-scrollbar space-y-2">
                    {campaigns.map(camp => (
                      <div
                        key={camp.id}
                        className={`flex items-center gap-3 px-4 py-3 rounded-2xl border-2 transition-all ${
                          selectedCampaignIds.has(camp.id)
                            ? 'border-orange-300 bg-orange-50'
                            : 'border-slate-100 bg-slate-50 hover:border-slate-200'
                        } ${isSending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        onClick={() => !isSending && toggleCampaign(camp.id)}
                      >
                        <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                          selectedCampaignIds.has(camp.id)
                            ? 'bg-orange-500 border-orange-500'
                            : 'border-slate-300 bg-white'
                        }`}>
                          {selectedCampaignIds.has(camp.id) && (
                            <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="1 5 4 8 11 1"/>
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-black text-black truncate">{camp.name}</p>
                          <p className="text-[9px] font-bold text-slate-400">
                            {camp.contacts.length} contatos · {camp.keyword} em {camp.city}
                          </p>
                        </div>
                        {onDeleteCampaign && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              if (isSending) return;
                              if (!confirm('Excluir esta campanha?')) return;
                              onDeleteCampaign(camp.id);
                              setSelectedCampaignIds(prev => { const n = new Set(prev); n.delete(camp.id); return n; });
                            }}
                            disabled={isSending}
                            className="text-slate-300 hover:text-red-500 font-black text-xs transition-colors flex-shrink-0 disabled:opacity-40"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Selected contacts summary */}
                  {selectedCampaignIds.size > 0 && (
                    <div className="bg-orange-50 border border-orange-100 rounded-2xl px-4 py-3">
                      <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest">
                        {contacts.length} contato{contacts.length !== 1 ? 's' : ''} únicos selecionados
                        {selectedCampaignIds.size > 1 && <span className="font-bold text-orange-400"> (duplicatas removidas)</span>}
                      </p>
                    </div>
                  )}

                  {/* Contact preview */}
                  {contacts.length > 0 && (
                    <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-1">
                      {contacts.map(c => (
                        <div key={c.id} className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-slate-100 border border-slate-200">
                          <div className="w-7 h-7 bg-slate-300 rounded-xl flex items-center justify-center text-xs font-bold text-slate-700 flex-shrink-0">
                            {c.name[0]?.toUpperCase() || '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black text-slate-800 truncate">{c.name}</p>
                            <p className="text-[9px] font-bold text-slate-500">{c.phone}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {source === 'custom' && (
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                Um contato por linha
              </label>
              <p className="text-[9px] font-bold text-slate-300">
                Formato: <span className="font-mono">55119999999</span> ou <span className="font-mono">Nome: 55119999999</span>
              </p>
              <textarea
                value={customText}
                onChange={e => setCustomText(e.target.value)}
                disabled={isSending}
                placeholder={"5511999990001\nJoão: 5511999990002\n5511999990003"}
                rows={10}
                className="w-full px-4 py-3 bg-slate-50 rounded-2xl text-xs font-mono outline-none border-2 border-transparent focus:border-orange-500 transition-all resize-none"
              />
              {contacts.length > 0 && (
                <p className="text-[10px] font-black text-green-600">
                  ✓ {contacts.length} número{contacts.length !== 1 ? 's' : ''} válido{contacts.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right: Messages + Timing */}
        <div className="space-y-6">
          {/* Messages */}
          <div className="bg-white border-2 border-slate-100 rounded-[28px] p-8 space-y-5 shadow-xl shadow-slate-100/50">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-black text-black uppercase tracking-widest">2. Mensagens (até 5)</h2>
              <span className="text-[9px] font-black text-slate-300 uppercase">Rotação automática</span>
            </div>

            <div className="space-y-3">
              {messages.map((msg, i) => (
                <div key={i} className="relative">
                  <div className="absolute top-3 left-3 w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-[9px] font-black">{i + 1}</span>
                  </div>
                  <textarea
                    value={msg}
                    onChange={e => updateMsg(i, e.target.value)}
                    placeholder={`Mensagem ${i + 1}...`}
                    rows={3}
                    disabled={isSending}
                    className="w-full pl-10 pr-10 py-3 bg-slate-50 rounded-2xl text-xs font-medium outline-none border-2 border-transparent focus:border-orange-500 transition-all resize-none"
                  />
                  {messages.length > 1 && (
                    <button
                      onClick={() => removeMsg(i)}
                      disabled={isSending}
                      className="absolute top-3 right-3 text-slate-300 hover:text-red-500 font-black text-base leading-none transition-all"
                    >✕</button>
                  )}
                </div>
              ))}
            </div>

            {messages.length < 5 && (
              <button
                onClick={addMsg}
                disabled={isSending}
                className="w-full py-3 border-2 border-dashed border-slate-200 rounded-2xl font-black text-[10px] uppercase tracking-widest text-slate-400 hover:border-orange-400 hover:text-orange-500 transition-all disabled:opacity-50"
              >
                + Adicionar Mensagem
              </button>
            )}
          </div>

          {/* Timing */}
          <div className="bg-white border-2 border-slate-100 rounded-[28px] p-8 space-y-6 shadow-xl shadow-slate-100/50">
            <h2 className="text-sm font-black text-black uppercase tracking-widest">3. Timing de Envio</h2>

            {/* Delay */}
            <div className="space-y-3">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Delay entre mensagens</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-slate-50 rounded-2xl px-4 py-3 flex items-center gap-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase">de</span>
                  <input
                    type="number" min={5} max={3600}
                    value={delayMin}
                    onChange={e => setDelayMin(Math.max(5, Number(e.target.value)))}
                    disabled={isSending}
                    className="w-16 text-center bg-white border-2 border-slate-200 rounded-xl py-1 font-black text-sm outline-none focus:border-orange-500"
                  />
                  <span className="text-[10px] font-black text-slate-400">s</span>
                </div>
                <span className="text-slate-300 font-black">—</span>
                <div className="flex-1 bg-slate-50 rounded-2xl px-4 py-3 flex items-center gap-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase">até</span>
                  <input
                    type="number" min={5} max={3600}
                    value={delayMax}
                    onChange={e => setDelayMax(Math.max(delayMin, Number(e.target.value)))}
                    disabled={isSending}
                    className="w-16 text-center bg-white border-2 border-slate-200 rounded-xl py-1 font-black text-sm outline-none focus:border-orange-500"
                  />
                  <span className="text-[10px] font-black text-slate-400">s</span>
                </div>
              </div>
            </div>

            {/* Pause */}
            <div className="space-y-3">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Intervalo de proteção</p>
              <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-slate-500 uppercase whitespace-nowrap">Pausar após</span>
                  <input
                    type="number" min={1} max={200}
                    value={pauseEvery}
                    onChange={e => setPauseEvery(Math.max(1, Number(e.target.value)))}
                    disabled={isSending}
                    className="w-14 text-center bg-white border-2 border-slate-200 rounded-xl py-1 font-black text-sm outline-none focus:border-orange-500"
                  />
                  <span className="text-[10px] font-black text-slate-500 uppercase">mensagens</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-slate-500 uppercase whitespace-nowrap">Pausar por</span>
                  <input
                    type="number" min={30}
                    value={pauseMin}
                    onChange={e => setPauseMin(Math.max(30, Number(e.target.value)))}
                    disabled={isSending}
                    className="w-14 text-center bg-white border-2 border-slate-200 rounded-xl py-1 font-black text-sm outline-none focus:border-orange-500"
                  />
                  <span className="text-[10px] font-black text-slate-400">—</span>
                  <input
                    type="number" min={pauseMin}
                    value={pauseMax}
                    onChange={e => setPauseMax(Math.max(pauseMin, Number(e.target.value)))}
                    disabled={isSending}
                    className="w-14 text-center bg-white border-2 border-slate-200 rounded-xl py-1 font-black text-sm outline-none focus:border-orange-500"
                  />
                  <span className="text-[10px] font-black text-slate-500 uppercase">s</span>
                </div>
              </div>
            </div>

            {/* Time Window */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Janela de Horário</p>
                <button
                  onClick={() => setUseTimeWindow(v => !v)}
                  disabled={isSending}
                  className={`relative w-10 h-5 rounded-full transition-all disabled:opacity-40 ${useTimeWindow ? 'bg-orange-500' : 'bg-slate-200'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${useTimeWindow ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>
              {useTimeWindow && (
                <div className="bg-blue-50 border-2 border-blue-100 rounded-2xl p-4 space-y-3">
                  <p className="text-[9px] font-bold text-blue-400">
                    O disparo só envia dentro do horário. Ao atingir o limite, pausa e retoma no dia seguinte ao entrar no horário.
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 space-y-1">
                      <label className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Início</label>
                      <input
                        type="time"
                        value={windowStart}
                        onChange={e => setWindowStart(e.target.value)}
                        disabled={isSending}
                        className="w-full px-3 py-2 bg-white border-2 border-blue-100 rounded-xl font-black text-sm outline-none focus:border-blue-400 transition-all"
                      />
                    </div>
                    <span className="text-blue-300 font-black mt-4">→</span>
                    <div className="flex-1 space-y-1">
                      <label className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Fim</label>
                      <input
                        type="time"
                        value={windowEnd}
                        onChange={e => setWindowEnd(e.target.value)}
                        disabled={isSending}
                        className="w-full px-3 py-2 bg-white border-2 border-blue-100 rounded-xl font-black text-sm outline-none focus:border-blue-400 transition-all"
                      />
                    </div>
                  </div>
                  <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest text-center">
                    {isInWindow(windowStart, windowEnd)
                      ? '✓ Agora dentro da janela de envio'
                      : `⏰ Fora da janela — próximo envio em ${formatSeconds(secondsUntilWindow(windowStart))}`}
                  </p>
                </div>
              )}
            </div>

            {/* Summary */}
            <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4">
              <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-2">Resumo do Disparo</p>
              <p className="text-[10px] font-bold text-orange-500">
                📤 {contacts.length} destinatários · {activeMessages.length} mensagem{activeMessages.length !== 1 ? 's' : ''} em rotação
              </p>
              <p className="text-[10px] font-bold text-orange-500">
                ⏱ Delay {delayMin}–{delayMax}s · Pausa de {formatSeconds(pauseMin)}–{formatSeconds(pauseMax)} a cada {pauseEvery} msgs
              </p>
              {useTimeWindow && (
                <p className="text-[10px] font-bold text-blue-500">
                  🕐 Janela {windowStart} → {windowEnd}
                </p>
              )}
              {contacts.length > 0 && (
                <p className="text-[9px] font-bold text-orange-400 mt-1">
                  Tempo estimado mínimo: ~{formatSeconds(contacts.length * delayMin + Math.floor(contacts.length / pauseEvery) * pauseMin)}
                </p>
              )}
            </div>

            {/* Start */}
            {!isSending && !progress && (
              <button
                onClick={startBroadcast}
                disabled={!adminConnected || activeMessages.length === 0 || contacts.length === 0}
                className="w-full py-5 bg-orange-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-200 hover:bg-orange-600 hover:scale-[1.02] transition-all disabled:opacity-40 disabled:scale-100 disabled:shadow-none"
              >
                🚀 Iniciar Disparo — {contacts.length} Contato{contacts.length !== 1 ? 's' : ''}
              </button>
            )}

            {(progress?.done || progress?.stopped) && (
              <button
                onClick={resetBroadcast}
                className="w-full py-5 bg-black text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-orange-500 transition-all"
              >
                ↺ Novo Disparo
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDisparoPanel;
