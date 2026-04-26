import React, { Suspense, lazy } from 'react';

const AppointmentsView = lazy(() => import('./AppointmentsView'));

interface ProfessionalPortalProps {
  tenantId: string;
  tenantName: string;
  professionalId: string;
  professionalName: string;
  onLogout: () => void;
}

const ProfessionalPortal: React.FC<ProfessionalPortalProps> = ({
  tenantId, tenantName, professionalId, professionalName, onLogout,
}) => {
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

      {/* Body — filtered appointments for this professional */}
      <main className="flex-1 overflow-auto">
        <Suspense fallback={
          <div className="min-h-[60vh] flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin" />
          </div>
        }>
          <AppointmentsView
            tenantId={tenantId}
            defaultProfessionalId={professionalId}
          />
        </Suspense>
      </main>
    </div>
  );
};

export default ProfessionalPortal;
