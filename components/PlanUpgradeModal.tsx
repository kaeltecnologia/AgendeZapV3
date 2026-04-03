
import React, { useState, useRef, useEffect } from 'react';
import { FeatureKey, PlanId, PLAN_CONFIGS, getPlanConfig, cheapestUpgradePlan } from '../config/planConfig';
import { db } from '../services/mockDb';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://cnnfnqrnjckntnxdgwae.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubmZucXJuamNrbnRueGRnd2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MTM3NzksImV4cCI6MjA4NzE4OTc3OX0.ANyOJVIsBv0GWuJyUmdicRrgHqZc5VAXRUSua_roO4I';

interface Props {
  feature: FeatureKey;
  tenantPlan: string;
  tenantId: string;
  onClose: () => void;
  onActivated?: () => void;
}

const FEATURE_LABELS: Record<FeatureKey, string> = {
  agenteIA: 'Agente IA (WhatsApp)',
  financeiro: 'Financeiro Essencial',
  performance: 'Performance e Metas',
  caixaAvancado: 'Caixa Avançado',
  relatorios: 'Relatórios',
  relatoriosAvancados: 'Relatórios Comparativos',
  reativacao: 'Reativação Automática',
  disparo: 'Disparador Segmentado',
  socialMidia: 'Social Mídia com IA',
  assistenteAdmin: 'Assistente Admin (WhatsApp)',
};

const ALL_FEATURES: FeatureKey[] = [
  'agenteIA', 'financeiro', 'performance', 'relatorios', 'reativacao',
  'disparo', 'socialMidia', 'caixaAvancado', 'relatoriosAvancados', 'assistenteAdmin',
];

type Cycle = 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';
type Step = 'compare' | 'cpf' | 'cycle' | 'payment' | 'loading' | 'waiting';

const CYCLE_OPTIONS: { id: Cycle; label: string; months: number; discount: number; tag?: string }[] = [
  { id: 'MONTHLY',      label: 'Mensal',     months: 1,  discount: 0 },
  { id: 'QUARTERLY',    label: 'Trimestral', months: 3,  discount: 0.10, tag: '10% OFF' },
  { id: 'SEMIANNUALLY', label: 'Semestral',  months: 6,  discount: 0.15, tag: '15% OFF' },
  { id: 'YEARLY',       label: 'Anual',      months: 12, discount: 0.25, tag: '25% OFF' },
];

function calcCyclePrice(monthlyPrice: number, months: number, discount: number) {
  return Math.round(monthlyPrice * months * (1 - discount) * 100) / 100;
}

function fmt(v: number) { return v.toFixed(2).replace('.', ','); }

