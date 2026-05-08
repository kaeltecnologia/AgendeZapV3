
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { Customer, Plan, PlanStatus, Service, FollowUpNamedMode, Professional, RecurringEntry, RecurringFrequency, AppointmentStatus } from '../types';

const CustomersView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [activeTab, setActiveTab] = useState<'lista' | 'retencao'>('lista');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [avisoModes, setAvisoModes] = useState<FollowUpNamedMode[]>([]);
  const [lembreteModes, setLembreteModes] = useState<FollowUpNamedMode[]>([]);
  const [reativacaoModes, setReativacaoModes] = useState<FollowUpNamedMode[]>([]);

  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [addEntry, setAddEntry] = useState<{
    professionalId: string;
    serviceId: string;
    dayOfWeek: number;
    time: string;
    repeat: boolean;
    frequency: RecurringFrequency;
    weekOffset: number;
    price: string;
  }>({
    professionalId: '',
    serviceId: '',
    dayOfWeek: 1,
    time: '09:00',
    repeat: true,
    frequency: 'weekly',
    weekOffset: 0,
    price: '',
  });
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [importResult, setImportResult] = useState<{ ok: number; fail: number } | null>(null);
  const [planBalance, setPlanBalance] = useState<Record<string, { total: number; used: number; remaining: number }>>({});
  const [renewingPlan, setRenewingPlan] = useState(false);
  const [profileTab, setProfileTab] = useState<'perfil' | 'config'>('perfil');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [data, plansData, svcData, profsData, settings, appts] = await Promise.all([
        db.getCustomers(tenantId),
        db.getPlans(tenantId),
        db.getServices(tenantId),
        db.getProfessionals(tenantId),
        db.getSettings(tenantId),
        db.getAppointments(tenantId)
      ]);
      setCustomers(data);
      setAppointments(appts);
      setPlans(plansData);
      setServices(svcData.filter(s => s.active));
      setProfessionals(profsData.filter(p => p.active));
      setAvisoModes(settings.avisoModes || []);
      setLembreteModes(settings.lembreteModes || []);
      setReativacaoModes(settings.reativacaoModes || []);
    } catch (err) {
      console.error("Erro ao carregar clientes", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  // Load plan balance when editing a customer with a plan
  useEffect(() => {
    if (editingCustomer?.planId) {
      db.getPlanBalance(tenantId, editingCustomer.id).then(setPlanBalance).catch(() => setPlanBalance({}));
    } else {
      setPlanBalance({});
    }
  }, [editingCustomer?.id, editingCustomer?.planId, tenantId]);

  // Compute consumption stats + history when viewing a customer profile
  const customerStats = React.useMemo(() => {
    if (!editingCustomer) return null;
    const custAppts = appointments.filter(a =>
      a.customer_id === editingCustomer.id &&
      !['CANCELLED', 'cancelado', 'NO_SHOW'].includes(a.status)
    );
    if (!custAppts.length) return null;
    const totalSpent = custAppts.reduce((s, a) => s + (a.amountPaid || 0), 0);
    const last = custAppts.slice().sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
    return { count: custAppts.length, totalSpent, lastDate: last?.startTime?.slice(0, 10) || '' };
  }, [editingCustomer?.id, appointments]);

  const customerHistory = React.useMemo(() => {
    if (!editingCustomer) return [];
    return appointments
      .filter(a => a.customer_id === editingCustomer.id)
      .sort((a, b) => b.startTime?.localeCompare(a.startTime || '') || 0)
      .slice(0, 50)
      .map(a => ({
        ...a,
        serviceName: services.find(s => s.id === a.service_id)?.name || '—',
        professionalName: professionals.find(p => p.id === a.professional_id)?.name || '—',
      }));
  }, [editingCustomer?.id, appointments, services, professionals]);

  const filteredCustomers = customers
    .filter(c =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm)
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));

  const handleAdd = async () => {
    if (!newName || !newPhone) { alert("Nome e WhatsApp são obrigatórios!"); return; }
    setSaving(true);
    try {
      await db.addCustomer({ tenant_id: tenantId, name: newName, phone: newPhone, active: true });
      await load();
      setShowAddModal(false);
      setNewName(''); setNewPhone('');
    } catch (err: any) {
      alert("Erro ao salvar cliente: " + (err.message || "Erro desconhecido"));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingCustomer) return;
    setSaving(true);
    try {
      await db.updateCustomer(tenantId, editingCustomer.id, {
        name: editingCustomer.name,
        phone: editingCustomer.phone,
        email: editingCustomer.email,
        birthDate: editingCustomer.birthDate,
        avisoModeId: editingCustomer.avisoModeId,
        lembreteModeId: editingCustomer.lembreteModeId,
        reativacaoModeId: editingCustomer.reativacaoModeId,
        planId: editingCustomer.planId,
        planStatus: editingCustomer.planStatus as PlanStatus | undefined,
        planServiceId: editingCustomer.planServiceId,
        recurringEntries: editingCustomer.recurringEntries
      });
      await load();
      setEditingCustomer(null);
    } catch (err: any) {
      alert("Erro ao salvar: " + (err.message || "Erro desconhecido"));
    } finally {
      setSaving(false);
    }
  };

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    setImportProgress(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      // Detect separator: semicolon (BR Excel) or comma
      const sep = lines[0]?.includes(';') ? ';' : ',';
      // Skip header row if first col is non-numeric and looks like a label
      const startIdx = /^(nome|name|cliente|contato)/i.test(lines[0]?.split(sep)[0] || '') ? 1 : 0;
      const dataLines = lines.slice(startIdx);
      let skipped = 0;
      const rows: Array<{ name: string; phone: string; birthDate?: string }> = [];
      for (const line of dataLines) {
        const cols = line.split(sep).map(c => c.replace(/^"|"$/g, '').trim());
        const name = cols[0] || '';
        const phone = (cols[1] || '').replace(/\D/g, '');
        // Aceita telefones com >= 7 dígitos (suporte a números internacionais)
        if (!name || phone.length < 7) { skipped++; continue; }
        const birthDate = cols[2] ? cols[2].trim() : undefined;
        rows.push({ name, phone, birthDate });
      }
      setImportProgress({ done: 0, total: rows.length });
      const { ok, fail } = await db.bulkImportCustomers(tenantId, rows, (done, total) => {
        setImportProgress({ done, total });
      });
      setImportResult({ ok, fail: fail + skipped });
      await load();
    } catch (err: any) {
      alert('Erro ao importar: ' + (err.message || 'Erro desconhecido'));
    } finally {
      setImporting(false);
      setImportProgress(null);
      e.target.value = '';
    }
  };

  const getPlanName = (planId: string | null | undefined) =>
    planId ? (plans.find(p => p.id === planId)?.name || null) : null;

  const hasAnyMode = (c: Customer) =>
    (c.avisoModeId && c.avisoModeId !== 'standard') ||
    (c.lembreteModeId && c.lembreteModeId !== 'standard') ||
    (c.reativacaoModeId && c.reativacaoModeId !== 'standard');

  const getModeName = (modeId: string | undefined, modes: FollowUpNamedMode[]) => {
    if (!modeId || modeId === 'standard') return null;
    return modes.find(m => m.id === modeId)?.name || null;
  };

  const hasModes = avisoModes.length > 0 || lembreteModes.length > 0 || reativacaoModes.length > 0;

  if (loading) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO CLIENTES...</div>;

  // ─── Retention calculations ───────────────────────────────────────────────
  const finishedAppts = appointments.filter(a => a.status === AppointmentStatus.FINISHED);
  const today = new Date();
  const iso = (d: Date) => d.toISOString().split('T')[0];
  const todayStr = iso(today);

  // Last visit date per customer
  const lastVisitMap: Record<string, string> = {};
  finishedAppts.forEach(a => {
    const d = a.startTime?.split('T')[0] || '';
    if (!lastVisitMap[a.customer_id] || d > lastVisitMap[a.customer_id]) {
      lastVisitMap[a.customer_id] = d;
    }
  });

  // Lost clients: last visit > 60 days ago (or no visit at all)
  const lostClients = customers
    .filter(c => {
      const last = lastVisitMap[c.id];
      if (!last) return false; // never visited = not tracked here
      const daysSince = Math.round((today.getTime() - new Date(last).getTime()) / 86400000);
      return daysSince > 60;
    })
    .map(c => ({
      ...c,
      daysSince: Math.round((today.getTime() - new Date(lastVisitMap[c.id]).getTime()) / 86400000),
      lastVisit: lastVisitMap[c.id]
    }))
    .sort((a, b) => b.daysSince - a.daysSince);

  // Visit count per customer
  const visitCountMap: Record<string, number> = {};
  finishedAppts.forEach(a => {
    visitCountMap[a.customer_id] = (visitCountMap[a.customer_id] || 0) + 1;
  });

  // Top 10 most frequent customers
  const topCustomers = customers
    .filter(c => visitCountMap[c.id])
    .map(c => ({ ...c, visits: visitCountMap[c.id] || 0 }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 10);

  // Return rate: % of customers with 2+ visits
  const visitedCount = Object.values(visitCountMap).filter(v => v >= 1).length;
  const returningCount = Object.values(visitCountMap).filter(v => v >= 2).length;
  const returnRate = visitedCount > 0 ? Math.round(returningCount / visitedCount * 100) : 0;

  // Avg ticket across all finished appointments
  const paidAppts = finishedAppts.filter(a => a.amountPaid && a.amountPaid > 0);
  const avgTicket = paidAppts.length > 0
    ? paidAppts.reduce((s, a) => s + (a.amountPaid || 0), 0) / paidAppts.length
    : 0;

  // Avg return frequency (avg days between consecutive visits for returning customers)
  let totalIntervalDays = 0;
  let intervalCount = 0;
  customers.forEach(c => {
    const visits = finishedAppts
      .filter(a => a.customer_id === c.id)
      .map(a => a.startTime?.split('T')[0] || '')
      .filter(Boolean)
      .sort();
    if (visits.length >= 2) {
      for (let i = 1; i < visits.length; i++) {
        const diff = Math.round((new Date(visits[i]).getTime() - new Date(visits[i - 1]).getTime()) / 86400000);
        if (diff > 0) { totalIntervalDays += diff; intervalCount++; }
      }
    }
  });
  const avgFrequency = intervalCount > 0 ? Math.round(totalIntervalDays / intervalCount) : 0;

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl sm:text-3xl font-black text-black uppercase tracking-tight">Base de Clientes</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Histórico e preferências</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {activeTab === 'lista' && importResult && (
            <span className="text-[9px] font-black uppercase tracking-widest text-green-600 bg-green-50 px-4 py-2 rounded-xl border border-green-100">
              ✅ {importResult.ok} importados {importResult.fail > 0 ? `/ ⚠️ ${importResult.fail} ignorados` : ''}
            </span>
          )}
          {activeTab === 'lista' && importProgress && (
            <span className="text-[9px] font-black uppercase tracking-widest text-orange-600 bg-orange-50 px-4 py-2 rounded-xl border border-orange-100">
              ⏳ {importProgress.done}/{importProgress.total}
            </span>
          )}
          {activeTab === 'lista' && (
            <>
              <label className={`cursor-pointer bg-white border-2 border-slate-200 text-slate-600 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:border-orange-500 hover:text-orange-500 transition-all ${importing ? 'opacity-50 pointer-events-none' : ''}`}>
                {importing ? `Importando${importProgress ? ` ${importProgress.done}/${importProgress.total}` : '...'}` : '↑ Importar CSV'}
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportCSV} disabled={importing} />
              </label>
              <button onClick={() => setShowAddModal(true)} className="bg-orange-500 text-white px-5 sm:px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-100 hover:scale-105 transition-all">
                + Novo Cliente
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex bg-slate-100 rounded-xl p-1 gap-0.5 w-fit">
        {([['lista', 'Lista'], ['retencao', 'Retenção']] as const).map(([v, l]) => (
          <button key={v} onClick={() => setActiveTab(v)}
            className={`px-6 py-2 rounded-lg text-xs font-black transition-all ${activeTab === v ? 'bg-black text-white shadow-sm' : 'text-slate-500 hover:text-black'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* ─── TAB: Lista ───────────────────────────────────────────── */}
      {activeTab === 'lista' && (
        <>
          <div className="bg-white p-6 border-2 border-slate-100 rounded-[30px] shadow-xl shadow-slate-100/50">
            <input
              placeholder="PESQUISAR POR NOME OU WHATSAPP..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full p-5 bg-slate-50 border-2 border-transparent outline-none text-xs font-black uppercase tracking-widest rounded-2xl focus:border-orange-500 transition-all"
            />
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            {filteredCustomers.length === 0 ? (
              <div className="py-20 text-center text-slate-300 text-sm font-semibold">
                {searchTerm ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado.'}
              </div>
            ) : (() => {
              const rows: React.ReactNode[] = [];
              let lastLetter = '';
              filteredCustomers.forEach((c, i) => {
                const letter = c.name.charAt(0).toUpperCase();
                if (letter !== lastLetter) {
                  lastLetter = letter;
                  rows.push(
                    <div key={`sep-${letter}`} className="px-4 py-1.5 bg-slate-50 border-b border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{letter}</span>
                    </div>
                  );
                }
                const planName = getPlanName(c.planId);
                const avisoName = getModeName(c.avisoModeId, avisoModes);
                const lembreteName = getModeName(c.lembreteModeId, lembreteModes);
                const reativacaoName = getModeName(c.reativacaoModeId, reativacaoModes);
                const hasRecurring = (c.recurringEntries || []).some(e => e.active);
                rows.push(
                  <div key={c.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors"
                    style={{ borderTop: '1px solid #F1F5F9' }}
                    onClick={() => { setProfileTab('perfil'); setEditingCustomer({ ...c }); }}>
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-orange-500">{c.name.charAt(0).toUpperCase()}</span>
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 leading-tight truncate">{c.name}</p>
                      <p className="text-xs text-slate-400">{c.phone}</p>
                    </div>
                    {/* Badges */}
                    <div className="hidden sm:flex items-center gap-1.5 flex-wrap justify-end">
                      {planName && (() => {
                        const st = c.planStatus || 'ativo';
                        const cls = st === 'ativo' ? 'bg-green-50 text-green-700' : st === 'pendente' ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700';
                        return <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{planName}</span>;
                      })()}
                      {avisoName && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-600">Aviso</span>}
                      {lembreteName && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Lembrete</span>}
                      {reativacaoName && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-700">Reativação</span>}
                      {hasRecurring && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Recorrente</span>}
                    </div>
                    <svg className="w-4 h-4 text-slate-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </div>
                );
              });
              return rows;
            })()}
          </div>
        </>
      )}

      {/* ─── TAB: Retenção ────────────────────────────────────────── */}
      {activeTab === 'retencao' && (
        <div className="space-y-6">
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Taxa de Retorno</p>
              <p className="text-xl sm:text-3xl font-black text-black leading-none">{returnRate}%</p>
              <p className="text-[10px] text-slate-400 mt-1">clientes com 2+ visitas</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Ticket Médio</p>
              <p className="text-xl sm:text-3xl font-black text-black leading-none">R$ {avgTicket.toFixed(0)}</p>
              <p className="text-[10px] text-slate-400 mt-1">por atendimento finalizado</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Frequência Média</p>
              <p className="text-xl sm:text-3xl font-black text-black leading-none">{avgFrequency > 0 ? `${avgFrequency}d` : '—'}</p>
              <p className="text-[10px] text-slate-400 mt-1">dias entre visitas</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Inativos +60d</p>
              <p className={`text-xl sm:text-3xl font-black leading-none ${lostClients.length > 0 ? 'text-red-500' : 'text-black'}`}>{lostClients.length}</p>
              <p className="text-[10px] text-slate-400 mt-1">clientes sem visitar</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Clientes Perdidos */}
            <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h3 className="font-black text-sm text-black">Clientes Inativos</h3>
                <p className="text-xs text-slate-400">Sem visita há mais de 60 dias</p>
              </div>
              {lostClients.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <p className="text-sm text-slate-400">Nenhum cliente inativo no momento</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
                  {lostClients.map(c => (
                    <div key={c.id} className="px-6 py-3 flex items-center justify-between hover:bg-slate-50">
                      <div>
                        <p className="text-sm font-bold text-black">{c.name}</p>
                        <p className="text-[10px] text-slate-400">{c.phone}</p>
                      </div>
                      <div className="text-right">
                        <span className={`text-xs font-black px-3 py-1 rounded-full ${c.daysSince > 120 ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'}`}>
                          {c.daysSince}d sem visita
                        </span>
                        <p className="text-[10px] text-slate-400 mt-1">última: {c.lastVisit}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top Clientes */}
            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h3 className="font-black text-sm text-black">Mais Frequentes</h3>
                <p className="text-xs text-slate-400">Top 10 por visitas</p>
              </div>
              {topCustomers.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <p className="text-sm text-slate-400">Sem dados</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {topCustomers.map((c, i) => (
                    <div key={c.id} className="px-6 py-3 flex items-center justify-between hover:bg-slate-50">
                      <div className="flex items-center gap-3">
                        <span className={`text-[10px] font-black w-5 text-center ${i === 0 ? 'text-yellow-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-orange-400' : 'text-slate-300'}`}>
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-xs font-bold text-black leading-tight">{c.name}</p>
                          <p className="text-[10px] text-slate-400">{c.phone}</p>
                        </div>
                      </div>
                      <span className="text-xs font-black text-black">{c.visits}x</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Add Modal ──────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex justify-center items-start min-h-full p-6 pt-10 pb-10">
          <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp">
            <h2 className="text-3xl font-black text-black uppercase tracking-tight">Novo Cliente</h2>
            <div className="space-y-6">
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome Completo" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold" />
              <input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="WhatsApp (55...)" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold" />
            </div>
            <div className="flex gap-4 pt-4">
              <button onClick={() => setShowAddModal(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs" disabled={saving}>Voltar</button>
              <button onClick={handleAdd} disabled={saving} className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-orange-500 transition-all disabled:opacity-50">
                {saving ? 'Gravando...' : 'Salvar'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* ─── Profile Modal ──────────────────────────── */}
      {editingCustomer && (() => {
        const DAY_NAMES = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const DAY_FULL  = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
        const FREQ_LABELS: Record<RecurringFrequency, string> = {
          weekly:'Toda semana', biweekly:'A cada 2 semanas', triweekly:'A cada 3 semanas', alternating:'Alternada',
        };
        const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
          FINISHED:  { label: 'Realizado', cls: 'bg-green-100 text-green-700' },
          CONFIRMED: { label: 'Confirmado', cls: 'bg-blue-100 text-blue-700' },
          PENDING:   { label: 'Pendente', cls: 'bg-yellow-100 text-yellow-700' },
          CANCELLED: { label: 'Cancelado', cls: 'bg-red-100 text-red-700' },
          cancelado: { label: 'Cancelado', cls: 'bg-red-100 text-red-700' },
          NO_SHOW:   { label: 'Faltou', cls: 'bg-slate-100 text-slate-500' },
        };
        const initials = editingCustomer.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
        const birthDisplay = editingCustomer.birthDate
          ? editingCustomer.birthDate.slice(5).split('-').reverse().join('/') : null;

        return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex justify-center items-start min-h-full p-4 sm:p-6 pt-6 pb-10">
            <div className="bg-white rounded-[40px] w-full max-w-2xl animate-scaleUp overflow-hidden">

              {/* ── Header ── */}
              <div style={{ borderBottom: '1px solid #E2E8F0' }}>
                {/* Orange accent top bar */}
                <div style={{ height: 3, background: 'var(--color-primary)' }} />
                <div className="p-5 sm:p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 bg-orange-100 rounded-2xl flex items-center justify-center text-xl font-black text-orange-500 shrink-0">{initials}</div>
                      <div>
                        <h2 className="text-lg sm:text-xl font-bold text-slate-900 leading-tight">{editingCustomer.name}</h2>
                        <p className="text-orange-500 font-semibold text-sm mt-0.5">{editingCustomer.phone}</p>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          {editingCustomer.email && <span className="text-slate-400 text-xs">{editingCustomer.email}</span>}
                          {birthDisplay && <span className="text-slate-400 text-xs">🎂 {birthDisplay}</span>}
                        </div>
                      </div>
                    </div>
                    <button onClick={() => setEditingCustomer(null)} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors shrink-0 text-base">✕</button>
                  </div>
                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Atendimentos', value: customerStats?.count ?? 0 },
                      { label: 'Total gasto', value: customerStats ? `R$ ${customerStats.totalSpent.toFixed(0)}` : 'R$ 0' },
                      { label: 'Última visita', value: customerStats?.lastDate ? customerStats.lastDate.split('-').reverse().join('/') : '—' },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-slate-50 rounded-xl px-3 py-2.5 text-center">
                        <p className="text-slate-800 font-bold text-base leading-none">{value}</p>
                        <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-wider mt-1">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Tab bar ── */}
              <div className="flex border-b border-slate-100">
                {(['perfil', 'config'] as const).map(t => (
                  <button key={t} onClick={() => setProfileTab(t)}
                    className={`flex-1 py-3 font-semibold text-xs transition-all ${profileTab === t ? 'border-b-2 border-orange-500 text-orange-500' : 'text-slate-400 hover:text-slate-600'}`}>
                    {t === 'perfil' ? 'Perfil' : 'Configurações'}
                  </button>
                ))}
              </div>

              <div className="p-6 sm:p-8 space-y-6 max-h-[60vh] overflow-y-auto">

              {/* ══ PERFIL TAB ══════════════════════════════════════ */}
              {profileTab === 'perfil' && (
                <div className="space-y-6">
                  {/* Personal data fields */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nome Completo</label>
                      <input value={editingCustomer.name} onChange={e => setEditingCustomer({ ...editingCustomer, name: e.target.value })}
                        placeholder="Nome Completo" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500 transition-all" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">WhatsApp</label>
                      <input value={editingCustomer.phone} onChange={e => setEditingCustomer({ ...editingCustomer, phone: e.target.value })}
                        placeholder="5511..." className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500 transition-all" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">E-mail</label>
                      <input type="email" value={editingCustomer.email || ''} onChange={e => setEditingCustomer({ ...editingCustomer, email: e.target.value })}
                        placeholder="cliente@email.com" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500 transition-all" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Data de Aniversário</label>
                      <input type="date" value={editingCustomer.birthDate || ''} onChange={e => setEditingCustomer({ ...editingCustomer, birthDate: e.target.value })}
                        className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500 transition-all" />
                    </div>
                  </div>

                  {/* Service history */}
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">📋 Histórico de Serviços</p>
                    {customerHistory.length === 0 ? (
                      <div className="text-center py-10 bg-slate-50 rounded-2xl">
                        <p className="text-slate-400 text-sm font-bold">Nenhum atendimento registrado</p>
                      </div>
                    ) : (
                      <div className="rounded-2xl border-2 border-slate-100 overflow-hidden">
                        <div className="grid grid-cols-[1fr_1.2fr_1fr_auto_auto] gap-0 text-[9px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-4 py-3">
                          <span>Data</span><span>Serviço</span><span>Profissional</span><span className="text-right">Valor</span><span className="text-right">Status</span>
                        </div>
                        <div className="divide-y divide-slate-50">
                          {customerHistory.map(a => {
                            const st = STATUS_LABELS[a.status] || { label: a.status, cls: 'bg-slate-100 text-slate-500' };
                            const dateStr = a.startTime ? new Date(a.startTime).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '—';
                            return (
                              <div key={a.id} className="grid grid-cols-[1fr_1.2fr_1fr_auto_auto] gap-2 items-center px-4 py-3 hover:bg-slate-50 transition-all">
                                <span className="text-xs font-bold text-slate-700">{dateStr}</span>
                                <span className="text-xs font-bold text-black truncate">{a.serviceName}</span>
                                <span className="text-xs text-slate-500 truncate">{a.professionalName}</span>
                                <span className="text-xs font-black text-right text-black">{a.amountPaid ? `R$\u00a0${a.amountPaid.toFixed(0)}` : '—'}</span>
                                <span className={`text-[9px] font-black px-2 py-1 rounded-full whitespace-nowrap ${st.cls}`}>{st.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ══ CONFIG TAB ══════════════════════════════════════ */}
              {profileTab === 'config' && (
              <div className="space-y-5">

              {/* ─── Histórico de Consumo ─── */}
              {customerStats && (
                <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-2xl p-5 space-y-3 border border-orange-100">
                  <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">📊 Histórico de Consumo</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="text-center">
                      <p className="text-xl font-black text-black">{customerStats.count}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase">Atendimentos</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-black text-black">R$ {customerStats.totalSpent.toFixed(0)}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase">Faturamento</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-black text-black">{customerStats.lastDate ? customerStats.lastDate.split('-').reverse().join('/') : '—'}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase">Último</p>
                    </div>
                  </div>
                </div>
              )}

              {/* ─── Plano ─── */}
              {plans.length > 0 && (
                <div className="bg-blue-50 rounded-2xl p-5 space-y-3">
                  <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">📦 Plano</p>
                  <select
                    value={editingCustomer.planId || ''}
                    onChange={e => {
                      const newPlanId = e.target.value || null;
                      setEditingCustomer({
                        ...editingCustomer,
                        planId: newPlanId,
                        planStatus: newPlanId ? (editingCustomer.planStatus || 'ativo') : undefined
                      });
                    }}
                    className="w-full p-4 bg-white border-2 border-blue-100 rounded-2xl font-bold outline-none focus:border-blue-500"
                  >
                    <option value="">Sem plano</option>
                    {plans.map(p => {
                      const quotaText = p.quotas.length > 0
                        ? p.quotas.map(q => `${q.quantity}x ${services.find(s => s.id === q.serviceId)?.name || '?'}`).join(', ')
                        : (p.proceduresPerMonth > 0 ? `${p.proceduresPerMonth} proc.` : 'ilimitado');
                      return (
                        <option key={p.id} value={p.id}>
                          {p.name} — R$ {p.price.toFixed(2)}/mês ({quotaText})
                        </option>
                      );
                    })}
                  </select>

                  {/* Plan status + balance + renew */}
                  {editingCustomer.planId && (
                    <div className="space-y-3">
                      {/* Status dropdown */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest ml-1">Status do Plano</label>
                        <div className="flex gap-2">
                          <select
                            value={editingCustomer.planStatus || 'ativo'}
                            onChange={e => setEditingCustomer({ ...editingCustomer, planStatus: e.target.value as PlanStatus })}
                            className="flex-1 p-4 bg-white border-2 border-blue-100 rounded-2xl font-bold outline-none focus:border-blue-500"
                          >
                            <option value="ativo">Ativo</option>
                            <option value="pendente">Pendente</option>
                            <option value="cancelado">Cancelado</option>
                          </select>
                          {(() => {
                            const st = editingCustomer.planStatus || 'ativo';
                            const colors = st === 'ativo' ? 'bg-green-500' : st === 'pendente' ? 'bg-yellow-500' : 'bg-red-500';
                            return <span className={`w-4 h-4 rounded-full self-center ${colors}`} />;
                          })()}
                        </div>
                      </div>

                      {/* Balance per service */}
                      {Object.keys(planBalance).length > 0 && (
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest ml-1">Saldo do Plano</label>
                          <div className="grid gap-2">
                            {Object.entries(planBalance).map(([svcId, b]: [string, { total: number; used: number; remaining: number }]) => {
                              const svcName = services.find(s => s.id === svcId)?.name || svcId;
                              const pct = b.total > 0 ? (b.used / b.total) * 100 : 0;
                              return (
                                <div key={svcId} className="bg-white rounded-xl px-4 py-3 border border-blue-100">
                                  <div className="flex justify-between items-center mb-1">
                                    <span className="text-xs font-black text-blue-700">{svcName}</span>
                                    <span className="text-xs font-black text-blue-500">{b.used}/{b.total}</span>
                                  </div>
                                  <div className="w-full bg-blue-100 rounded-full h-2">
                                    <div className={`h-2 rounded-full transition-all ${pct >= 100 ? 'bg-red-500' : pct >= 75 ? 'bg-yellow-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                                  </div>
                                  <p className="text-[9px] font-bold text-blue-400 mt-1">{b.remaining} restante{b.remaining !== 1 ? 's' : ''}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Renew button */}
                      <button
                        type="button"
                        disabled={renewingPlan}
                        onClick={async () => {
                          if (!confirm('Renovar plano? Isso zera o saldo de uso do cliente.')) return;
                          setRenewingPlan(true);
                          try {
                            await db.resetPlanUsage(tenantId, editingCustomer.id);
                            await db.updateCustomer(tenantId, editingCustomer.id, { planStatus: 'ativo' as PlanStatus });
                            setEditingCustomer({ ...editingCustomer, planStatus: 'ativo' });
                            const bal = await db.getPlanBalance(tenantId, editingCustomer.id);
                            setPlanBalance(bal);
                          } catch (err: any) {
                            alert('Erro ao renovar: ' + (err.message || ''));
                          } finally {
                            setRenewingPlan(false);
                          }
                        }}
                        className="w-full py-3 bg-blue-500 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-600 transition-all disabled:opacity-50"
                      >
                        {renewingPlan ? 'Renovando...' : '🔄 Renovar Plano (Zerar Saldo)'}
                      </button>
                    </div>
                  )}

                  {/* ─── Recorrências ─── */}
                  {editingCustomer.planId && (() => {
                    const maxOffset = addEntry.frequency === 'triweekly' ? 3 : 2;
                    const offsetLabels = ['A','B','C'];
                    const entries: RecurringEntry[] = editingCustomer.recurringEntries || [];

                    const removeEntry = (id: string) =>
                      setEditingCustomer({ ...editingCustomer, recurringEntries: entries.filter(e => e.id !== id) });

                    const handleAddEntry = () => {
                      if (!addEntry.professionalId || !addEntry.serviceId || !addEntry.time) return;
                      const newEntry: RecurringEntry = {
                        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
                        professionalId: addEntry.professionalId,
                        serviceId: addEntry.serviceId,
                        dayOfWeek: addEntry.dayOfWeek,
                        time: addEntry.time,
                        repeat: addEntry.repeat,
                        frequency: addEntry.repeat ? addEntry.frequency : undefined,
                        weekOffset: (addEntry.repeat && addEntry.frequency !== 'weekly') ? addEntry.weekOffset : undefined,
                        price: addEntry.price ? Number(addEntry.price) : undefined,
                        active: true,
                      };
                      setEditingCustomer({ ...editingCustomer, recurringEntries: [...entries, newEntry] });
                      setShowAddEntry(false);
                      setAddEntry({ professionalId: professionals[0]?.id || '', serviceId: '', dayOfWeek: 1, time: '09:00', repeat: true, frequency: 'weekly', weekOffset: 0, price: '' });
                    };

                    return (
                      <div className="border-t-2 border-blue-100 pt-4 space-y-3">
                        <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">🔄 Recorrências</p>

                        {/* Entry list */}
                        {entries.length > 0 && (
                          <div className="space-y-2">
                            {entries.map(e => {
                              const prof = professionals.find(p => p.id === e.professionalId);
                              const svc  = services.find(s => s.id === e.serviceId);
                              const freqLabel = e.repeat && e.frequency
                                ? (e.weekOffset !== undefined && e.frequency !== 'weekly'
                                    ? `${FREQ_LABELS[e.frequency]} · Sem.${offsetLabels[e.weekOffset] ?? 'A'}`
                                    : FREQ_LABELS[e.frequency])
                                : 'Única vez';
                              return (
                                <div key={e.id} className="flex items-start justify-between bg-blue-50 px-4 py-3 rounded-xl border border-blue-100 gap-2">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-black text-blue-800 truncate">
                                      {prof?.name || '—'} · {svc?.name || '—'}
                                    </p>
                                    <p className="text-[10px] font-bold text-blue-500 mt-0.5">
                                      {DAY_NAMES[e.dayOfWeek]} {e.time} · {freqLabel}
                                      {e.price ? ` · R$ ${e.price.toFixed(2)}` : ''}
                                    </p>
                                  </div>
                                  <button type="button" onClick={() => removeEntry(e.id)} className="text-red-400 hover:text-red-600 font-black text-sm flex-shrink-0">✕</button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Add entry form */}
                        {showAddEntry ? (
                          <div className="bg-blue-50 border-2 border-blue-100 rounded-2xl p-4 space-y-3">
                            <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest">Nova recorrência</p>

                            {/* Prof + Service */}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <label className="text-[9px] font-black text-blue-400 uppercase tracking-widest ml-1">Profissional</label>
                                <select value={addEntry.professionalId}
                                  onChange={e => setAddEntry(p => ({ ...p, professionalId: e.target.value }))}
                                  className="w-full p-2.5 bg-white border-2 border-blue-100 rounded-xl font-bold text-xs outline-none focus:border-blue-400">
                                  <option value="">Selecione</option>
                                  {professionals.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-black text-blue-400 uppercase tracking-widest ml-1">Serviço</label>
                                <select value={addEntry.serviceId}
                                  onChange={e => setAddEntry(p => ({ ...p, serviceId: e.target.value }))}
                                  className="w-full p-2.5 bg-white border-2 border-blue-100 rounded-xl font-bold text-xs outline-none focus:border-blue-400">
                                  <option value="">Selecione</option>
                                  {services.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                              </div>
                            </div>

                            {/* Day + Time */}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <label className="text-[9px] font-black text-blue-400 uppercase tracking-widest ml-1">Dia</label>
                                <select value={addEntry.dayOfWeek}
                                  onChange={e => setAddEntry(p => ({ ...p, dayOfWeek: Number(e.target.value) }))}
                                  className="w-full p-2.5 bg-white border-2 border-blue-100 rounded-xl font-bold text-xs outline-none focus:border-blue-400">
                                  {DAY_FULL.map((d, i) => <option key={i} value={i}>{d}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-black text-blue-400 uppercase tracking-widest ml-1">Horário</label>
                                <input type="time" value={addEntry.time}
                                  onChange={e => setAddEntry(p => ({ ...p, time: e.target.value }))}
                                  className="w-full p-2.5 bg-white border-2 border-blue-100 rounded-xl font-bold text-xs outline-none focus:border-blue-400" />
                              </div>
                            </div>

                            {/* Repeat toggle */}
                            <div className="flex items-center gap-3">
                              <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Repetir</p>
                              {['Não','Sim'].map((label, i) => (
                                <button key={i} type="button"
                                  onClick={() => setAddEntry(p => ({ ...p, repeat: i === 1 }))}
                                  className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ${addEntry.repeat === (i === 1) ? 'bg-blue-500 text-white' : 'bg-white text-blue-400 border border-blue-200'}`}>
                                  {label}
                                </button>
                              ))}
                            </div>

                            {addEntry.repeat && (
                              <>
                                {/* Frequency */}
                                <div className="space-y-1">
                                  <label className="text-[9px] font-black text-blue-400 uppercase tracking-widest ml-1">Frequência</label>
                                  <div className="flex flex-wrap gap-1.5">
                                    {(['weekly','biweekly','triweekly','alternating'] as RecurringFrequency[]).map(f => (
                                      <button key={f} type="button"
                                        onClick={() => setAddEntry(p => ({ ...p, frequency: f, weekOffset: 0 }))}
                                        className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all ${addEntry.frequency === f ? 'bg-blue-500 text-white' : 'bg-white text-blue-400 border border-blue-200 hover:border-blue-400'}`}>
                                        {FREQ_LABELS[f]}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Week offset (for biweekly, triweekly, alternating) */}
                                {addEntry.frequency !== 'weekly' && (
                                  <div className="space-y-1">
                                    <label className="text-[9px] font-black text-blue-400 uppercase tracking-widest ml-1">
                                      Semana (para intercalar com outras recorrências)
                                    </label>
                                    <div className="flex gap-1.5">
                                      {Array.from({ length: maxOffset }, (_, i) => (
                                        <button key={i} type="button"
                                          onClick={() => setAddEntry(p => ({ ...p, weekOffset: i }))}
                                          className={`w-10 h-10 rounded-xl text-xs font-black transition-all ${addEntry.weekOffset === i ? 'bg-blue-500 text-white' : 'bg-white text-blue-400 border border-blue-200 hover:border-blue-400'}`}>
                                          {offsetLabels[i]}
                                        </button>
                                      ))}
                                    </div>
                                    <p className="text-[9px] text-blue-400 ml-1">
                                      Ex: Cabelo+Barba na Sem.A, Cabelo na Sem.B → alternância automática
                                    </p>
                                  </div>
                                )}

                                {/* Price */}
                                <div className="space-y-1">
                                  <label className="text-[9px] font-black text-blue-400 uppercase tracking-widest ml-1">Valor por sessão (R$)</label>
                                  <input type="number" min="0" step="0.01" placeholder="0,00"
                                    value={addEntry.price}
                                    onChange={e => setAddEntry(p => ({ ...p, price: e.target.value }))}
                                    className="w-full p-2.5 bg-white border-2 border-blue-100 rounded-xl font-bold text-xs outline-none focus:border-blue-400" />
                                </div>
                              </>
                            )}

                            <div className="flex gap-2 pt-1">
                              <button type="button" onClick={handleAddEntry}
                                disabled={!addEntry.professionalId || !addEntry.serviceId || !addEntry.time}
                                className="flex-1 py-2.5 bg-blue-500 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-600 transition-all disabled:opacity-40">
                                Adicionar
                              </button>
                              <button type="button" onClick={() => setShowAddEntry(false)}
                                className="px-4 py-2.5 bg-white border-2 border-slate-200 text-slate-500 rounded-xl font-black text-xs hover:border-slate-400 transition-all">
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => {
                            setShowAddEntry(true);
                            setAddEntry(p => ({ ...p, professionalId: professionals[0]?.id || '' }));
                          }}
                            className="w-full py-2.5 border-2 border-dashed border-blue-200 text-blue-500 rounded-xl font-black text-xs uppercase tracking-widest hover:border-blue-400 hover:bg-blue-50 transition-all">
                            + Adicionar recorrência
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ─── Modos de Follow-up ─── */}
              {hasModes && (
                <div className="bg-slate-50 rounded-2xl p-5 space-y-4">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">🎯 Modos de Lembrete</p>

                  {avisoModes.length > 0 && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-yellow-600 uppercase tracking-widest ml-1">📢 Check-in Diário</label>
                      <select
                        value={editingCustomer.avisoModeId || 'standard'}
                        onChange={e => setEditingCustomer({ ...editingCustomer, avisoModeId: e.target.value })}
                        className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500"
                      >
                        <option value="standard">Padrão</option>
                        {avisoModes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                  )}

                  {lembreteModes.length > 0 && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-purple-600 uppercase tracking-widest ml-1">🕒 Lembrete Próximo</label>
                      <select
                        value={editingCustomer.lembreteModeId || 'standard'}
                        onChange={e => setEditingCustomer({ ...editingCustomer, lembreteModeId: e.target.value })}
                        className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500"
                      >
                        <option value="standard">Padrão</option>
                        {lembreteModes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                  )}

                  {reativacaoModes.length > 0 && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-green-600 uppercase tracking-widest ml-1">♻️ Recuperação</label>
                      <select
                        value={editingCustomer.reativacaoModeId || 'standard'}
                        onChange={e => setEditingCustomer({ ...editingCustomer, reativacaoModeId: e.target.value })}
                        className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500"
                      >
                        <option value="standard">Padrão</option>
                        {reativacaoModes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                  )}

                  {!hasModes && (
                    <p className="text-[9px] font-bold text-slate-300 uppercase">Crie modos em Lembretes para atribuir aqui</p>
                  )}
                </div>
              )}
              </div>
              )}

              </div>

              {/* ── Footer ── */}
              <div className="flex gap-4 px-6 sm:px-8 pb-8 pt-2">
                <button onClick={() => setEditingCustomer(null)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs rounded-2xl hover:bg-slate-50 transition-all" disabled={saving}>Fechar</button>
                <button onClick={handleSaveEdit} disabled={saving} className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-orange-500 transition-all disabled:opacity-50 shadow-xl shadow-slate-200">
                  {saving ? 'Gravando...' : 'Salvar'}
                </button>
              </div>

            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
};

export default CustomersView;
