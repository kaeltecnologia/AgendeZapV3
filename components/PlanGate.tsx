import React from 'react';
import { FeatureKey, getPlanConfig, cheapestUpgradePlan } from '../config/planConfig';

interface PlanGateProps {
  feature: FeatureKey;
  tenantPlan: string | null | undefined;
  children: React.ReactNode;
  onClose?: () => void;
  onUpgrade?: () => void;
}

/**
 * PlanGate — wraps any view/section with a lock overlay when the tenant's
 * plan does not include the requested feature.
 *
 * The underlying content is always rendered (blurred) so the user can see
 * what they're missing. Only interaction is blocked via the overlay.
 */
const PlanGate: React.FC<PlanGateProps> = ({ feature, tenantPlan, children, onClose, onUpgrade }) => {
  const config = getPlanConfig(tenantPlan);
  const hasAccess = config.permissions[feature];

  // ── Unlocked: render children normally ─────────────────────────────
  if (hasAccess) return <>{children}</>;

  // ── Locked: show blurred preview + compact upgrade prompt ──────────
  const upgrade = cheapestUpgradePlan(feature);

  return (
    <div className="relative min-h-[60vh]">
      {/* Blurred, pointer-events-none background */}
      <div
        className="pointer-events-none select-none"
        style={{ filter: 'blur(4px)', opacity: 0.35 }}
        aria-hidden="true"
      >
        {children}
      </div>

      {/* Lock overlay */}
      <div className="absolute inset-0 flex items-center justify-center z-20 px-4">
        <div className="bg-white rounded-[36px] border-2 border-slate-100 shadow-2xl shadow-slate-200/60 p-8 max-w-sm w-full text-center space-y-5 animate-scaleUp">

          {/* Lock icon */}
          <div className="w-16 h-16 rounded-[20px] bg-slate-100 flex items-center justify-center text-3xl mx-auto">
            🔒
          </div>

          {/* Title */}
          <div className="space-y-1">
            <p className="text-lg font-black text-black uppercase tracking-tight">
              Recurso Bloqueado
            </p>
            <p className="text-xs text-slate-500">
              Este recurso requer o plano{' '}
              <span style={{ color: upgrade.color }} className="font-black">{upgrade.name}</span>{' '}
              ou superior
            </p>
          </div>

          {/* Buttons */}
          <div className="space-y-2.5">
            {onUpgrade && (
              <button
                onClick={onUpgrade}
                className="w-full py-3.5 rounded-2xl font-black uppercase text-xs tracking-widest text-white transition-all hover:opacity-90 shadow-lg"
                style={{ backgroundColor: upgrade.color }}
              >
                Ver Planos e Fazer Upgrade
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="w-full py-3 rounded-2xl border-2 border-slate-100 text-slate-400 font-black text-[10px] uppercase tracking-widest hover:border-slate-300 hover:text-slate-600 transition-all"
              >
                Voltar
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

export default PlanGate;
