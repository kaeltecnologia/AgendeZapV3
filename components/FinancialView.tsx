
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { db } from '../services/mockDb';
import { PaymentMethod, AppointmentStatus, Professional, Appointment, Service, Customer, Comanda, ComandaItem } from '../types';

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayStr    = () => new Date().toISOString().slice(0, 10);
const daysAgoStr  = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };

const PM_LABEL: Record<string, string> = {
  [PaymentMethod.PIX]:    'PIX',
  [PaymentMethod.MONEY]:  'Dinheiro',
  [PaymentMethod.DEBIT]:  'Débito',
  [PaymentMethod.CREDIT]: 'Crédito',
};
const PAYMENT_METHODS = [
  { key: PaymentMethod.PIX,    icon: '📱', label: 'PIX',      barColor: '#16a34a', textColor: '#16a34a', bgClass: 'bg-green-50   border-green-100'   },
  { key: PaymentMethod.MONEY,  icon: '💵', label: 'Dinheiro', barColor: '#059669', textColor: '#059669', bgClass: 'bg-emerald-50 border-emerald-100' },
  { key: PaymentMethod.DEBIT,  icon: '💳', label: 'Débito',   barColor: '#2563eb', textColor: '#2563eb', bgClass: 'bg-blue-50    border-blue-100'    },
  { key: PaymentMethod.CREDIT, icon: '💳', label: 'Crédito',  barColor: '#9333ea', textColor: '#9333ea', bgClass: 'bg-purple-50  border-purple-100'  },
] as const;
const QUICK_PRESETS = [
  { label: '7D',   start: () => daysAgoStr(6),   end: todayStr },
  { label: '30D',  start: () => daysAgoStr(29),  end: todayStr },
  { label: '90D',  start: () => daysAgoStr(89),  end: todayStr },
  { label: 'Mês',  start: firstOfMonth,           end: todayStr },
] as const;

const comandaItemNet = (item: ComandaItem) => {
  const gross = item.qty * item.unitPrice;
  if (item.discountType === 'percent') return gross * (1 - item.discount / 100);
  return gross - (item.discount ?? 0);
};
const comandaTotal = (c: Comanda) => {
  if (c.finalAmount !== undefined) return c.finalAmount;
  return c.items.reduce((s, i) => s + comandaItemNet(i), 0);
};

// ─────────────────────────────────────────────────────────────────────────────

