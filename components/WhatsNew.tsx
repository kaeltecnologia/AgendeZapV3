import React, { useEffect, useState } from 'react';

const VERSION_KEY = 'agz_whats_new_seen_v9';

const updates = [
  {
    icon: '🖱️',
    title: 'Clique direito nos agendamentos',
    desc: 'Clique com o botão direito em qualquer agendamento da agenda para abrir um menu rápido: mude o status (Confirmado, Chegou, Finalizado, Faltou…) ou abra o editor diretamente, sem sair da agenda.',
    highlight: true,
  },
  {
    icon: '✂️',
    title: 'Editar agendamento com múltiplos serviços',
    desc: 'Ao editar um agendamento, agora você pode adicionar quantos serviços quiser — cada um com horário de início, fim e preço individuais. Clique em "+ Adicionar Serviço" para inserir mais linhas.',
    highlight: true,
  },
  {
    icon: '☕',
    title: 'Clique direito nos intervalos e almoço',
    desc: 'Clique com o botão direito em qualquer bloco de intervalo (almoço, imprevisto, feriado…) diretamente na agenda para editar ou excluir sem precisar ir em Configurações.',
    highlight: true,
  },
  {
    icon: '📋',
    title: 'Modal de intervalo com modo edição',
    desc: 'O modal de intervalo agora detecta quando você está editando um existente e exibe "Editar Intervalo" no título — sem criar duplicatas ao salvar.',
    highlight: false,
  },
  {
    icon: '🎯',
    title: 'Mudança de status sem recarregar',
    desc: 'Os botões de status rápido no popup de clique direito aplicam a mudança instantaneamente e atualizam a agenda sem precisar abrir o modal completo.',
    highlight: false,
  },
];

const WhatsNew: React.FC = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(VERSION_KEY)) {
      setTimeout(() => setOpen(true), 800);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(VERSION_KEY, '1');
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9995] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}
      onClick={dismiss}
    >
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-[32px] sm:rounded-[32px] shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[88vh] overflow-hidden"
        style={{ animation: 'slideUpModal 0.35s cubic-bezier(.22,1,.36,1)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="relative px-7 pt-8 pb-5 overflow-hidden flex-shrink-0">
          <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full opacity-10 pointer-events-none"
            style={{ background: 'radial-gradient(circle, #f97316, transparent)' }} />
          <div className="absolute -bottom-6 -left-6 w-32 h-32 rounded-full opacity-10 pointer-events-none"
            style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />

          <div className="flex items-start justify-between relative">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1 bg-orange-100 text-orange-600 text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest">
                  🎉 Versão Nova
                </span>
                <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-500 text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest">
                  v4.70
                </span>
              </div>
              <h2 className="text-[26px] font-black text-slate-900 leading-tight">
                Agenda turbinada!<br />🖱️✨
              </h2>
              <p className="text-xs text-slate-400 mt-1.5 font-medium">
                {updates.length} melhorias chegaram pro seu sistema
              </p>
            </div>
            <button
              onClick={dismiss}
              className="mt-1 ml-4 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-600 font-black text-sm transition-all flex-shrink-0"
            >✕</button>
          </div>
        </div>

        {/* ── Updates list ── */}
        <div className="overflow-y-auto flex-1 px-5 pb-2 space-y-2">
          {updates.map((u, i) => (
            <div
              key={i}
              className={`flex items-start gap-3.5 p-4 rounded-2xl transition-all ${
                u.highlight
                  ? 'bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-100'
                  : 'bg-slate-50 border border-slate-100'
              }`}
            >
              <span className="text-2xl flex-shrink-0 mt-0.5">{u.icon}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-[11px] font-black uppercase tracking-wide ${u.highlight ? 'text-orange-600' : 'text-slate-700'}`}>
                    {u.title}
                  </p>
                  {u.highlight && (
                    <span className="text-[8px] font-black bg-orange-500 text-white px-1.5 py-0.5 rounded-full uppercase tracking-widest">
                      Destaque
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{u.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 pb-7 pt-4 flex-shrink-0">
          <button
            onClick={dismiss}
            className="w-full py-4 rounded-2xl font-black text-[13px] uppercase tracking-widest text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
            style={{ background: 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)', boxShadow: '0 8px 24px rgba(249,115,22,0.35)' }}
          >
            Incrível, bora usar! 🎉
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideUpModal {
          from { opacity: 0; transform: translateY(40px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
      `}</style>
    </div>
  );
};

export default WhatsNew;
