import React, { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { evolutionService } from '../services/evolutionService';
import { Tenant } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

interface TestStep {
  id: string;
  customerMessage: string;
  expectedBehavior: string;
}

interface TestScenario {
  id: string;
  name: string;
  description: string;
  icon: string;
  bugRef?: string; // reference to the bug that originated this scenario
  steps: TestStep[];
  builtIn?: boolean; // true = cannot be deleted
}

interface StepResult {
  stepId: string;
  status: 'pending' | 'sending' | 'waiting' | 'success' | 'timeout' | 'error';
  sentAt?: number;
  aiResponse?: string;
  latencyMs?: number;
  error?: string;
}

interface ScenarioRun {
  scenarioId: string;
  scenarioName: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  currentStepIndex: number;
  stepResults: StepResult[];
  startedAt: number;
  completedAt?: number;
}

interface TenantHealth {
  aiActive: boolean;
  connected: boolean;
  services: string[];
  professionals: string[];
  issues: string[];
}

// ── Built-in scenarios (based on real bugs fixed) ────────────────────────────

const BUILTIN_SCENARIOS: TestScenario[] = [
  {
    id: 'bug-combo-barba',
    name: 'BUG: Combo so reconhecia barba',
    icon: '🐛',
    description: 'Cliente pedia "cabelo e barba" mas IA reconhecia so barba. Substring match rodava antes do combo.',
    bugRef: 'Fix commit bdc8842',
    builtIn: true,
    steps: [
      { id: 's1', customerMessage: 'Quero cabelo e barba', expectedBehavior: 'Deve reconhecer COMBO (cabelo+barba) na resposta, NAO apenas "barba"' },
    ],
  },
  {
    id: 'bug-multi-service',
    name: 'BUG: Multi-servico ignorado',
    icon: '🐛',
    description: 'Cliente pediu 4 servicos mas IA reconheceu so 1. matchServiceByKeywords retornava no primeiro match.',
    bugRef: 'Fix commit 97c418b',
    builtIn: true,
    steps: [
      { id: 's1', customerMessage: 'Eu vou querer fazer a barba, cortar o cabelo, passar aquele produtinho no cabelo tambem, fazer a sobrancelha tambem', expectedBehavior: 'Deve listar TODOS os servicos: barba, corte, progressiva/produto, sobrancelha' },
    ],
  },
  {
    id: 'bug-colloquial-time',
    name: 'BUG: "5 e meia" nao reconhecido',
    icon: '🐛',
    description: 'Cliente disse "5 e meia" e IA nao entendeu como 17:30, resetou o fluxo de agendamento.',
    bugRef: 'Fix commit 97c418b',
    builtIn: true,
    steps: [
      { id: 's1', customerMessage: 'Quero cortar cabelo', expectedBehavior: 'Reconhece servico e segue fluxo' },
      { id: 's2', customerMessage: '5 e meia', expectedBehavior: 'Deve interpretar como 17:30, NAO deve resetar o fluxo pedindo servico de novo' },
    ],
  },
  {
    id: 'bug-flow-reset',
    name: 'BUG: Fluxo resetava perdendo dados',
    icon: '🐛',
    description: 'Apos coletar servico e horario, IA perguntava "Qual procedimento?" novamente.',
    bugRef: 'Fix commit 97c418b',
    builtIn: true,
    steps: [
      { id: 's1', customerMessage: 'Oi quero agendar um corte', expectedBehavior: 'Reconhece corte, pergunta profissional/dia/horario' },
      { id: 's2', customerMessage: 'Amanha as 10', expectedBehavior: 'Deve confirmar horario, NAO deve perguntar "qual procedimento?" de novo' },
    ],
  },
  {
    id: 'bug-greeting-natural',
    name: 'BUG: Saudacao forcava agendamento',
    icon: '🐛',
    description: 'Cliente mandava "Oi, tudo bem?" e IA ja pulava para "Qual servico deseja?".',
    bugRef: 'Fix: AI prompt critical reminders',
    builtIn: true,
    steps: [
      { id: 's1', customerMessage: 'Oi, tudo bem?', expectedBehavior: 'Resposta natural e amigavel, sem forcar "qual servico?"' },
    ],
  },
  {
    id: 'bug-fitin-now',
    name: 'BUG: Encaixe agora tratado como on-the-way',
    icon: '🐛',
    description: 'Cliente pedia "tem como encaixar agora?" e sistema respondia "Te esperamos!" sem verificar disponibilidade.',
    bugRef: 'Fix: walk-in detection antes do on-the-way',
    builtIn: true,
    steps: [
      { id: 's1', customerMessage: 'tem como encaixar agora? to chegando', expectedBehavior: 'Deve perguntar qual servico ou verificar disponibilidade, NAO responder "Te esperamos"' },
    ],
  },
  {
    id: 'bug-audio-conflict',
    name: 'BUG: Audio processado sem confirmacao',
    icon: '🐛',
    description: 'Audios informais eram processados direto pela IA sem confirmacao, causando interpretacao errada.',
    bugRef: 'Fix: transcricao + cleanup + confirmacao antes de processar',
    builtIn: true,
    steps: [
      { id: 's1', customerMessage: 'Quero cortar o cabelo amanha as duas da tarde', expectedBehavior: 'IA deve reconhecer servico e horario normalmente (teste com texto que simula audio transcrito)' },
    ],
  },
  {
    id: 'bug-corta-informal',
    name: 'BUG: "corta" nao reconhecido como corte',
    icon: '🐛',
    description: 'Cliente dizia "quero corta com o matheus tem vaga ai?" e sistema nao reconhecia como pedido de corte.',
    bugRef: 'Fix: adicionado "corta" a BOOK_KW2 e SVC_SYNONYMS',
    builtIn: true,
    steps: [
      { id: 's1', customerMessage: 'Quero corta tem vaga ai?', expectedBehavior: 'Deve reconhecer como pedido de corte de cabelo e seguir fluxo de agendamento' },
    ],
  },
  {
    id: 'bug-corte-vira-combo',
    name: 'BUG: Corte virava Corte+Relaxamento',
    icon: '🐛',
    description: 'Ao pedir so "corte", sistema selecionava "Corte e Relaxamento" (combo mais longo) em vez do servico simples.',
    bugRef: 'Fix: preferir servico mais especifico no matching individual',
    builtIn: true,
    steps: [
      { id: 's1', customerMessage: 'Quero so corte', expectedBehavior: 'Deve selecionar APENAS corte, nao combo com relaxamento ou outro servico' },
    ],
  },
  {
    id: 'regression-single-service',
    name: 'Regressao: Servico unico',
    icon: '✅',
    description: 'Verifica que reconhecimento basico de servico unico continua funcionando.',
    builtIn: true,
    steps: [
      { id: 's1', customerMessage: 'Quero cortar cabelo', expectedBehavior: 'Reconhece corte de cabelo e segue fluxo normalmente' },
    ],
  },
  {
    id: 'regression-full-flow',
    name: 'Regressao: Fluxo completo',
    icon: '✅',
    description: 'Conversa completa de agendamento do inicio ao fim (4 steps).',
    builtIn: true,
    steps: [
      { id: 's1', customerMessage: 'Oi, quero agendar', expectedBehavior: 'Saudacao + pergunta qual servico' },
      { id: 's2', customerMessage: 'Corte de cabelo', expectedBehavior: 'Reconhece servico, pergunta profissional/dia/horario' },
      { id: 's3', customerMessage: 'Amanha as 10', expectedBehavior: 'Confirma horario e pede confirmacao final' },
      { id: 's4', customerMessage: 'Confirmar', expectedBehavior: 'Agendamento confirmado com resumo completo' },
    ],
  },
];

const STORAGE_KEY = 'agz_test_scenarios';

function loadCustomScenarios(): TestScenario[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomScenarios(scenarios: TestScenario[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const WEBHOOK_URL = 'https://cnnfnqrnjckntnxdgwae.supabase.co/functions/v1/whatsapp-webhook';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubmZucXJuamNrbnRueGRnd2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MTM3NzksImV4cCI6MjA4NzE4OTc3OX0.ANyOJVIsBv0GWuJyUmdicRrgHqZc5VAXRUSua_roO4I';

async function simulateWebhook(instanceName: string, phone: string, text: string): Promise<boolean> {
  const msgId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    event: 'messages.upsert',
    instance: instanceName,
    data: [{
      key: { id: msgId, remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
      message: { conversation: text },
      messageTimestamp: Math.floor(Date.now() / 1000),
      pushName: 'Teste SuperAdmin',
      messageType: 'text',
    }],
  };
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function pollResponse(
  tenantId: string, phone: string, afterTs: number, timeoutMs: number, abortRef: React.MutableRefObject<boolean>,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  await new Promise(r => setTimeout(r, 15000));

  while (Date.now() < deadline) {
    if (abortRef.current) return null;
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('body, ts')
      .eq('tenant_id', tenantId)
      .eq('phone', phone)
      .eq('direction', 'out')
      .gt('ts', afterTs)
      .order('ts', { ascending: true });

    if (data && data.length > 0) {
      await new Promise(r => setTimeout(r, 5000));
      const { data: all } = await supabase
        .from('whatsapp_messages')
        .select('body')
        .eq('tenant_id', tenantId)
        .eq('phone', phone)
        .eq('direction', 'out')
        .gt('ts', afterTs)
        .order('ts', { ascending: true });
      return (all || data).map((m: any) => m.body).join('\n');
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

async function clearSession(tenantId: string, phone: string) {
  await supabase.from('agent_sessions').delete().eq('tenant_id', tenantId).eq('phone', phone);
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  tenants: Tenant[];
}

const TestRunnerPanel: React.FC<Props> = ({ tenants }) => {
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [testPhone, setTestPhone] = useState(() => localStorage.getItem('agz_test_phone') || '');
  const [health, setHealth] = useState<TenantHealth | null>(null);
  const [validating, setValidating] = useState(false);
  const [currentRun, setCurrentRun] = useState<ScenarioRun | null>(null);
  const [history, setHistory] = useState<ScenarioRun[]>([]);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [customScenarios, setCustomScenarios] = useState<TestScenario[]>(loadCustomScenarios);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newBugRef, setNewBugRef] = useState('');
  const [newSteps, setNewSteps] = useState<{ msg: string; expected: string }[]>([{ msg: '', expected: '' }]);
  const abortRef = useRef(false);

  const allScenarios = [...BUILTIN_SCENARIOS, ...customScenarios];

  useEffect(() => {
    if (testPhone) localStorage.setItem('agz_test_phone', testPhone);
  }, [testPhone]);

  const activeTenants = tenants.filter(t => t.evolution_instance);
  const selectedTenant = activeTenants.find(t => t.id === selectedTenantId);

  // ── Validate tenant ──
  const validateTenant = useCallback(async () => {
    if (!selectedTenantId || !selectedTenant) return;
    setValidating(true);
    const issues: string[] = [];
    const instanceName = selectedTenant.evolution_instance || '';

    let aiActive = false;
    try {
      const { data } = await supabase.from('tenant_settings').select('ai_active').eq('tenant_id', selectedTenantId).maybeSingle();
      aiActive = data?.ai_active ?? false;
    } catch {}
    if (!aiActive) issues.push('IA desativada');

    let connected = false;
    try {
      const st = await evolutionService.checkStatus(instanceName);
      connected = st === 'open';
    } catch {}
    if (!connected) issues.push('WhatsApp desconectado');

    let svcNames: string[] = [];
    try {
      const { data } = await supabase.from('services').select('nome').eq('tenant_id', selectedTenantId).eq('ativo', true);
      svcNames = (data || []).map((s: any) => s.nome);
    } catch {}
    if (svcNames.length === 0) issues.push('Sem servicos ativos');

    let profNames: string[] = [];
    try {
      const { data } = await supabase.from('professionals').select('nome').eq('tenant_id', selectedTenantId).eq('ativo', true);
      profNames = (data || []).map((p: any) => p.nome);
    } catch {}
    if (profNames.length === 0) issues.push('Sem profissionais ativos');

    setHealth({ aiActive, connected, services: svcNames, professionals: profNames, issues });
    setValidating(false);
  }, [selectedTenantId, selectedTenant]);

  // ── Run scenario ──
  const runScenario = useCallback(async (scenario: TestScenario) => {
    if (!selectedTenant || !testPhone.trim()) return;
    const phone = testPhone.replace(/\D/g, '');
    const instanceName = selectedTenant.evolution_instance || '';
    abortRef.current = false;

    const run: ScenarioRun = {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      status: 'running',
      currentStepIndex: 0,
      stepResults: scenario.steps.map(s => ({ stepId: s.id, status: 'pending' as const })),
      startedAt: Date.now(),
    };
    setCurrentRun({ ...run });
    await clearSession(selectedTenantId, phone);

    for (let i = 0; i < scenario.steps.length; i++) {
      if (abortRef.current) { run.status = 'aborted'; setCurrentRun({ ...run }); break; }

      const step = scenario.steps[i];
      run.currentStepIndex = i;
      run.stepResults[i] = { stepId: step.id, status: 'sending' };
      setCurrentRun({ ...run });

      const sentTs = Math.floor(Date.now() / 1000) - 1;
      const sentAt = Date.now();

      try {
        const ok = await simulateWebhook(instanceName, phone, step.customerMessage);
        if (!ok) {
          run.stepResults[i] = { stepId: step.id, status: 'error', error: 'Webhook retornou erro' };
          run.status = 'failed'; setCurrentRun({ ...run }); break;
        }

        run.stepResults[i] = { stepId: step.id, status: 'waiting', sentAt };
        setCurrentRun({ ...run });

        const response = await pollResponse(selectedTenantId, phone, sentTs, 90000, abortRef);
        if (abortRef.current) { run.status = 'aborted'; setCurrentRun({ ...run }); break; }

        if (response) {
          run.stepResults[i] = { stepId: step.id, status: 'success', sentAt, aiResponse: response, latencyMs: Date.now() - sentAt };
        } else {
          run.stepResults[i] = { stepId: step.id, status: 'timeout', sentAt, error: 'IA nao respondeu em 90s' };
          run.status = 'failed'; setCurrentRun({ ...run }); break;
        }
      } catch (e: any) {
        run.stepResults[i] = { stepId: step.id, status: 'error', sentAt, error: e.message };
        run.status = 'failed'; setCurrentRun({ ...run }); break;
      }
      setCurrentRun({ ...run });
    }

    if (run.status === 'running') run.status = 'completed';
    run.completedAt = Date.now();
    setCurrentRun({ ...run });
    setHistory(prev => [{ ...run }, ...prev].slice(0, 30));
  }, [selectedTenantId, selectedTenant, testPhone]);

  const handleAbort = () => { abortRef.current = true; };

  const handleClearSession = async () => {
    if (!selectedTenantId || !testPhone.trim()) return;
    await clearSession(selectedTenantId, testPhone.replace(/\D/g, ''));
  };

  // ── Custom scenario CRUD ──
  const handleAddScenario = () => {
    if (!newName.trim() || newSteps.every(s => !s.msg.trim())) return;
    const scenario: TestScenario = {
      id: `custom_${Date.now()}`,
      name: newName.trim(),
      description: newDesc.trim() || 'Cenario customizado',
      icon: '🧪',
      bugRef: newBugRef.trim() || undefined,
      steps: newSteps.filter(s => s.msg.trim()).map((s, i) => ({
        id: `s${i + 1}`,
        customerMessage: s.msg.trim(),
        expectedBehavior: s.expected.trim() || 'Verificar resposta',
      })),
    };
    const updated = [...customScenarios, scenario];
    setCustomScenarios(updated);
    saveCustomScenarios(updated);
    setShowNewForm(false);
    setNewName(''); setNewDesc(''); setNewBugRef('');
    setNewSteps([{ msg: '', expected: '' }]);
  };

  const handleDeleteScenario = (id: string) => {
    const updated = customScenarios.filter(s => s.id !== id);
    setCustomScenarios(updated);
    saveCustomScenarios(updated);
  };

  const isRunning = currentRun?.status === 'running';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-1">Sistema</p>
        <h2 className="text-2xl font-black text-black">Test Runner</h2>
        <p className="text-xs text-slate-400 mt-1">Simula mensagens de cliente e verifica respostas da IA — cenarios baseados em bugs reais</p>
      </div>

      {/* Config + Scenarios */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left: Config ── */}
        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 space-y-4">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Configuracao</p>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Tenant</label>
            <select
              value={selectedTenantId}
              onChange={e => { setSelectedTenantId(e.target.value); setHealth(null); }}
              className="w-full mt-1 px-3 py-2 border-2 border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-orange-400"
            >
              <option value="">Selecione...</option>
              {activeTenants.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.evolution_instance})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Telefone de teste</label>
            <input
              type="text" value={testPhone} onChange={e => setTestPhone(e.target.value)}
              placeholder="5511999999999"
              className="w-full mt-1 px-3 py-2 border-2 border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-orange-400"
            />
            <p className="text-[9px] text-slate-400 mt-1">Este numero recebe as respostas da IA no WhatsApp</p>
          </div>

          <button
            onClick={validateTenant} disabled={!selectedTenantId || validating}
            className="w-full py-2 bg-slate-800 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-700 transition disabled:opacity-40"
          >
            {validating ? 'Validando...' : 'Validar Tenant'}
          </button>

          {health && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              {[
                ['IA', health.aiActive ? 'Ativa' : 'Desativada', health.aiActive],
                ['WhatsApp', health.connected ? 'Conectado' : 'Desconectado', health.connected],
                ['Servicos', String(health.services.length), health.services.length > 0],
                ['Profissionais', String(health.professionals.length), health.professionals.length > 0],
              ].map(([label, val, ok]) => (
                <div key={label as string} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-[10px] font-bold text-slate-600">{label}: {val}</span>
                </div>
              ))}
              {health.issues.length > 0 && (
                <div className="bg-red-50 rounded-xl p-3 mt-2">
                  <p className="text-[9px] font-black text-red-600 uppercase tracking-widest mb-1">Problemas</p>
                  {health.issues.map((iss, i) => <p key={i} className="text-[10px] text-red-600">- {iss}</p>)}
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleClearSession} disabled={!selectedTenantId || !testPhone.trim() || isRunning}
            className="w-full py-2 bg-slate-200 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-300 transition disabled:opacity-40"
          >
            Limpar Sessao
          </button>
        </div>

        {/* ── Center: Scenarios ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Bug fix scenarios */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black text-red-500 uppercase tracking-widest">🐛 Cenarios de Bug (fixes aplicados)</p>
            <span className="text-[9px] text-slate-400">{BUILTIN_SCENARIOS.filter(s => s.icon === '🐛').length} bugs</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {BUILTIN_SCENARIOS.filter(s => s.icon === '🐛').map(sc => (
              <ScenarioCard key={sc.id} scenario={sc} onRun={runScenario} disabled={!selectedTenantId || !testPhone.trim() || isRunning || (health !== null && !health.aiActive)} />
            ))}
          </div>

          {/* Regression scenarios */}
          <p className="text-[10px] font-black text-green-600 uppercase tracking-widest pt-2">✅ Regressao</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {BUILTIN_SCENARIOS.filter(s => s.icon === '✅').map(sc => (
              <ScenarioCard key={sc.id} scenario={sc} onRun={runScenario} disabled={!selectedTenantId || !testPhone.trim() || isRunning || (health !== null && !health.aiActive)} />
            ))}
          </div>

          {/* Custom scenarios */}
          {customScenarios.length > 0 && (
            <>
              <p className="text-[10px] font-black text-purple-500 uppercase tracking-widest pt-2">🧪 Cenarios Customizados</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {customScenarios.map(sc => (
                  <ScenarioCard key={sc.id} scenario={sc} onRun={runScenario} onDelete={handleDeleteScenario} disabled={!selectedTenantId || !testPhone.trim() || isRunning || (health !== null && !health.aiActive)} />
                ))}
              </div>
            </>
          )}

          {/* Add new scenario */}
          {!showNewForm ? (
            <button
              onClick={() => setShowNewForm(true)}
              className="w-full py-3 border-2 border-dashed border-slate-200 rounded-2xl text-[10px] font-black text-slate-400 uppercase tracking-widest hover:border-orange-400 hover:text-orange-500 transition"
            >
              + Novo Cenario de Teste
            </button>
          ) : (
            <div className="bg-white rounded-2xl border-2 border-orange-200 p-5 space-y-3">
              <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Novo Cenario</p>

              <input
                type="text" value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Nome do cenario (ex: BUG: horario nao reconhecido)"
                className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-orange-400"
              />
              <input
                type="text" value={newDesc} onChange={e => setNewDesc(e.target.value)}
                placeholder="Descricao do bug / o que testa"
                className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-orange-400"
              />
              <input
                type="text" value={newBugRef} onChange={e => setNewBugRef(e.target.value)}
                placeholder="Referencia do fix (opcional, ex: commit abc123)"
                className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-orange-400"
              />

              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wide pt-1">Steps (mensagens do cliente)</p>
              {newSteps.map((step, i) => (
                <div key={i} className="flex gap-2">
                  <div className="flex-1 space-y-1">
                    <input
                      type="text" value={step.msg}
                      onChange={e => { const u = [...newSteps]; u[i].msg = e.target.value; setNewSteps(u); }}
                      placeholder={`Mensagem ${i + 1} do cliente`}
                      className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-orange-400"
                    />
                    <input
                      type="text" value={step.expected}
                      onChange={e => { const u = [...newSteps]; u[i].expected = e.target.value; setNewSteps(u); }}
                      placeholder="Comportamento esperado da IA"
                      className="w-full px-3 py-1.5 border border-slate-100 rounded-lg text-[10px] text-slate-500 focus:outline-none focus:border-orange-300"
                    />
                  </div>
                  {newSteps.length > 1 && (
                    <button onClick={() => setNewSteps(newSteps.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 text-xs font-bold self-start mt-2">✕</button>
                  )}
                </div>
              ))}
              <button
                onClick={() => setNewSteps([...newSteps, { msg: '', expected: '' }])}
                className="text-[9px] font-bold text-orange-500 hover:text-orange-600"
              >
                + Adicionar step
              </button>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleAddScenario}
                  disabled={!newName.trim() || newSteps.every(s => !s.msg.trim())}
                  className="flex-1 py-2 bg-orange-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-600 transition disabled:opacity-40"
                >
                  Salvar Cenario
                </button>
                <button
                  onClick={() => { setShowNewForm(false); setNewName(''); setNewDesc(''); setNewBugRef(''); setNewSteps([{ msg: '', expected: '' }]); }}
                  className="px-4 py-2 bg-slate-200 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-300 transition"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Abort */}
          {isRunning && (
            <button onClick={handleAbort} className="w-full py-2 bg-red-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-600 transition">
              Parar Teste
            </button>
          )}
        </div>
      </div>

      {/* ── Execution display ── */}
      {currentRun && (
        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-[10px] font-black uppercase tracking-widest ${
                currentRun.status === 'running' ? 'text-orange-500' : currentRun.status === 'completed' ? 'text-green-600' : currentRun.status === 'aborted' ? 'text-yellow-600' : 'text-red-500'
              }`}>
                {currentRun.status === 'running' ? 'Executando...' : currentRun.status === 'completed' ? 'Concluido' : currentRun.status === 'aborted' ? 'Abortado' : 'Falhou'}
              </p>
              <p className="text-sm font-black text-black">{currentRun.scenarioName}</p>
            </div>
            {currentRun.completedAt && (
              <span className="text-[10px] text-slate-400">{Math.round((currentRun.completedAt - currentRun.startedAt) / 1000)}s total</span>
            )}
          </div>

          {allScenarios.find(s => s.id === currentRun.scenarioId)?.steps.map((step, i) => {
            const result = currentRun.stepResults[i];
            if (!result) return null;
            return (
              <div key={step.id} className={`rounded-2xl p-4 space-y-2 ${
                result.status === 'success' ? 'bg-green-50 border border-green-200' :
                result.status === 'error' || result.status === 'timeout' ? 'bg-red-50 border border-red-200' :
                result.status === 'waiting' || result.status === 'sending' ? 'bg-orange-50 border border-orange-200' :
                'bg-slate-50 border border-slate-200'
              }`}>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-slate-600 uppercase tracking-wide">
                    Step {i + 1}/{currentRun.stepResults.length}
                    {result.status === 'success' && ' ✅'}
                    {result.status === 'sending' && ' ⬆️'}
                    {result.status === 'waiting' && ' ⏳'}
                    {result.status === 'timeout' && ' ⚠️'}
                    {result.status === 'error' && ' ❌'}
                    {result.status === 'pending' && ' ⏸️'}
                  </p>
                  {result.latencyMs != null && <span className="text-[9px] text-slate-400">{(result.latencyMs / 1000).toFixed(1)}s</span>}
                </div>

                <div className="flex items-start gap-2">
                  <span className="text-[10px] flex-shrink-0 mt-0.5">📤</span>
                  <p className="text-[11px] font-medium text-slate-700">{step.customerMessage}</p>
                </div>

                <div className="flex items-start gap-2">
                  <span className="text-[10px] flex-shrink-0 mt-0.5">🎯</span>
                  <p className="text-[10px] text-slate-400 italic">{step.expectedBehavior}</p>
                </div>

                {result.aiResponse && (
                  <div className="flex items-start gap-2 bg-white/60 rounded-xl p-3 mt-1">
                    <span className="text-[10px] text-green-600 flex-shrink-0 mt-0.5">🤖</span>
                    <p className="text-[11px] text-slate-800 whitespace-pre-wrap">{result.aiResponse}</p>
                  </div>
                )}

                {result.error && <p className="text-[10px] text-red-600 font-medium">{result.error}</p>}

                {result.status === 'waiting' && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                    <p className="text-[10px] text-orange-500 font-medium">Aguardando resposta da IA...</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── History ── */}
      {history.length > 0 && (
        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 space-y-3">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Historico de Testes</p>
          {history.map((run) => {
            const key = `${run.scenarioId}-${run.startedAt}`;
            const isExpanded = expandedHistory === key;
            const scenario = allScenarios.find(s => s.id === run.scenarioId);
            return (
              <div key={key} className="border border-slate-100 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setExpandedHistory(isExpanded ? null : key)}
                  className="w-full flex items-center justify-between p-3 hover:bg-slate-50 transition text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${run.status === 'completed' ? 'bg-green-500' : run.status === 'aborted' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                    <span className="text-[10px] font-bold text-slate-700">{run.scenarioName}</span>
                    <span className="text-[9px] text-slate-400">
                      {new Date(run.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-bold uppercase ${run.status === 'completed' ? 'text-green-600' : run.status === 'aborted' ? 'text-yellow-600' : 'text-red-600'}`}>
                      {run.status === 'completed' ? 'OK' : run.status === 'aborted' ? 'Abortado' : 'Falhou'}
                    </span>
                    <span className="text-slate-300 text-xs">{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </button>
                {isExpanded && scenario && (
                  <div className="px-3 pb-3 space-y-2">
                    {scenario.steps.map((step, i) => {
                      const r = run.stepResults[i];
                      if (!r) return null;
                      return (
                        <div key={step.id} className="bg-slate-50 rounded-xl p-3 space-y-1">
                          <p className="text-[9px] font-bold text-slate-500">
                            Step {i + 1}: {r.status === 'success' ? '✅' : r.status === 'timeout' ? '⚠️' : r.status === 'error' ? '❌' : '⏸️'}
                            {r.latencyMs ? ` (${(r.latencyMs / 1000).toFixed(1)}s)` : ''}
                          </p>
                          <p className="text-[10px] text-slate-600">📤 {step.customerMessage}</p>
                          {r.aiResponse && <p className="text-[10px] text-slate-800 whitespace-pre-wrap">🤖 {r.aiResponse}</p>}
                          {r.error && <p className="text-[10px] text-red-600">{r.error}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Scenario Card ────────────────────────────────────────────────────────────

const ScenarioCard: React.FC<{
  scenario: TestScenario;
  onRun: (s: TestScenario) => void;
  onDelete?: (id: string) => void;
  disabled: boolean;
}> = ({ scenario, onRun, onDelete, disabled }) => (
  <div className="bg-white rounded-2xl border-2 border-slate-100 p-4 space-y-2">
    <div className="flex items-start gap-3">
      <span className="text-xl flex-shrink-0">{scenario.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-black text-black uppercase tracking-wide leading-tight">{scenario.name}</p>
        <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{scenario.description}</p>
        {scenario.bugRef && <p className="text-[9px] text-slate-300 mt-0.5 italic">{scenario.bugRef}</p>}
        <p className="text-[9px] text-slate-300 mt-1">{scenario.steps.length} step{scenario.steps.length > 1 ? 's' : ''}</p>
      </div>
    </div>
    <div className="flex items-center gap-2">
      <button
        onClick={() => onRun(scenario)} disabled={disabled}
        className="flex-1 py-1.5 bg-orange-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-orange-600 transition disabled:opacity-40"
      >
        Executar
      </button>
      {onDelete && (
        <button
          onClick={() => onDelete(scenario.id)}
          className="px-2 py-1.5 text-red-400 hover:text-red-600 text-[9px] font-bold"
        >
          ✕
        </button>
      )}
    </div>
  </div>
);

export default TestRunnerPanel;
