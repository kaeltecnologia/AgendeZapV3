
import React, { useState, useEffect } from 'react';
import { db } from '../services/mockDb';
import { hasFeature } from '../config/planConfig';

const Toggle = ({ checked, onChange, label, description }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
}) => (
  <div className="flex items-center justify-between gap-4 bg-slate-50 rounded-2xl p-5">
    <div>
      <p className="text-xs font-black text-black uppercase tracking-wide">{label}</p>
      <p className="text-[10px] font-bold text-slate-400 mt-0.5">{description}</p>
    </div>
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200 focus:outline-none ${checked ? 'bg-orange-500' : 'bg-slate-200'}`}
    >
      <span className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  </div>
);

const DEFAULT_PROMPT = 'Você é o assistente oficial do estabelecimento. Use um tom amigável, moderno e focado na conversão de agendamentos. Pergunte o que o cliente deseja e guie-o até a confirmação de horário, profissional e serviço.';
const DEFAULT_AGENT_NAME = 'Agente Inteligente AgendeZap';

const DEFAULT_STAGE_PROMPTS: Record<string, string> = {
  saudacao:     'Cumprimente o cliente com o horário do dia (bom dia / boa tarde / boa noite), apresente o estabelecimento pelo nome e inclua o link de agendamento online na saudação. Pergunte como pode ajudar.',
  servico:      'Pergunte qual procedimento o cliente deseja sem listar todos os serviços de uma vez. Se o cliente hesitar, peça que descreva o que procura e sugira o mais adequado.',
  profissional: 'Apresente os profissionais disponíveis para o serviço escolhido e aguarde a escolha. Se o cliente não tiver preferência, diga que qualquer um atende muito bem.',
  data:         'Pergunte se o cliente tem preferência de dia. Se não tiver preferência, sugira o próximo dia disponível. Para "hoje", verifique se há horários antes de avançar.',
  horario:      'Ofereça horários disponíveis somente após ter profissional e dia definidos. Se o horário pedido estiver ocupado, ofereça o mais próximo anterior e posterior. Se recusar ambos, liste todos os horários do dia.',
  confirmacao:  'Exiba um resumo com serviço, profissional, data e horário. Aguarde o cliente confirmar com "sim", "ok", "pode" ou similar antes de registrar o agendamento.',
};

type ChatMsg = { role: 'agent' | 'client'; text: string };
const STAGE_EXAMPLES: Record<string, ChatMsg[]> = {
  saudacao: [
    { role: 'agent',  text: 'Boa tarde! 😊 Seja bem-vinda ao Studio Bella!\n\nVocê também pode agendar pelo link:\nagendezap.com/agendar/studio-bella 🔗\n\nComo posso te ajudar?' },
  ],
  servico: [
    { role: 'client', text: 'Olá, quero marcar um horário' },
    { role: 'agent',  text: 'Claro! Qual procedimento você gostaria?' },
    { role: 'client', text: 'Manicure' },
    { role: 'agent',  text: 'Ótimo! Com qual profissional você prefere?' },
  ],
  profissional: [
    { role: 'agent',  text: 'Temos a Ana e a Bruna disponíveis. Com qual você prefere?' },
    { role: 'client', text: 'Sem preferência' },
    { role: 'agent',  text: 'Combinado! As duas atendem muito bem 😊 Tem algum dia de preferência?' },
  ],
  data: [
    { role: 'agent',  text: 'Tem algum dia de preferência?' },
    { role: 'client', text: 'Sexta-feira' },
    { role: 'agent',  text: 'Ótimo! Prefere de manhã ou à tarde?' },
    { role: 'client', text: 'Tarde' },
    { role: 'agent',  text: 'Certo! Na sexta à tarde temos às 14h e às 16h. Qual prefere?' },
  ],
  horario: [
    { role: 'agent',  text: 'Com a Ana na sexta às 14h pode ser? 😊' },
    { role: 'client', text: 'Tem um pouco antes?' },
    { role: 'agent',  text: 'Às 14h é o mais cedo disponível, mas temos às 15h ou 16h também. Qual prefere?' },
    { role: 'client', text: 'Então 14h mesmo' },
  ],
  confirmacao: [
    { role: 'agent',  text: 'Vou confirmar: Manicure com Ana, sexta-feira dia 20/06 às 14h. Confirma?' },
    { role: 'client', text: 'Sim!' },
    { role: 'agent',  text: 'Agendado! Manicure com Ana, 20/06 às 14h. Te esperamos! 😊' },
  ],
};

const AiAgentConfig: React.FC<{ tenantId: string; tenantPlan?: string }> = ({ tenantId, tenantPlan }) => {
  const [active, setActive] = useState(false);
  const [aiLeadActive, setAiLeadActive] = useState(true);
  const [aiProfessionalActive, setAiProfessionalActive] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const [agentName, setAgentName] = useState(DEFAULT_AGENT_NAME);
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [agentGender, setAgentGender] = useState<'neutro' | 'masculino' | 'feminino'>('neutro');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [msgBufferSecs, setMsgBufferSecs] = useState(8);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [sharedOpenAiKey, setSharedOpenAiKey] = useState('');
  const [funnelStagePrompts, setFunnelStagePrompts] = useState<Record<string, string>>({});
  const [expandedStage, setExpandedStage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const [settings, globalCfg] = await Promise.all([
        db.getSettings(tenantId),
        db.getGlobalConfig(),
      ]);
      setActive(settings.aiActive);
      setAiLeadActive(settings.aiLeadActive !== false);
      setAiProfessionalActive(!!settings.aiProfessionalActive);
      setSystemPrompt(settings.systemPrompt || DEFAULT_PROMPT);
      setAgentName(settings.agentName || DEFAULT_AGENT_NAME);
      setWelcomeMessage(settings.welcomeMessage || '');
      setAgentGender((settings.agentGender as 'neutro' | 'masculino' | 'feminino') || 'neutro');
      setOpenaiApiKey(settings.openaiApiKey || '');
      setMsgBufferSecs(settings.msgBufferSecs ?? 8);
      setSharedOpenAiKey((globalCfg['shared_openai_key'] || '').trim());
      const saved = (settings.funnelStagePrompts as Record<string, string>) || {};
      // Pre-fill with defaults for any stage that was never customized
      const merged = { ...DEFAULT_STAGE_PROMPTS, ...saved };
      setFunnelStagePrompts(merged);
      setLoadingSettings(false);
    };
    load();
  }, [tenantId]);

  const toggleAi = async () => {
    const newState = !active;
    setActive(newState);
    await db.updateSettings(tenantId, { aiActive: newState });
  };

  const handleToggleLead = async (val: boolean) => {
    setAiLeadActive(val);
    await db.updateSettings(tenantId, { aiLeadActive: val });
  };

  const handleToggleProfessional = async (val: boolean) => {
    setAiProfessionalActive(val);
    await db.updateSettings(tenantId, { aiProfessionalActive: val });
  };

  const handleSavePrompt = async () => {
    setSavingPrompt(true);
    await db.updateSettings(tenantId, { systemPrompt, agentName, agentGender, openaiApiKey, msgBufferSecs, welcomeMessage, funnelStagePrompts });
    setSavingPrompt(false);
  };

  if (loadingSettings) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO CONFIGURAÇÕES...</div>;

  if (!hasFeature(tenantPlan, 'agenteIA')) {
    return (
      <div className="space-y-10 animate-fadeIn">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Agente IA</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Configurações de inteligência artificial</p>
        </div>
        <div className="bg-white p-10 rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 text-center space-y-6">
          <div className="w-24 h-24 mx-auto rounded-[30px] bg-slate-50 flex items-center justify-center text-5xl">🔒</div>
          <h2 className="text-xl font-black text-black uppercase tracking-tight">Recurso do Plano Profissional</h2>
          <p className="text-sm font-bold text-slate-400 max-w-md mx-auto">
            O Agente IA de agendamento via WhatsApp está disponível a partir do plano <strong className="text-blue-600">Profissional</strong>. Faça upgrade para ativar o atendimento automático por IA.
          </p>
          <div className="bg-blue-50 border-2 border-blue-100 rounded-2xl p-5 max-w-sm mx-auto">
            <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Plano Profissional</p>
            <p className="text-2xl font-black text-blue-700 mt-1">R$89,90<span className="text-xs font-bold text-blue-400">/mês</span></p>
          </div>
        </div>
      </div>
    );
  }

  const ownKeyIsOpenAI = openaiApiKey.trim().startsWith('sk-');
  const sharedKeyIsOpenAI = sharedOpenAiKey.startsWith('sk-');
  const usingOpenAI = ownKeyIsOpenAI || sharedKeyIsOpenAI;
  const usingSharedKey = !ownKeyIsOpenAI && sharedKeyIsOpenAI;

  return (
    <div className="space-y-10 animate-fadeIn">
      <div>
        <h1 className="text-3xl font-black text-black uppercase tracking-tight">Agente IA</h1>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
          Configurações de inteligência artificial
          {usingOpenAI
            ? <span className="ml-2 bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-[9px] font-black uppercase" title={usingSharedKey ? 'Usando chave compartilhada do SuperAdmin' : 'Chave própria do tenant'}>GPT-4.1 Mini{usingSharedKey ? ' ✦' : ''}</span>
            : <span className="ml-2 bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-[9px] font-black uppercase">Gemini Flash</span>
          }
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* ─── Left column: status + mode toggles ─── */}
        <div className="w-full lg:w-72 space-y-6">
          {/* Main on/off */}
          <div className="bg-white p-6 rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 text-center flex flex-col items-center">
            <div className={`w-24 h-24 rounded-[30px] flex items-center justify-center text-5xl mb-6 transition-all shadow-xl ${active ? 'bg-orange-500 text-white animate-pulse' : 'bg-slate-50 text-slate-300'}`}>🤖</div>
            <h3 className="font-black text-black uppercase tracking-tight mb-2">Status do Robô</h3>
            <p className={`text-[10px] uppercase font-black tracking-widest mb-10 ${active ? 'text-orange-500' : 'text-slate-400'}`}>
              {active ? 'CONECTADO & OPERANTE' : 'SISTEMA DESATIVADO'}
            </p>
            <button
              onClick={toggleAi}
              className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${
                active ? 'bg-black text-white hover:bg-red-500' : 'bg-orange-500 text-white shadow-xl shadow-orange-100'
              }`}
            >
              {active ? 'Desligar Agente' : 'Ativar Sistema'}
            </button>
          </div>

          {/* Mode toggles */}
          <div className="bg-white p-8 rounded-[32px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-4">
            <h3 className="font-black text-black text-xs uppercase tracking-widest mb-2">Modos de Atuação</h3>
            <Toggle
              checked={aiLeadActive}
              onChange={handleToggleLead}
              label="IA para Leads"
              description="Responde automaticamente novos contatos via WhatsApp e converte em agendamentos"
            />
            {hasFeature(tenantPlan, 'assistenteAdmin') ? (
              <Toggle
                checked={aiProfessionalActive}
                onChange={handleToggleProfessional}
                label="Assessor do Profissional"
                description="Notifica e interage com os profissionais sobre agenda, confirmações e cancelamentos"
              />
            ) : (
              <div className="flex items-center justify-between gap-4 bg-slate-50 rounded-2xl p-5 opacity-60">
                <div>
                  <p className="text-xs font-black text-black uppercase tracking-wide">🔒 Assessor do Profissional</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">Disponível a partir do plano Elite</p>
                </div>
              </div>
            )}
            {!active && (
              <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest text-center pt-2">Ative o sistema acima para os modos funcionarem</p>
            )}
          </div>

          {/* Buffer configurável */}
          <div className="bg-white p-8 rounded-[32px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-5">
            <div>
              <h3 className="font-black text-black text-xs uppercase tracking-widest">Buffer de Mensagens</h3>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5">Aguarda este tempo de silêncio antes de responder</p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-slate-400 uppercase">Espera</span>
                <span className="text-2xl font-black text-orange-500">{msgBufferSecs}s</span>
              </div>
              <input
                type="range"
                min={5}
                max={120}
                step={5}
                value={msgBufferSecs}
                onChange={e => setMsgBufferSecs(Number(e.target.value))}
                className="w-full accent-orange-500"
              />
              <div className="flex justify-between text-[9px] font-black text-slate-300 uppercase">
                <span>5s</span>
                <span>Rápido ←→ Paciente</span>
                <span>120s</span>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Right column: prompt + API key config ─── */}
        <div className="flex-1 bg-white p-4 sm:p-6 md:p-8 rounded-[50px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-6">
          <div className="space-y-3">
            <label className="text-[10px] font-black text-black uppercase tracking-[0.2em] ml-2">Personalidade do Atendente</label>
            <input value={agentName} onChange={e => setAgentName(e.target.value)} className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[24px] outline-none font-black text-sm uppercase tracking-tight focus:border-orange-500 transition-all" />
          </div>

          {/* ─── Modo de Conversa ─── */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-black uppercase tracking-[0.2em] ml-2">Modo de Conversa do Agente</label>
            <div className="grid grid-cols-3 gap-3">
              {([
                { value: 'feminino',  emoji: '👩', label: 'Feminino',  desc: '"linda", "querida", "flor"' },
                { value: 'neutro',    emoji: '🧑', label: 'Neutro',    desc: '"cliente", "você", inclusivo' },
                { value: 'masculino', emoji: '👨', label: 'Masculino', desc: '"cara", "mano", "irmão"' },
              ] as { value: 'feminino'|'neutro'|'masculino'; emoji: string; label: string; desc: string }[]).map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => setAgentGender(opt.value)}
                  className={`flex flex-col items-center gap-1.5 p-4 rounded-[20px] border-2 transition-all ${agentGender === opt.value ? 'border-orange-500 bg-orange-50' : 'border-slate-100 bg-slate-50 hover:border-slate-300'}`}
                >
                  <span className="text-2xl">{opt.emoji}</span>
                  <span className={`text-[10px] font-black uppercase tracking-wider ${agentGender === opt.value ? 'text-orange-600' : 'text-slate-600'}`}>{opt.label}</span>
                  <span className="text-[9px] font-bold text-slate-400 text-center leading-tight">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>


          <div className="space-y-3">
            <label className="text-[10px] font-black text-black uppercase tracking-[0.2em] ml-2">Contexto e Comportamento (System Prompt)</label>
            <textarea
              rows={8}
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              className="w-full p-8 bg-slate-50 border-2 border-slate-100 rounded-[30px] outline-none focus:border-orange-500 transition-all text-sm font-bold leading-relaxed text-black"
            />
          </div>

          {/* ─── Etapas do Funil ─── */}
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-black text-black uppercase tracking-[0.2em] ml-2">Etapas do Funil de Atendimento</label>
              <p className="text-[10px] font-bold text-slate-400 ml-2 mt-0.5">Personalize o comportamento do agente em cada etapa — funciona como base de orientação, não como regra absoluta.</p>
            </div>
            {([
              { key: 'saudacao',     emoji: '🌅', label: 'Saudação e Abertura',    desc: 'Primeiro contato e abertura da conversa' },
              { key: 'servico',      emoji: '✂️', label: 'Identificar Serviço',    desc: 'Como o agente conduz a escolha do serviço' },
              { key: 'profissional', emoji: '👤', label: 'Escolher Profissional',  desc: 'Como o agente apresenta os profissionais' },
              { key: 'data',         emoji: '📅', label: 'Definir Data',           desc: 'Como o agente conduz a escolha do dia' },
              { key: 'horario',      emoji: '⏰', label: 'Oferecer Horário',       desc: 'Como o agente apresenta os horários disponíveis' },
              { key: 'confirmacao',  emoji: '✅', label: 'Confirmação Final',      desc: 'Como o agente resume e confirma o agendamento' },
            ].map(stage => {
              const isOpen = expandedStage === stage.key;
              const currentVal = funnelStagePrompts[stage.key] || '';
              const isEdited = currentVal.trim() !== (DEFAULT_STAGE_PROMPTS[stage.key] || '').trim();
              return (
                <div key={stage.key} className={`rounded-[20px] border-2 transition-all overflow-hidden ${isEdited ? 'border-orange-200 bg-orange-50/40' : 'border-slate-100 bg-slate-50'}`}>
                  <button
                    type="button"
                    onClick={() => setExpandedStage(isOpen ? null : stage.key)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{stage.emoji}</span>
                      <div>
                        <p className="text-[11px] font-black text-black uppercase tracking-wide">{stage.label}</p>
                        <p className="text-[10px] font-bold text-slate-400">{stage.desc}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isEdited && <span className="text-[9px] font-black text-orange-500 uppercase bg-orange-100 px-2 py-0.5 rounded-full">editado</span>}
                      <span className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} style={{ fontSize: 12 }}>▼</span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-5 space-y-4">
                      {/* Instrução editável */}
                      <div className="space-y-1">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Instrução para o agente</p>
                        <textarea
                          rows={3}
                          value={currentVal}
                          onChange={e => setFunnelStagePrompts(prev => ({ ...prev, [stage.key]: e.target.value }))}
                          className="w-full p-4 bg-white border-2 border-slate-100 rounded-[16px] outline-none focus:border-orange-500 transition-all text-xs font-bold leading-relaxed text-black resize-none"
                        />
                        {isEdited && (
                          <button
                            type="button"
                            onClick={() => setFunnelStagePrompts(prev => ({ ...prev, [stage.key]: DEFAULT_STAGE_PROMPTS[stage.key] }))}
                            className="text-[9px] font-black text-slate-400 uppercase hover:text-orange-500 transition-colors ml-1"
                          >
                            ↩ Restaurar texto padrão
                          </button>
                        )}
                      </div>

                      {/* Exemplo prático */}
                      {STAGE_EXAMPLES[stage.key] && (
                        <div className="space-y-1">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Exemplo na prática</p>
                          <div className="bg-[#ECE5DD] rounded-[16px] p-3 space-y-2">
                            {STAGE_EXAMPLES[stage.key].map((msg, i) => (
                              <div key={i} className={`flex ${msg.role === 'agent' ? 'justify-end' : 'justify-start'}`}>
                                <div
                                  className={`max-w-[80%] px-3 py-2 rounded-[12px] shadow-sm ${
                                    msg.role === 'agent'
                                      ? 'bg-[#DCF8C6] text-black rounded-tr-none'
                                      : 'bg-white text-black rounded-tl-none'
                                  }`}
                                  style={{ fontSize: 10, fontWeight: 600, lineHeight: 1.5, whiteSpace: 'pre-line' }}
                                >
                                  {msg.text}
                                </div>
                              </div>
                            ))}
                          </div>
                          <p className="text-[8px] font-bold text-slate-300 ml-1">Branco = cliente · Verde = agente</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            }))}
          </div>

          <div className="flex justify-end pt-4">
            <button onClick={handleSavePrompt} disabled={savingPrompt} className="bg-black text-white px-12 py-5 rounded-[24px] font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-orange-500 transition-all disabled:opacity-50">
              {savingPrompt ? 'Salvando...' : 'Salvar IA'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiAgentConfig;
