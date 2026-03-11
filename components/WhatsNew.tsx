import React, { useEffect, useState } from 'react';

const VERSION_KEY = 'agz_whats_new_seen_v4';

const updates = [
  { icon: '🌙', title: 'Modo escuro por padrão', desc: 'Sistema abre em dark mode. Troque pelo botão no header.' },
  { icon: '✨', title: 'Micro-animações por todo o sistema', desc: 'Botões com micro-bounce, mensagens com slide-in suave e transições fluidas.' },
  { icon: '💬', title: 'Indicador de digitação no chat', desc: 'Três pontinhos animados aparecem enquanto a IA processa sua mensagem.' },
  { icon: '🔔', title: 'Badge de não lidas no menu', desc: 'O ícone do WhatsApp no menu mostra quantas conversas estão sem visualizar.' },
  { icon: '⏰', title: 'Alerta de atendimento', desc: 'Popup automático quando chega a hora de um agendamento — abre a comanda com um clique.' },
  { icon: '🏆', title: 'Streak e estatísticas no Dashboard', desc: 'Veja sua sequência de dias com atendimentos, total de hoje e pendentes em tempo real.' },
  { icon: '🎊', title: 'Confete ao agendar', desc: 'Animação de celebração ao confirmar um agendamento manual.' },
  { icon: '🖼️', title: 'Fix: colar imagem no suporte', desc: 'Resolvido o erro ao colar imagens no chat de suporte.' },
];

const WhatsNew: React.FC = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(VERSION_KEY)) setOpen(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(VERSION_KEY, '1');
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9995] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#132040] rounded-[28px] w-full max-w-md shadow-2xl animate-scaleUp flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-7 pt-7 pb-4 border-b border-slate-100 dark:border-[#1e3a5f] flex-shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-1">Novidades</p>
              <h2 className="text-2xl font-black text-black dark:text-white leading-tight">O que há de novo? 🚀</h2>
              <p className="text-xs text-slate-400 mt-1">Atualizações desta versão do AgendeZap</p>
            </div>
            <button
              onClick={dismiss}
              className="text-slate-300 hover:text-slate-500 font-black text-xl leading-none ml-4 mt-1"
            >✕</button>
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 px-7 py-4 space-y-3">
          {updates.map((u, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="text-xl flex-shrink-0 mt-0.5">{u.icon}</span>
              <div>
                <p className="text-[11px] font-black text-black dark:text-white uppercase tracking-wide">{u.title}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{u.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-7 pb-7 pt-4 flex-shrink-0">
          <button
            onClick={dismiss}
            className="w-full py-3 bg-orange-500 text-white rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-orange-600 transition-all shadow-md shadow-orange-500/30"
          >
            Entendido, vamos lá! 🎉
          </button>
        </div>
      </div>
    </div>
  );
};

export default WhatsNew;
