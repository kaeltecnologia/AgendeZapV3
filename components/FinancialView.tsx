
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { PaymentMethod, AppointmentStatus, Professional, Expense, Appointment } from '../types';
import { hasFeature } from '../config/planConfig';

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const FinancialView: React.FC<{ tenantId: string; tenantPlan?: string }> = ({ tenantId, tenantPlan }) => {
  const hasCaixa = hasFeature(tenantPlan, 'caixaAvancado');
  const [activeTab, setActiveTab] = useState<'visao' | 'caixa' | 'config'>('visao');

  // ── Visão Financeira state ────────────────────────────────────────────────
  const [period, setPeriod] = useState(30);
  const [selectedProfId, setSelectedProfId] = useState<string>('');
  const [showExpModal, setShowExpModal] = useState(false);
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState(0);
  const [expCategory, setExpCategory] = useState<'COMPANY' | 'PROFESSIONAL'>('COMPANY');
  const [expProfId, setExpProfId] = useState('');
  const [expPaymentMethod, setExpPaymentMethod] = useState<PaymentMethod>(PaymentMethod.MONEY);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [expensesList, setExpensesList] = useState<Expense[]>([]);
  const [revenuesList, setRevenuesList] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Caixa state ───────────────────────────────────────────────────────────
  const [caixaDate, setCaixaDate] = useState(new Date().toISOString().split('T')[0]);
  const [settings, setSettings] = useState<any>({});

  // ── Config state ──────────────────────────────────────────────────────────
  const [cfgDebit, setCfgDebit] = useState(0);
  const [cfgCredit, setCfgCredit] = useState(0);
  const [cfgInstallment, setCfgInstallment] = useState(0);
  const [cfgGoal, setCfgGoal] = useState(0);
  const [cfgCommissions, setCfgCommissions] = useState<Record<string, number>>({});
  const [cfgSaving, setCfgSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [pros, summ, exps, apps, st] = await Promise.all([
      db.getProfessionals(tenantId),
      db.getFinancialSummary(tenantId, period, selectedProfId),
      db.getExpenses(tenantId),
      db.getAppointments(tenantId),
      db.getSettings(tenantId),
    ]);
    setProfessionals(pros);
    setSummary(summ);
    setExpensesList(exps);
    setSettings(st);
    const startDate = new Date(); startDate.setDate(startDate.getDate() - period);
    setRevenuesList(apps.filter(a =>
      a.status === AppointmentStatus.FINISHED &&
      !a.isPlan &&
      new Date(a.startTime) >= startDate &&
      (!selectedProfId || a.professional_id === selectedProfId)
    ));
    // Init config
    setCfgDebit(st.cardFees?.debit ?? 0);
    setCfgCredit(st.cardFees?.credit ?? 0);
    setCfgInstallment(st.cardFees?.installment ?? 0);
    setCfgGoal(st.monthlyRevenueGoal ?? 0);
    const commMap: Record<string, number> = {};
    pros.forEach(p => { commMap[p.id] = st.professionalMeta?.[p.id]?.commissionRate ?? 0; });
    setCfgCommissions(commMap);
    setLoading(false);
  }, [tenantId, period, selectedProfId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Expense modal ─────────────────────────────────────────────────────────
  const handleAddExpense = async () => {
    if (!expDesc || expAmount <= 0) return;
    await db.addExpense({
      tenant_id: tenantId, description: expDesc, amount: expAmount,
      category: expCategory, professional_id: expCategory === 'PROFESSIONAL' ? expProfId : undefined,
      date: new Date().toISOString(), paymentMethod: expPaymentMethod
    });
    setExpDesc(''); setExpAmount(0); setExpCategory('COMPANY'); setExpProfId('');
    setExpPaymentMethod(PaymentMethod.MONEY);
    setShowExpModal(false);
    loadData();
  };

  // ── Config save ───────────────────────────────────────────────────────────
  const handleSaveConfig = async () => {
    setCfgSaving(true);
    try {
      const st = await db.getSettings(tenantId);
      const meta = { ...(st.professionalMeta || {}) };
      professionals.forEach(p => {
        meta[p.id] = { role: meta[p.id]?.role ?? 'colab', ...(meta[p.id] || {}), commissionRate: cfgCommissions[p.id] ?? 0 };
      });
      await db.updateSettings(tenantId, {
        cardFees: { debit: cfgDebit, credit: cfgCredit, installment: cfgInstallment },
        monthlyRevenueGoal: cfgGoal,
        professionalMeta: meta,
      });
    } finally {
      setCfgSaving(false);
    }
  };

  // ── Caixa calculations ────────────────────────────────────────────────────
  const cardFees = settings.cardFees || { debit: 0, credit: 0, installment: 0 };
  const caixaRevenues = revenuesList.filter(a => a.startTime?.startsWith(caixaDate));
  const caixaExpenses = expensesList.filter(e => (e.date || '').startsWith(caixaDate));

  const getLiquid = (a: Appointment) => {
    const gross = a.amountPaid || 0;
    if (a.paymentMethod === PaymentMethod.DEBIT) return gross * (1 - cardFees.debit / 100);
    if (a.paymentMethod === PaymentMethod.CREDIT) return gross * (1 - cardFees.credit / 100);
    return gross;
  };

  const caixaGross = caixaRevenues.reduce((s, a) => s + (a.amountPaid || 0), 0);
  const caixaLiquid = caixaRevenues.reduce((s, a) => s + getLiquid(a), 0);
  const caixaOut = caixaExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const caixaBalance = caixaLiquid - caixaOut;

  // ── Comparison (período anterior) ────────────────────────────────────────
  const prevRevenue = (() => {
    if (!summary) return 0;
    return summary.prevRevenue || 0;
  })();
  const revGrowth = summary && prevRevenue > 0
    ? ((summary.totalRevenue - prevRevenue) / prevRevenue * 100).toFixed(1)
    : null;

  if (loading || !summary) {
    return <div className="p-20 text-center font-black animate-pulse">CARREGANDO FINANCEIRO...</div>;
  }

  const profit = summary.totalRevenue - summary.totalExpenses;
  const margin = summary.totalRevenue > 0 ? (profit / summary.totalRevenue * 100) : 0;

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-black">Financeiro</h1>
          <p className="text-xs text-slate-400 mt-0.5">Controle completo das finanças do negócio.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 rounded-2xl p-1 gap-1 w-fit">
        {([
          { key: 'visao', label: 'Visão Financeira', gated: false },
          { key: 'caixa', label: 'Caixa', gated: !hasCaixa },
          { key: 'config', label: 'Configurações', gated: !hasCaixa },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => !t.gated && setActiveTab(t.key)}
            title={t.gated ? 'Disponível no plano Elite' : undefined}
            className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              t.gated
                ? 'text-slate-300 cursor-not-allowed'
                : activeTab === t.key ? 'bg-black text-white shadow-sm' : 'text-slate-500 hover:text-black'
            }`}
          >
            {t.label}{t.gated ? ' 🔒' : ''}
          </button>
        ))}
      </div>

      {/* ── ABA: VISÃO FINANCEIRA ─────────────────────────────────────────── */}
      {activeTab === 'visao' && (
        <div className="space-y-8">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-4">
            <select value={selectedProfId} onChange={e => setSelectedProfId(e.target.value)}
              className="p-3 bg-white border-2 border-slate-100 rounded-xl text-[10px] font-black uppercase outline-none focus:border-black">
              <option value="">Consolidado</option>
              {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="flex bg-slate-100 p-1 rounded-xl">
              {[7, 30, 90].map(d => (
                <button key={d} onClick={() => setPeriod(d)}
                  className={`px-4 py-2 text-[10px] font-black uppercase rounded-lg ${period === d ? 'bg-black text-white' : 'text-slate-400'}`}>
                  {d}D
                </button>
              ))}
            </div>
            <button onClick={() => setShowExpModal(true)}
              className="bg-black text-white px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-orange-500 transition-all">
              − Registrar Despesa
            </button>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <FinCard title="Faturamento Bruto" val={`R$ ${fmtBRL(summary.totalRevenue)}`} icon="📈" color="text-orange-500"
              sub={revGrowth ? `${Number(revGrowth) >= 0 ? '+' : ''}${revGrowth}% vs anterior` : undefined} />
            <FinCard title="Despesas" val={`R$ ${fmtBRL(summary.totalExpenses)}`} icon="📉" color="text-black" />
            <FinCard title="Lucro Líquido" val={`R$ ${fmtBRL(profit)}`} icon="💹" color="text-orange-500" highlight />
            <FinCard title="Margem" val={`${margin.toFixed(1)}%`} icon="📊" color={margin >= 40 ? 'text-green-600' : margin >= 20 ? 'text-orange-500' : 'text-red-500'} />
            <FinCard title="Em Dinheiro / PIX" val={`R$ ${fmtBRL(summary[PaymentMethod.MONEY] + summary[PaymentMethod.PIX])}`} icon="💵" />
            <FinCard title="Cartões" val={`R$ ${fmtBRL(summary[PaymentMethod.DEBIT] + summary[PaymentMethod.CREDIT])}`} icon="💳" />
          </div>

          {/* Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 overflow-hidden h-[520px] flex flex-col">
              <div className="p-8 border-b-2 border-slate-50 flex justify-between items-center bg-white sticky top-0 z-10">
                <h3 className="font-black text-black uppercase tracking-widest text-sm">Entradas (Vendas)</h3>
                <span className="text-[10px] font-black text-orange-500 bg-orange-50 px-3 py-1.5 rounded-full uppercase tracking-widest">Receitas</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                    <tr><th className="px-8 py-4 text-left">DESCRIÇÃO</th><th className="px-8 py-4 text-right">VALOR</th></tr>
                  </thead>
                  <tbody className="divide-y-2 divide-slate-50">
                    {revenuesList.map(a => (
                      <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-8 py-5">
                          <p className="font-black text-black leading-tight">
                            {professionals.find(p => p.id === a.professional_id)?.name || 'Profissional'}
                          </p>
                          <p className="text-[9px] font-bold text-slate-400 tracking-widest uppercase mt-1">
                            📅 {new Date(a.startTime).toLocaleDateString('pt-BR')} · {a.paymentMethod || '—'}
                          </p>
                        </td>
                        <td className="px-8 py-5 text-right font-black text-orange-500 text-lg">R$ {fmtBRL(a.amountPaid || 0)}</td>
                      </tr>
                    ))}
                    {revenuesList.length === 0 && (
                      <tr><td colSpan={2} className="px-8 py-12 text-center text-xs text-slate-400">Sem receitas no período</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 overflow-hidden h-[520px] flex flex-col">
              <div className="p-8 border-b-2 border-slate-50 flex justify-between items-center bg-white sticky top-0 z-10">
                <h3 className="font-black text-black uppercase tracking-widest text-sm">Saídas (Custos)</h3>
                <span className="text-[10px] font-black text-black bg-slate-100 px-3 py-1.5 rounded-full uppercase tracking-widest">Despesas</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                    <tr><th className="px-8 py-4 text-left">DESCRIÇÃO</th><th className="px-8 py-4 text-right">VALOR</th></tr>
                  </thead>
                  <tbody className="divide-y-2 divide-slate-50">
                    {expensesList.map(e => (
                      <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-8 py-5">
                          <p className="font-black text-black leading-tight">{e.description}</p>
                          <p className="text-[9px] font-bold text-slate-400 tracking-widest uppercase mt-1">
                            {e.category === 'COMPANY' ? '🏢 Unidade' : `👤 ${professionals.find(p => p.id === e.professional_id)?.name || 'Profissional'}`}
                            {e.paymentMethod && <> · {e.paymentMethod}</>}
                          </p>
                        </td>
                        <td className="px-8 py-5 text-right font-black text-black text-lg">R$ {fmtBRL(e.amount)}</td>
                      </tr>
                    ))}
                    {expensesList.length === 0 && (
                      <tr><td colSpan={2} className="px-8 py-12 text-center text-xs text-slate-400">Sem despesas no período</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ABA: CAIXA ───────────────────────────────────────────────────── */}
      {activeTab === 'caixa' && (
        <div className="space-y-6">
          {/* Date picker + action */}
          <div className="flex flex-wrap items-center gap-4">
            <input
              type="date"
              value={caixaDate}
              onChange={e => setCaixaDate(e.target.value)}
              className="p-3 bg-white border-2 border-slate-100 rounded-xl text-sm font-bold outline-none focus:border-black"
            />
            <button onClick={() => setCaixaDate(new Date().toISOString().split('T')[0])}
              className="px-4 py-3 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-200 transition-all">
              Hoje
            </button>
            <button onClick={() => setShowExpModal(true)}
              className="bg-black text-white px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-orange-500 transition-all">
              − Registrar Saída
            </button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Entradas Brutas</p>
              <p className="text-2xl font-black text-orange-500">R$ {fmtBRL(caixaGross)}</p>
              <p className="text-[10px] text-slate-400 mt-1">{caixaRevenues.length} atendimentos</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Entradas Líquidas</p>
              <p className="text-2xl font-black text-black">R$ {fmtBRL(caixaLiquid)}</p>
              <p className="text-[10px] text-slate-400 mt-1">Após taxas de cartão</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Saídas</p>
              <p className="text-2xl font-black text-red-500">R$ {fmtBRL(caixaOut)}</p>
              <p className="text-[10px] text-slate-400 mt-1">{caixaExpenses.length} despesas</p>
            </div>
            <div className={`rounded-2xl border p-5 ${caixaBalance >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">Saldo do Dia</p>
              <p className={`text-2xl font-black ${caixaBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>R$ {fmtBRL(caixaBalance)}</p>
              <p className="text-[10px] text-slate-400 mt-1">Líquido − Saídas</p>
            </div>
          </div>

          {/* Entries table */}
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-black text-sm text-black uppercase tracking-widest">Entradas do Dia</h3>
              <span className="text-[10px] font-bold text-orange-500 bg-orange-50 px-3 py-1 rounded-full">Receitas</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-[0.15em]">
                <tr>
                  <th className="px-6 py-3 text-left">Hora</th>
                  <th className="px-6 py-3 text-left">Profissional</th>
                  <th className="px-6 py-3 text-left">Pagamento</th>
                  <th className="px-6 py-3 text-right">Bruto</th>
                  <th className="px-6 py-3 text-right">Taxa</th>
                  <th className="px-6 py-3 text-right">Líquido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {caixaRevenues.map(a => {
                  const gross = a.amountPaid || 0;
                  const liq = getLiquid(a);
                  const fee = gross - liq;
                  const feeRate = a.paymentMethod === PaymentMethod.DEBIT ? cardFees.debit
                    : a.paymentMethod === PaymentMethod.CREDIT ? cardFees.credit : 0;
                  return (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-6 py-3 font-bold text-black tabular-nums">
                        {new Date(a.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-6 py-3 text-slate-600">{professionals.find(p => p.id === a.professional_id)?.name || '—'}</td>
                      <td className="px-6 py-3">
                        <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
                          {a.paymentMethod || '—'}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right font-bold text-black">R$ {fmtBRL(gross)}</td>
                      <td className="px-6 py-3 text-right text-red-400 text-xs">
                        {feeRate > 0 ? `−R$ ${fmtBRL(fee)} (${feeRate}%)` : '—'}
                      </td>
                      <td className="px-6 py-3 text-right font-black text-orange-500">R$ {fmtBRL(liq)}</td>
                    </tr>
                  );
                })}
                {caixaRevenues.length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-xs text-slate-400">Sem entradas neste dia</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Expenses table */}
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-black text-sm text-black uppercase tracking-widest">Saídas do Dia</h3>
              <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-3 py-1 rounded-full">Despesas</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-[0.15em]">
                <tr>
                  <th className="px-6 py-3 text-left">Descrição</th>
                  <th className="px-6 py-3 text-left">Categoria</th>
                  <th className="px-6 py-3 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {caixaExpenses.map(e => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-bold text-black">{e.description}</td>
                    <td className="px-6 py-3 text-slate-400 text-xs">
                      {e.category === 'COMPANY' ? 'Unidade' : `Prof: ${professionals.find(p => p.id === e.professional_id)?.name || '—'}`}
                    </td>
                    <td className="px-6 py-3 text-right font-black text-red-500">R$ {fmtBRL(e.amount)}</td>
                  </tr>
                ))}
                {caixaExpenses.length === 0 && (
                  <tr><td colSpan={3} className="px-6 py-10 text-center text-xs text-slate-400">Sem saídas neste dia</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ABA: CONFIGURAÇÕES FINANCEIRAS ───────────────────────────────── */}
      {activeTab === 'config' && (
        <div className="space-y-8 max-w-2xl">
          {/* Meta mensal */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
            <h3 className="font-black text-sm text-black uppercase tracking-widest">Meta Mensal da Barbearia</h3>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Meta de Faturamento (R$)</label>
              <input
                type="number" value={cfgGoal} min={0} step={100}
                onChange={e => setCfgGoal(Number(e.target.value))}
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-xl font-black text-xl outline-none focus:border-black"
                placeholder="0,00"
              />
              <p className="text-[10px] text-slate-400 mt-1">Exibida como barra de progresso no Dashboard</p>
            </div>
          </div>

          {/* Taxas de cartão */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
            <h3 className="font-black text-sm text-black uppercase tracking-widest">Taxas de Cartão (%)</h3>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Débito', value: cfgDebit, setter: setCfgDebit },
                { label: 'Crédito à Vista', value: cfgCredit, setter: setCfgCredit },
                { label: 'Parcelado', value: cfgInstallment, setter: setCfgInstallment },
              ].map(({ label, value, setter }) => (
                <div key={label}>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">{label}</label>
                  <div className="relative">
                    <input
                      type="number" value={value} min={0} max={100} step={0.1}
                      onChange={e => setter(Number(e.target.value))}
                      className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl font-bold outline-none focus:border-black pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">%</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400">Usadas para calcular valor líquido no Caixa</p>
          </div>

          {/* Comissão por profissional */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
            <h3 className="font-black text-sm text-black uppercase tracking-widest">Comissão por Profissional (%)</h3>
            <div className="space-y-3">
              {professionals.map(p => (
                <div key={p.id} className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center text-xs font-black shrink-0">
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="flex-1 text-sm font-bold text-black">{p.name}</span>
                  <div className="relative w-28">
                    <input
                      type="number" min={0} max={100} step={1}
                      value={cfgCommissions[p.id] ?? 0}
                      onChange={e => setCfgCommissions(prev => ({ ...prev, [p.id]: Number(e.target.value) }))}
                      className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl font-bold outline-none focus:border-black text-right pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">%</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400">Exibida no Assessor de cada profissional via WhatsApp</p>
          </div>

          <button
            onClick={handleSaveConfig}
            disabled={cfgSaving}
            className="w-full py-4 bg-black text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl hover:bg-orange-500 transition-all disabled:opacity-50"
          >
            {cfgSaving ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        </div>
      )}

      {/* ── Expense Modal ─────────────────────────────────────────────────── */}
      {showExpModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp">
            <h2 className="text-2xl font-black text-black uppercase">Registrar Saída</h2>
            <div className="space-y-6">
              <input value={expDesc} onChange={e => setExpDesc(e.target.value)} placeholder="O que foi pago?"
                className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold" />
              <input type="number" value={expAmount} onChange={e => setExpAmount(Number(e.target.value))} placeholder="0,00"
                className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-black text-xl" />
              <div className="flex gap-4">
                <button onClick={() => setExpCategory('COMPANY')}
                  className={`flex-1 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest ${expCategory === 'COMPANY' ? 'bg-black text-white' : 'bg-slate-50 text-slate-400'}`}>
                  Unidade
                </button>
                <button onClick={() => setExpCategory('PROFESSIONAL')}
                  className={`flex-1 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest ${expCategory === 'PROFESSIONAL' ? 'bg-black text-white' : 'bg-slate-50 text-slate-400'}`}>
                  Profissional
                </button>
              </div>
              {expCategory === 'PROFESSIONAL' && (
                <select value={expProfId} onChange={e => setExpProfId(e.target.value)}
                  className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold">
                  <option value="">Qual Profissional?</option>
                  {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Método de Pagamento</p>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { val: PaymentMethod.MONEY, icon: '💵', label: 'Dinheiro' },
                    { val: PaymentMethod.PIX, icon: '📱', label: 'PIX' },
                    { val: PaymentMethod.DEBIT, icon: '💳', label: 'Débito' },
                    { val: PaymentMethod.CREDIT, icon: '💳', label: 'Crédito' },
                  ] as const).map(({ val, icon, label }) => (
                    <button key={val} type="button" onClick={() => setExpPaymentMethod(val)}
                      className={`py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${expPaymentMethod === val ? 'bg-black text-white border-black' : 'bg-slate-50 text-slate-400 border-slate-100 hover:border-slate-400'}`}>
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-4">
              <button onClick={() => setShowExpModal(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs tracking-widest">Fechar</button>
              <button onClick={handleAddExpense}
                className="flex-1 py-4 bg-orange-500 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-orange-100">
                Lançar Agora
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const FinCard = ({ title, val, icon, color, highlight, sub }: any) => (
  <div className={`bg-white p-5 rounded-[28px] border-2 shadow-lg transition-all ${highlight ? 'border-orange-500 scale-105 shadow-orange-100/50' : 'border-slate-100 shadow-slate-100/50 hover:border-black'}`}>
    <div className="text-xl mb-3">{icon}</div>
    <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</h4>
    <p className={`text-lg font-black ${color || 'text-black'}`}>{val}</p>
    {sub && <p className="text-[9px] text-slate-400 mt-1">{sub}</p>}
  </div>
);

export default FinancialView;
