import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/mockDb';
import { PLAN_CONFIGS, PlanId } from '../config/planConfig';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const PLANS: PlanId[] = ['START', 'PROFISSIONAL', 'ELITE'];

type Step = 'plan' | 'payment' | 'loading' | 'waiting';

const TrialExpiredView: React.FC<{
  tenantId: string;
  onActivated?: () => void;
}> = ({ tenantId, onActivated }) => {
  const [step, setStep] = useState<Step>('plan');
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  const handleSelectPlan = (planId: PlanId) => {
    setSelectedPlan(planId);
    setStep('payment');
    setError(null);
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
        body: JSON.stringify({ tenantId, planId: selectedPlan, billingType }),
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

  const startPolling = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      try {
        const settings = await db.getSettings(tenantId);
        // When webhook processes PAYMENT_RECEIVED, it clears trialStartDate
        if (!settings.trialStartDate) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          onActivated?.();
        }
      } catch { /* ignore polling errors */ }
    }, 5000);
  };

  const handleBack = () => {
    setStep('plan');
    setSelectedPlan(null);
    setError(null);
  };

  return (
    <div className="min-h-full bg-slate-50 flex items-center justify-center p-8">
      <div className="w-full max-w-4xl space-y-10">

        {/* Header */}
        <div className="text-center space-y-3">
          <div className="w-16 h-16 bg-slate-100 rounded-[20px] flex items-center justify-center mx-auto text-3xl">
            {step === 'waiting' ? '⏳' : '🔒'}
          </div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">
            {step === 'waiting'
              ? 'Aguardando pagamento'
              : step === 'payment'
                ? 'Forma de pagamento'
                : 'Período de teste encerrado'}
          </h1>
          <p className="text-sm font-bold text-slate-400 max-w-md mx-auto">
            {step === 'waiting'
              ? 'Após confirmar o pagamento, sua conta será ativada automaticamente.'
              : step === 'payment'
                ? `Plano ${PLAN_CONFIGS[selectedPlan!]?.name} — R$ ${PLAN_CONFIGS[selectedPlan!]?.price.toFixed(2).replace('.', ',')}/mês`
                : 'Seus dados estão salvos e seguros. Escolha um plano para continuar usando o AgendeZap com todos os recursos.'}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-[24px] p-6 text-center">
            <p className="text-xs font-bold text-red-600">{error}</p>
          </div>
        )}

        {/* ── Step: Plan Selection ── */}
        {step === 'plan' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PLANS.map(planId => {
              const cfg = PLAN_CONFIGS[planId];
              return (
                <div
                  key={planId}
                  className="bg-white rounded-[32px] border-2 border-slate-100 hover:border-slate-300 p-8 space-y-6 transition-all"
                >
                  <div className="space-y-1">
                    <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${cfg.bgClass} ${cfg.textClass}`}>
                      {cfg.badge}
                    </span>
                    <h3 className="text-xl font-black text-black uppercase tracking-tight mt-2">{cfg.name}</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">{cfg.subtitle}</p>
                  </div>

                  <div>
                    <span className="text-3xl font-black text-black">R$ {cfg.price.toFixed(2).replace('.', ',')}</span>
                    <span className="text-xs font-bold text-slate-400">/mês</span>
                  </div>

                  <ul className="space-y-2">
                    {cfg.features.slice(0, 5).map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-[10px] font-bold text-slate-600">
                        <span className="text-orange-500 mt-0.5">✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                    {cfg.features.length > 5 && (
                      <li className="text-[10px] font-black text-slate-400 ml-4">
                        + {cfg.features.length - 5} mais...
                      </li>
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

        {/* ── Step: Payment Method ── */}
        {step === 'payment' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-lg mx-auto">
              <button
                onClick={() => handleSelectPayment('PIX')}
                className="bg-white rounded-[24px] border-2 border-slate-100 hover:border-green-300 hover:shadow-lg p-8 space-y-4 transition-all text-center group"
              >
                <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto text-2xl group-hover:scale-110 transition-transform">
                  <svg viewBox="0 0 24 24" className="w-8 h-8 text-green-600" fill="currentColor">
                    <path d="M17.2 14.63c-.41.41-.97.63-1.54.63s-1.13-.22-1.54-.63l-2.83-2.83a.5.5 0 0 0-.71 0l-2.83 2.83c-.41.41-.97.63-1.54.63s-1.13-.22-1.54-.63L2.5 12.5l2.17-2.13c.41-.41.97-.63 1.54-.63s1.13.22 1.54.63l2.83 2.83a.5.5 0 0 0 .71 0l2.83-2.83c.41-.41.97-.63 1.54-.63s1.13.22 1.54.63L19.37 12.5l-2.17 2.13z"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-black text-black uppercase">Pix</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-1">Pagamento instantâneo</p>
                </div>
              </button>

              <button
                onClick={() => handleSelectPayment('CREDIT_CARD')}
                className="bg-white rounded-[24px] border-2 border-slate-100 hover:border-blue-300 hover:shadow-lg p-8 space-y-4 transition-all text-center group"
              >
                <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto text-2xl group-hover:scale-110 transition-transform">
                  <svg viewBox="0 0 24 24" className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="5" width="20" height="14" rx="2" />
                    <line x1="2" y1="10" x2="22" y2="10" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-black text-black uppercase">Cartão de Crédito</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-1">Débito automático mensal</p>
                </div>
              </button>
            </div>

            <div className="text-center">
              <button
                onClick={handleBack}
                className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest"
              >
                ← Voltar para planos
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Loading ── */}
        {step === 'loading' && (
          <div className="text-center py-12 space-y-4">
            <div className="w-12 h-12 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto" />
            <p className="text-sm font-bold text-slate-500">Gerando sua assinatura...</p>
          </div>
        )}

        {/* ── Step: Waiting for payment ── */}
        {step === 'waiting' && (
          <div className="space-y-6">
            <div className="bg-orange-50 border-2 border-orange-200 rounded-[24px] p-8 text-center space-y-4">
              <div className="w-12 h-12 border-4 border-orange-100 border-t-orange-500 rounded-full animate-spin mx-auto" />
              <div className="space-y-2">
                <p className="text-sm font-black text-orange-700 uppercase tracking-widest">
                  Pagamento em andamento
                </p>
                <p className="text-xs font-bold text-orange-600 max-w-sm mx-auto">
                  Uma nova aba foi aberta para você realizar o pagamento.
                  Assim que confirmarmos, sua conta será ativada automaticamente.
                </p>
              </div>
            </div>

            <div className="text-center space-y-2">
              <p className="text-[10px] font-bold text-slate-300">
                Não viu a aba de pagamento? Verifique se o bloqueador de pop-ups está desativado.
              </p>
              <button
                onClick={handleBack}
                className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest"
              >
                ← Escolher outro plano
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        {step === 'plan' && (
          <p className="text-center text-[10px] font-bold text-slate-300 uppercase tracking-widest">
            Pagamento seguro via Asaas. Cancele quando quiser.
          </p>
        )}
      </div>
    </div>
  );
};

export default TrialExpiredView;
