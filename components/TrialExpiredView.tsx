import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/mockDb';
import { PLAN_CONFIGS, PlanId } from '../config/planConfig';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://cnnfnqrnjckntnxdgwae.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubmZucXJuamNrbnRueGRnd2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MTM3NzksImV4cCI6MjA4NzE4OTc3OX0.ANyOJVIsBv0GWuJyUmdicRrgHqZc5VAXRUSua_roO4I';

const PLANS: PlanId[] = ['START', 'PROFISSIONAL', 'ELITE'];

type Cycle = 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';
type Step = 'plan' | 'cycle' | 'cpf' | 'payment' | 'loading' | 'waiting';

const CYCLE_OPTIONS: { id: Cycle; label: string; months: number; discount: number; tag?: string }[] = [
  { id: 'MONTHLY',      label: 'Mensal',      months: 1,  discount: 0 },
  { id: 'QUARTERLY',    label: 'Trimestral',  months: 3,  discount: 0.10, tag: '10% OFF' },
  { id: 'SEMIANNUALLY', label: 'Semestral',   months: 6,  discount: 0.15, tag: '15% OFF' },
  { id: 'YEARLY',       label: 'Anual',       months: 12, discount: 0.25, tag: '25% OFF' },
];

function calcCyclePrice(monthlyPrice: number, months: number, discount: number) {
  return Math.round(monthlyPrice * months * (1 - discount) * 100) / 100;
}

function fmt(v: number) {
  return v.toFixed(2).replace('.', ',');
}

