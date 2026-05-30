
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../services/mockDb';
import { FollowUpNamedMode } from '../types';
import { FeatureKey, hasFeature } from '../config/planConfig';

type ModeTab = 'aviso' | 'lembrete' | 'reativacao';
type MainTab = ModeTab;

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 11);
}

const TAB_CONFIG: Record<ModeTab, { label: string; icon: string; tabKey: 'avisoModes' | 'lembreteModes' | 'reativacaoModes'; timingLabel: string; timingType: 'fixed' | 'minutes' | 'days'; customerModeField: 'avisoModeId' | 'lembreteModeId' | 'reativacaoModeId' }> = {
  aviso: { label: 'Check-in Diário', icon: '📢', tabKey: 'avisoModes', timingLabel: 'Horário de envio', timingType: 'fixed', customerModeField: 'avisoModeId' },
  lembrete: { label: 'Lembrete Próximo', icon: '🕒', tabKey: 'lembreteModes', timingLabel: 'Antecipar em (minutos)', timingType: 'minutes', customerModeField: 'lembreteModeId' },
  reativacao: { label: 'Recuperação', icon: '♻️', tabKey: 'reativacaoModes', timingLabel: 'Dias de ausência', timingType: 'days', customerModeField: 'reativacaoModeId' }
};

const PRESET_TEMPLATES: Record<ModeTab, { name: string; message: string; timing: number; fixedTime?: string; daysBefore?: number }[]> = {
  aviso: [
    {
      name: 'Confirmação do Dia',
      message: 'Oi {nome}! 👋\n\nPassando para confirmar seu agendamento de hoje:\n📅 {dia} às {hora}\n✂️ {servico} com {profissional}\n\nVocê confirma presença? Responda *SIM* ✅ ou nos avise se precisar cancelar 🙏',
      timing: 0,
      fixedTime: '08:00',
      daysBefore: 0,
    },
    {
      name: 'Lembrete Véspera',
      message: 'Olá {nome}! 😊\n\nLembrando que amanhã você tem:\n📅 {dia} às {hora}\n✂️ {servico} com {profissional}\n\nConfirma sua presença? Responda *SIM* para confirmar! ✅',
      timing: 0,
      fixedTime: '18:00',
      daysBefore: 1,
    },
    {
      name: 'Check-in Matinal',
      message: 'Bom dia, {nome}! ☀️\n\nSeu horário hoje é às {hora} para {servico} com {profissional}.\n\nEsperamos você! 🙌',
      timing: 0,
      fixedTime: '07:30',
      daysBefore: 0,
    },
  ],
  lembrete: [
    {
      name: 'Lembrete 1h Antes',
      message: 'Oi {nome}! 🕒\n\nSeu horário está chegando!\nDaqui a pouco é hora do seu {servico} com {profissional}.\n\nTe esperamos às {hora}! 😊',
      timing: 60,
    },
    {
      name: 'Lembrete 2h Antes',
      message: 'Oi {nome}! ⏰\n\nFaltam 2 horas para o seu agendamento:\n📅 {dia} às {hora}\n✂️ {servico} com {profissional}\n\nTe esperamos! 🙌',
      timing: 120,
    },
    {
      name: 'Lembrete 30min',
      message: 'Oi {nome}! 🔔\n\nSeu {servico} começa em 30 minutinhos!\nTe esperamos com {profissional} às {hora}! 😄',
      timing: 30,
    },
  ],
  reativacao: [
    {
      name: 'Saudades do Cliente',
      message: 'Oi {nome}! 😊\n\nFaz um tempinho que não te vemos por aqui!\n\nQue tal agendar um horário esta semana? Temos disponibilidade para você.\n\nMe fala qual dia fica melhor! 🗓️',
      timing: 30,
    },
    {
      name: 'Oferta de Retorno',
      message: 'Olá {nome}! 👋\n\nEstamos com saudades! Notamos que faz um tempo que você não passa aqui.\n\nQuer marcar um horário? Responda esta mensagem e te atendemos na hora! 🚀',
      timing: 60,
    },
    {
      name: 'Reativação Suave',
      message: 'Oi {nome}! 🌟\n\nTudo bem com você?\n\nSempre é bom ter você por aqui. Quando quiser retomar seus cuidados, é só chamar! 😊',
      timing: 90,
    },
  ],
};

