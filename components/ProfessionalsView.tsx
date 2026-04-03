import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { Professional, AppointmentStatus, Appointment, Expense, BreakPeriod } from '../types';
import { getPlanConfig, PLAN_CONFIGS } from '../config/planConfig';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://cnnfnqrnjckntnxdgwae.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubmZucXJuamNrbnRueGRnd2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MTM3NzksImV4cCI6MjA4NzE4OTc3OX0.ANyOJVIsBv0GWuJyUmdicRrgHqZc5VAXRUSua_roO4I';

function genId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 11);
}

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const ProfessionalsView: React.FC<{ tenantId: string; tenantPlan?: string; onNavigate?: (view: string) => void }> = ({ tenantId, tenantPlan, onNavigate }) => {
  const [pros, setPros] = useState<Professional[]>([]);
  const [allAppointments, setAllAppointments] = useState<Appointment[]>([]);
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
  const [allServices, setAllServices] = useState<{ id: string; name: string }[]>([]);
  const [breaks, setBreaks] = useState<BreakPeriod[]>([]);
  const [reportTab, setReportTab] = useState<'appointments' | 'expenses'>('appointments');

  const [showModal, setShowModal] = useState(false);
  const [editingPro, setEditingPro] = useState<Professional | null>(null);
  const [selectedProForReport, setSelectedProForReport] = useState<Professional | null>(null);

  const [lunchPro, setLunchPro] = useState<Professional | null>(null);
  const [lunchStart, setLunchStart] = useState('12:00');
  const [lunchEnd, setLunchEnd] = useState('13:00');
  const [lunchDays, setLunchDays] = useState<number[]>([1, 2, 3, 4, 5]);

  const [vacPro, setVacPro] = useState<Professional | null>(null);
  const [vacStart, setVacStart] = useState('');
  const [vacEnd, setVacEnd] = useState('');
  const [saving, setSaving] = useState(false);

  const [intervalPro, setIntervalPro] = useState<Professional | null>(null);
  const [intervalStart, setIntervalStart] = useState('15:00');
  const [intervalEnd, setIntervalEnd] = useState('15:30');
  const [intervalDays, setIntervalDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [intervalDate, setIntervalDate] = useState('');
  const [intervalMode, setIntervalMode] = useState<'recurring' | 'specific'>('recurring');
  const [editingIntervalId, setEditingIntervalId] = useState<string | null>(null);

  const [deleteProId, setDeleteProId] = useState<string | null>(null);
  const [deletingPro, setDeletingPro] = useState(false);

  // Upsell popup state
  const [showUpsell, setShowUpsell] = useState(false);
  const [upsellLoading, setUpsellLoading] = useState(false);
  const [extraPros, setExtraPros] = useState(0);

  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [presetPeriod, setPresetPeriod] = useState<string>('custom');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [role, setRole] = useState<'admin' | 'colab'>('colab');

  const load = useCallback(async () => {
    try {
      const [p, a, e, s, svc, settings] = await Promise.all([
        db.getProfessionals(tenantId),
        db.getAppointments(tenantId),
        db.getExpenses(tenantId),
        db.getBreaks(tenantId),
        db.getServices(tenantId),
        db.getSettings(tenantId),
      ]);
      setPros(p);
      setAllAppointments(a);
      setAllExpenses(e);
      setBreaks(s);
      setAllServices(svc.map(s => ({ id: s.id, name: s.name })));
      // Load extra professionals from settings
      const fup = (settings as any).follow_up || {};
      setExtraPros(fup._extraProfessionals || 0);
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!name || !phone) { alert('Nome e Telefone são obrigatórios!'); return; }

    // Check plan limit
    const planCfg = getPlanConfig(tenantPlan);
    const maxAllowed = planCfg.maxProfessionals + extraPros;
    if (pros.length >= maxAllowed) {
      setShowUpsell(true);
      return;
    }

    setSaving(true);
    try {
      const newPro = await db.addProfessional({ tenant_id: tenantId, name, phone, specialty, active: true });
      await db.updateProfessional(tenantId, newPro.id, { role });
      await load();
      setShowModal(false);
      resetForm();
    } catch (err: any) {
      alert('Erro ao salvar: ' + (err.message || 'Erro desconhecido'));
    } finally { setSaving(false); }
  };

  const handleAddonPurchase = async (billingType: 'PIX' | 'CREDIT_CARD') => {
    setUpsellLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/asaas-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          tenantId,
          billingType,
          addon: 'additional_professional',
        }),
      });
      const data = await res.json();
      if (data.invoiceUrl) {
        window.open(data.invoiceUrl, '_blank');
        setShowUpsell(false);
        // Reload to get updated extraPros count
        setTimeout(() => load(), 3000);
      } else {
        alert('Erro ao gerar cobrança: ' + (data.error || 'Tente novamente'));
      }
    } catch (err: any) {
      alert('Erro: ' + (err.message || 'Falha na conexão'));
    } finally { setUpsellLoading(false); }
  };

  const handleEdit = async () => {
    if (!editingPro || !name || !phone) return;
    setSaving(true);
    try {
      await db.updateProfessional(tenantId, editingPro.id, { name, phone, specialty, role });
      await load();
      setEditingPro(null);
      resetForm();
    } catch (err: any) {
      alert('Erro ao atualizar: ' + (err.message || 'Erro desconhecido'));
    } finally { setSaving(false); }
  };

  const resetForm = () => { setName(''); setPhone(''); setSpecialty(''); setRole('colab'); };

  const handleDeletePro = async () => {
    if (!deleteProId) return;
    setDeletingPro(true);
    try {
      await db.deleteProfessional(tenantId, deleteProId);
      setDeleteProId(null);
      await load();
    } catch (e: any) {
      alert('Erro ao excluir: ' + (e.message || 'tente novamente.'));
    } finally {
      setDeletingPro(false);
    }
  };

  const openLunch = (pro: Professional) => {
    const existing = breaks.find(b => b.type === 'lunch' && b.professionalId === pro.id);
    if (existing) {
      setLunchStart(existing.startTime);
      setLunchEnd(existing.endTime);
      setLunchDays(existing.dayOfWeek == null ? [0, 1, 2, 3, 4, 5, 6] : [existing.dayOfWeek]);
    } else {
      setLunchStart('12:00'); setLunchEnd('13:00'); setLunchDays([1, 2, 3, 4, 5]);
    }
    setLunchPro(pro);
  };

  const saveLunch = async () => {
    if (!lunchPro) return;
    setSaving(true);
    try {
      const withoutOld = breaks.filter(b => !(b.type === 'lunch' && b.professionalId === lunchPro.id));
      const allDays = lunchDays.length === 7;
      const newBreaks: BreakPeriod[] = allDays
        ? [{ id: genId(), type: 'lunch', label: `Almoço — ${lunchPro.name}`, professionalId: lunchPro.id, dayOfWeek: null, date: null, startTime: lunchStart, endTime: lunchEnd }]
        : lunchDays.map(d => ({ id: genId(), type: 'lunch' as const, label: `Almoço — ${lunchPro.name}`, professionalId: lunchPro.id, dayOfWeek: d, date: null, startTime: lunchStart, endTime: lunchEnd }));
      await db.saveBreaks(tenantId, [...withoutOld, ...newBreaks]);
      await load();
      setLunchPro(null);
    } finally { setSaving(false); }
  };

  const removeLunch = async () => {
    if (!lunchPro) return;
    setSaving(true);
    try {
      const without = breaks.filter(b => !(b.type === 'lunch' && b.professionalId === lunchPro.id));
      await db.saveBreaks(tenantId, without);
      await load();
      setLunchPro(null);
    } finally { setSaving(false); }
  };

  const openVacation = (pro: Professional) => {
    const existing = breaks.find(b => b.type === 'vacation' && b.professionalId === pro.id);
    if (existing) {
      setVacStart(existing.date || '');
      setVacEnd(existing.vacationEndDate || '');
    } else {
      setVacStart(''); setVacEnd('');
    }
    setVacPro(pro);
  };

  const saveVacation = async () => {
    if (!vacPro || !vacStart || !vacEnd) { alert('Informe o período de férias.'); return; }
    setSaving(true);
    try {
      const withoutOld = breaks.filter(b => !(b.type === 'vacation' && b.professionalId === vacPro.id));
      const vac: BreakPeriod = { id: genId(), type: 'vacation', label: `Férias — ${vacPro.name}`, professionalId: vacPro.id, date: vacStart, vacationEndDate: vacEnd, dayOfWeek: null, startTime: '00:00', endTime: '23:59' };
      await db.saveBreaks(tenantId, [...withoutOld, vac]);
      await load();
      setVacPro(null);
    } finally { setSaving(false); }
  };

  const removeVacation = async () => {
    if (!vacPro) return;
    setSaving(true);
    try {
      const without = breaks.filter(b => !(b.type === 'vacation' && b.professionalId === vacPro.id));
      await db.saveBreaks(tenantId, without);
      await load();
      setVacPro(null);
    } finally { setSaving(false); }
  };

  const openInterval = (pro: Professional, existingId?: string) => {
    if (existingId) {
      const existing = breaks.find(b => b.id === existingId);
      if (existing) {
        setIntervalStart(existing.startTime);
        setIntervalEnd(existing.endTime);
        if (existing.date) {
          setIntervalMode('specific');
          setIntervalDate(existing.date);
          setIntervalDays([]);
        } else {
          setIntervalMode('recurring');
          setIntervalDate('');
          setIntervalDays(existing.dayOfWeek == null ? [0, 1, 2, 3, 4, 5, 6] : [existing.dayOfWeek]);
        }
        setEditingIntervalId(existingId);
      }
    } else {
      setIntervalStart('15:00'); setIntervalEnd('15:30');
      setIntervalDays([1, 2, 3, 4, 5]); setIntervalDate('');
      setIntervalMode('recurring'); setEditingIntervalId(null);
    }
    setIntervalPro(pro);
  };

  const saveInterval = async () => {
    if (!intervalPro) return;
    if (intervalMode === 'specific' && !intervalDate) { alert('Informe a data do intervalo.'); return; }
    if (intervalMode === 'recurring' && intervalDays.length === 0) { alert('Selecione ao menos um dia.'); return; }
    setSaving(true);
    try {
      const withoutOld = editingIntervalId
        ? breaks.filter(b => b.id !== editingIntervalId)
        : breaks;
      let newBreaks: BreakPeriod[];
      if (intervalMode === 'specific') {
        newBreaks = [{ id: genId(), type: 'break', label: `Intervalo — ${intervalPro.name}`, professionalId: intervalPro.id, dayOfWeek: null, date: intervalDate, startTime: intervalStart, endTime: intervalEnd }];
      } else {
        const allDays = intervalDays.length === 7;
        newBreaks = allDays
          ? [{ id: genId(), type: 'break', label: `Intervalo — ${intervalPro.name}`, professionalId: intervalPro.id, dayOfWeek: null, date: null, startTime: intervalStart, endTime: intervalEnd }]
          : intervalDays.map(d => ({ id: genId(), type: 'break' as const, label: `Intervalo — ${intervalPro.name}`, professionalId: intervalPro.id, dayOfWeek: d, date: null, startTime: intervalStart, endTime: intervalEnd }));
      }
      await db.saveBreaks(tenantId, [...withoutOld, ...newBreaks]);
      await load();
      setIntervalPro(null);
    } finally { setSaving(false); }
  };

  const removeInterval = async (id: string) => {
    setSaving(true);
    try {
      const without = breaks.filter(b => b.id !== id);
      await db.saveBreaks(tenantId, without);
      await load();
    } finally { setSaving(false); }
  };

  const toggleIntervalDay = (d: number) =>
    setIntervalDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);

  const getIntervalsInfo = (pro: Professional) => breaks.filter(b => b.type === 'break' && b.professionalId === pro.id);

  const applyPreset = (period: string) => {
    setPresetPeriod(period);
    const now = new Date();
    let start = new Date(), end = new Date();
    switch (period) {
      case 'week': start.setDate(now.getDate() - now.getDay()); break;
      case '7d': start.setDate(now.getDate() - 7); break;
      case '14d': start.setDate(now.getDate() - 14); break;
      case 'month': start = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'last_month': start = new Date(now.getFullYear(), now.getMonth() - 1, 1); end = new Date(now.getFullYear(), now.getMonth(), 0); break;
    }
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  };

  const reportData = useMemo(() => {
    if (!selectedProForReport) return null;
    const filteredApps = allAppointments.filter(a => {
      if (a.professional_id !== selectedProForReport.id) return false;
      const d = new Date(a.startTime).toISOString().split('T')[0];
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    });
    const filteredExps = allExpenses.filter(e => {
      if (e.professional_id !== selectedProForReport.id) return false;
      const d = new Date(e.date).toISOString().split('T')[0];
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    });
    const finished = filteredApps.filter(a => a.status === AppointmentStatus.FINISHED);
    const revenue = finished.reduce((acc, curr) => acc + (curr.amountPaid || 0), 0);
    const totalExpenses = filteredExps.reduce((acc, curr) => acc + curr.amount, 0);
    return {
      total: filteredApps.length, revenue, expenses: totalExpenses, netResult: revenue - totalExpenses,
      appointments: filteredApps.sort((a, b) => b.startTime.localeCompare(a.startTime)),
      expensesList: filteredExps.sort((a, b) => b.date.localeCompare(a.date)),
    };
  }, [selectedProForReport, startDate, endDate, allAppointments, allExpenses]);

  const getLunchInfo = (pro: Professional) => breaks.find(b => b.type === 'lunch' && b.professionalId === pro.id);
  const getVacInfo = (pro: Professional) => breaks.find(b => b.type === 'vacation' && b.professionalId === pro.id);
  const toggleLunchDay = (d: number) =>
    setLunchDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);

  return (
    <>
    <div className="space-y-10 animate-fadeIn">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl sm:text-3xl font-black text-black uppercase tracking-tight">Equipe de Profissionais</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Gestão de performance individual</p>
        </div>
        <button onClick={() => {
          const planCfg = getPlanConfig(tenantPlan);
          const maxAllowed = planCfg.maxProfessionals + extraPros;
          if (pros.length >= maxAllowed) {
            setShowUpsell(true);
          } else {
            setShowModal(true);
          }
        }} className="bg-orange-500 text-white px-5 sm:px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-100 hover:scale-105 transition-all w-full sm:w-auto">
          + Novo Profissional
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {pros.map((p) => {
          const lunch = getLunchInfo(p);
          const vac = getVacInfo(p);
          const intervals = getIntervalsInfo(p);
          return (
            <div key={p.id} className="bg-white p-5 sm:p-6 md:p-8 rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 relative group hover:border-orange-500 transition-all">
              <div className="flex items-center space-x-5 mb-6 cursor-pointer" onClick={() => { setSelectedProForReport(p); setReportTab('appointments'); }}>
                <div className="w-16 h-16 bg-black text-white rounded-[24px] flex items-center justify-center text-2xl font-black group-hover:bg-orange-500 transition-all shadow-lg">
                  {p.name[0]}
                </div>
                <div>
                  <h3 className="text-lg font-black text-black leading-tight">{p.name}</h3>
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-0.5">{p.specialty || 'Profissional'}</p>
                  <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest ${p.role === 'admin' ? 'bg-black text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {p.role === 'admin' ? '👑 Admin' : '💈 Colab'}
                  </span>
                </div>
              </div>
              <div className="space-y-1.5 mb-5">
                {lunch && (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-1.5">
                    <span className="text-xs">🍽️</span>
                    <span className="text-[10px] font-black text-amber-700">Almoço {lunch.startTime}–{lunch.endTime}</span>
                  </div>
                )}
                {vac && (
                  <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-1.5">
                    <span className="text-xs">🌴</span>
                    <span className="text-[10px] font-black text-blue-700">Férias: {vac.date} até {vac.vacationEndDate}</span>
                  </div>
                )}
                {intervals.map(intv => (
                  <div key={intv.id} className="flex items-center justify-between bg-purple-50 border border-purple-100 rounded-xl px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs">⏸️</span>
                      <span className="text-[10px] font-black text-purple-700">
                        Intervalo {intv.startTime}–{intv.endTime}
                        {intv.date ? ` (${intv.date})` : intv.dayOfWeek != null ? ` (${DAYS_PT[intv.dayOfWeek]})` : ' (todos os dias)'}
                      </span>
                    </div>
                    <button onClick={() => openInterval(p, intv.id)} className="text-purple-400 hover:text-purple-700 text-[9px] font-black">
                      Editar
                    </button>
                  </div>
                ))}
              </div>
              <div className="border-t-2 border-slate-50 pt-4 space-y-2">
                <div className="flex gap-2">
                  <button onClick={() => openLunch(p)} className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all">
                    🍽️ Almoço
                  </button>
                  <button onClick={() => openInterval(p)} className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all">
                    ⏸️ Intervalo
                  </button>
                  <button onClick={() => openVacation(p)} className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all">
                    🌴 Férias
                  </button>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <button onClick={(e) => { e.stopPropagation(); setEditingPro(p); setName(p.name); setPhone(p.phone); setSpecialty(p.specialty); setRole(p.role || 'colab'); }}
                      className="text-[9px] font-black text-slate-400 uppercase tracking-widest hover:text-black transition-all">
                      📝 Editar
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setDeleteProId(p.id); }}
                      title="Excluir profissional"
                      className="text-red-400 hover:text-red-600 transition-colors">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                      </svg>
                    </button>
                  </div>
                  <button onClick={() => { setSelectedProForReport(p); setReportTab('appointments'); }} className="text-[10px] font-black text-orange-500 uppercase tracking-widest hover:tracking-wider transition-all">
                    Ver Desempenho →
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>

      {/* ── LUNCH MODAL ─────────────────────────────────────────────── */}
      {lunchPro && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-sm p-8 space-y-6 animate-scaleUp border-4 border-black max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🍽️</span>
              <div>
                <h2 className="text-xl font-black text-black uppercase">Intervalo de Almoço</h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{lunchPro.name}</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Início</label>
                  <input type="time" value={lunchStart} onChange={e => setLunchStart(e.target.value)}
                    className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-center outline-none focus:border-amber-400" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Fim</label>
                  <input type="time" value={lunchEnd} onChange={e => setLunchEnd(e.target.value)}
                    className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-center outline-none focus:border-amber-400" />
                </div>
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-2">Dias da semana</label>
                <div className="flex gap-1.5 flex-wrap">
                  {DAYS_PT.map((d, i) => (
                    <button key={i} onClick={() => toggleLunchDay(i)}
                      className={`w-9 h-9 rounded-xl font-black text-[9px] uppercase transition-all ${lunchDays.includes(i) ? 'bg-amber-400 text-white' : 'bg-slate-100 text-slate-400 hover:bg-amber-100'}`}>
                      {d.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              {breaks.some(b => b.type === 'lunch' && b.professionalId === lunchPro.id) && (
                <button onClick={removeLunch} disabled={saving} className="px-4 py-3 bg-red-50 text-red-500 rounded-2xl font-black text-[9px] uppercase hover:bg-red-100 transition-all">
                  Remover
                </button>
              )}
              <button onClick={() => setLunchPro(null)} className="flex-1 py-3 font-black text-slate-400 uppercase text-xs" disabled={saving}>Cancelar</button>
              <button onClick={saveLunch} disabled={saving || lunchDays.length === 0} className="flex-1 py-3 bg-amber-400 text-white rounded-2xl font-black uppercase text-xs hover:bg-amber-500 transition-all disabled:opacity-40">
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── VACATION MODAL ───────────────────────────────────────────── */}
      {vacPro && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-sm p-8 space-y-6 animate-scaleUp border-4 border-black max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🌴</span>
              <div>
                <h2 className="text-xl font-black text-black uppercase">Período de Férias</h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{vacPro.name}</p>
              </div>
            </div>
            <p className="text-xs text-slate-400 font-bold leading-relaxed">
              Durante as férias, nenhum agendamento será aceito para este profissional — nem pelo Agente IA, nem pelo link web.
            </p>
            <div className="space-y-4">
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Início das férias</label>
                <input type="date" value={vacStart} onChange={e => setVacStart(e.target.value)}
                  className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Retorno (inclusive)</label>
                <input type="date" value={vacEnd} onChange={e => setVacEnd(e.target.value)}
                  className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black outline-none focus:border-blue-400" />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              {breaks.some(b => b.type === 'vacation' && b.professionalId === vacPro.id) && (
                <button onClick={removeVacation} disabled={saving} className="px-4 py-3 bg-red-50 text-red-500 rounded-2xl font-black text-[9px] uppercase hover:bg-red-100 transition-all">
                  Remover
                </button>
              )}
              <button onClick={() => setVacPro(null)} className="flex-1 py-3 font-black text-slate-400 uppercase text-xs" disabled={saving}>Cancelar</button>
              <button onClick={saveVacation} disabled={saving || !vacStart || !vacEnd} className="flex-1 py-3 bg-blue-500 text-white rounded-2xl font-black uppercase text-xs hover:bg-blue-600 transition-all disabled:opacity-40">
                {saving ? 'Salvando...' : 'Confirmar Férias'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── INTERVAL MODAL ────────────────────────────────────────────── */}
      {intervalPro && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-sm p-8 space-y-6 animate-scaleUp border-4 border-black max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⏸️</span>
              <div>
                <h2 className="text-xl font-black text-black uppercase">{editingIntervalId ? 'Editar Intervalo' : 'Novo Intervalo'}</h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{intervalPro.name}</p>
              </div>
            </div>
            <p className="text-xs text-slate-400 font-bold leading-relaxed">
              O profissional ficará indisponível neste horário. O agente IA e o link web não oferecem esses slots.
            </p>
            <div className="space-y-4">
              {/* Mode selector */}
              <div className="flex gap-2">
                <button onClick={() => setIntervalMode('recurring')}
                  className={`flex-1 py-2.5 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${intervalMode === 'recurring' ? 'bg-purple-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-purple-50'}`}>
                  Recorrente
                </button>
                <button onClick={() => setIntervalMode('specific')}
                  className={`flex-1 py-2.5 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${intervalMode === 'specific' ? 'bg-purple-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-purple-50'}`}>
                  Data Específica
                </button>
              </div>
              {/* Time range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Início</label>
                  <input type="time" value={intervalStart} onChange={e => setIntervalStart(e.target.value)}
                    className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-center outline-none focus:border-purple-400" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Fim</label>
                  <input type="time" value={intervalEnd} onChange={e => setIntervalEnd(e.target.value)}
                    className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-center outline-none focus:border-purple-400" />
                </div>
              </div>
              {/* Days or date */}
              {intervalMode === 'recurring' ? (
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-2">Dias da semana</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {DAYS_PT.map((d, i) => (
                      <button key={i} onClick={() => toggleIntervalDay(i)}
                        className={`w-9 h-9 rounded-xl font-black text-[9px] uppercase transition-all ${intervalDays.includes(i) ? 'bg-purple-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-purple-100'}`}>
                        {d.slice(0, 3)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Data</label>
                  <input type="date" value={intervalDate} onChange={e => setIntervalDate(e.target.value)}
                    className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black outline-none focus:border-purple-400" />
                </div>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              {editingIntervalId && (
                <button onClick={async () => { await removeInterval(editingIntervalId); setIntervalPro(null); }} disabled={saving}
                  className="px-4 py-3 bg-red-50 text-red-500 rounded-2xl font-black text-[9px] uppercase hover:bg-red-100 transition-all">
                  Remover
                </button>
              )}
              <button onClick={() => setIntervalPro(null)} className="flex-1 py-3 font-black text-slate-400 uppercase text-xs" disabled={saving}>Cancelar</button>
              <button onClick={saveInterval} disabled={saving} className="flex-1 py-3 bg-purple-500 text-white rounded-2xl font-black uppercase text-xs hover:bg-purple-600 transition-all disabled:opacity-40">
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REPORT MODAL ─────────────────────────────────────────────── */}
      {selectedProForReport && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="bg-white rounded-[50px] w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-scaleUp border-4 border-black">
            <div className="p-10 border-b-2 border-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
              <div className="flex items-center space-x-5">
                <div className="w-16 h-16 bg-orange-500 text-white rounded-3xl flex items-center justify-center text-2xl font-black shadow-xl">{selectedProForReport.name[0]}</div>
                <div>
                  <h2 className="text-2xl font-black text-black uppercase tracking-tight">{selectedProForReport.name}</h2>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Relatório de Atividade</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex bg-slate-100 p-1 rounded-2xl">
                  <PresetBtn active={presetPeriod === 'week'} onClick={() => applyPreset('week')} label="Esta Semana" />
                  <PresetBtn active={presetPeriod === '7d'} onClick={() => applyPreset('7d')} label="7 Dias" />
                  <PresetBtn active={presetPeriod === 'month'} onClick={() => applyPreset('month')} label="Este Mês" />
                </div>
                <button onClick={() => setSelectedProForReport(null)} className="ml-2 w-11 h-11 bg-slate-100 rounded-2xl flex items-center justify-center text-black hover:bg-red-500 hover:text-white transition-all font-black text-xl">×</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-10 space-y-8 bg-slate-50/30 custom-scrollbar">
              {/* ── Summary cards ── */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <StatCardSmall title="Atendimentos" value={reportData?.total} />
                <StatCardSmall title="Faturamento Bruto" value={`R$ ${reportData?.revenue.toFixed(2)}`} color="text-orange-500" />
                <StatCardSmall title="Despesas" value={`R$ ${reportData?.expenses.toFixed(2)}`} />
                <StatCardSmall title="Lucro Líquido" value={`R$ ${reportData?.netResult.toFixed(2)}`} bg="bg-black text-white" />
              </div>

              {/* ── Tab switcher ── */}
              <div className="flex bg-slate-100 p-1 rounded-2xl w-fit">
                <button
                  onClick={() => setReportTab('appointments')}
                  className={`px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${reportTab === 'appointments' ? 'bg-black text-white shadow-md' : 'text-slate-400 hover:text-black'}`}
                >
                  📅 Agendamentos ({reportData?.appointments.length ?? 0})
                </button>
                <button
                  onClick={() => setReportTab('expenses')}
                  className={`px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${reportTab === 'expenses' ? 'bg-black text-white shadow-md' : 'text-slate-400 hover:text-black'}`}
                >
                  💸 Despesas ({reportData?.expensesList.length ?? 0})
                </button>
              </div>

              {/* ── Appointments list ── */}
              {reportTab === 'appointments' && (
                <div className="space-y-3">
                  {(reportData?.appointments ?? []).length === 0 && (
                    <p className="text-center text-slate-400 font-black text-xs uppercase py-8">Nenhum agendamento no período</p>
                  )}
                  {(reportData?.appointments ?? []).map((a: Appointment) => {
                    const svcName = allServices.find(s => s.id === a.service_id)?.name ?? '—';
                    const statusColors: Record<string, string> = {
                      FINISHED:  'bg-emerald-100 text-emerald-700',
                      CONFIRMED: 'bg-blue-100 text-blue-700',
                      CANCELLED: 'bg-red-100 text-red-600',
                      PENDING:   'bg-amber-100 text-amber-700',
                    };
                    const statusLabel: Record<string, string> = {
                      FINISHED: 'Finalizado', CONFIRMED: 'Confirmado',
                      CANCELLED: 'Cancelado', PENDING: 'Pendente',
                    };
                    const dateStr = new Date(a.startTime).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
                    const timeStr = new Date(a.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div key={a.id} className="flex items-center justify-between bg-white rounded-2xl px-6 py-4 border-2 border-slate-100">
                        <div className="flex items-center gap-4">
                          <div className="text-center min-w-[52px]">
                            <p className="text-[10px] font-black text-slate-400 uppercase">{dateStr}</p>
                            <p className="text-xs font-black text-black">{timeStr}</p>
                          </div>
                          <div>
                            <p className="text-sm font-black text-black">{svcName}</p>
                            {a.isPlan && <span className="text-[9px] font-black text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full uppercase">Plano</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase ${statusColors[a.status] ?? 'bg-slate-100 text-slate-500'}`}>
                            {statusLabel[a.status] ?? a.status}
                          </span>
                          {a.status === 'FINISHED' && (
                            <span className="text-sm font-black text-emerald-600">R$ {(a.amountPaid ?? 0).toFixed(2)}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Expenses list ── */}
              {reportTab === 'expenses' && (
                <div className="space-y-3">
                  {(reportData?.expensesList ?? []).length === 0 && (
                    <p className="text-center text-slate-400 font-black text-xs uppercase py-8">Nenhuma despesa no período</p>
                  )}
                  {(reportData?.expensesList ?? []).map((e: Expense) => (
                    <div key={e.id} className="flex items-center justify-between bg-white rounded-2xl px-6 py-4 border-2 border-slate-100">
                      <div className="flex items-center gap-4">
                        <p className="text-[10px] font-black text-slate-400 uppercase min-w-[52px]">
                          {new Date(e.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                        </p>
                        <div>
                          <p className="text-sm font-black text-black">{e.description}</p>
                          {e.paymentMethod && (
                            <p className="text-[9px] font-black text-slate-400 uppercase">{e.paymentMethod}</p>
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-black text-red-500">- R$ {e.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE PRO CONFIRM MODAL ─────────────────────────────────── */}
      {deleteProId && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-sm p-10 space-y-6 border-4 border-red-500 animate-scaleUp">
            <h2 className="text-2xl font-black text-black uppercase tracking-tight">Excluir Profissional?</h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Esta ação é <strong>permanente</strong>. O profissional será removido do sistema junto com seus metadados de configuração.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setDeleteProId(null)}
                className="flex-1 py-3 rounded-2xl border-2 border-slate-200 text-sm font-black text-slate-500 hover:bg-slate-50 transition-colors"
              >
                CANCELAR
              </button>
              <button
                onClick={handleDeletePro}
                disabled={deletingPro}
                className="flex-1 py-3 rounded-2xl bg-red-500 hover:bg-red-600 text-white text-sm font-black uppercase tracking-widest transition-colors disabled:opacity-50"
              >
                {deletingPro ? '...' : 'EXCLUIR'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD/EDIT PRO MODAL ───────────────────────────────────────── */}
      {(showModal || editingPro) && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md p-8 space-y-6 animate-scaleUp border-4 border-black max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-black text-black uppercase tracking-tight italic">
              {editingPro ? 'Editar Profissional' : 'Novo Profissional'}
            </h2>
            <div className="space-y-4">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome Completo"
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">WhatsApp Pessoal</label>
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="5544999999999"
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
              </div>
              <input value={specialty} onChange={e => setSpecialty(e.target.value)} placeholder="Especialidade"
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Nível de Acesso</label>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setRole('colab')}
                    className={`py-3 rounded-2xl font-black text-xs uppercase tracking-widest border-2 transition-all ${role === 'colab' ? 'bg-slate-800 text-white border-slate-800' : 'bg-slate-50 text-slate-400 border-slate-100 hover:border-slate-400'}`}>
                    💈 Colaborador
                  </button>
                  <button type="button" onClick={() => setRole('admin')}
                    className={`py-3 rounded-2xl font-black text-xs uppercase tracking-widest border-2 transition-all ${role === 'admin' ? 'bg-black text-white border-black' : 'bg-slate-50 text-slate-400 border-slate-100 hover:border-black'}`}>
                    👑 Admin
                  </button>
                </div>
              </div>
            </div>
            <div className="flex gap-4 pt-2">
              <button onClick={() => { setShowModal(false); setEditingPro(null); resetForm(); }}
                className="flex-1 py-4 font-black text-slate-400 uppercase text-xs" disabled={saving}>
                Cancelar
              </button>
              <button onClick={editingPro ? handleEdit : handleAdd}
                className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs shadow-xl hover:bg-orange-500 transition-all disabled:opacity-50" disabled={saving}>
                {saving ? 'Gravando...' : editingPro ? 'Salvar Alterações' : 'Confirmar Cadastro'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Upsell Popup ═══ */}
      {showUpsell && (() => {
        const planCfg = getPlanConfig(tenantPlan);
        const isStart = (tenantPlan || 'START') === 'START';
        const canAddMore = isStart && (planCfg.maxProfessionals + extraPros) < 2;
        const addonPrice = planCfg.additionalProfessionalPrice || 19.90;
        const proPlan = PLAN_CONFIGS.PROFISSIONAL;

        return (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setShowUpsell(false)}>
            <div className="bg-white rounded-[32px] w-full max-w-md p-8 space-y-6 animate-scaleUp border-2 border-orange-500" onClick={e => e.stopPropagation()}>
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center text-3xl mx-auto">👥</div>
                <h2 className="text-xl font-black text-black uppercase tracking-tight">Limite de Profissionais</h2>
                <p className="text-sm text-slate-500">
                  Seu plano <span className="font-bold">{planCfg.name}</span> permite até{' '}
                  <span className="font-bold">{planCfg.maxProfessionals + extraPros}</span> profissional{(planCfg.maxProfessionals + extraPros) !== 1 ? 'is' : ''}.
                </p>
              </div>

              <div className="space-y-3">
                {/* Option 1: Add professional addon (only for START, max 2 total) */}
                {isStart && canAddMore && (
                  <div className="border-2 border-green-200 bg-green-50/50 rounded-2xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-black text-sm text-black">+1 Profissional</p>
                        <p className="text-xs text-slate-500">Adicione mais um acesso ao seu plano</p>
                      </div>
                      <p className="text-lg font-black text-green-600">R$ {addonPrice.toFixed(2).replace('.', ',')}<span className="text-[10px] font-bold text-slate-400">/mês</span></p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAddonPurchase('PIX')}
                        disabled={upsellLoading}
                        className="flex-1 py-3 bg-green-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-green-700 transition-all disabled:opacity-50"
                      >
                        {upsellLoading ? '...' : '💠 Pagar com PIX'}
                      </button>
                      <button
                        onClick={() => handleAddonPurchase('CREDIT_CARD')}
                        disabled={upsellLoading}
                        className="flex-1 py-3 bg-slate-800 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-900 transition-all disabled:opacity-50"
                      >
                        {upsellLoading ? '...' : '💳 Cartão'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Option 2: Upgrade to PROFISSIONAL */}
                <div className="border-2 border-blue-200 bg-blue-50/50 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-black text-sm text-black">🔵 Upgrade para Profissional</p>
                      <p className="text-xs text-slate-500">Até {proPlan.maxProfessionals} profissionais + IA + financeiro</p>
                    </div>
                    <p className="text-lg font-black text-blue-600">R$ {proPlan.price.toFixed(2).replace('.', ',')}<span className="text-[10px] font-bold text-slate-400">/mês</span></p>
                  </div>
                  <button
                    onClick={() => {
                      setShowUpsell(false);
                      if (onNavigate) onNavigate('PLANOS');
                    }}
                    className="w-full py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all"
                  >
                    Ver Plano Profissional
                  </button>
                </div>
              </div>

              <button onClick={() => setShowUpsell(false)} className="w-full py-3 text-slate-400 font-bold text-xs uppercase tracking-widest hover:text-slate-600 transition-all">
                Fechar
              </button>
            </div>
          </div>
        );
      })()}
    </>
  );
};

const StatCardSmall = ({ title, value, color, bg }: any) => (
  <div className={`p-8 rounded-[30px] border-2 border-slate-100 shadow-sm ${bg || 'bg-white'}`}>
    <p className={`text-[9px] font-black uppercase tracking-widest mb-1 ${bg ? 'text-white/50' : 'text-slate-400'}`}>{title}</p>
    <p className={`text-2xl font-black tracking-tight ${color || ''}`}>{value}</p>
  </div>
);

const PresetBtn = ({ active, onClick, label }: any) => (
  <button onClick={onClick} className={`px-3 py-2 text-[8px] font-black uppercase tracking-tighter rounded-xl transition-all ${active ? 'bg-black text-white shadow-md' : 'text-slate-400 hover:text-black'}`}>{label}</button>
);

export default ProfessionalsView;