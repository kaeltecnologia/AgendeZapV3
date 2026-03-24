import React, { useState } from 'react';

interface Tutorial {
  id: string;
  title: string;
  description: string;
  duration: string;
  videoUrl: string;
  category: string;
}

const TUTORIALS: Tutorial[] = [
  { id: '1', title: 'Primeiros passos no AgendeZap', description: 'Como configurar sua conta, conectar o WhatsApp e começar a receber agendamentos.', duration: '3:20', videoUrl: '', category: 'inicio' },
  { id: '2', title: 'Como a IA agenda seus clientes', description: 'Veja como a inteligência artificial responde, agenda e confirma horários automaticamente.', duration: '2:45', videoUrl: '', category: 'inicio' },
  { id: '3', title: 'Configurando serviços e horários', description: 'Cadastre seus serviços, defina preços, duração e horários disponíveis.', duration: '2:10', videoUrl: '', category: 'agenda' },
  { id: '4', title: 'Gerenciando a agenda do dia', description: 'Visualize agendamentos, filtre por profissional e acompanhe cada atendimento.', duration: '1:50', videoUrl: '', category: 'agenda' },
  { id: '5', title: 'Adicionando profissionais', description: 'Cadastre sua equipe, defina especialidades e comissões individuais.', duration: '2:00', videoUrl: '', category: 'agenda' },
  { id: '6', title: 'Entendendo o financeiro', description: 'Faturamento, despesas e lucro líquido atualizados em tempo real.', duration: '3:00', videoUrl: '', category: 'financeiro' },
  { id: '7', title: 'Caixa diário e formas de pagamento', description: 'Registre entradas e saídas, configure taxas de cartão e veja o líquido.', duration: '2:30', videoUrl: '', category: 'financeiro' },
  { id: '8', title: 'Relatórios e projeções', description: 'Relatórios comparativos, projeção de faturamento e análise de crescimento.', duration: '2:15', videoUrl: '', category: 'financeiro' },
  { id: '9', title: 'Lembretes e reativação de clientes', description: 'Configure confirmação automática, lembretes e recupere clientes inativos.', duration: '2:40', videoUrl: '', category: 'marketing' },
  { id: '10', title: 'Disparador de mensagens', description: 'Envie mensagens segmentadas para grupos específicos de clientes.', duration: '2:20', videoUrl: '', category: 'marketing' },
  { id: '11', title: 'Social Mídia com IA', description: 'Crie calendários de conteúdo com roteiros prontos para gravar.', duration: '3:10', videoUrl: '', category: 'marketing' },
  { id: '12', title: 'Conversas do WhatsApp no painel', description: 'Acompanhe todas as conversas com clientes direto no sistema.', duration: '1:40', videoUrl: '', category: 'whatsapp' },
];

const CATEGORIES = [
  { id: 'todos', label: 'Todos', emoji: '📱' },
  { id: 'inicio', label: 'Início', emoji: '✨' },
  { id: 'agenda', label: 'Agenda', emoji: '📅' },
  { id: 'financeiro', label: 'Financeiro', emoji: '💰' },
  { id: 'marketing', label: 'Marketing', emoji: '📣' },
  { id: 'whatsapp', label: 'WhatsApp', emoji: '💬' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function TutorialsPanel({ open, onClose }: Props) {
  const [category, setCategory] = useState('todos');
  const [playingId, setPlayingId] = useState<string | null>(null);

  const filtered = category === 'todos' ? TUTORIALS : TUTORIALS.filter(t => t.category === category);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[199] bg-black/40" onClick={onClose} />
      <div className={`fixed right-0 top-0 h-full w-full max-w-md bg-white dark:bg-[#0f1c33] shadow-2xl z-[200] flex flex-col transform transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            </div>
            <div>
              <h2 className="font-bold text-gray-900 dark:text-white text-lg">Tutoriais</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">Aprenda a usar o AgendeZap</p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
            <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        {/* Category filters */}
        <div className="flex gap-2 px-5 py-3 overflow-x-auto border-b border-gray-50 dark:border-gray-800" style={{ scrollbarWidth: 'none' }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                category === cat.id
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <span>{cat.emoji}</span>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Tutorial list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filtered.map(tutorial => (
            <div
              key={tutorial.id}
              className="bg-gray-50 dark:bg-[#132040] rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden hover:shadow-md transition-all"
            >
              {playingId === tutorial.id && tutorial.videoUrl ? (
                <div className="aspect-video bg-black">
                  <iframe
                    src={tutorial.videoUrl}
                    className="w-full h-full"
                    allowFullScreen
                    allow="autoplay"
                  />
                </div>
              ) : (
                <button
                  onClick={() => tutorial.videoUrl ? setPlayingId(tutorial.id) : null}
                  className="w-full text-left p-4 flex items-start gap-3"
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    tutorial.videoUrl
                      ? 'bg-purple-100 dark:bg-purple-900/30'
                      : 'bg-gray-200 dark:bg-gray-700'
                  }`}>
                    <svg className={`w-5 h-5 ${tutorial.videoUrl ? 'text-purple-600' : 'text-gray-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-sm text-gray-900 dark:text-white mb-1">{tutorial.title}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{tutorial.description}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] font-bold text-purple-600 bg-purple-50 dark:bg-purple-900/20 px-2 py-0.5 rounded-full">{tutorial.duration}</span>
                      {!tutorial.videoUrl && (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">Em breve</span>
                      )}
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-800">
          <p className="text-center text-xs text-gray-400">
            Novos tutoriais toda semana
          </p>
        </div>
      </div>
    </>
  );
}