function formatCpfCnpj(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 11) {
    // CPF: 000.000.000-00
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  // CNPJ: 00.000.000/0000-00
  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

function isValidCpfCnpj(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 || digits.length === 14;
}

const TrialExpiredView: React.FC<{
  tenantId: string;
  mode?: 'trial_expired' | 'pending_payment';
  onActivated?: () => void;
}> = ({ tenantId, mode = 'trial_expired', onActivated }) => {
  const [step, setStep] = useState<Step>('plan');
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<Cycle>('MONTHLY');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  const handleSelectPlan = (planId: PlanId) => {
    setSelectedPlan(planId);
    setSelectedCycle('MONTHLY');
    setStep('cycle');
    setError(null);
  };

  const handleSelectCycle = (cycle: Cycle) => {
    setSelectedCycle(cycle);
    setStep('cpf');
    setError(null);
  };

  const handleCpfSubmit = () => {
    if (!isValidCpfCnpj(cpfCnpj)) {
      setError('Informe um CPF (11 digitos) ou CNPJ (14 digitos) valido.');
      return;
    }
    setError(null);
    setStep('payment');
  };

  const handleSelectPayment = async (billingType: 'PIX' | 'CREDIT_CARD') => {
    if (!selectedPlan) return;
    setStep('loading');
    setError(null);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/asaas-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          tenantId,
          planId: selectedPlan,
          billingType,
          cycle: selectedCycle,
          cpfCnpj: cpfCnpj.replace(/\D/g, ''),
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Erro ao criar assinatura');
      }

      if (data.invoiceUrl) {
        window.open(data.invoiceUrl, '_blank');
      }

      setStep('waiting');
      startPolling();
    } catch (err: any) {
      setError(err.message || 'Erro inesperado. Tente novamente.');
      setStep('payment');
    }
  };

  const callAsaasVerify = async (): Promise<'activated' | 'pending' | 'not_paid' | 'error'> => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/asaas-verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ tenantId }),
      });
      const data = await res.json();
      return data.status || 'error';
    } catch {
      return 'error';
    }
  };

  const handleVerifyPayment = async () => {
    setVerifying(true);
    setError(null);
    const status = await callAsaasVerify();
    setVerifying(false);
    if (status === 'activated') {
      if (pollingRef.current) clearInterval(pollingRef.current);
      onActivated?.();
    } else if (status === 'pending') {
      setError('Pagamento ainda pendente. Aguarde a confirmacao ou tente novamente em alguns instantes.');
    } else if (status === 'not_paid') {
      setError('Nenhum pagamento encontrado. Realize o pagamento na aba aberta e tente novamente.');
    } else {
      setError('Nao foi possivel verificar. Tente novamente em alguns instantes.');
    }
  };

  const startPolling = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        // First try asaas-verify (direct Asaas API check — works even if webhook fails)
        const verifyStatus = await callAsaasVerify();
        if (verifyStatus === 'activated') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          onActivated?.();
          return;
        }
        // Fallback: check DB directly
        if (mode === 'pending_payment') {
          const tenant = await db.getTenant(tenantId);
          if (tenant?.status === 'ATIVA') {
            if (pollingRef.current) clearInterval(pollingRef.current);
            onActivated?.();
          }
        } else {
          const settings = await db.getSettings(tenantId);
          if (!settings.trialStartDate) {
            if (pollingRef.current) clearInterval(pollingRef.current);
            onActivated?.();
          }
        }
      } catch { /* ignore */ }
    }, 10000);
  };

  const handleBack = () => {
    setError(null);
    if (step === 'payment') { setStep('cpf'); }
    else if (step === 'cpf') { setStep('cycle'); }
    else if (step === 'cycle') { setStep('plan'); setSelectedPlan(null); }
    else { setStep('plan'); setSelectedPlan(null); }
  };

  const planCfg = selectedPlan ? PLAN_CONFIGS[selectedPlan] : null;
  const cycleCfg = CYCLE_OPTIONS.find(c => c.id === selectedCycle)!;
  const cycleTotal = planCfg ? calcCyclePrice(planCfg.price, cycleCfg.months, cycleCfg.discount) : 0;

  // Header text per step
  const headerIcon = step === 'waiting' ? '⏳' : step === 'loading' ? '⏳' : mode === 'pending_payment' ? '🚀' : '🔒';
  const headerTitle =
    step === 'waiting' ? 'Aguardando pagamento'
    : step === 'loading' ? 'Gerando assinatura...'
    : step === 'payment' ? 'Forma de pagamento'
    : step === 'cpf' ? 'Dados para cobranca'
    : step === 'cycle' ? 'Periodo de assinatura'
    : mode === 'pending_payment' ? 'Escolha seu plano para comecar'
    : 'Periodo de teste encerrado';
  const headerSubtitle =
    step === 'waiting' ? 'Apos confirmar o pagamento, sua conta sera ativada automaticamente.'
    : step === 'payment' ? `${planCfg?.name} ${cycleCfg.label} — R$ ${fmt(cycleTotal)}`
    : step === 'cpf' ? `${planCfg?.name} ${cycleCfg.label} — R$ ${fmt(cycleTotal)}`
    : step === 'cycle' ? `Plano ${planCfg?.name} — escolha o periodo`
    : mode === 'pending_payment' ? 'Selecione o plano ideal para seu negocio. Cancele gratis nos primeiros 7 dias.'
    : 'Seus dados estao salvos e seguros. Escolha um plano para continuar usando o AgendeZap.';

  return (
    <div className="min-h-full flex items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-4xl space-y-8">

        {/* Header */}
        <div className="text-center space-y-3">
          <div className="w-16 h-16 bg-slate-100 rounded-[20px] flex items-center justify-center mx-auto text-3xl">{headerIcon}</div>
          <h1 className="text-2xl md:text-3xl font-black text-black uppercase tracking-tight">{headerTitle}</h1>
          <p className="text-sm font-bold text-slate-400 max-w-md mx-auto">{headerSubtitle}</p>
        </div>

        {error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-[24px] p-6 text-center">
            <p className="text-xs font-bold text-red-600">{error}</p>
          </div>
        )}

        {/* ── Step 1: Plan Selection ── */}
        {step === 'plan' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PLANS.map(planId => {
              const cfg = PLAN_CONFIGS[planId];
              return (
                <div key={planId} className="bg-white rounded-[32px] border-2 border-slate-100 hover:border-slate-300 p-8 space-y-6 transition-all">
                  <div className="space-y-1">
                    <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${cfg.bgClass} ${cfg.textClass}`}>
                      {cfg.badge}
                    </span>
                    <h3 className="text-xl font-black text-black uppercase tracking-tight mt-2">{cfg.name}</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">{cfg.subtitle}</p>
                  </div>

                  <div>
                    <span className="text-3xl font-black text-black">R$ {fmt(cfg.price)}</span>
                    <span className="text-xs font-bold text-slate-400">/mes</span>
                  </div>

                  <ul className="space-y-2">
                    {cfg.features.slice(0, 5).map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-[10px] font-bold text-slate-600">
                        <span className="text-orange-500 mt-0.5">✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                    {cfg.features.length > 5 && (
                      <li className="text-[10px] font-black text-slate-400 ml-4">+ {cfg.features.length - 5} mais...</li>
                    )}
                  </ul>

                  <button
                    onClick={() => handleSelectPlan(planId)}
                    className="w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all bg-black text-white hover:bg-orange-500"
                  >
                    Quero o {cfg.name}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Step 2: Cycle Selection ── */}
        {step === 'cycle' && planCfg && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
              {CYCLE_OPTIONS.map(opt => {
                const total = calcCyclePrice(planCfg.price, opt.months, opt.discount);
                const monthlyEquiv = total / opt.months;
                const saving = opt.discount > 0
                  ? planCfg.price * opt.months - total
                  : 0;

                return (
                  <button
                    key={opt.id}
                    onClick={() => handleSelectCycle(opt.id)}
                    className="bg-white rounded-[24px] border-2 border-slate-100 hover:border-orange-300 hover:shadow-lg p-6 space-y-3 transition-all text-center relative"
                  >
                    {opt.tag && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-wider">
                        {opt.tag}
                      </span>
                    )}
                    <p className="text-sm font-black text-black uppercase">{opt.label}</p>
                    <div>
                      <span className="text-2xl font-black text-black">R$ {fmt(total)}</span>
                      {opt.months > 1 && (
                        <p className="text-[10px] font-bold text-slate-400 mt-1">
                          = R$ {fmt(monthlyEquiv)}/mes
                        </p>
                      )}
                    </div>
                    {saving > 0 && (
                      <p className="text-[10px] font-black text-green-600">
                        Economia de R$ {fmt(saving)}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="text-center">
              <button onClick={handleBack} className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest">
                ← Voltar para planos
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: CPF/CNPJ ── */}
        {step === 'cpf' && (
          <div className="space-y-6 max-w-md mx-auto">
            <div className="bg-white rounded-[24px] border-2 border-slate-100 p-8 space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-black uppercase tracking-widest">CPF ou CNPJ</label>
                <input
                  type="text"
                  value={cpfCnpj}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, '').slice(0, 14);
                    setCpfCnpj(formatCpfCnpj(raw));
                  }}
                  placeholder="000.000.000-00"
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-orange-500 focus:bg-white transition-all font-bold text-center text-lg tracking-wider"
                  autoFocus
                />
                <p className="text-[10px] font-bold text-slate-400 text-center">Necessario para emissao da cobranca</p>
              </div>
              <button
                onClick={handleCpfSubmit}
                className="w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all bg-black text-white hover:bg-orange-500"
              >
                Continuar
              </button>
            </div>
            <div className="text-center">
              <button onClick={handleBack} className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest">
                ← Voltar para periodo
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Payment Method ── */}
        {step === 'payment' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-lg mx-auto">
              <button
                onClick={() => handleSelectPayment('PIX')}
                className="bg-white rounded-[24px] border-2 border-slate-100 hover:border-green-300 hover:shadow-lg p-8 space-y-4 transition-all text-center group"
              >
                <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                  <svg viewBox="0 0 512 512" className="w-8 h-8 text-green-600" fill="currentColor">
                    <path d="M346.5 271.5l-89.2-89.2c-4.7-4.7-12.3-4.7-17 0l-89.2 89.2c-14.6 14.6-34 22.6-54.6 22.6H82.2l113.4 113.4c25 25 65.5 25 90.5 0L399.5 294h-7.4c-20.6 0-40-8-54.6-22.5zm17-31l89.2-89.2c-14.6-14.6-22.6-34-22.6-54.6v-14.3L316.7 195.8c-25 25-65.5 25-90.5 0L112.8 82.4V96.7c0 20.6-8 40-22.6 54.6l89.2 89.2c4.7 4.7 12.3 4.7 17 0l89.2-89.2c14.6-14.6 34-22.6 54.6-22.6h14.3z"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-black text-black uppercase">Pix</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-1">Pagamento instantaneo</p>
                </div>
              </button>

              <button
                onClick={() => handleSelectPayment('CREDIT_CARD')}
                className="bg-white rounded-[24px] border-2 border-slate-100 hover:border-blue-300 hover:shadow-lg p-8 space-y-4 transition-all text-center group"
              >
                <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                  <svg viewBox="0 0 24 24" className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="5" width="20" height="14" rx="2" />
                    <line x1="2" y1="10" x2="22" y2="10" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-black text-black uppercase">Cartao de Credito</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-1">Debito automatico</p>
                </div>
              </button>
            </div>

            <div className="text-center">
              <button onClick={handleBack} className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest">
                ← Voltar
              </button>
            </div>
          </div>
        )}

        {/* ── Loading ── */}
        {step === 'loading' && (
          <div className="text-center py-12 space-y-4">
            <div className="w-12 h-12 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto" />
            <p className="text-sm font-bold text-slate-500">Gerando sua assinatura...</p>
          </div>
        )}

        {/* ── Waiting ── */}
        {step === 'waiting' && (
          <div className="space-y-6">
            <div className="bg-orange-50 border-2 border-orange-200 rounded-[24px] p-8 text-center space-y-4">
              <div className="w-12 h-12 border-4 border-orange-100 border-t-orange-500 rounded-full animate-spin mx-auto" />
              <div className="space-y-2">
                <p className="text-sm font-black text-orange-700 uppercase tracking-widest">Pagamento em andamento</p>
                <p className="text-xs font-bold text-orange-600 max-w-sm mx-auto">
                  Uma nova aba foi aberta para voce realizar o pagamento.
                  Assim que confirmarmos, sua conta sera ativada automaticamente.
                </p>
              </div>
            </div>
            <div className="text-center space-y-3">
              <button
                onClick={handleVerifyPayment}
                disabled={verifying}
                className={`px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${
                  verifying
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-200'
                }`}
              >
                {verifying ? 'Verificando...' : 'Ja paguei — Verificar'}
              </button>
              <p className="text-[10px] font-bold text-slate-300">Nao viu a aba? Verifique o bloqueador de pop-ups.</p>
              <button onClick={() => { setStep('plan'); setSelectedPlan(null); }} className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest">
                ← Escolher outro plano
              </button>
            </div>
          </div>
        )}

        {step === 'plan' && (
          <p className="text-center text-[10px] font-bold text-slate-300 uppercase tracking-widest">
            Pagamento seguro via Asaas. {mode === 'pending_payment' ? 'Cancele gratis em ate 7 dias.' : 'Cancele quando quiser.'}
          </p>
        )}
      </div>
    </div>
  );
};

export default TrialExpiredView;
