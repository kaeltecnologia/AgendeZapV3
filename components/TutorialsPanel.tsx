import React, { useState } from 'react';

interface Tutorial {
  id: string;
  title: string;
  description: string;
  steps: string[];
  category: string;
}

const TUTORIALS: Tutorial[] = [
  {
    id: '1',
    title: 'Primeiros passos no AgendeZap',
    description: 'Configure sua conta e comece a receber agendamentos.',
    category: 'inicio',
    steps: [
      'Acesse o menu "Conexões" e conecte seu WhatsApp pela aba "WhatsApp". Escaneie o QR Code com seu celular.',
      'Vá em "Serviços" e cadastre os serviços que você oferece, com nome, preço e duração.',
      'Em "Equipe", adicione os profissionais e defina os horários de trabalho de cada um.',
      'Volte em "Conexões" > "Agente IA" e ative o sistema. A IA já vai começar a atender automaticamente!',
    ],
  },
  {
    id: '2',
    title: 'Como a IA agenda seus clientes',
    description: 'Entenda como a inteligência artificial atende pelo WhatsApp.',
    category: 'inicio',
    steps: [
      'Quando um cliente manda mensagem no WhatsApp, a IA responde em segundos com uma saudação personalizada.',
      'A IA pergunta qual serviço o cliente deseja e mostra as opções cadastradas.',
      'Depois, oferece os dias e horários disponíveis baseados na agenda real dos profissionais.',
      'O cliente escolhe e a IA confirma o agendamento. O horário aparece automaticamente na sua agenda.',
      'Se o cliente ficar confuso, a IA ativa o "modo numerado" e envia opções numeradas para facilitar.',
    ],
  },
  {
    id: '3',
    title: 'Configurando serviços e horários',
    description: 'Cadastre seus serviços com preços e duração.',
    category: 'agenda',
    steps: [
      'Acesse "Serviços" no menu lateral.',
      'Clique em "+ Novo Serviço" e preencha: nome, preço e duração em minutos.',
      'Cada serviço aparece como opção para o cliente na hora de agendar.',
      'Para editar ou remover, clique no serviço na lista e faça as alterações.',
    ],
  },
  {
    id: '4',
    title: 'Gerenciando a agenda do dia',
    description: 'Visualize e gerencie os agendamentos.',
    category: 'agenda',
    steps: [
      'A tela "Agenda" mostra todos os agendamentos do dia selecionado.',
      'Use os filtros para ver por profissional específico ou todos juntos.',
      'Clique em um agendamento para ver detalhes: cliente, serviço, horário e status.',
      'Você pode confirmar, cancelar ou remarcar diretamente pela agenda.',
      'Agendamentos feitos pela IA aparecem automaticamente com o status "Confirmado".',
    ],
  },
  {
    id: '5',
    title: 'Adicionando profissionais',
    description: 'Cadastre sua equipe e defina horários.',
    category: 'agenda',
    steps: [
      'Acesse "Equipe" no menu lateral e clique em "+ Novo Profissional".',
      'Preencha nome, especialidade e telefone (WhatsApp) do profissional.',
      'Defina os horários de trabalho: dias da semana, hora de início e fim, e intervalo de almoço.',
      'Se usar o plano Profissional+, configure a comissão individual de cada profissional.',
    ],
  },
  {
    id: '6',
    title: 'Entendendo o financeiro',
    description: 'Faturamento, despesas e lucro em tempo real.',
    category: 'financeiro',
    steps: [
      'O "Financeiro" mostra o faturamento bruto baseado nos agendamentos realizados.',
      'Cadastre suas despesas fixas e variáveis para ver o lucro líquido real.',
      'A margem de lucro é calculada automaticamente: (faturamento - despesas) / faturamento.',
      'Use o gráfico mensal para acompanhar a evolução do seu negócio.',
    ],
  },
  {
    id: '7',
    title: 'Caixa diário e pagamentos',
    description: 'Registre entradas, saídas e formas de pagamento.',
    category: 'financeiro',
    steps: [
      'O "Caixa Diário" (plano Elite) permite registrar cada entrada e saída do dia.',
      'Configure as taxas de cartão: débito, crédito e parcelado. O sistema calcula o valor líquido.',
      'Registre a forma de pagamento de cada atendimento: PIX, dinheiro, cartão.',
      'No final do dia, veja o resumo: total bruto, taxas descontadas e valor líquido.',
    ],
  },
  {
    id: '8',
    title: 'Relatórios e projeções',
    description: 'Análise de desempenho e crescimento.',
    category: 'financeiro',
    steps: [
      'Acesse "Relatórios" para ver dados de agendamentos por período.',
      'Veja os serviços mais procurados, horários de pico e profissionais com mais demanda.',
      'No plano Elite, relatórios comparativos mostram a evolução mês a mês.',
      'A projeção de faturamento estima o resultado do mês baseado no ritmo atual.',
    ],
  },
  {
    id: '9',
    title: 'Lembretes e reativação',
    description: 'Confirmações automáticas e recuperação de clientes.',
    category: 'marketing',
    steps: [
      'Em "Configurações", ative os lembretes automáticos para enviar avisos antes do atendimento.',
      'A confirmação automática pergunta ao cliente se ele confirma o horário agendado.',
      'A reativação busca clientes que não aparecem há mais de 30 dias e envia uma mensagem convidando a voltar.',
      'Todas as mensagens são enviadas pelo WhatsApp automaticamente.',
    ],
  },
  {
    id: '10',
    title: 'Disparador de mensagens',
    description: 'Envie mensagens segmentadas para grupos de clientes.',
    category: 'marketing',
    steps: [
      'Acesse "Disparador" no menu (plano Profissional+).',
      'Escolha o público: todos os clientes, inativos, ou um segmento específico.',
      'Escreva sua mensagem ou use um template pronto.',
      'Agende o envio ou dispare imediatamente. O sistema envia com intervalo entre mensagens para evitar bloqueio.',
    ],
  },
  {
    id: '11',
    title: 'Social Mídia com IA',
    description: 'Calendário de conteúdo e roteiros prontos.',
    category: 'marketing',
    steps: [
      'Acesse "Social Mídia" no menu (plano Profissional+).',
      'A IA gera um calendário semanal com sugestões de posts para Instagram e TikTok.',
      'Cada post vem com roteiro completo: legenda, hashtags e dicas de gravação.',
      'Marque como concluído conforme for publicando para acompanhar o progresso.',
    ],
  },
  {
    id: '12',
    title: 'Conversas do WhatsApp',
    description: 'Acompanhe as conversas com clientes no painel.',
    category: 'whatsapp',
    steps: [
      'Acesse "Conversas" no menu para ver todas as interações do WhatsApp.',
      'Cada conversa mostra o histórico completo: mensagens do cliente e respostas da IA.',
      'Use o filtro para buscar por nome ou número do cliente.',
      'Conversas com agendamento confirmado são marcadas com badge verde.',
    ],
  },
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
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
              onClick={() => { setCategory(cat.id); setExpandedId(null); }}
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
          {filtered.map(tutorial => {
            const isExpanded = expandedId === tutorial.id;
            return (
              <div
                key={tutorial.id}
                className="bg-gray-50 dark:bg-[#132040] rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden hover:shadow-md transition-all"
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : tutorial.id)}
                  className="w-full text-left p-4 flex items-start gap-3"
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-purple-100 dark:bg-purple-900/30">
                    <svg className="w-5 h-5 text-purple-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-sm text-gray-900 dark:text-white mb-1">{tutorial.title}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{tutorial.description}</p>
                    <span className="inline-block mt-2 text-[10px] font-bold text-purple-600 bg-purple-50 dark:bg-purple-900/20 px-2 py-0.5 rounded-full">
                      {tutorial.steps.length} passos
                    </span>
                  </div>
                  <svg className={`w-4 h-4 text-gray-300 flex-shrink-0 mt-1 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-0">
                    <div className="bg-white dark:bg-[#0f1c33] rounded-xl p-4 space-y-3 border border-purple-100 dark:border-purple-900/30">
                      {tutorial.steps.map((step, i) => (
                        <div key={i} className="flex gap-3 items-start">
                          <span className="w-6 h-6 rounded-full bg-purple-600 text-white text-[10px] font-black flex items-center justify-center flex-shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{step}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-800">
          <p className="text-center text-xs text-gray-400">
            Dica: clique em um tutorial para ver o passo a passo
          </p>
        </div>
      </div>
    </>
  );
}
