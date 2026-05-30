import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const RELEASE_VERSION = 'v4_0_official';

const updates = [
  {
    icon: '⚡',
    title: 'WhatsApp sincroniza em tempo real',
    desc: 'Reduzimos o tempo de resposta de até 20 segundos para menos de 5s. Mensagens chegam e saem instantaneamente, sem delay perceptível.',
    highlight: true,
  },
  {
    icon: '🤖',
    title: 'Agente IA com etapas do funil personalizáveis',
    desc: 'Em Agente IA você pode definir orientações por etapa: Saudação, Serviço, Profissional, Data, Horário e Confirmação. O agente usa como guia, não como regra rígida.',
    highlight: true,
  },
  {
    icon: '💳',
    title: 'Detalhamento por forma de pagamento',
    desc: 'No Financeiro, clique em PIX, Dinheiro, Débito ou Crédito para ver exatamente quais atendimentos usaram aquele método — com cliente, serviço e valor.',
    highlight: true,
  },
  {
    icon: '📤',
    title: 'Enviar agendamento pelo WhatsApp',
    desc: 'Na agenda, passe o mouse sobre um agendamento e clique em "Enviar agendamento ao cliente". Se o cliente tiver mais de um no dia, escolha quais enviar.',
    highlight: true,
  },
  {
    icon: '🔒',
    title: 'Horários de funcionamento nunca mais perdidos',
    desc: 'Corrigimos o bug crônico que apagava os horários configurados após salvar outra configuração. Agora há backup duplo — coluna dedicada + JSONB.',
    highlight: false,
  },
  {
    icon: '📅',
    title: 'Agenda diária para profissionais sem duplicatas',
    desc: 'O envio automático da agenda do dia agora tem memória persistente — não envia duas vezes, nem mesmo após reiniciar o sistema.',
    highlight: false,
  },
  {
    icon: '📊',
    title: 'Menu Financeiro reorganizado',
    desc: 'Nova ordem: Financeiro → Folha Pgto. → Performance → Notas Fiscais. Mais lógico, mais direto.',
    highlight: false,
  },
  {
    icon: '🛠️',
    title: 'Correções de bugs crônicos',
    desc: 'Race conditions no salvamento de configurações, configurações do agente perdidas, buffer de mensagens ajustado e sincronização de status WhatsApp otimizada.',
    highlight: false,
  },
];

interface Props {
  tenantId: string;
}

const WhatsNew: React.FC<Props> = ({ tenantId }) => {
  const [open, setOpen] = useState(false);
  const storageKey = `agz_release_${RELEASE_VERSION}_${tenantId}`;

  useEffect(() => {
    if (!tenantId) return;
    if (!localStorage.getItem(storageKey)) {
      const t = setTimeout(() => setOpen(true), 1200);
      return () => clearTimeout(t);
    }
  }, [tenantId, storageKey]);

  const dismiss = () => {
    localStorage.setItem(storageKey, '1');
    setOpen(false);
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9995] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(8px)' }}
      onClick={dismiss}
    >
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-[32px] sm:rounded-[32px] shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[88vh] overflow-hidden"
        style={{ animation: 'slideUpModal 0.38s cubic-bezier(.22,1,.36,1)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="relative px-7 pt-8 pb-5 overflow-hidden flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}>
          <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full opacity-20 pointer-events-none"
            style={{ background: 'radial-gradient(circle, #f97316, transparent)' }} />
          <div className="absolute -bottom-4 -left-4 w-28 h-28 rounded-full opacity-15 pointer-events-none"
            style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />

          <div className="flex items-start justify-between relative">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center gap-1 text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest"
                  style={{ background: 'rgba(249,115,22,0.2)', color: '#fb923c' }}>
                  🎉 Nova versão
                </span>
                <span className="inline-flex items-center gap-1 text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest"
                  style={{ background: 'rgba(255,255,255,0.1)', color: '#94a3b8' }}>
                  v4.0
                </span>
              </div>
              <h2 className="text-2xl font-black text-white leading-tight">
                Tudo mais rápido.<br />Tudo mais estável. ⚡
              </h2>
              <p className="text-xs text-slate-400 mt-2 font-medium">
                {updates.length} melhorias e correções nesta versão
              </p>
            </div>
            <button onClick={dismiss}
              className="mt-1 ml-4 w-8 h-8 flex items-center justify-center rounded-full font-black text-sm transition-all flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.1)', color: '#94a3b8' }}>
              ✕
            </button>
          </div>

          {/* Launch banner */}
          <div className="mt-4 relative flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.35)' }}>
            <span className="text-xl flex-shrink-0">🚀</span>
            <div>
              <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest">Versão oficial no ar</p>
              <p className="text-xs text-white font-bold">Domingo, 31/05 às 00:01 — sistema atualizado automaticamente</p>
            </div>
          </div>
        </div>

        {/* ── Updates list ── */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-2">
          {updates.map((u, i) => (
            <div key={i}
              className={`flex items-start gap-3.5 p-4 rounded-2xl transition-all ${
                u.highlight
                  ? 'bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-100'
                  : 'bg-slate-50 border border-slate-100'
              }`}
            >
              <span className="text-xl flex-shrink-0 mt-0.5">{u.icon}</span>
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
        <div className="px-5 pb-7 pt-3 flex-shrink-0 border-t border-slate-100">
          <button onClick={dismiss}
            className="w-full py-4 rounded-2xl font-black text-[13px] uppercase tracking-widest text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
            style={{ background: 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)', boxShadow: '0 8px 24px rgba(249,115,22,0.35)' }}>
            Entendido, bora usar! 🚀
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideUpModal {
          from { opacity: 0; transform: translateY(44px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>,
    document.body
  );
};

export default WhatsNew;