function formatCpfCnpj(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
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

/** Calculate pro-rata upgrade discount (mirrors edge function logic) */
function calcUpgradeDiscount(currentPlanPrice: number, lastPaymentDate: string): { discount: number; daysElapsed: number } {
  const last = new Date(lastPaymentDate + 'T00:00:00');
  const now = new Date();
  const diffMs = now.getTime() - last.getTime();
  const daysElapsed = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  if (daysElapsed <= 15) {
    return { discount: currentPlanPrice, daysElapsed };
  }

  const daysRemaining = Math.max(0, 30 - daysElapsed);
  const discount = Math.round(currentPlanPrice * (daysRemaining / 30) * 100) / 100;
  return { discount, daysElapsed };
}

const PlanUpgradeModal: React.FC<Props> = ({ feature, tenantPlan, tenantId, onClose, onActivated }) => {
  const currentConfig = getPlanConfig(tenantPlan);
  const recommendedConfig = cheapestUpgradePlan(feature);
  const eliteConfig = PLAN_CONFIGS.ELITE;
  const showElite = recommendedConfig.id !== 'ELITE';

  const upgradePlans = showElite
    ? [recommendedConfig, eliteConfig]
    : [eliteConfig];

  const [selectedPlan, setSelectedPlan] = useState<PlanId>(recommendedConfig.id);
  const [step, setStep] = useState<Step>('compare');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [selectedCycle, setSelectedCycle] = useState<Cycle>('MONTHLY');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Upgrade discount state
  const [lastPaymentDate, setLastPaymentDate] = useState<string | null>(null);
  const [asaasPlanId, setAsaasPlanId] = useState<string | null>(null);

  const selectedConfig = getPlanConfig(selectedPlan);

  // Fetch payment date for discount calculation
  useEffect(() => {
    db.getSettings(tenantId).then(s => {
      if (s.asaasLastPaymentDate) setLastPaymentDate(s.asaasLastPaymentDate);
      if (s.asaasPlanId) setAsaasPlanId(s.asaasPlanId);
    });
  }, [tenantId]);

  // Calculate discount if upgrade
  const isUpgrade = !!(lastPaymentDate && asaasPlanId && currentConfig.price > 0);
  const upgradeResult = isUpgrade ? calcUpgradeDiscount(currentConfig.price, lastPaymentDate) : null;
  const upgradeDiscount = upgradeResult?.discount || 0;

  const firstMonthValue = isUpgrade
    ? Math.max(0, Math.round((selectedConfig.price - upgradeDiscount) * 100) / 100)
    : selectedConfig.price;

  const startPolling = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      const status = await callAsaasVerify();
      if (status === 'activated') {
        if (pollingRef.current) clearInterval(pollingRef.current);
        onActivated?.();
      }
    }, 15000);
  };

  const callAsaasVerify = async (): Promise<string> => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/asaas-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ tenantId }),
      });
      const data = await res.json();
      return data.status || 'error';
    } catch { return 'error'; }
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
      setError('Pagamento pendente. Aguarde a confirmação ou tente novamente.');
    } else if (status === 'not_paid') {
      setError('Nenhum pagamento encontrado. Realize o pagamento e tente novamente.');
    } else {
      setError('Não foi possível verificar. Tente novamente.');
    }
  };

  const handleSelectPayment = async (billingType: 'PIX' | 'CREDIT_CARD') => {
    setStep('loading');
    setError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/asaas-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          tenantId,
          planId: selectedPlan,
          billingType,
          cycle: selectedCycle,
          cpfCnpj: cpfCnpj.replace(/\D/g, ''),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Erro ao criar assinatura');
      if (data.invoiceUrl) window.open(data.invoiceUrl, '_blank');
      setStep('waiting');
      startPolling();
    } catch (err: any) {
      setError(err.message || 'Erro inesperado. Tente novamente.');
      setStep('payment');
    }
  };

  const handleCpfSubmit = () => {
    if (!isValidCpfCnpj(cpfCnpj)) {
      setError('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.');
      return;
    }
    setError(null);
    setStep('cycle');
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-[32px] w-full max-w-md p-7 space-y-5 animate-scaleUp max-h-[95vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-orange-100 rounded-2xl flex items-center justify-center text-2xl mx-auto">
            {step === 'waiting' ? '📄' : step === 'loading' ? '⏳' : '🔒'}
          </div>
          {step === 'compare' && (
            <>
              <p className="text-lg font-black text-black uppercase tracking-tight">Faça o Upgrade</p>
              <p className="text-xs text-slate-500">
                <strong>{FEATURE_LABELS[feature]}</strong> requer o plano{' '}
                <span style={{ color: recommendedConfig.color }} className="font-black">{recommendedConfig.name}</span> ou superior
              </p>
            </>
          )}
          {step === 'cpf' && (
            <>
              <p className="text-lg font-black text-black uppercase tracking-tight">CPF ou CNPJ</p>
              <p className="text-xs text-slate-400">Necessário para emissão da cobrança</p>
            </>
          )}
          {step === 'cycle' && (
            <>
              <p className="text-lg font-black text-black uppercase tracking-tight">Período</p>
              <p className="text-xs text-slate-400">Quanto maior o período, maior o desconto</p>
            </>
          )}
          {step === 'payment' && (
            <>
              <p className="text-lg font-black text-black uppercase tracking-tight">Pagamento</p>
              <p className="text-xs text-slate-400">
                {selectedConfig.emoji} {selectedConfig.name} — {CYCLE_OPTIONS.find(c => c.id === selectedCycle)?.label}
                {isUpgrade && upgradeDiscount > 0
                  ? ` — 1a cobrança: R$${fmt(firstMonthValue)}`
                  : ` — R$${fmt(calcCyclePrice(selectedConfig.price, CYCLE_OPTIONS.find(c => c.id === selectedCycle)!.months, CYCLE_OPTIONS.find(c => c.id === selectedCycle)!.discount))}`
                }
              </p>
            </>
          )}
          {step === 'loading' && (
            <>
              <p className="text-lg font-black text-black uppercase tracking-tight">Gerando cobrança...</p>
              <p className="text-xs text-slate-400">Aguarde, estamos criando sua assinatura</p>
            </>
          )}
          {step === 'waiting' && (
            <>
              <p className="text-lg font-black text-black uppercase tracking-tight">Cobrança Gerada!</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Uma nova aba foi aberta com o link de pagamento.<br />
                Após pagar, clique abaixo para ativar seu plano.
              </p>
            </>
          )}
        </div>

        {/* ── STEP: Compare ── */}
        {step === 'compare' && (
          <div className="space-y-4">
            {/* Plan cards */}
            <div className="space-y-2.5">
              {upgradePlans.map(plan => {
                const isSelected = selectedPlan === plan.id;
                const planGains = ALL_FEATURES.filter(f => !currentConfig.permissions[f] && plan.permissions[f]);
                const planFirstMonth = isUpgrade
                  ? Math.max(0, Math.round((plan.price - upgradeDiscount) * 100) / 100)
                  : plan.price;
                return (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan.id as PlanId)}
                    className={`w-full text-left rounded-2xl border-2 p-4 transition-all ${
                      isSelected
                        ? 'border-orange-400 bg-orange-50 shadow-md'
                        : 'border-slate-100 bg-slate-50 hover:border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{plan.emoji}</span>
                        <div>
                          <p className="text-sm font-black text-black">{plan.name}</p>
                          <p className="text-[10px] text-slate-400 font-bold">{plan.subtitle}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-black" style={{ color: plan.color }}>
                          R${fmt(plan.price)}<span className="text-[9px] font-bold text-slate-400">/mês</span>
                        </p>
                        {plan.maxProfessionals >= 9999
                          ? <p className="text-[9px] text-slate-400 font-bold">Profissionais ilimitados</p>
                          : <p className="text-[9px] text-slate-400 font-bold">Até {plan.maxProfessionals} profissionais</p>
                        }
                      </div>
                    </div>
                    {/* Upgrade discount badge */}
                    {isUpgrade && upgradeDiscount > 0 && (
                      <div className="mb-2 bg-green-50 border border-green-200 rounded-xl px-3 py-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold text-green-700">Desconto pro-rata: -R${fmt(upgradeDiscount)}</span>
                          <span className="text-[9px] font-black text-green-700">1a cobrança: R${fmt(planFirstMonth)}</span>
                        </div>
                      </div>
                    )}
                    {/* Gains chips */}
                    <div className="flex flex-wrap gap-1">
                      {planGains.map(f => (
                        <span
                          key={f}
                          className={`text-[8px] font-black px-2 py-0.5 rounded-full ${
                            f === feature
                              ? 'bg-orange-500 text-white'
                              : 'bg-white text-slate-500 border border-slate-200'
                          }`}
                        >
                          {f === feature ? '★ ' : '+ '}{FEATURE_LABELS[f]}
                        </span>
                      ))}
                    </div>
                    {/* Selection indicator */}
                    {isSelected && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <div className="w-4 h-4 rounded-full bg-orange-500 flex items-center justify-center">
                          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        </div>
                        <span className="text-[10px] font-black text-orange-600 uppercase">Selecionado</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* CTA */}
            <button
              onClick={() => { setError(null); setStep('cpf'); }}
              className="w-full py-3.5 rounded-2xl font-black uppercase text-xs tracking-widest text-white transition-all hover:opacity-90 shadow-lg"
              style={{ backgroundColor: selectedConfig.color }}
            >
              {isUpgrade && upgradeDiscount > 0
                ? `Upgrade para ${selectedConfig.name} — R$${fmt(firstMonthValue)} hoje`
                : `Assinar ${selectedConfig.name} — R$${fmt(selectedConfig.price)}/mês`
              }
            </button>
            <button onClick={onClose} className="w-full py-1 font-bold text-slate-400 text-[10px] hover:text-slate-600 transition-all">
              Fechar
            </button>
          </div>
        )}

        {/* ── STEP: CPF/CNPJ ── */}
        {step === 'cpf' && (
          <div className="space-y-3">
            <input
              type="text"
              value={cpfCnpj}
              onChange={e => setCpfCnpj(formatCpfCnpj(e.target.value))}
              placeholder="000.000.000-00"
              maxLength={18}
              className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm text-center focus:border-orange-500 transition-colors"
            />
            {error && <p className="text-[10px] font-bold text-red-500 text-center">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setError(null); setStep('compare'); }} className="flex-1 py-3 font-black text-slate-400 uppercase text-xs border-2 border-slate-100 rounded-2xl hover:border-slate-300 transition-all">
                Voltar
              </button>
              <button onClick={handleCpfSubmit} className="flex-1 py-3 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all">
                Continuar
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: Cycle ── */}
        {step === 'cycle' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {CYCLE_OPTIONS.map(opt => {
                const total = calcCyclePrice(selectedConfig.price, opt.months, opt.discount);
                const perMonth = total / opt.months;
                const isSelected = selectedCycle === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setSelectedCycle(opt.id)}
                    className={`p-3 rounded-2xl border-2 text-left transition-all ${
                      isSelected
                        ? 'border-orange-500 bg-orange-50 shadow-md'
                        : 'border-slate-100 bg-slate-50 hover:border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className={`text-[10px] font-black uppercase tracking-wide ${isSelected ? 'text-orange-600' : 'text-slate-600'}`}>
                        {opt.label}
                      </p>
                      {opt.tag && (
                        <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-green-100 text-green-600">
                          {opt.tag}
                        </span>
                      )}
                    </div>
                    <p className={`text-sm font-black ${isSelected ? 'text-orange-600' : 'text-black'}`}>
                      R${fmt(total)}
                    </p>
                    {opt.months > 1 && (
                      <p className="text-[9px] text-slate-400 font-bold">= R${fmt(perMonth)}/mês</p>
                    )}
                  </button>
                );
              })}
            </div>
            {/* Upgrade discount reminder */}
            {isUpgrade && upgradeDiscount > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-center">
                <p className="text-[9px] font-black text-green-700">
                  Desconto pro-rata aplicado na 1a cobrança: -R${fmt(upgradeDiscount)}
                </p>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setError(null); setStep('cpf'); }} className="flex-1 py-3 font-black text-slate-400 uppercase text-xs border-2 border-slate-100 rounded-2xl hover:border-slate-300 transition-all">
                Voltar
              </button>
              <button onClick={() => { setError(null); setStep('payment'); }} className="flex-1 py-3 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all">
                Continuar
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: Payment ── */}
        {step === 'payment' && (
          <div className="space-y-3">
            {error && <p className="text-[10px] font-bold text-red-500 text-center">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleSelectPayment('PIX')}
                className="p-5 rounded-2xl border-2 border-green-200 bg-green-50 hover:border-green-400 hover:shadow-md transition-all flex flex-col items-center gap-2"
              >
                <span className="text-3xl">🟢</span>
                <span className="text-xs font-black uppercase text-green-700">PIX</span>
                <span className="text-[9px] text-green-600 font-bold">Aprovação imediata</span>
              </button>
              <button
                onClick={() => handleSelectPayment('CREDIT_CARD')}
                className="p-5 rounded-2xl border-2 border-blue-200 bg-blue-50 hover:border-blue-400 hover:shadow-md transition-all flex flex-col items-center gap-2"
              >
                <span className="text-3xl">💳</span>
                <span className="text-xs font-black uppercase text-blue-700">Cartão</span>
                <span className="text-[9px] text-blue-600 font-bold">Crédito</span>
              </button>
            </div>
            <button onClick={() => { setError(null); setStep('cycle'); }} className="w-full py-2 font-bold text-slate-400 text-[10px] hover:text-slate-600 transition-all">
              Voltar
            </button>
          </div>
        )}

        {/* ── STEP: Loading ── */}
        {step === 'loading' && (
          <div className="flex justify-center py-4">
            <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* ── STEP: Waiting ── */}
        {step === 'waiting' && (
          <div className="space-y-3">
            {error && <p className="text-[10px] font-bold text-red-500 text-center">{error}</p>}
            <button
              onClick={handleVerifyPayment}
              disabled={verifying}
              className="w-full py-3.5 bg-green-600 text-white rounded-2xl font-black uppercase text-xs hover:bg-green-700 transition-all disabled:opacity-50 shadow-lg shadow-green-600/30"
            >
              {verifying ? 'Verificando...' : '✓ Já paguei — Verificar Pagamento'}
            </button>
            <button onClick={onClose} className="w-full py-1 font-bold text-slate-400 text-[10px] hover:text-slate-600 transition-all">
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlanUpgradeModal;