const FinancialView: React.FC<{ tenantId: string; tenantPlan?: string; refreshTicker?: number }> = ({
  tenantId, refreshTicker = 0
}) => {
  const [startDate, setStartDate] = useState(() => daysAgoStr(29));
  const [endDate,   setEndDate]   = useState(() => todayStr());
  const [selectedProfId, setSelectedProfId] = useState('');

  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [allAppts,      setAllAppts]      = useState<Appointment[]>([]);
  const [allExps,       setAllExps]       = useState<any[]>([]);
  const [services,      setServices]      = useState<Service[]>([]);
  const [customers,     setCustomers]     = useState<Customer[]>([]);
  const [allComandas,      setAllComandas]      = useState<Comanda[]>([]);
  const [commRate,         setCommRate]         = useState(0);
  const [professionalMeta, setProfessionalMeta] = useState<Record<string, any>>({});
  const [selectedComanda,  setSelectedComanda]  = useState<Comanda | null>(null);

  const firstLoad = useRef(true);
  const retroactiveDone = useRef(false);
  const [loading, setLoading] = useState(true);

  // ── Expense modal ─────────────────────────────────────────────────────────
  const [showExpModal, setShowExpModal]         = useState(false);
  const [expDesc, setExpDesc]                   = useState('');
  const [expAmount, setExpAmount]               = useState(0);
  const [expCategory, setExpCategory]           = useState<'COMPANY' | 'PROFESSIONAL'>('COMPANY');
  const [expProfId, setExpProfId]               = useState('');
  const [expPaymentMethod, setExpPaymentMethod] = useState<PaymentMethod>(PaymentMethod.MONEY);

  // ── Adiantamento modal ────────────────────────────────────────────────────
  const [showAdiantModal,  setShowAdiantModal]  = useState(false);
  const [adiantProfId,     setAdiantProfId]     = useState('');
  const [adiantAmount,     setAdiantAmount]     = useState('');
  const [adiantDesc,       setAdiantDesc]       = useState('');
  const [adiantDate,       setAdiantDate]       = useState(() => todayStr());
  const [adiantSaving,     setAdiantSaving]     = useState(false);

  const loadData = useCallback(async () => {
    if (firstLoad.current) setLoading(true);
    const [pros, apps, exps, svcs, custs, st, coms] = await Promise.all([
      db.getProfessionals(tenantId),
      db.getAppointments(tenantId),
      db.getExpenses(tenantId),
      db.getServices(tenantId),
      db.getCustomers(tenantId),
      db.getSettings(tenantId),
      db.getComandas(tenantId),
    ]);
    setProfessionals(pros);
    setAllAppts(apps);
    setAllExps(exps);
    setServices(svcs);
    setCustomers(custs);
    setAllComandas(coms);
    setCommRate(selectedProfId ? (st.professionalMeta?.[selectedProfId]?.commissionRate ?? 0) : 0);
    setProfessionalMeta(st.professionalMeta ?? {});
    if (firstLoad.current) {
      setLoading(false);
      firstLoad.current = false;
      // Geração retroativa: cria comandas fechadas para agendamentos finalizados sem comanda
      if (!retroactiveDone.current) {
        retroactiveDone.current = true;
        const apptIds = new Set(coms.map((c: Comanda) => c.appointment_id));
        const missing = apps.filter((a: Appointment) =>
          a.status === AppointmentStatus.FINISHED && !apptIds.has(a.id)
        );
        if (missing.length > 0) {
          missing.forEach(async (a: Appointment) => {
            const svc = svcs.find((s: Service) => s.id === a.service_id);
            try {
              await db.createComanda({
                tenant_id: tenantId,
                appointment_id: a.id,
                professional_id: a.professional_id!,
                customer_id: a.customer_id!,
                items: svc ? [{ id: crypto.randomUUID(), type: 'service', itemId: svc.id, name: svc.name, qty: 1, unitPrice: svc.price, discountType: 'value', discount: 0, professionalId: a.professional_id }] : [],
                status: 'closed',
                paymentMethod: a.paymentMethod,
                closedAt: a.startTime,
                finalAmount: a.amountPaid && a.amountPaid > 0 ? a.amountPaid : undefined,
              });
            } catch {}
          });
          // Recarrega comandas após geração retroativa
          setTimeout(() => db.getComandas(tenantId).then(setAllComandas), 2000);
        }
      }
    }
  }, [tenantId, selectedProfId, refreshTicker]);

  useEffect(() => { loadData(); }, [loadData]);

  // Reset firstLoad ao mudar filtros principais (para mostrar spinner)
  const applyPreset = (p: typeof QUICK_PRESETS[number]) => {
    firstLoad.current = true;
    setStartDate(p.start());
    setEndDate(p.end());
  };
  const handleProfChange = (id: string) => { firstLoad.current = true; setSelectedProfId(id); };
  const handleDateChange = (field: 'start' | 'end', val: string) => {
    firstLoad.current = true;
    field === 'start' ? setStartDate(val) : setEndDate(val);
  };

  // ── KPI derivados (recomputados quando filtros ou dados mudam) ────────────
  const { totalRevenue, totalExpenses, byMethod, profAppts } = useMemo(() => {
    const inRange = (dateStr: string) => {
      const d = dateStr?.substring(0, 10);
      return d && d >= startDate && d <= endDate;
    };
    const finishedAppts = allAppts.filter(a =>
      a.status === AppointmentStatus.FINISHED && !a.isPlan && inRange(a.startTime)
    );
    const profFiltered = selectedProfId
      ? finishedAppts.filter(a => a.professional_id === selectedProfId)
      : finishedAppts;

    const rev  = profFiltered.reduce((s, a) => s + (a.amountPaid || 0), 0);
    const exps = allExps.filter(e => inRange(e.date)).reduce((s: number, e: any) => s + e.amount, 0);
    const byM: Record<string, number> = {};
    profFiltered.forEach(a => {
      if (a.paymentMethod) byM[a.paymentMethod] = (byM[a.paymentMethod] ?? 0) + (a.amountPaid || 0);
    });
    const sorted = profFiltered.slice().sort((a, b) =>
      new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
    return { totalRevenue: rev, totalExpenses: exps, byMethod: byM, profAppts: sorted };
  }, [allAppts, allExps, startDate, endDate, selectedProfId]);

  // ── Comandas derivadas ────────────────────────────────────────────────────
  const { openComandas, closedComandas } = useMemo(() => {
    const base = selectedProfId
      ? allComandas.filter(c =>
          c.professional_id === selectedProfId ||
          c.items.some(i => i.professionalId === selectedProfId)
        )
      : allComandas;
    const open = selectedProfId
      ? base.filter(c => c.status === 'open')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      : []; // abertas só mostram quando filtra por profissional
    const closed = base
      .filter(c => c.status === 'closed' && c.closedAt && c.closedAt.substring(0, 10) >= startDate && c.closedAt.substring(0, 10) <= endDate)
      .sort((a, b) => new Date(b.closedAt!).getTime() - new Date(a.closedAt!).getTime());
    return { openComandas: open, closedComandas: closed };
  }, [allComandas, selectedProfId, startDate, endDate]);

  const handleAddExpense = async () => {
    if (!expDesc || expAmount <= 0) return;
    const today = new Date().toISOString();
    await db.addExpense({
      tenant_id: tenantId, description: expDesc, amount: expAmount,
      category: expCategory,
      professional_id: expCategory === 'PROFESSIONAL' ? expProfId : undefined,
      date: today, paymentMethod: expPaymentMethod,
    });
    setExpDesc(''); setExpAmount(0); setExpCategory('COMPANY'); setExpProfId('');
    setExpPaymentMethod(PaymentMethod.MONEY);
    setShowExpModal(false);
    loadData();
  };

  const handleAddAdiantamento = async () => {
    const amount = parseFloat(adiantAmount.replace(',', '.'));
    if (!adiantProfId || !amount || amount <= 0) return;
    setAdiantSaving(true);
    try {
      await db.addAdiantamento(tenantId, {
        professionalId: adiantProfId,
        amount,
        date: adiantDate,
        description: adiantDesc || undefined,
      });
      setAdiantProfId(''); setAdiantAmount(''); setAdiantDesc('');
      setAdiantDate(todayStr());
      setShowAdiantModal(false);
      loadData();
    } catch (e: any) {
      alert(`Erro ao registrar adiantamento: ${e?.message || 'Tente novamente.'}`);
    } finally {
      setAdiantSaving(false);
    }
  };

  if (loading || !professionals) {
    return <div className="p-20 text-center font-black animate-pulse text-slate-300 uppercase tracking-widest">Carregando...</div>;
  }

  const profit         = totalRevenue - totalExpenses;
  const margin         = totalRevenue > 0 ? (profit / totalRevenue * 100) : 0;
  const selectedProf   = professionals.find(p => p.id === selectedProfId);

  const calcComm = (a: Appointment) => {
    const amount   = a.amountPaid || 0;
    const svc      = services.find(s => s.id === a.service_id);
    const matPct   = svc?.materialCostPercent ?? 0;
    const gross    = amount * commRate / 100;
    const insumo   = amount * matPct / 100;
    return { gross, insumo, net: gross - insumo };
  };
  const totalCommission     = profAppts.reduce((s, a) => s + calcComm(a).net, 0);
  const totalGrossComm      = profAppts.reduce((s, a) => s + calcComm(a).gross, 0);
  const totalInsumoDiscount = profAppts.reduce((s, a) => s + calcComm(a).insumo, 0);
  const hasAnyInsumos       = profAppts.some(a => (services.find(s => s.id === a.service_id)?.materialCostPercent ?? 0) > 0);

  // Preset matching
  const activePreset = QUICK_PRESETS.find(p => p.start() === startDate && p.end() === endDate)?.label ?? null;

  return (
    <div className="space-y-8 animate-fadeIn">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-black">Financeiro</h1>
          <p className="text-xs text-slate-400 mt-0.5">Resumo do período selecionado.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowExpModal(true)}
            className="bg-black text-white px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-orange-500 transition-all whitespace-nowrap">
            − Registrar Despesa
          </button>
          <button onClick={() => { setAdiantDate(todayStr()); setShowAdiantModal(true); }}
            className="bg-blue-600 text-white px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-blue-700 transition-all whitespace-nowrap">
            + Adiantamento
          </button>
        </div>
      </div>

      {/* ── Filtros ─────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-[24px] border-2 border-slate-100 p-5 space-y-4">
        {/* Linha 1: profissional + pills */}
        <div className="flex flex-wrap items-center gap-3">
          <select value={selectedProfId} onChange={e => handleProfChange(e.target.value)}
            className="p-3 bg-slate-50 border-2 border-slate-100 rounded-xl text-[10px] font-black uppercase outline-none focus:border-black flex-1 min-w-[180px]">
            <option value="">Todos os profissionais</option>
            {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <div className="flex bg-slate-100 p-1 rounded-xl shrink-0">
            {QUICK_PRESETS.map(p => (
              <button key={p.label} onClick={() => applyPreset(p)}
                className={`px-3 sm:px-4 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${
                  activePreset === p.label ? 'bg-black text-white shadow-sm' : 'text-slate-400 hover:text-black'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Linha 2: date range */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">De</label>
            <input type="date" value={startDate} onChange={e => handleDateChange('start', e.target.value)}
              className="p-2.5 bg-slate-50 border-2 border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-black" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Até</label>
            <input type="date" value={endDate} onChange={e => handleDateChange('end', e.target.value)}
              className="p-2.5 bg-slate-50 border-2 border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-black" />
          </div>
          <span className="text-[10px] text-slate-400 font-bold hidden sm:block">
            {(() => {
              const d1 = new Date(startDate), d2 = new Date(endDate);
              const days = Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
              return `${days} dia${days !== 1 ? 's' : ''}`;
            })()}
          </span>
        </div>
      </div>

      {/* ── 3 KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-[28px] border-2 border-slate-100 p-6 sm:p-8 space-y-3 hover:border-black transition-all">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Faturamento Total</p>
            <span className="text-lg">📈</span>
          </div>
          <p className="text-3xl sm:text-4xl font-black text-black tabular-nums">R$&nbsp;{fmtBRL(totalRevenue)}</p>
          <p className="text-[10px] text-slate-300">Receitas confirmadas no período</p>
        </div>

        <div className="bg-white rounded-[28px] border-2 border-slate-100 p-6 sm:p-8 space-y-3 hover:border-black transition-all">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Despesas Pagas</p>
            <span className="text-lg">📉</span>
          </div>
          <p className="text-3xl sm:text-4xl font-black text-black tabular-nums">R$&nbsp;{fmtBRL(totalExpenses)}</p>
          <p className="text-[10px] text-slate-300">Saídas registradas no período</p>
        </div>

        <div className={`rounded-[28px] p-6 sm:p-8 space-y-3 shadow-xl ${
          profit >= 0 ? 'bg-gradient-to-br from-orange-500 to-orange-600 shadow-orange-200'
                      : 'bg-gradient-to-br from-red-500 to-red-600 shadow-red-200'
        }`}>
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black text-white/70 uppercase tracking-widest">Lucro Líquido</p>
            <span className="text-lg">{profit >= 0 ? '💹' : '⚠️'}</span>
          </div>
          <p className="text-3xl sm:text-4xl font-black text-white tabular-nums">R$&nbsp;{fmtBRL(profit)}</p>
          <p className="text-[10px] text-white/70">Margem {margin.toFixed(1)}% · Faturamento − Despesas</p>
        </div>
      </div>

      {/* ── Formas de Pagamento ──────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Formas de Pagamento</h2>
          <div className="flex-1 h-px bg-slate-100" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {PAYMENT_METHODS.map(pm => {
            const val = byMethod[pm.key] || 0;
            const pct = totalRevenue > 0 ? (val / totalRevenue * 100) : 0;
            return (
              <div key={pm.key} className={`bg-white rounded-[24px] border-2 ${pm.bgClass} p-5 space-y-4`}>
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{pm.icon}</span>
                  <span className="text-[10px] font-black px-2 py-1 rounded-full bg-white" style={{ color: pm.textColor }}>
                    {pct.toFixed(1)}%
                  </span>
                </div>
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{pm.label}</p>
                  <p className="text-xl font-black tabular-nums" style={{ color: pm.textColor }}>R$&nbsp;{fmtBRL(val)}</p>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: pm.barColor }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-[24px] border-2 border-slate-100 p-5 flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Dinheiro + PIX</p>
              <p className="text-xl font-black text-black tabular-nums">
                R$&nbsp;{fmtBRL((byMethod[PaymentMethod.MONEY] || 0) + (byMethod[PaymentMethod.PIX] || 0))}
              </p>
            </div>
            <span className="text-3xl opacity-40">💵</span>
          </div>
          <div className="bg-white rounded-[24px] border-2 border-slate-100 p-5 flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Débito + Crédito</p>
              <p className="text-xl font-black text-black tabular-nums">
                R$&nbsp;{fmtBRL((byMethod[PaymentMethod.DEBIT] || 0) + (byMethod[PaymentMethod.CREDIT] || 0))}
              </p>
            </div>
            <span className="text-3xl opacity-40">💳</span>
          </div>
        </div>
      </div>

      {/* ── Seção do Profissional ────────────────────────────────────────────── */}
      {selectedProfId && selectedProf && (
        <>
          {/* ── Atendimentos ── */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Atendimentos — {selectedProf.name}
              </h2>
              <div className="flex-1 h-px bg-slate-100" />
              {commRate > 0 && (
                <span className="text-[10px] font-black text-orange-500 bg-orange-50 px-3 py-1 rounded-full whitespace-nowrap">
                  Comissão {commRate}%
                </span>
              )}
            </div>

            {profAppts.length === 0 ? (
              <div className="bg-white rounded-[24px] border-2 border-dashed border-slate-200 p-10 text-center">
                <p className="text-sm font-black text-slate-300 uppercase tracking-widest">Nenhum atendimento no período</p>
              </div>
            ) : (
              <div className="bg-white rounded-[28px] border-2 border-slate-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <div className="min-w-[760px]">
                    <div className="grid grid-cols-[88px_1fr_1.1fr_80px_148px_72px] gap-2 px-6 py-3 bg-slate-50 border-b border-slate-100 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      <span>Data</span><span>Cliente</span><span>Procedimento</span>
                      <span className="text-right">Valor</span>
                      <span className="text-right">Comissão</span>
                      <span className="text-center">Pagto</span>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {profAppts.map(a => {
                        const svc     = services.find(s => s.id === a.service_id);
                        const cust    = customers.find(c => c.id === a.customer_id);
                        const amount  = a.amountPaid || 0;
                        const { gross, insumo, net } = calcComm(a);
                        const matPct  = svc?.materialCostPercent ?? 0;
                        const dateStr = new Date(a.startTime).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
                        const timeStr = new Date(a.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                        return (
                          <div key={a.id} className="grid grid-cols-[88px_1fr_1.1fr_80px_148px_72px] gap-2 items-center px-6 py-3.5 hover:bg-slate-50 transition-all">
                            <div>
                              <p className="text-xs font-bold text-black tabular-nums">{dateStr}</p>
                              <p className="text-[9px] text-slate-400">{timeStr}</p>
                            </div>
                            <p className="text-xs font-black text-black truncate">{cust?.name ?? '—'}</p>
                            <div>
                              <p className="text-xs font-bold text-slate-700 truncate">{svc?.name ?? '—'}</p>
                              {matPct > 0 && <p className="text-[9px] text-slate-400">Insumos {matPct}%</p>}
                            </div>
                            <p className="text-xs font-black text-black text-right tabular-nums">R$&nbsp;{fmtBRL(amount)}</p>
                            {/* Coluna comissão — breakdown se tiver insumo */}
                            <div className="text-right">
                              {commRate === 0 ? (
                                <span className="text-xs font-black text-slate-300">—</span>
                              ) : matPct > 0 ? (
                                <>
                                  <p className="text-xs font-black text-orange-500 tabular-nums">R$&nbsp;{fmtBRL(gross)}</p>
                                  <p className="text-[11px] font-bold text-red-400 tabular-nums">− R$&nbsp;{fmtBRL(insumo)} insumo</p>
                                  <p className="text-[11px] font-black text-green-600 tabular-nums border-t border-slate-100 mt-0.5 pt-0.5">= R$&nbsp;{fmtBRL(net)}</p>
                                </>
                              ) : (
                                <p className="text-xs font-black text-orange-500 tabular-nums">R$&nbsp;{fmtBRL(gross)}</p>
                              )}
                            </div>
                            <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-full text-center block">
                              {PM_LABEL[a.paymentMethod || ''] || '—'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {/* Totais */}
                    <div className="grid grid-cols-[88px_1fr_1.1fr_80px_148px_72px] gap-2 items-center px-6 py-4 bg-slate-50 border-t-2 border-slate-100">
                      <p className="text-[10px] font-black text-black uppercase col-span-3">
                        {profAppts.length} atendimento{profAppts.length !== 1 ? 's' : ''}
                      </p>
                      <p className="text-sm font-black text-black text-right tabular-nums">
                        R$&nbsp;{fmtBRL(profAppts.reduce((s, a) => s + (a.amountPaid || 0), 0))}
                      </p>
                      <div className="text-right">
                        {commRate === 0 ? (
                          <span className="text-sm font-black text-slate-300">—</span>
                        ) : hasAnyInsumos ? (
                          <>
                            <p className="text-sm font-black text-orange-500 tabular-nums">R$&nbsp;{fmtBRL(totalGrossComm)}</p>
                            <p className="text-xs font-bold text-red-400 tabular-nums">− R$&nbsp;{fmtBRL(totalInsumoDiscount)} insumos</p>
                            <p className="text-sm font-black text-green-600 tabular-nums border-t border-slate-200 mt-0.5 pt-0.5">= R$&nbsp;{fmtBRL(totalCommission)}</p>
                          </>
                        ) : (
                          <p className="text-sm font-black text-orange-500 tabular-nums">R$&nbsp;{fmtBRL(totalCommission)}</p>
                        )}
                      </div>
                      <span />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

        </>
      )}

      {/* ── Comandas (sempre visível, filtra por profissional se selecionado) ── */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Comandas{selectedProf ? ` — ${selectedProf.name}` : ''}
          </h2>
          <div className="flex-1 h-px bg-slate-100" />
          <div className="flex items-center gap-2">
            {openComandas.length > 0 && (
              <span className="text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full">
                {openComandas.length} aberta{openComandas.length !== 1 ? 's' : ''}
              </span>
            )}
            {closedComandas.length > 0 && (
              <span className="text-[9px] font-black text-green-700 bg-green-50 border border-green-100 px-2.5 py-1 rounded-full">
                {closedComandas.length} fechada{closedComandas.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {openComandas.length === 0 && closedComandas.length === 0 ? (
          <div className="bg-white rounded-[24px] border-2 border-dashed border-slate-200 p-10 text-center">
            <p className="text-sm font-black text-slate-300 uppercase tracking-widest">Nenhuma comanda no período</p>
          </div>
        ) : (
          <div className="space-y-3">
            {openComandas.map(c => {
              const cust  = customers.find(cu => cu.id === c.customer_id);
              const total = comandaTotal(c);
              const dateStr = new Date(c.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
              return (
                <div key={c.id} onClick={() => setSelectedComanda(c)} className="bg-amber-50 border-2 border-amber-100 rounded-[20px] px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:border-amber-300 transition-all">
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="text-[9px] font-black bg-amber-200 text-amber-800 px-2.5 py-1 rounded-full whitespace-nowrap uppercase shrink-0">
                      Aberta {c.number ? `#${String(c.number).padStart(3,'0')}` : ''}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-black text-black truncate">{cust?.name ?? '—'}</p>
                      <p className="text-[9px] text-slate-400">{dateStr} · {c.items.length} item{c.items.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <p className="text-sm font-black text-amber-700 tabular-nums whitespace-nowrap shrink-0">
                    R$&nbsp;{fmtBRL(total)}
                  </p>
                </div>
              );
            })}

            {closedComandas.map(c => {
              const cust    = customers.find(cu => cu.id === c.customer_id);
              const prof    = professionals.find(p => p.id === c.professional_id);
              const total   = comandaTotal(c);
              const dateStr = c.closedAt
                ? new Date(c.closedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                : '—';
              const pmLabel = PM_LABEL[c.paymentMethod || ''] || c.paymentMethod || '—';
              return (
                <div key={c.id} onClick={() => setSelectedComanda(c)} className="bg-white border-2 border-slate-100 rounded-[20px] px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:border-black transition-all">
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="text-[9px] font-black bg-green-100 text-green-700 px-2.5 py-1 rounded-full whitespace-nowrap uppercase shrink-0">
                      Fechada {c.number ? `#${String(c.number).padStart(3,'0')}` : ''}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-black text-black truncate">{cust?.name ?? '—'}</p>
                      {!selectedProfId && prof && (
                        <p className="text-[9px] text-orange-500 font-bold truncate">{prof.name}</p>
                      )}
                      <p className="text-[9px] text-slate-400">{dateStr} · {c.items.length} item{c.items.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {c.paymentMethod && (
                      <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-full whitespace-nowrap">
                        {pmLabel}
                      </span>
                    )}
                    <p className="text-sm font-black text-black tabular-nums whitespace-nowrap">
                      R$&nbsp;{fmtBRL(total)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Comanda Detail Modal ─────────────────────────────────────────────── */}
      {selectedComanda && (() => {
        const c       = selectedComanda;
        const cust    = customers.find(cu => cu.id === c.customer_id);
        const prof    = professionals.find(p => p.id === c.professional_id);
        const cRate   = professionalMeta[c.professional_id]?.commissionRate ?? 0;
        const subtotal = c.items.reduce((s, i) => {
          const gross = i.qty * i.unitPrice;
          return s + (i.discountType === 'percent' ? gross * (1 - i.discount / 100) : gross - (i.discount ?? 0));
        }, 0);
        const total   = c.finalAmount !== undefined ? c.finalAmount : subtotal;
        const desconto = subtotal - total;
        const comissao = cRate > 0 ? total * cRate / 100 : 0;
        const dateOpen   = new Date(c.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
        const dateClosed = c.closedAt ? new Date(c.closedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
        return (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setSelectedComanda(null)}>
            <div className="bg-white rounded-[32px] w-full max-w-sm overflow-hidden shadow-2xl animate-scaleUp" onClick={e => e.stopPropagation()}>

              {/* Cabeçalho */}
              <div className="bg-black px-7 pt-7 pb-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Comanda</p>
                    <p className="text-2xl font-black text-white">
                      {c.number ? `#${String(c.number).padStart(3, '0')}` : '—'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className={`text-[9px] font-black px-3 py-1.5 rounded-full uppercase tracking-widest ${
                      c.status === 'closed'  ? 'bg-green-500 text-white' :
                      c.status === 'open'    ? 'bg-amber-400 text-black' :
                                               'bg-slate-600 text-slate-300'
                    }`}>
                      {c.status === 'closed' ? 'Fechada' : c.status === 'open' ? 'Aberta' : 'Standby'}
                    </span>
                    {c.paymentMethod && (
                      <span className="text-[9px] font-black bg-slate-800 text-slate-300 px-3 py-1 rounded-full uppercase tracking-widest">
                        {PM_LABEL[c.paymentMethod] || c.paymentMethod}
                      </span>
                    )}
                  </div>
                </div>
                <div className="border-t border-slate-800 pt-4 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[8px] text-slate-500 uppercase tracking-widest">Cliente</p>
                    <p className="text-xs font-black text-white truncate">{cust?.name ?? '—'}</p>
                    {cust?.phone && <p className="text-[9px] text-slate-400">{cust.phone}</p>}
                  </div>
                  <div>
                    <p className="text-[8px] text-slate-500 uppercase tracking-widest">Profissional</p>
                    <p className="text-xs font-black text-white truncate">{prof?.name ?? '—'}</p>
                    {cRate > 0 && <p className="text-[9px] text-orange-400">Comissão {cRate}%</p>}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[8px] text-slate-500 uppercase tracking-widest">Aberta em</p>
                    <p className="text-[9px] text-slate-300">{dateOpen}</p>
                  </div>
                  {dateClosed && (
                    <div>
                      <p className="text-[8px] text-slate-500 uppercase tracking-widest">Fechada em</p>
                      <p className="text-[9px] text-slate-300">{dateClosed}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Serviços */}
              <div className="px-7 py-5 space-y-2 border-b-2 border-dashed border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Serviços</p>
                {c.items.length === 0 ? (
                  <p className="text-xs text-slate-300 italic">Sem itens registrados</p>
                ) : c.items.map(item => {
                  const gross = item.qty * item.unitPrice;
                  const net   = item.discountType === 'percent' ? gross * (1 - item.discount / 100) : gross - (item.discount ?? 0);
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-black truncate">{item.name}</p>
                        {item.qty > 1 && <p className="text-[9px] text-slate-400">{item.qty}× R$ {fmtBRL(item.unitPrice)}</p>}
                        {item.discount > 0 && (
                          <p className="text-[9px] text-green-600">
                            Desconto {item.discountType === 'percent' ? `${item.discount}%` : `R$ ${fmtBRL(item.discount)}`}
                          </p>
                        )}
                      </div>
                      <p className="text-xs font-black text-black tabular-nums shrink-0">R$&nbsp;{fmtBRL(net)}</p>
                    </div>
                  );
                })}
              </div>

              {/* Totais + Comissão */}
              <div className="px-7 py-5 space-y-2.5">
                {desconto > 0.01 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Subtotal</span>
                    <span className="font-bold tabular-nums">R$&nbsp;{fmtBRL(subtotal)}</span>
                  </div>
                )}
                {desconto > 0.01 && (
                  <div className="flex justify-between text-xs text-green-600">
                    <span>Desconto</span>
                    <span className="font-bold tabular-nums">− R$&nbsp;{fmtBRL(desconto)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center bg-black rounded-2xl px-4 py-3">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total</span>
                  <span className="text-lg font-black text-white tabular-nums">R$&nbsp;{fmtBRL(total)}</span>
                </div>
                {cRate > 0 && (
                  <div className="flex justify-between text-xs text-orange-500 bg-orange-50 rounded-xl px-4 py-2.5">
                    <span className="font-bold">Comissão {cRate}%</span>
                    <span className="font-black tabular-nums">R$&nbsp;{fmtBRL(comissao)}</span>
                  </div>
                )}
                {c.notes && (
                  <div className="bg-slate-50 rounded-xl px-4 py-3 mt-1">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Observações</p>
                    <p className="text-xs text-slate-600 italic">{c.notes}</p>
                  </div>
                )}
                <button onClick={() => setSelectedComanda(null)}
                  className="w-full py-3.5 bg-slate-100 text-slate-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-black hover:text-white transition-all mt-2">
                  Fechar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Adiantamento Modal ──────────────────────────────────────────────── */}
      {showAdiantModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md p-10 space-y-7 animate-scaleUp">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-black uppercase">Adiantamento</h2>
                <p className="text-xs text-slate-400 mt-0.5 font-bold">Pagamento antecipado ao profissional</p>
              </div>
              <button onClick={() => setShowAdiantModal(false)} className="text-slate-400 hover:text-black text-xl font-black">✕</button>
            </div>
            <div className="space-y-4">
              <select value={adiantProfId} onChange={e => setAdiantProfId(e.target.value)}
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none focus:border-blue-500">
                <option value="">Selecionar profissional...</option>
                {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input type="text" inputMode="decimal" value={adiantAmount}
                onChange={e => setAdiantAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
                placeholder="Valor (R$)"
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-black text-xl focus:border-blue-500" />
              <input value={adiantDesc} onChange={e => setAdiantDesc(e.target.value)}
                placeholder="Descrição (opcional)"
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-blue-500" />
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Data</p>
                <input type="date" value={adiantDate} onChange={e => setAdiantDate(e.target.value)}
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-blue-500" />
              </div>
            </div>
            <div className="flex gap-4 pt-1">
              <button onClick={() => setShowAdiantModal(false)}
                className="flex-1 py-4 font-black text-slate-400 uppercase text-xs tracking-widest">Cancelar</button>
              <button onClick={handleAddAdiantamento} disabled={adiantSaving || !adiantProfId || !adiantAmount}
                className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all disabled:opacity-50">
                {adiantSaving ? 'Salvando...' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Expense Modal ────────────────────────────────────────────────────── */}
      {showExpModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md p-10 space-y-7 animate-scaleUp">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-black uppercase">Registrar Despesa</h2>
              <button onClick={() => setShowExpModal(false)} className="text-slate-400 hover:text-black text-xl font-black">✕</button>
            </div>
            <div className="space-y-5">
              <input value={expDesc} onChange={e => setExpDesc(e.target.value)} placeholder="Descrição da despesa..."
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-black" />
              <input type="number" value={expAmount || ''} onChange={e => setExpAmount(Number(e.target.value))} placeholder="Valor (R$)"
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-black text-xl focus:border-black" />
              <div className="flex gap-3">
                {(['COMPANY', 'PROFESSIONAL'] as const).map(cat => (
                  <button key={cat} onClick={() => setExpCategory(cat)}
                    className={`flex-1 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${
                      expCategory === cat ? 'bg-black text-white' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
                    }`}>
                    {cat === 'COMPANY' ? 'Unidade' : 'Profissional'}
                  </button>
                ))}
              </div>
              {expCategory === 'PROFESSIONAL' && (
                <select value={expProfId} onChange={e => setExpProfId(e.target.value)}
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-black">
                  <option value="">Qual profissional?</option>
                  {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Forma de pagamento</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { val: PaymentMethod.MONEY,  icon: '💵', label: 'Dinheiro' },
                    { val: PaymentMethod.PIX,    icon: '📱', label: 'PIX'      },
                    { val: PaymentMethod.DEBIT,  icon: '💳', label: 'Débito'   },
                    { val: PaymentMethod.CREDIT, icon: '💳', label: 'Crédito'  },
                  ] as const).map(({ val, icon, label }) => (
                    <button key={val} onClick={() => setExpPaymentMethod(val)}
                      className={`py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${
                        expPaymentMethod === val ? 'bg-black text-white border-black' : 'bg-slate-50 text-slate-400 border-slate-100 hover:border-slate-300'
                      }`}>
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-4 pt-1">
              <button onClick={() => setShowExpModal(false)}
                className="flex-1 py-4 font-black text-slate-400 uppercase text-xs tracking-widest">Cancelar</button>
              <button onClick={handleAddExpense}
                className="flex-1 py-4 bg-orange-500 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-orange-100 hover:bg-black transition-all">
                Lançar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancialView;
