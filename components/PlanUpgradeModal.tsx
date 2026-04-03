
import React, { useState, useRef } from 'react';
import { FeatureKey, PlanConfig, PlanId, PLAN_CONFIGS, getPlanConfig, cheapestUpgradePlan } from '../config/planConfig';

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

const PlanUpgradeModal: React.FC<Props> = ({ feature, tenantPlan, tenantId, onClose, onActivated }) => {
  const currentConfig = getPlanConfig(tenantPlan);
  const recommendedConfig = cheapestUpgradePlan(feature);
  const eliteConfig = PLAN_CONFIGS.ELITE;
  const showElite = recommendedConfig.id !== 'ELITE';

  const [selectedPlan, setSelectedPlan] = useState<PlanId>(recommendedConfig.id);
  const [step, setStep] = useState<Step>('compare');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [selectedCycle, setSelectedCycle] = useState<Cycle>('MONTHLY');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedConfig = getPlanConfig(selectedPlan);

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

  /* ─── Plan column renderer ─── */
  const renderPlanCol = (config: PlanConfig, label: string, isRecommended: boolean) => (
    <div
      className={`rounded-2xl border-2 p-4 relative cursor-pointer transition-all ${config.bgClass} ${config.borderClass} ${
        selectedPlan === config.id && step === 'compare' ? 'ring-2 ring-offset-2 ring-orange-500 scale-[1.02]' : ''
      }`}
      onClick={() => { if (config.id !== currentConfig.id) setSelectedPlan(config.id as PlanId); }}
    >
      {isRecommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
          <span className="text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-widest text-white" style={{ backgroundColor: config.color }}>
            Recomendado
          </span>
        </div>
      )}
      <div className="mb-3">
        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{label}</p>
        <p className={`text-xs font-black uppercase ${config.textClass}`}>{config.emoji} {config.name}</p>
        <p className={`text-[10px] font-bold ${config.textClass}`}>
          {config.price === 0 ? 'Grátis' : `R$${fmt(config.price)}/mês`}
        </p>
      </div>
      <div className="space-y-1.5">
        {ALL_FEATURES.map(f => (
          <div key={f} className={`flex items-start gap-1 ${f === feature ? 'bg-white/60 rounded-md px-1 -mx-1' : ''}`}>
            <span className={`text-[10px] font-black shrink-0 mt-px ${config.permissions[f] ? config.textClass : 'text-slate-200'}`}>
              {config.permissions[f] ? '✓' : '✗'}
            </span>
            <span className={`text-[9px] leading-tight ${config.permissions[f] ? 'text-slate-600 font-bold' : 'text-slate-300'} ${f === feature ? 'font-black' : ''}`}>
              {FEATURE_LABELS[f]}
              {f === feature && !config.permissions[f] && config.id === currentConfig.id && (
                <span className="ml-1 text-[7px] font-black px-1 py-0.5 rounded bg-red-100 text-red-500">BLOQUEADO</span>
              )}
              {f === feature && config.permissions[f] && config.id !== currentConfig.id && (
                <span className={`ml-1 text-[7px] font-black px-1 py-0.5 rounded ${config.bgClass} ${config.textClass}`}>NOVO</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-white rounded-[32px] w-full ${showElite ? 'max-w-3xl' : 'max-w-lg'} p-8 space-y-5 animate-scaleUp max-h-[95vh] overflow-y-auto`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center text-2xl mx-auto">🔒</div>
          <p className="text-lg font-black text-black uppercase tracking-tight">Recurso Bloqueado</p>
          <p className="text-[11px] font-bold text-slate-500">
            <strong>{FEATURE_LABELS[feature]}</strong> está disponível a partir do{' '}
            <span style={{ color: recommendedConfig.color }} className="font-black">{recommendedConfig.badge}</span>
          </p>
        </div>

        {/* Plan comparison grid */}
        <div className={`grid gap-3 ${showElite ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {renderPlanCol(currentConfig, 'Seu plano atual', false)}
          {renderPlanCol(recommendedConfig, 'Fazer upgrade para', true)}
          {showElite && renderPlanCol(eliteConfig, 'Plano completo', false)}
        </div>

        {/* ── STEP: Compare ── */}
        {step === 'compare' && (
          <div className="space-y-3">
            {/* Gains summary */}
            <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1.5">O que você ganha com o {selectedConfig.name}</p>
              <div className="flex flex-wrap gap-1.5">
                {ALL_FEATURES.filter(f => !currentConfig.permissions[f] && selectedConfig.permissions[f]).map(f => (
                  <span key={f} className={`text-[8px] font-black px-2 py-0.5 rounded-lg border uppercase ${selectedConfig.bgClass} ${selectedConfig.textClass} ${selectedConfig.borderClass}`}>
                    ✓ {FEATURE_LABELS[f]}
                  </span>
                ))}
              </div>
            </div>

            <button
              onClick={() => { setError(null); setStep('cpf'); }}
              className="w-full py-3.5 rounded-2xl font-black uppercase text-xs tracking-widest text-white transition-all hover:opacity-90 shadow-lg"
              style={{ backgroundColor: selectedConfig.color }}
            >
              Assinar {selectedConfig.name} — R${fmt(selectedConfig.price)}/mês
            </button>
            <button onClick={onClose} className="w-full py-2.5 font-black text-slate-400 uppercase text-[10px] hover:text-slate-600 transition-all">
              Fechar
            </button>
          </div>
        )}

        {/* ── STEP: CPF/CNPJ ── */}
        {step === 'cpf' && (
          <div className="space-y-3">
            <div className="text-center">
              <p className="text-xs font-black text-black uppercase tracking-widest">CPF ou CNPJ</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Necessário para emissão da cobrança</p>
            </div>
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
            <div className="text-center">
              <p className="text-xs font-black text-black uppercase tracking-widest">Período de cobrança</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Quanto maior o período, maior o desconto</p>
            </div>
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
                      <p className="text-[9px] text-slate-400 font-bold">
                        = R${fmt(perMonth)}/mês
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
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
            <div className="text-center">
              <p className="text-xs font-black text-black uppercase tracking-widest">Forma de Pagamento</p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {selectedConfig.name} — {CYCLE_OPTIONS.find(c => c.id === selectedCycle)?.label} — R${fmt(
                  calcCyclePrice(selectedConfig.price, CYCLE_OPTIONS.find(c => c.id === selectedCycle)!.months, CYCLE_OPTIONS.find(c => c.id === selectedCycle)!.discount)
                )}
              </p>
            </div>
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
            <button onClick={() => { setError(null); setStep('cycle'); }} className="w-full py-2.5 font-black text-slate-400 uppercase text-[10px] hover:text-slate-600 transition-all">
              Voltar
            </button>
          </div>
        )}

        {/* ── STEP: Loading ── */}
        {step === 'loading' && (
          <div className="text-center py-6 space-y-3">
            <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs font-black text-black uppercase">Gerando cobrança...</p>
            <p className="text-[10px] text-slate-400 font-bold">Aguarde, estamos criando sua assinatura</p>
          </div>
        )}

        {/* ── STEP: Waiting ── */}
        {step === 'waiting' && (
          <div className="text-center space-y-3">
            <div className="w-14 h-14 bg-orange-100 rounded-full flex items-center justify-center text-2xl mx-auto">📄</div>
            <p className="text-sm font-black text-black uppercase">Cobrança Gerada!</p>
            <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
              Uma nova aba foi aberta com o link de pagamento.<br />
              Após pagar, clique no botão abaixo para ativar seu plano.
            </p>
            {error && <p className="text-[10px] font-bold text-red-500">{error}</p>}
            <button
              onClick={handleVerifyPayment}
              disabled={verifying}
              className="w-full py-3.5 bg-green-600 text-white rounded-2xl font-black uppercase text-xs hover:bg-green-700 transition-all disabled:opacity-50 shadow-lg shadow-green-600/30"
            >
              {verifying ? 'Verificando...' : '✓ Já paguei — Verificar Pagamento'}
            </button>
            <button onClick={onClose} className="w-full py-2.5 font-black text-slate-400 uppercase text-[10px] hover:text-slate-600 transition-all">
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlanUpgradeModal;