const FollowUpView: React.FC<{ tenantId: string; tenantPlan?: string; onUpgrade?: (feature: FeatureKey) => void; refreshTicker?: number }> = ({ tenantId, tenantPlan, onUpgrade, refreshTicker = 0 }) => {
  const [activeTab, setActiveTab] = useState<MainTab>('aviso');

  const [avisoModes, setAvisoModes] = useState<FollowUpNamedMode[]>([]);
  const [lembreteModes, setLembreteModes] = useState<FollowUpNamedMode[]>([]);
  const [reativacaoModes, setReativacaoModes] = useState<FollowUpNamedMode[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyingModeId, setApplyingModeId] = useState<string | null>(null);
  const [appliedModeId, setAppliedModeId] = useState<string | null>(null);

  // Add-mode form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMsg, setNewMsg] = useState('');
  const [newTiming, setNewTiming] = useState<number>(60);
  const [newFixedTime, setNewFixedTime] = useState('08:00');
  const [newDaysBefore, setNewDaysBefore] = useState<number>(0);

  // Edit state for each mode (by id)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Partial<FollowUpNamedMode>>({});

  // Refs for variable insertion at cursor position
  const addMsgRef = useRef<HTMLTextAreaElement | null>(null);
  const editMsgRef = useRef<HTMLTextAreaElement | null>(null);
  const firstLoad = useRef(true);

  function insertVar(
    variable: string,
    ref: React.RefObject<HTMLTextAreaElement | null>,
    currentValue: string,
    setter: (v: string) => void
  ) {
    const el = ref.current;
    if (!el) { setter(currentValue + variable); return; }
    const start = el.selectionStart ?? currentValue.length;
    const end = el.selectionEnd ?? currentValue.length;
    const newVal = currentValue.slice(0, start) + variable + currentValue.slice(end);
    setter(newVal);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + variable.length, start + variable.length);
    });
  }

  const load = useCallback(async () => {
    if (firstLoad.current) setLoading(true);
    const s = await db.getSettings(tenantId);
    setAvisoModes(s.avisoModes || []);
    setLembreteModes(s.lembreteModes || []);
    setReativacaoModes(s.reativacaoModes || []);
    firstLoad.current = false;
    setLoading(false);
  }, [tenantId, refreshTicker]);

  useEffect(() => { load(); }, [load]);

  // When switching tabs, close forms
  useEffect(() => { setShowAddForm(false); setEditingId(null); resetAddForm(); }, [activeTab]);

  function resetAddForm() {
    setNewName(''); setNewMsg(''); setNewTiming(60); setNewFixedTime('08:00'); setNewDaysBefore(0);
  }

  const getModes = (tab: MainTab) => tab === 'aviso' ? avisoModes : tab === 'lembrete' ? lembreteModes : reativacaoModes;
  const setModes = (tab: MainTab, modes: FollowUpNamedMode[]) => {
    if (tab === 'aviso') setAvisoModes(modes);
    else if (tab === 'lembrete') setLembreteModes(modes);
    else setReativacaoModes(modes);
  };
  const getKey = (tab: MainTab) => TAB_CONFIG[tab].tabKey;

  const handleAddMode = async () => {
    const name = newName.trim();
    const msg = newMsg.trim();
    if (!name || !msg) return;
    setSaving(true);
    const cfg = TAB_CONFIG[activeTab];
    const mode: FollowUpNamedMode = {
      id: generateId(),
      name,
      active: true,
      message: msg,
      timing: cfg.timingType === 'fixed' ? 0 : newTiming,
      fixedTime: cfg.timingType === 'fixed' ? newFixedTime : undefined,
      ...(cfg.timingType === 'fixed' ? { daysBefore: newDaysBefore } : {}),
    };
    const updated = [...getModes(activeTab), mode];
    await db.updateSettings(tenantId, { [getKey(activeTab)]: updated });
    setModes(activeTab, updated);
    resetAddForm();
    setShowAddForm(false);
    setSaving(false);
  };

  const handleToggleActive = async (mode: FollowUpNamedMode) => {
    const updated = getModes(activeTab).map(m => m.id === mode.id ? { ...m, active: !m.active } : m);
    setModes(activeTab, updated);
    await db.updateSettings(tenantId, { [getKey(activeTab)]: updated });
  };

  const handleStartEdit = (mode: FollowUpNamedMode) => {
    setEditingId(mode.id);
    setEditFields({ ...mode });
  };

  const handleSaveEdit = async (id: string) => {
    setSaving(true);
    const updated = getModes(activeTab).map(m => m.id === id ? { ...m, ...editFields } : m);
    await db.updateSettings(tenantId, { [getKey(activeTab)]: updated });
    setModes(activeTab, updated);
    setEditingId(null);
    setEditFields({});
    setSaving(false);
  };

  const handleDeleteMode = async (id: string) => {
    if (!confirm('Remover este modo?')) return;
    const updated = getModes(activeTab).filter(m => m.id !== id);
    await db.updateSettings(tenantId, { [getKey(activeTab)]: updated });
    setModes(activeTab, updated);
  };

  const handleApplyToAll = async (mode: FollowUpNamedMode) => {
    const field = TAB_CONFIG[activeTab].customerModeField;
    if (!confirm(`Aplicar o modo "${mode.name}" para TODOS os clientes? O modo atual de ${TAB_CONFIG[activeTab].label} de cada cliente será substituído.`)) return;
    setApplyingModeId(mode.id);
    try {
      const [customers, settings] = await Promise.all([
        db.getCustomers(tenantId),
        db.getSettings(tenantId),
      ]);
      const customerData: Record<string, any> = { ...(settings.customerData || {}) };
      for (const cust of customers) {
        customerData[cust.id] = { ...(customerData[cust.id] || {}), [field]: mode.id };
      }
      await db.updateSettings(tenantId, { customerData });
      setAppliedModeId(mode.id);
      setTimeout(() => setAppliedModeId(null), 3000);
    } finally {
      setApplyingModeId(null);
    }
  };

  const handleUseTemplate = async (tab: ModeTab, tpl: typeof PRESET_TEMPLATES[ModeTab][number]) => {
    setSaving(true);
    const cfg = TAB_CONFIG[tab];
    const mode: FollowUpNamedMode = {
      id: generateId(),
      name: tpl.name,
      active: true,
      message: tpl.message,
      timing: cfg.timingType === 'fixed' ? 0 : tpl.timing,
      fixedTime: cfg.timingType === 'fixed' ? (tpl.fixedTime || '08:00') : undefined,
      ...(cfg.timingType === 'fixed' ? { daysBefore: tpl.daysBefore ?? 0 } : {}),
    };
    const current = tab === 'aviso' ? avisoModes : tab === 'lembrete' ? lembreteModes : reativacaoModes;
    const updated = [...current, mode];
    await db.updateSettings(tenantId, { [cfg.tabKey]: updated });
    setModes(tab, updated);
    setSaving(false);
  };

  if (loading) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO...</div>;

  const cfg = TAB_CONFIG[activeTab];
  const modes = getModes(activeTab);

  return (
    <div className="space-y-10 animate-fadeIn max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-black text-black uppercase tracking-tight">Lembretes Inteligentes</h1>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Crie múltiplos modos e atribua individualmente a cada cliente</p>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 p-1 sm:p-2 rounded-[30px] shadow-sm overflow-x-auto">
        {(Object.entries(TAB_CONFIG) as [ModeTab, typeof TAB_CONFIG[ModeTab]][]).map(([key, c]) => {
          const tabModes = key === 'aviso' ? avisoModes : key === 'lembrete' ? lembreteModes : reativacaoModes;
          const activeCount = tabModes.filter(m => m.active).length;
          return (
            <Tab key={key} active={activeTab === key} count={activeCount} onClick={() => {
              if (key === 'reativacao' && !hasFeature(tenantPlan, 'reativacao')) {
                setActiveTab(key);
                onUpgrade?.('reativacao');
                return;
              }
              setActiveTab(key);
            }} label={c.label} icon={c.icon} />
          );
        })}
      </div>

      {/* Tab content (named modes) */}
      <div className="bg-white p-4 sm:p-8 md:p-12 rounded-[50px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-6 sm:space-y-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-6">
            <div className="w-12 h-12 sm:w-20 sm:h-20 bg-black text-white rounded-xl sm:rounded-[28px] flex items-center justify-center text-2xl sm:text-4xl shadow-xl shrink-0">
              {cfg.icon}
            </div>
            <div>
              <h3 className="text-lg sm:text-2xl font-black text-black uppercase tracking-tight">{cfg.label}</h3>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                {modes.length} modo{modes.length !== 1 ? 's' : ''} criado{modes.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => { setShowAddForm(v => !v); setEditingId(null); }}
            className="px-5 sm:px-8 py-3 sm:py-4 bg-orange-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all shadow-xl shadow-orange-100 w-full sm:w-auto"
          >
            + Adicionar Modo
          </button>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="bg-slate-50 rounded-[30px] p-8 space-y-5 border-2 border-orange-100">
            <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Novo Modo — {cfg.label}</p>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Nome do modo (ex: VIP, Padrão Intenso)"
              className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500 transition-all"
            />
            <textarea
              ref={addMsgRef}
              rows={4}
              value={newMsg}
              onChange={e => setNewMsg(e.target.value)}
              placeholder="Mensagem que será enviada via WhatsApp... Use {nome}, {dia}, {hora}, {servico}, {profissional}"
              className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl outline-none font-bold resize-none focus:border-orange-500 transition-all text-sm leading-relaxed"
            />
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">inserir:</span>
              {['{nome}', '{dia}', '{hora}', '{servico}', '{profissional}'].map(v => (
                <Tag key={v} label={v} onClick={() => insertVar(v, addMsgRef, newMsg, setNewMsg)} />
              ))}
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 ml-1">{cfg.timingLabel}</label>
              {cfg.timingType === 'fixed' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <input type="number" min={0} max={7} value={newDaysBefore} onChange={e => setNewDaysBefore(Math.max(0, Math.min(7, Number(e.target.value))))}
                      className="w-20 p-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-center text-xl outline-none focus:border-orange-500" />
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{newDaysBefore === 0 ? 'No dia do agendamento' : newDaysBefore === 1 ? 'dia antes' : 'dias antes'}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="time" value={newFixedTime} onChange={e => setNewFixedTime(e.target.value)}
                      className="p-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-xl outline-none focus:border-orange-500" />
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Horário de envio</span>
                  </div>
                </div>
              )}
              {cfg.timingType === 'minutes' && (
                <select value={newTiming} onChange={e => setNewTiming(Number(e.target.value))}
                  className="p-4 bg-white border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-black uppercase text-xs">
                  <option value={30}>30 minutos antes</option>
                  <option value={60}>1 hora antes</option>
                  <option value={120}>2 horas antes</option>
                  <option value={240}>4 horas antes</option>
                </select>
              )}
              {cfg.timingType === 'days' && (
                <div className="flex items-center gap-3">
                  <input type="number" value={newTiming} onChange={e => setNewTiming(Number(e.target.value))}
                    className="w-24 p-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-center text-xl outline-none focus:border-orange-500" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">dias de ausência</span>
                </div>
              )}
            </div>
            <div className="flex gap-4 pt-2">
              <button onClick={() => { setShowAddForm(false); resetAddForm(); }}
                className="flex-1 py-3 font-black text-slate-400 uppercase text-xs" disabled={saving}>
                Cancelar
              </button>
              <button onClick={handleAddMode} disabled={saving || !newName.trim() || !newMsg.trim()}
                className="flex-1 py-3 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-40">
                {saving ? 'Salvando...' : 'Adicionar Modo'}
              </button>
            </div>
          </div>
        )}

        {/* Pre-defined templates — shown when no modes exist and add form is hidden */}
        {modes.length === 0 && !showAddForm && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Modelos pré-definidos — clique para usar</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>
            {PRESET_TEMPLATES[activeTab as ModeTab].map((tpl, i) => (
              <div key={i} className="rounded-2xl border-2 border-dashed border-slate-100 bg-slate-50 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 hover:border-orange-200 hover:bg-orange-50 transition-all group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="font-black text-sm text-black">{tpl.name}</span>
                    {cfg.timingType === 'fixed' && (
                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-2 py-0.5 rounded-full">
                        ⏰ {tpl.daysBefore ? `${tpl.daysBefore}d antes, ` : 'Dia do agend., '}{tpl.fixedTime}
                      </span>
                    )}
                    {cfg.timingType === 'minutes' && (
                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-2 py-0.5 rounded-full">
                        ⏰ {tpl.timing}min antes
                      </span>
                    )}
                    {cfg.timingType === 'days' && (
                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-2 py-0.5 rounded-full">
                        📆 {tpl.timing} dias ausência
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 font-bold whitespace-pre-line leading-relaxed line-clamp-3">{tpl.message}</p>
                </div>
                <button
                  onClick={() => handleUseTemplate(activeTab as ModeTab, tpl)}
                  disabled={saving}
                  className="px-5 py-2.5 bg-black text-white rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-orange-500 transition-all disabled:opacity-40 shrink-0 group-hover:bg-orange-500">
                  {saving ? '...' : '+ Usar Modelo'}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-4">
          {modes.map(mode => (
            <div key={mode.id} className={`rounded-[28px] border-2 transition-all ${mode.active ? 'bg-white border-slate-100' : 'bg-slate-50 border-slate-100 opacity-60'}`}>
              {editingId === mode.id ? (
                /* Edit mode */
                <div className="p-8 space-y-4">
                  <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Editando modo</p>
                  <input
                    value={editFields.name || ''}
                    onChange={e => setEditFields(f => ({ ...f, name: e.target.value }))}
                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500"
                  />
                  <textarea
                    ref={editMsgRef}
                    rows={4}
                    value={editFields.message || ''}
                    onChange={e => setEditFields(f => ({ ...f, message: e.target.value }))}
                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold resize-none focus:border-orange-500 text-sm leading-relaxed"
                  />
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">inserir:</span>
                    {['{nome}', '{dia}', '{hora}', '{servico}', '{profissional}'].map(v => (
                      <Tag key={v} label={v} onClick={() => insertVar(v, editMsgRef, editFields.message || '', (val) => setEditFields(f => ({ ...f, message: val })))} />
                    ))}
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 ml-1">{cfg.timingLabel}</label>
                    {cfg.timingType === 'fixed' && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <input type="number" min={0} max={7} value={editFields.daysBefore ?? 0}
                            onChange={e => setEditFields(f => ({ ...f, daysBefore: Math.max(0, Math.min(7, Number(e.target.value))) }))}
                            className="w-20 p-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-center text-xl outline-none focus:border-orange-500" />
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{(editFields.daysBefore ?? 0) === 0 ? 'No dia' : (editFields.daysBefore ?? 0) === 1 ? 'dia antes' : 'dias antes'}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <input type="time" value={editFields.fixedTime || '08:00'}
                            onChange={e => setEditFields(f => ({ ...f, fixedTime: e.target.value }))}
                            className="p-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-xl outline-none focus:border-orange-500" />
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Horário de envio</span>
                        </div>
                      </div>
                    )}
                    {cfg.timingType === 'minutes' && (
                      <select value={editFields.timing}
                        onChange={e => setEditFields(f => ({ ...f, timing: Number(e.target.value) }))}
                        className="p-4 bg-white border-2 border-slate-100 rounded-2xl font-bold outline-none uppercase text-xs">
                        <option value={30}>30 minutos antes</option>
                        <option value={60}>1 hora antes</option>
                        <option value={120}>2 horas antes</option>
                        <option value={240}>4 horas antes</option>
                      </select>
                    )}
                    {cfg.timingType === 'days' && (
                      <div className="flex items-center gap-3">
                        <input type="number" value={editFields.timing}
                          onChange={e => setEditFields(f => ({ ...f, timing: Number(e.target.value) }))}
                          className="w-24 p-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-center text-xl outline-none focus:border-orange-500" />
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">dias de ausência</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setEditingId(null)} className="flex-1 py-3 font-black text-slate-400 uppercase text-xs" disabled={saving}>Cancelar</button>
                    <button onClick={() => handleSaveEdit(mode.id)} disabled={saving}
                      className="flex-1 py-3 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-40">
                      {saving ? 'Salvando...' : 'Salvar'}
                    </button>
                  </div>
                </div>
              ) : (
                /* Read mode */
                <div className="p-8">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl flex-shrink-0 ${mode.active ? 'bg-orange-50' : 'bg-slate-100'}`}>
                        {cfg.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <p className="font-black text-black uppercase tracking-wide text-sm">{mode.name}</p>
                          <span className={`text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${mode.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                            {mode.active ? 'Ativo' : 'Inativo'}
                          </span>
                          {cfg.timingType === 'fixed' && (
                            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">⏰ {mode.daysBefore ? `${mode.daysBefore}d antes, ` : ''}{mode.fixedTime}</span>
                          )}
                          {cfg.timingType === 'minutes' && (
                            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">⏰ {mode.timing}min antes</span>
                          )}
                          {cfg.timingType === 'days' && (
                            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">📆 {mode.timing} dias ausência</span>
                          )}
                        </div>
                        <p className="text-xs font-bold text-slate-400 mt-1 truncate">{mode.message.substring(0, 80)}{mode.message.length > 80 ? '...' : ''}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                      <button
                        onClick={() => handleApplyToAll(mode)}
                        disabled={applyingModeId === mode.id}
                        title="Atribuir este modo para todos os clientes cadastrados"
                        className={`px-4 py-2 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${appliedModeId === mode.id ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-600 hover:bg-blue-500 hover:text-white'} disabled:opacity-40`}>
                        {applyingModeId === mode.id ? 'Aplicando...' : appliedModeId === mode.id ? '✓ Aplicado!' : '👥 Todos'}
                      </button>
                      <button onClick={() => handleToggleActive(mode)}
                        className={`px-4 py-2 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${mode.active ? 'bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-100 text-green-600 hover:bg-green-200'}`}>
                        {mode.active ? 'Pausar' : 'Ativar'}
                      </button>
                      <button onClick={() => handleStartEdit(mode)}
                        className="px-4 py-2 bg-slate-100 hover:bg-black hover:text-white text-slate-500 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all">
                        Editar
                      </button>
                      <button onClick={() => handleDeleteMode(mode.id)}
                        className="px-4 py-2 bg-slate-100 hover:bg-red-500 hover:text-white text-slate-400 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all">
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Tab = ({ active, onClick, label, icon, count }: any) => (
  <button onClick={onClick} className={`flex-1 py-4 px-4 rounded-[24px] flex items-center justify-center gap-2 transition-all ${active ? 'bg-white text-black shadow-xl font-black scale-105 z-10' : 'text-slate-400 font-bold hover:text-black'}`}>
    <span className="text-lg">{icon}</span>
    <span className="text-[9px] uppercase tracking-widest hidden sm:block">{label}</span>
    {count > 0 && (
      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full leading-none ${active ? 'bg-orange-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
        {count}
      </span>
    )}
  </button>
);

const Tag: React.FC<{ label: string; onClick?: () => void }> = ({ label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="bg-white border-2 border-slate-100 px-3 py-1.5 rounded-xl text-[10px] font-black text-slate-600 tracking-widest hover:border-orange-400 hover:bg-orange-50 hover:text-orange-600 active:scale-95 transition-all uppercase cursor-pointer"
  >
    {label}
  </button>
);

export default FollowUpView;
