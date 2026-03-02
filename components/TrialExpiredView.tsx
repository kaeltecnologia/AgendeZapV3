import React, { useState } from 'react';
import { db } from '../services/mockDb';
import { PLAN_CONFIGS, PlanId } from '../config/planConfig';

const PLANS: PlanId[] = ['START', 'PROFISSIONAL', 'ELITE'];

const TrialExpiredView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [sending, setSending] = useState(false);
  const [sentPlan, setSentPlan] = useState<string | null>(null);

  const handleSelectPlan = async (planId: PlanId) => {
    if (sending) return;
    setSending(true);
    try {
      const cfg = PLAN_CONFIGS[planId];
      await db.sendSupportRequest(
        tenantId,
        `💳 Solicitação de assinatura\n\nPlano escolhido: ${cfg.name} — R$ ${cfg.price.toFixed(2)}/mês\n\nPor favor, entre em contato para ativar a conta.`,
        planId,
        'trial_upgrade'
      );
      setSentPlan(planId);
    } catch {
      alert('Erro ao enviar solicitação. Tente novamente.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-full bg-slate-50 flex items-center justify-center p-8">
      <div className="w-full max-w-4xl space-y-10">

        {/* Header */}
        <div className="text-center space-y-3">
          <div className="w-16 h-16 bg-slate-100 rounded-[20px] flex items-center justify-center mx-auto text-3xl">🔒</div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">
            Período de teste encerrado
          </h1>
          <p className="text-sm font-bold text-slate-400 max-w-md mx-auto">
            Seus dados estão salvos e seguros. Escolha um plano para continuar usando o AgendeZap com todos os recursos.
          </p>
        </div>

        {/* Sent confirmation */}
        {sentPlan && (
          <div className="bg-green-50 border-2 border-green-200 rounded-[24px] p-6 text-center space-y-2">
            <p className="text-sm font-black text-green-700 uppercase tracking-widest">✓ Solicitação enviada!</p>
            <p className="text-xs font-bold text-green-600">
              Nossa equipe recebeu seu interesse no plano <strong>{PLAN_CONFIGS[sentPlan as PlanId]?.name}</strong>. Em breve entraremos em contato para ativar sua conta.
            </p>
          </div>
        )}

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLANS.map(planId => {
            const cfg = PLAN_CONFIGS[planId];
            const isSelected = sentPlan === planId;
            return (
              <div
                key={planId}
                className={`bg-white rounded-[32px] border-2 p-8 space-y-6 transition-all ${
                  isSelected ? `${cfg.borderClass} shadow-xl` : 'border-slate-100 hover:border-slate-300'
                }`}
              >
                {/* Plan header */}
                <div className="space-y-1">
                  <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${cfg.bgClass} ${cfg.textClass}`}>
                    {cfg.badge}
                  </span>
                  <h3 className="text-xl font-black text-black uppercase tracking-tight mt-2">{cfg.name}</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">{cfg.subtitle}</p>
                </div>

                {/* Price */}
                <div>
                  <span className="text-3xl font-black text-black">R$ {cfg.price.toFixed(2).replace('.', ',')}</span>
                  <span className="text-xs font-bold text-slate-400">/mês</span>
                </div>

                {/* Features (first 5) */}
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

                {/* CTA */}
                <button
                  onClick={() => handleSelectPlan(planId)}
                  disabled={sending || !!sentPlan}
                  className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all disabled:opacity-50 ${
                    isSelected
                      ? `${cfg.bgClass} ${cfg.textClass} border-2 ${cfg.borderClass}`
                      : 'bg-black text-white hover:bg-orange-500'
                  }`}
                >
                  {isSelected ? '✓ Solicitado' : sending ? 'Enviando...' : `Quero o ${cfg.name}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer note */}
        <p className="text-center text-[10px] font-bold text-slate-300 uppercase tracking-widest">
          Após o pagamento, nossa equipe ativa sua conta em até 24 horas.
        </p>
      </div>
    </div>
  );
};

export default TrialExpiredView;
