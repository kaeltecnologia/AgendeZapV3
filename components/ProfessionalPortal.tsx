import React, { useState, useEffect, Suspense, lazy } from 'react';
import { db } from '../services/mockDb';
import ProfDashboard from './ProfDashboard';

const AppointmentsView = lazy(() => import('./AppointmentsView'));

interface ProfessionalPortalProps {
  tenantId: string;
  tenantName: string;
  professionalId: string;
  professionalName: string;
  onLogout: () => void;
}

type Tab = 'agenda' | 'dashboard';

const ProfessionalPortal: React.FC<ProfessionalPortalProps> = ({
  tenantId, tenantName, professionalId, professionalName, onLogout,
}) => {
  const [tab, setTab] = useState<Tab>('agenda');
  const [canBook, setCanBook] = useState(true);
  const [canViewRevenue, setCanViewRevenue] = useState(true);
  const [seeDashboard, setSeeDashboard] = useState(true);
  const [permLoaded, setPermLoaded] = useState(false);

  useEffect(() => {
    db.getSettings(tenantId).then(s => {
      const perms = s.professionalMeta?.[professionalId]?.portalPermissions;
      if (perms) {
        setCanBook(perms.canBook !== false);
        setCanViewRevenue(perms.canViewRevenue !== false);
        setSeeDashboard(perms.seeDashboard !== false);
      }
      setPermLoaded(true);
    });
  }, [tenantId, professionalId]);

  if (!permLoaded) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b-2 border-slate-100 px-4 sm:px-8 py-4 flex items-center justify-between shadow-sm sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-500 rounded-[14px] flex items-center justify-center text-xl shadow-lg shadow-orange-100">
            ✂️
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">{tenantName}</p>
            <p className="text-sm font-black text-black uppercase tracking-tight">{professionalName}</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-red-500 transition-colors px-4 py-2 rounded-xl hover:bg-red-50"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          Sair
        </button>
      </header>

      {/* Tab bar */}
      {seeDashboard && (
        <div className="bg-white border-b-2 border-slate-100 px-4 sm:px-8 flex gap-1 sticky top-[73px] z-40">
          {([
            { id: 'agenda',    icon: '📅', label: 'Agenda' },
            { id: 'dashboard', icon: '📊', label: 'Meu Desempenho' },
          ] as { id: Tab; icon: string; label: string }[]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-[11px] font-black uppercase tracking-widest border-b-2 transition-colors -mb-[2px]
                ${tab === t.id
                  ? 'border-orange-500 text-orange-500'
                  : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <main className="flex-1 overflow-auto">
        {tab === 'agenda' ? (
          <Suspense fallback={
            <div className="min-h-[60vh] flex items-center justify-center">
              <div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin" />
            </div>
          }>
            <AppointmentsView
              tenantId={tenantId}
              defaultProfessionalId={professionalId}
              readOnly={!canBook}
            />
          </Suspense>
        ) : (
          <ProfDashboard
            tenantId={tenantId}
            professionalId={professionalId}
            professionalName={professionalName}
            canViewRevenue={canViewRevenue}
          />
        )}
      </main>
    </div>
  );
};

export default ProfessionalPortal;
