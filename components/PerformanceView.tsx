
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { AppointmentStatus } from '../types';

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Period = 'this_month' | 'last_month' | 'this_week' | '30d' | '90d';

function getPeriodRange(p: Period): { start: string; end: string; label: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = iso(now);

  if (p === 'this_month') {
    return { start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, end: today, label: 'Este mês' };
  }
  if (p === 'last_month') {
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: iso(lm), end: iso(lmEnd), label: 'Mês passado' };
  }
  if (p === 'this_week') {
    const dow = now.getDay();
    const mon = new Date(now); mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
    return { start: iso(mon), end: today, label: 'Esta semana' };
  }
  if (p === '90d') {
    const d = new Date(now); d.setDate(d.getDate() - 90);
    return { start: iso(d), end: today, label: 'Últimos 90 dias' };
  }
  const d = new Date(now); d.setDate(d.getDate() - 30);
  return { start: iso(d), end: today, label: 'Últimos 30 dias' };
}

const PerformanceView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [activeTab, setActiveTab] = useState<'geral' | 'individual'>('geral');
  const [period, setPeriod] = useState<Period>('this_month');
  const [selectedProId, setSelectedProId] = useState<string>('');

  const [professionals, setProfessionals] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pros, apps, svcs, custs, st] = await Promise.all([
        db.getProfessionals(tenantId),
        db.getAppointments(tenantId),
        db.getServices(tenantId),
        db.getCustomers(tenantId),
        db.getSettings(tenantId),
      ]);
      setProfessionals(pros);
      setAppointments(apps);
      setServices(svcs);
      setCustomers(custs);
      setSettings(st);
      if (pros.length > 0 && !selectedProId) setSelectedProId(pros[0].id);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const range = getPeriodRange(period);

  const inRange = (a: any) => {
    const d = a.startTime?.split('T')[0] || '';
    return d >= range.start && d <= range.end;
  };

  // ── GERAL CALCULATIONS ────────────────────────────────────────────────────

  const profMeta = settings.professionalMeta || {};

  const profStats = professionals.map(p => {
    const proAppts = appointments.filter(a => a.professional_id === p.id && inRange(a));
    const finished = proAppts.filter(a => a.status === AppointmentStatus.FINISHED && !a.isPlan);
    const cancelled = proAppts.filter(a => a.status === AppointmentStatus.CANCELLED);
    const revenue = finished.reduce((s: number, a: any) => s + (a.amountPaid || 0), 0);
    const goal = profMeta[p.id]?.monthlyGoal ?? 0;
    const goalPct = goal > 0 ? Math.min(100, Math.round((finished.length / goal) * 100)) : 0;
    return { ...p, finished: finished.length, cancelled: cancelled.length, revenue, goal, goalPct, proAppts };
  }).sort((a, b) => b.finished - a.finished);

  // Top services
  const svcCount: Record<string, number> = {};
  appointments.filter(a => inRange(a) && a.status === AppointmentStatus.FINISHED).forEach(a => {
    svcCount[a.service_id] = (svcCount[a.service_id] || 0) + 1;
  });
  const topServices = Object.entries(svcCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ name: services.find(s => s.id === id)?.name || 'Serviço', count }));

  const maxFinished = profStats[0]?.finished || 1;

  // ── INDIVIDUAL CALCULATIONS ───────────────────────────────────────────────

  const selPro = professionals.find(p => p.id === selectedProId);
  const selAppts = appointments.filter(a => a.professional_id === selectedProId && inRange(a));
  const selFinished = selAppts.filter(a => a.status === AppointmentStatus.FINISHED && !a.isPlan);
  const selCancelled = selAppts.filter(a => a.status === AppointmentStatus.CANCELLED);
  const selRevenue = selFinished.reduce((s: number, a: any) => s + (a.amountPaid || 0), 0);
  const avgTicket = selFinished.length > 0 ? selRevenue / selFinished.length : 0;

  const commRate = profMeta[selectedProId]?.commissionRate;
  const commission = commRate !== undefined ? selRevenue * commRate / 100 : null;

  const indGoal = profMeta[selectedProId]?.monthlyGoal ?? 0;
  const indGoalPct = indGoal > 0 ? Math.min(100, Math.round((selFinished.length / indGoal) * 100)) : 0;

  // Taxa de retorno (clientes com 2+ atendimentos com este profissional no período)
  const uniqueClientsSet = new Set(selFinished.map((a: any) => a.customer_id));
  const returningClients = [...uniqueClientsSet].filter(cId =>
    selFinished.filter((a: any) => a.customer_id === cId).length >= 2
  ).length;
  const returnRate = uniqueClientsSet.size > 0 ? Math.round(returningClients / uniqueClientsSet.size * 100) : 0;

  // Taxa de no-show: CANCELLED / (FINISHED + CANCELLED + PENDING)
  const selScheduled = selAppts.filter(a => !a.isPlan).length;
  const noShowRate = selScheduled > 0 ? Math.round(selCancelled.length / selScheduled * 100) : 0;

  // All appointments for history (no inRange filter for history — use selAppts already filtered)
  const historyAppts = selAppts.sort((a: any, b: any) => b.startTime.localeCompare(a.startTime)).slice(0, 50);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20">
        <div className="w-8 h-8 border-4 border-slate-100 border-t-black rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-black">Performance</h1>
          <p className="text-xs text-slate-400 mt-0.5">Produtividade e resultado da equipe.</p>
        </div>
        <div className="flex bg-slate-100 rounded-xl p-1 gap-0.5">
          {([
            { v: 'this_week', l: 'Semana' },
            { v: 'this_month', l: 'Mês atual' },
            { v: 'last_month', l: 'Mês anterior' },
            { v: '90d', l: '90 dias' },
          ] as { v: Period; l: string }[]).map(o => (
            <button key={o.v} onClick={() => setPeriod(o.v)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${period === o.v ? 'bg-black text-white shadow-sm' : 'text-slate-500 hover:text-black'}`}>
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 rounded-2xl p-1 gap-1 w-fit">
        {[
          { key: 'geral', label: 'Geral' },
          { key: 'individual', label: 'Individual' },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key as any)}
            className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === t.key ? 'bg-black text-white shadow-sm' : 'text-slate-500 hover:text-black'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── ABA: GERAL ───────────────────────────────────────────────────── */}
      {activeTab === 'geral' && (
        <div className="space-y-6">
          {/* Ranking */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6">
            <h3 className="font-black text-sm text-black mb-1">Ranking — {range.label}</h3>
            <p className="text-xs text-slate-400 mb-5">Ordenado por procedimentos finalizados</p>
            <div className="space-y-4">
              {profStats.map((p, i) => (
                <div key={p.id} className="flex items-center gap-4">
                  <span className="w-6 text-center text-sm font-black text-slate-400">{i + 1}°</span>
                  <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center text-xs font-black shrink-0">
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm font-bold text-black">{p.name}</p>
                      <div className="flex items-center gap-3 text-xs font-bold text-slate-500 shrink-0 ml-2">
                        <span>{p.finished} atend.</span>
                        <span className="text-orange-500">R$ {fmtBRL(p.revenue)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-slate-900 rounded-full"
                          style={{ width: `${maxFinished > 0 ? (p.finished / maxFinished * 100) : 0}%` }} />
                      </div>
                      {p.cancelled > 0 && (
                        <span className="text-[10px] text-red-400 font-bold shrink-0">{p.cancelled} faltas</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {profStats.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Sem dados no período</p>}
            </div>
          </div>

          {/* Top procedimentos + Metas */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <h3 className="font-black text-sm text-black mb-1">Top Procedimentos</h3>
              <p className="text-xs text-slate-400 mb-4">Mais realizados no período</p>
              <div className="space-y-3">
                {topServices.map((s, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-slate-300">#{i + 1}</span>
                      <span className="text-sm font-semibold text-black">{s.name}</span>
                    </div>
                    <span className="text-sm font-black text-black">{s.count}×</span>
                  </div>
                ))}
                {topServices.length === 0 && <p className="text-xs text-slate-400">Sem dados</p>}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <h3 className="font-black text-sm text-black mb-1">Meta de Procedimentos</h3>
              <p className="text-xs text-slate-400 mb-4">Progresso individual</p>
              <div className="space-y-4">
                {profStats.map(p => (
                  <div key={p.id}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-bold text-black truncate">{p.name}</span>
                      <span className="text-xs text-slate-400 shrink-0 ml-2">
                        {p.finished}{p.goal > 0 ? `/${p.goal}` : ''}
                      </span>
                    </div>
                    {p.goal > 0 ? (
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${p.goalPct >= 100 ? 'bg-green-500' : p.goalPct >= 70 ? 'bg-orange-500' : 'bg-red-400'}`}
                          style={{ width: `${p.goalPct}%` }}
                        />
                      </div>
                    ) : (
                      <p className="text-[10px] text-slate-300">Meta não configurada</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Faltas */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6">
            <h3 className="font-black text-sm text-black mb-1">Faltas (Cancelamentos)</h3>
            <p className="text-xs text-slate-400 mb-4">Agendamentos cancelados por profissional</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {profStats.map(p => (
                <div key={p.id} className={`rounded-xl p-4 border ${p.cancelled > 0 ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-slate-50'}`}>
                  <p className="text-xs font-bold text-slate-600 mb-1 truncate">{p.name}</p>
                  <p className={`text-2xl font-black ${p.cancelled > 0 ? 'text-red-500' : 'text-slate-300'}`}>{p.cancelled}</p>
                  <p className="text-[10px] text-slate-400">cancelamentos</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── ABA: INDIVIDUAL ──────────────────────────────────────────────── */}
      {activeTab === 'individual' && (
        <div className="space-y-6">
          {/* Selector */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Profissional:</label>
            <select value={selectedProId} onChange={e => setSelectedProId(e.target.value)}
              className="border-2 border-slate-100 rounded-xl px-4 py-2 text-sm font-bold bg-white text-slate-700 outline-none focus:border-black">
              {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {selPro && (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {/* Comissão */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Comissão</p>
                  {commission !== null ? (
                    <>
                      <p className="text-2xl font-black text-orange-500">R$ {fmtBRL(commission)}</p>
                      <p className="text-[10px] text-slate-400 mt-1">{commRate}% sobre R$ {fmtBRL(selRevenue)}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-black text-slate-300">—</p>
                      <p className="text-[10px] text-slate-400 mt-1">Taxa não configurada</p>
                    </>
                  )}
                </div>

                {/* Ticket Médio */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Ticket Médio</p>
                  <p className="text-2xl font-black text-black">R$ {fmtBRL(avgTicket)}</p>
                  <p className="text-[10px] text-slate-400 mt-1">{selFinished.length} atendimentos finalizados</p>
                </div>

                {/* Faturamento */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Faturamento</p>
                  <p className="text-2xl font-black text-black">R$ {fmtBRL(selRevenue)}</p>
                  <p className="text-[10px] text-slate-400 mt-1">{range.label}</p>
                </div>

                {/* Taxa de Retorno */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Taxa de Retorno</p>
                  <p className={`text-2xl font-black ${returnRate >= 50 ? 'text-green-600' : returnRate >= 25 ? 'text-orange-500' : 'text-slate-400'}`}>
                    {returnRate}%
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">{returningClients} de {uniqueClientsSet.size} clientes retornaram</p>
                </div>

                {/* Taxa de No-Show */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Taxa de Cancelamento</p>
                  <p className={`text-2xl font-black ${noShowRate === 0 ? 'text-green-600' : noShowRate <= 15 ? 'text-orange-500' : 'text-red-500'}`}>
                    {noShowRate}%
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">{selCancelled.length} de {selScheduled} cancelados</p>
                </div>

                {/* Meta Individual */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Meta Individual</p>
                  {indGoal > 0 ? (
                    <>
                      <p className="text-2xl font-black text-black">{indGoalPct}%</p>
                      <p className="text-[10px] text-slate-400 mt-1">{selFinished.length} de {indGoal} procedimentos</p>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mt-2">
                        <div className={`h-full rounded-full ${indGoalPct >= 100 ? 'bg-green-500' : indGoalPct >= 70 ? 'bg-orange-500' : 'bg-red-400'}`}
                          style={{ width: `${indGoalPct}%` }} />
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-black text-slate-300">—</p>
                      <p className="text-[10px] text-slate-400 mt-1">Meta não configurada</p>
                    </>
                  )}
                </div>
              </div>

              {/* Histórico de atendimentos */}
              <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                  <h3 className="font-black text-sm text-black">Histórico de Atendimentos</h3>
                  <p className="text-xs text-slate-400">{range.label} · {selAppts.length} registros</p>
                </div>
                <div className="overflow-y-auto max-h-[400px]">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] sticky top-0">
                      <tr>
                        <th className="px-6 py-3 text-left">Data / Hora</th>
                        <th className="px-6 py-3 text-left">Cliente</th>
                        <th className="px-6 py-3 text-left">Serviço</th>
                        <th className="px-6 py-3 text-left">Status</th>
                        <th className="px-6 py-3 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {historyAppts.map((a: any) => {
                        const cust = customers.find(c => c.id === a.customer_id);
                        const svc = services.find(s => s.id === a.service_id);
                        const isFinished = a.status === AppointmentStatus.FINISHED;
                        const isCancelled = a.status === AppointmentStatus.CANCELLED;
                        return (
                          <tr key={a.id} className="hover:bg-slate-50">
                            <td className="px-6 py-3 font-bold text-black tabular-nums text-xs">
                              {new Date(a.startTime).toLocaleDateString('pt-BR')}{' '}
                              {new Date(a.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="px-6 py-3 text-slate-700">{cust?.name || 'Cliente'}</td>
                            <td className="px-6 py-3 text-slate-500 text-xs">{svc?.name || 'Serviço'}</td>
                            <td className="px-6 py-3">
                              <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full ${isFinished ? 'bg-green-50 text-green-600' : isCancelled ? 'bg-red-50 text-red-500' : 'bg-orange-50 text-orange-500'}`}>
                                {isFinished ? 'Finalizado' : isCancelled ? 'Cancelado' : 'Pendente'}
                              </span>
                            </td>
                            <td className="px-6 py-3 text-right font-bold text-black">
                              {isFinished && !a.isPlan ? `R$ ${fmtBRL(a.amountPaid || 0)}` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                      {historyAppts.length === 0 && (
                        <tr><td colSpan={5} className="px-6 py-10 text-center text-xs text-slate-400">Sem histórico no período</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default PerformanceView;
