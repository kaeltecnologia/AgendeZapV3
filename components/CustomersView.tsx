
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { Customer, Plan, PlanStatus, Service, FollowUpNamedMode, Professional, RecurringSchedule, AppointmentStatus } from '../types';

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
  const [addSlotDay, setAddSlotDay] = useState<number>(1);
  const [addSlotTime, setAddSlotTime] = useState<string>('09:00');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: number; fail: number } | null>(null);
  const [planBalance, setPlanBalance] = useState<Record<string, { total: number; used: number; remaining: number }>>({});
  const [renewingPlan, setRenewingPlan] = useState(false);

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

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone.includes(searchTerm)
  );

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
        avisoModeId: editingCustomer.avisoModeId,
        lembreteModeId: editingCustomer.lembreteModeId,
        reativacaoModeId: editingCustomer.reativacaoModeId,
        planId: editingCustomer.planId,
        planStatus: editingCustomer.planStatus as PlanStatus | undefined,
        planServiceId: editingCustomer.planServiceId,
        recurringSchedule: editingCustomer.recurringSchedule
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
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      // Detect separator: semicolon (BR Excel) or comma
      const sep = lines[0]?.includes(';') ? ';' : ',';
      let ok = 0, fail = 0;
      for (const line of lines) {
        const cols = line.split(sep).map(c => c.replace(/^"|"$/g, '').trim());
        const name = cols[0] || '';
        const phone = (cols[1] || '').replace(/\D/g, '');
        if (!name || phone.length < 10) { fail++; continue; }
        try {
          await db.addCustomer({ tenant_id: tenantId, name, phone, active: true });
          ok++;
        } catch { fail++; }
      }
      setImportResult({ ok, fail });
      await load();
    } catch (err: any) {
      alert('Erro ao importar: ' + (err.message || 'Erro desconhecido'));
    } finally {
      setImporting(false);
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
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Base de Clientes</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Histórico e preferências</p>
        </div>
        <div className="flex items-center gap-3">
          {activeTab === 'lista' && importResult && (
            <span className="text-[9px] font-black uppercase tracking-widest text-green-600 bg-green-50 px-4 py-2 rounded-xl border border-green-100">
              ✅ {importResult.ok} importados {importResult.fail > 0 ? `/ ⚠️ ${importResult.fail} falhas` : ''}
            </span>
          )}
          {activeTab === 'lista' && (
            <>
              <label className={`cursor-pointer bg-white border-2 border-slate-200 text-slate-600 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:border-orange-500 hover:text-orange-500 transition-all ${importing ? 'opacity-50 pointer-events-none' : ''}`}>
                {importing ? 'Importando...' : '↑ Importar CSV'}
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportCSV} disabled={importing} />
              </label>
              <button onClick={() => setShowAddModal(true)} className="bg-orange-500 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-100 hover:scale-105 transition-all">
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

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredCustomers.map(c => {
              const planName = getPlanName(c.planId);
              const avisoName = getModeName(c.avisoModeId, avisoModes);
              const lembreteName = getModeName(c.lembreteModeId, lembreteModes);
              const reativacaoName = getModeName(c.reativacaoModeId, reativacaoModes);
              return (
                <div key={c.id} className="bg-white p-10 rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 relative group hover:border-black transition-all">
                  <div className="absolute top-10 right-10">
                    <button onClick={() => setEditingCustomer({ ...c })} className="text-slate-300 hover:text-orange-500 transition-all font-black text-xs uppercase tracking-widest">EDITAR</button>
                  </div>
                  <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center text-3xl mb-6 group-hover:bg-orange-50 transition-all">👤</div>
                  <h3 className="text-xl font-black text-black mb-1 pr-16 leading-tight uppercase tracking-tight">{c.name}</h3>
                  <p className="text-xs font-black text-orange-500 mb-4">{c.phone}</p>
                  <div className="flex flex-wrap gap-2">
                    {planName && (() => {
                      const st = c.planStatus || 'ativo';
                      const colors = st === 'ativo' ? 'bg-green-100 text-green-700' : st === 'pendente' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700';
                      return (
                        <span className={`text-[8px] font-black px-3 py-1 rounded-full ${colors} uppercase tracking-widest`}>
                          📦 {planName} ({st})
                        </span>
                      );
                    })()}
                    {avisoName && (
                      <span className="text-[8px] font-black px-3 py-1 rounded-full bg-yellow-100 text-yellow-700 uppercase tracking-widest">
                        📢 {avisoName}
                      </span>
                    )}
                    {lembreteName && (
                      <span className="text-[8px] font-black px-3 py-1 rounded-full bg-purple-100 text-purple-700 uppercase tracking-widest">
                        🕒 {lembreteName}
                      </span>
                    )}
                    {reativacaoName && (
                      <span className="text-[8px] font-black px-3 py-1 rounded-full bg-green-100 text-green-700 uppercase tracking-widest">
                        ♻️ {reativacaoName}
                      </span>
                    )}
                    {c.recurringSchedule?.enabled && (() => {
                      const dayNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
                      const slotsText = (c.recurringSchedule?.slots || []).map(s => `${dayNames[s.dayOfWeek]} ${s.time}`).join(', ');
                      return (
                        <span className="text-[8px] font-black px-3 py-1 rounded-full bg-blue-100 text-blue-700 uppercase tracking-widest">
                          🔄 Recorrente {slotsText ? `(${slotsText})` : ''}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ─── TAB: Retenção ────────────────────────────────────────── */}
      {activeTab === 'retencao' && (
        <div className="space-y-6">
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Taxa de Retorno</p>
              <p className="text-3xl font-black text-black leading-none">{returnRate}%</p>
              <p className="text-[10px] text-slate-400 mt-1">clientes com 2+ visitas</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Ticket Médio</p>
              <p className="text-3xl font-black text-black leading-none">R$ {avgTicket.toFixed(0)}</p>
              <p className="text-[10px] text-slate-400 mt-1">por atendimento finalizado</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Frequência Média</p>
              <p className="text-3xl font-black text-black leading-none">{avgFrequency > 0 ? `${avgFrequency}d` : '—'}</p>
              <p className="text-[10px] text-slate-400 mt-1">dias entre visitas</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Inativos +60d</p>
              <p className={`text-3xl font-black leading-none ${lostClients.length > 0 ? 'text-red-500' : 'text-black'}`}>{lostClients.length}</p>
              <p className="text-[10px] text-slate-400 mt-1">clientes sem visitar</p>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-4">
            {/* Clientes Perdidos */}
            <div className="col-span-3 bg-white rounded-2xl border border-slate-100 overflow-hidden">
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
            <div className="col-span-2 bg-white rounded-2xl border border-slate-100 overflow-hidden">
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

      {/* ─── Edit Modal ──────────────────────────── */}
      {editingCustomer && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex justify-center items-start min-h-full p-6 pt-10 pb-10">
            <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp">
            <h2 className="text-3xl font-black text-black uppercase tracking-tight">Editar Cliente</h2>

            <div className="space-y-5">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Nome</label>
                <input value={editingCustomer.name} onChange={e => setEditingCustomer({ ...editingCustomer, name: e.target.value })} placeholder="Nome Completo" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500" />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">WhatsApp</label>
                <input value={editingCustomer.phone} onChange={e => setEditingCustomer({ ...editingCustomer, phone: e.target.value })} placeholder="55..." className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500" />
              </div>

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

                  {/* ─── Agendamento Recorrente ─── */}
                  {editingCustomer.planId && (
                    <div className="border-t-2 border-blue-100 pt-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">🔄 Agendamento Recorrente</p>
                        <button
                          type="button"
                          onClick={() => setEditingCustomer({
                            ...editingCustomer,
                            recurringSchedule: {
                              enabled: !(editingCustomer.recurringSchedule?.enabled),
                              professionalId: editingCustomer.recurringSchedule?.professionalId || professionals[0]?.id || '',
                              serviceId: editingCustomer.recurringSchedule?.serviceId,
                              slots: editingCustomer.recurringSchedule?.slots || []
                            }
                          })}
                          className={`relative w-12 h-6 rounded-full transition-all ${editingCustomer.recurringSchedule?.enabled ? 'bg-blue-500' : 'bg-slate-200'}`}
                        >
                          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${editingCustomer.recurringSchedule?.enabled ? 'left-7' : 'left-1'}`} />
                        </button>
                      </div>

                      {editingCustomer.recurringSchedule?.enabled && (
                        <div className="space-y-3">
                          {/* Professional */}
                          <div className="space-y-1">
                            <label className="text-[9px] font-black text-blue-400 uppercase tracking-widest ml-1">Profissional</label>
                            <select
                              value={editingCustomer.recurringSchedule.professionalId || ''}
                              onChange={e => setEditingCustomer({
                                ...editingCustomer,
                                recurringSchedule: { ...editingCustomer.recurringSchedule!, professionalId: e.target.value }
                              })}
                              className="w-full p-3 bg-white border-2 border-blue-100 rounded-xl font-bold text-sm outline-none focus:border-blue-500"
                            >
                              <option value="">Selecione o profissional</option>
                              {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </div>

                          {/* Override service (optional) */}
                          <div className="space-y-1">
                            <label className="text-[9px] font-black text-blue-400 uppercase tracking-widest ml-1">Serviço (opcional — usa o do plano se vazio)</label>
                            <select
                              value={editingCustomer.recurringSchedule.serviceId || ''}
                              onChange={e => setEditingCustomer({
                                ...editingCustomer,
                                recurringSchedule: { ...editingCustomer.recurringSchedule!, serviceId: e.target.value || undefined }
                              })}
                              className="w-full p-3 bg-white border-2 border-blue-100 rounded-xl font-bold text-sm outline-none focus:border-blue-500"
                            >
                              <option value="">Usar serviço do plano</option>
                              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </div>

                          {/* Configured slots */}
                          {(editingCustomer.recurringSchedule.slots || []).length > 0 && (
                            <div className="space-y-2">
                              <label className="text-[9px] font-black text-blue-400 uppercase tracking-widest ml-1">Horários Fixos</label>
                              {editingCustomer.recurringSchedule.slots.map((slot, idx) => {
                                const dayNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
                                return (
                                  <div key={idx} className="flex items-center justify-between bg-blue-50 px-4 py-2 rounded-xl border border-blue-100">
                                    <span className="text-xs font-black text-blue-700">{dayNames[slot.dayOfWeek]} · {slot.time}</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const newSlots = editingCustomer.recurringSchedule!.slots.filter((_, i) => i !== idx);
                                        setEditingCustomer({ ...editingCustomer, recurringSchedule: { ...editingCustomer.recurringSchedule!, slots: newSlots } });
                                      }}
                                      className="text-red-400 hover:text-red-600 font-black text-xs ml-3"
                                    >✕</button>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Add slot form */}
                          <div className="flex gap-2 items-end">
                            <div className="flex-1 space-y-1">
                              <label className="text-[9px] font-black text-blue-400 uppercase tracking-widest ml-1">Dia</label>
                              <select
                                value={addSlotDay}
                                onChange={e => setAddSlotDay(Number(e.target.value))}
                                className="w-full p-3 bg-white border-2 border-blue-100 rounded-xl font-bold text-sm outline-none"
                              >
                                {['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'].map((d, i) => (
                                  <option key={i} value={i}>{d}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-black text-blue-400 uppercase tracking-widest ml-1">Hora</label>
                              <input
                                type="time"
                                value={addSlotTime}
                                onChange={e => setAddSlotTime(e.target.value)}
                                className="p-3 bg-white border-2 border-blue-100 rounded-xl font-bold text-sm outline-none"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                if (!addSlotTime) return;
                                const newSlots = [...(editingCustomer.recurringSchedule?.slots || []), { dayOfWeek: addSlotDay, time: addSlotTime }];
                                setEditingCustomer({ ...editingCustomer, recurringSchedule: { ...editingCustomer.recurringSchedule!, slots: newSlots } });
                              }}
                              className="py-3 px-4 bg-blue-500 text-white rounded-xl font-black text-xs hover:bg-blue-600 transition-all whitespace-nowrap"
                            >+ Add</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
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

            <div className="flex gap-4 pt-4">
              <button onClick={() => setEditingCustomer(null)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs" disabled={saving}>Voltar</button>
              <button onClick={handleSaveEdit} disabled={saving} className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-orange-500 transition-all disabled:opacity-50">
                {saving ? 'Gravando...' : 'Salvar'}
              </button>
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomersView;
