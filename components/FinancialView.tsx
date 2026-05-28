
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { PaymentMethod, Professional } from '../types';

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PAYMENT_METHODS = [
  { key: PaymentMethod.PIX,        icon: '📱', label: 'PIX',        barColor: '#16a34a', textColor: '#16a34a', bgClass: 'bg-green-50  border-green-100'  },
  { key: PaymentMethod.MONEY,      icon: '💵', label: 'Dinheiro',   barColor: '#059669', textColor: '#059669', bgClass: 'bg-emerald-50 border-emerald-100' },
  { key: PaymentMethod.DEBIT,      icon: '💳', label: 'Débito',     barColor: '#2563eb', textColor: '#2563eb', bgClass: 'bg-blue-50   border-blue-100'    },
  { key: PaymentMethod.CREDIT,     icon: '💳', label: 'Crédito',    barColor: '#9333ea', textColor: '#9333ea', bgClass: 'bg-purple-50 border-purple-100'  },
] as const;

const FinancialView: React.FC<{ tenantId: string; tenantPlan?: string; refreshTicker?: number }> = ({
  tenantId, refreshTicker = 0
}) => {
  const [period, setPeriod]               = useState(30);
  const [selectedProfId, setSelectedProfId] = useState('');
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [summary, setSummary]             = useState<any>(null);
  const [loading, setLoading]             = useState(true);

  // ── Expense modal state ───────────────────────────────────────────────────
  const [showExpModal, setShowExpModal]           = useState(false);
  const [expDesc, setExpDesc]                     = useState('');
  const [expAmount, setExpAmount]                 = useState(0);
  const [expCategory, setExpCategory]             = useState<'COMPANY' | 'PROFESSIONAL'>('COMPANY');
  const [expProfId, setExpProfId]                 = useState('');
  const [expPaymentMethod, setExpPaymentMethod]   = useState<PaymentMethod>(PaymentMethod.MONEY);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [pros, summ] = await Promise.all([
      db.getProfessionals(tenantId),
      db.getFinancialSummary(tenantId, period, selectedProfId),
    ]);
    setProfessionals(pros);
    setSummary(summ);
    setLoading(false);
  }, [tenantId, period, selectedProfId, refreshTicker]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAddExpense = async () => {
    if (!expDesc || expAmount <= 0) return;
    const today = new Date().toISOString();
    await db.addExpense({
      tenant_id: tenantId, description: expDesc, amount: expAmount,
      category: expCategory,
      professional_id: expCategory === 'PROFESSIONAL' ? expProfId : undefined,
      date: today, paymentMethod: expPaymentMethod,
    });
    if (expCategory === 'PROFESSIONAL' && expProfId) {
      await db.addAdiantamento(tenantId, {
        professionalId: expProfId,
        amount: expAmount,
        date: today.slice(0, 10),
        description: expDesc,
      });
    }
    setExpDesc(''); setExpAmount(0); setExpCategory('COMPANY'); setExpProfId('');
    setExpPaymentMethod(PaymentMethod.MONEY);
    setShowExpModal(false);
    loadData();
  };

  if (loading || !summary) {
    return <div className="p-20 text-center font-black animate-pulse text-slate-300 uppercase tracking-widest">Carregando...</div>;
  }

  const profit  = summary.totalRevenue - summary.totalExpenses;
  const margin  = summary.totalRevenue > 0 ? (profit / summary.totalRevenue * 100) : 0;
  const profitPositive = profit >= 0;

  const prevRevenue: number = summary.prevRevenue || 0;
  const revGrowth = prevRevenue > 0
    ? ((summary.totalRevenue - prevRevenue) / prevRevenue * 100)
    : null;

  return (
    <div className="space-y-8 animate-fadeIn">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-black">Financeiro</h1>
          <p className="text-xs text-slate-400 mt-0.5">Resumo do período selecionado.</p>
        </div>
        <button
          onClick={() => setShowExpModal(true)}
          className="bg-black text-white px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-orange-500 transition-all whitespace-nowrap"
        >
          − Registrar Despesa
        </button>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Profissional */}
        <select
          value={selectedProfId}
          onChange={e => setSelectedProfId(e.target.value)}
          className="p-3 bg-white border-2 border-slate-100 rounded-xl text-[10px] font-black uppercase outline-none focus:border-black"
        >
          <option value="">Todos os profissionais</option>
          {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {/* Período */}
        <div className="flex bg-slate-100 p-1 rounded-xl">
          {([7, 30, 90] as const).map(d => (
            <button
              key={d}
              onClick={() => setPeriod(d)}
              className={`px-4 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${
                period === d ? 'bg-black text-white shadow-sm' : 'text-slate-400 hover:text-black'
              }`}
            >
              {d}D
            </button>
          ))}
        </div>

        <span className="text-[10px] font-bold text-slate-400 hidden sm:block">
          Últimos {period} dias
        </span>
      </div>

      {/* ── 3 KPI Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

        {/* Faturamento */}
        <div className="bg-white rounded-[28px] border-2 border-slate-100 p-6 sm:p-8 space-y-3 hover:border-black transition-all">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Faturamento Total</p>
            <span className="text-lg">📈</span>
          </div>
          <p className="text-3xl sm:text-4xl font-black text-black tabular-nums">
            R$&nbsp;{fmtBRL(summary.totalRevenue)}
          </p>
          {revGrowth !== null && (
            <p className={`text-[10px] font-bold ${revGrowth >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {revGrowth >= 0 ? '▲' : '▼'} {Math.abs(revGrowth).toFixed(1)}% vs período anterior
            </p>
          )}
          {revGrowth === null && (
            <p className="text-[10px] text-slate-300">Receitas confirmadas no período</p>
          )}
        </div>

        {/* Despesas */}
        <div className="bg-white rounded-[28px] border-2 border-slate-100 p-6 sm:p-8 space-y-3 hover:border-black transition-all">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Despesas Pagas</p>
            <span className="text-lg">📉</span>
          </div>
          <p className="text-3xl sm:text-4xl font-black text-black tabular-nums">
            R$&nbsp;{fmtBRL(summary.totalExpenses)}
          </p>
          <p className="text-[10px] text-slate-300">Saídas registradas no período</p>
        </div>

        {/* Lucro Líquido */}
        <div className={`rounded-[28px] p-6 sm:p-8 space-y-3 shadow-xl ${
          profitPositive
            ? 'bg-gradient-to-br from-orange-500 to-orange-600 shadow-orange-200'
            : 'bg-gradient-to-br from-red-500 to-red-600 shadow-red-200'
        }`}>
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black text-white/70 uppercase tracking-widest">Lucro Líquido</p>
            <span className="text-lg">{profitPositive ? '💹' : '⚠️'}</span>
          </div>
          <p className="text-3xl sm:text-4xl font-black text-white tabular-nums">
            R$&nbsp;{fmtBRL(profit)}
          </p>
          <p className="text-[10px] text-white/70">
            Margem {margin.toFixed(1)}% · Faturamento − Despesas
          </p>
        </div>
      </div>

      {/* ── Formas de Pagamento ──────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Formas de Pagamento</h2>
          <div className="flex-1 h-px bg-slate-100" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {PAYMENT_METHODS.map(pm => {
            const val = (summary[pm.key] as number) || 0;
            const pct = summary.totalRevenue > 0 ? (val / summary.totalRevenue * 100) : 0;
            return (
              <div
                key={pm.key}
                className={`bg-white rounded-[24px] border-2 ${pm.bgClass} p-5 space-y-4`}
              >
                {/* Top row */}
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{pm.icon}</span>
                  <span
                    className="text-[10px] font-black px-2 py-1 rounded-full bg-white"
                    style={{ color: pm.textColor }}
                  >
                    {pct.toFixed(1)}%
                  </span>
                </div>

                {/* Label + value */}
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">
                    {pm.label}
                  </p>
                  <p className="text-xl font-black tabular-nums" style={{ color: pm.textColor }}>
                    R$&nbsp;{fmtBRL(val)}
                  </p>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: pm.barColor }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Combined: Dinheiro + PIX vs Cartões */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
          <div className="bg-white rounded-[24px] border-2 border-slate-100 p-5 flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Dinheiro + PIX</p>
              <p className="text-xl font-black text-black tabular-nums">
                R$&nbsp;{fmtBRL((summary[PaymentMethod.MONEY] || 0) + (summary[PaymentMethod.PIX] || 0))}
              </p>
            </div>
            <span className="text-3xl opacity-60">💵</span>
          </div>
          <div className="bg-white rounded-[24px] border-2 border-slate-100 p-5 flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Débito + Crédito</p>
              <p className="text-xl font-black text-black tabular-nums">
                R$&nbsp;{fmtBRL((summary[PaymentMethod.DEBIT] || 0) + (summary[PaymentMethod.CREDIT] || 0))}
              </p>
            </div>
            <span className="text-3xl opacity-60">💳</span>
          </div>
        </div>
      </div>

      {/* ── Expense Modal ─────────────────────────────────────────────────── */}
      {showExpModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md p-10 space-y-7 animate-scaleUp">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-black uppercase">Registrar Despesa</h2>
              <button onClick={() => setShowExpModal(false)} className="text-slate-400 hover:text-black text-xl font-black">✕</button>
            </div>
            <div className="space-y-5">
              <input
                value={expDesc}
                onChange={e => setExpDesc(e.target.value)}
                placeholder="Descrição da despesa..."
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-black"
              />
              <input
                type="number" value={expAmount || ''}
                onChange={e => setExpAmount(Number(e.target.value))}
                placeholder="Valor (R$)"
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-black text-xl focus:border-black"
              />

              {/* Categoria */}
              <div className="flex gap-3">
                {(['COMPANY', 'PROFESSIONAL'] as const).map(cat => (
                  <button
                    key={cat}
                    onClick={() => setExpCategory(cat)}
                    className={`flex-1 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${
                      expCategory === cat ? 'bg-black text-white' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
                    }`}
                  >
                    {cat === 'COMPANY' ? 'Unidade' : 'Profissional'}
                  </button>
                ))}
              </div>

              {expCategory === 'PROFESSIONAL' && (
                <select
                  value={expProfId}
                  onChange={e => setExpProfId(e.target.value)}
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-black"
                >
                  <option value="">Qual profissional?</option>
                  {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}

              {/* Forma de pagamento */}
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Forma de pagamento</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { val: PaymentMethod.MONEY,  icon: '💵', label: 'Dinheiro' },
                    { val: PaymentMethod.PIX,    icon: '📱', label: 'PIX'      },
                    { val: PaymentMethod.DEBIT,  icon: '💳', label: 'Débito'   },
                    { val: PaymentMethod.CREDIT, icon: '💳', label: 'Crédito'  },
                  ] as const).map(({ val, icon, label }) => (
                    <button
                      key={val}
                      onClick={() => setExpPaymentMethod(val)}
                      className={`py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${
                        expPaymentMethod === val
                          ? 'bg-black text-white border-black'
                          : 'bg-slate-50 text-slate-400 border-slate-100 hover:border-slate-300'
                      }`}
                    >
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-4 pt-1">
              <button
                onClick={() => setShowExpModal(false)}
                className="flex-1 py-4 font-black text-slate-400 uppercase text-xs tracking-widest"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddExpense}
                className="flex-1 py-4 bg-orange-500 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-orange-100 hover:bg-black transition-all"
              >
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
