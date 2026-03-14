import { TenantSettings } from '../types';
import { db } from './mockDb';

export interface OptimizationResult {
  newPrompt: string;
  summary: string;
  insights: string[];   // human behavior patterns discovered this cycle
  booked: number;
  abandoned: number;
  total: number;
}

export interface AllTenantsResult {
  tenantId: string;
  tenantName: string;
  status: 'ok' | 'skipped' | 'error';
  message?: string;
  result?: OptimizationResult;
}

export interface EvolutionSnapshot {
  date: string;
  tenantsOptimized: number;
  totalTenants: number;
  avgConversionRate: number;
  globalScore: number;
  totalConversations: number;
  totalBooked: number;
}

const EVOLUTION_KEY = 'agz_ai_evolution';

export function loadEvolutionHistory(): EvolutionSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(EVOLUTION_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveEvolutionSnapshot(snap: EvolutionSnapshot) {
  const history = loadEvolutionHistory();
  history.unshift(snap);
  localStorage.setItem(EVOLUTION_KEY, JSON.stringify(history.slice(0, 30)));
}

// ── Format a conversation for GPT reading ────────────────────────────────────

function formatConv(
  log: { turns: number; history: Array<{ role: string; text: string }> },
  index: number,
  label: string
): string {
  const chat = (log.history || [])
    .map(h => `${h.role === 'user' ? 'Cliente' : 'IA'}: ${h.text}`)
    .join('\n');
  return `--- ${label} ${index + 1} (${log.turns} turnos) ---\n${chat || '(sem histórico)'}`;
}

// ── Individual tenant optimization ───────────────────────────────────────────

export async function runWeeklyOptimization(
  tenantId: string,
  tenantName: string,
  settings: TenantSettings,
  openAiKey: string,
  globalContext?: string
): Promise<OptimizationResult> {

  // 1. Fetch last 7 days of conversation logs
  const logs = await db.getConversationLogs(tenantId, 7);
  const bookedLogs  = logs.filter(l => l.outcome === 'booked');
  const abandoned   = logs.filter(l => l.outcome === 'abandoned');
  const duplicates  = logs.filter(l => l.outcome === 'duplicate');
  const total       = logs.filter(l => l.outcome !== 'duplicate').length;

  if (total < 3) {
    throw new Error('Dados insuficientes para otimização (mínimo 3 conversas nos últimos 7 dias)');
  }

  const currentPrompt  = settings.systemPrompt || '';
  const conversionRate = total > 0 ? Math.round((bookedLogs.length / total) * 100) : 0;

  // 2. Format all three categories for GPT
  const bookedSamples = bookedLogs.slice(0, 3)
    .map((l, i) => formatConv(l, i, 'Conversa bem-sucedida'))
    .join('\n\n') || 'Nenhum agendamento confirmado neste período.';

  const abandonedSamples = abandoned.slice(0, 5)
    .map((l, i) => formatConv(l, i, 'Conversa abandonada'))
    .join('\n\n') || 'Nenhuma conversa abandonada neste período.';

  const duplicateSamples = duplicates.length > 0
    ? duplicates.slice(0, 3)
        .map((d, i) => `${i + 1}. "${(d.history?.[0] as any)?.text?.slice(0, 120) || '?'}"`)
        .join('\n')
    : '';

  // 3. Compose analysis prompt focused on human behavior understanding
  const analysisPrompt = `Você é um especialista em comportamento humano aplicado a bots de agendamento via WhatsApp.

Sua missão NÃO é apenas aumentar conversão — é ensinar o agente a LER e ENTENDER o ser humano durante o processo de decisão de agendamento. Cada conversa é uma janela para como aquele ser humano pensa, hesita, confia e decide.

═══════════════════════════════════
PROMPT ATUAL DO AGENTE:
═══════════════════════════════════
${currentPrompt || '(sem prompt personalizado — usando padrão do sistema)'}

═══════════════════════════════════
DADOS DA SEMANA — ${tenantName}
═══════════════════════════════════
- Conversas analisadas: ${total}
- Agendamentos confirmados: ${bookedLogs.length} (${conversionRate}%)
- Conversas abandonadas: ${abandoned.length}
- Bugs de duplicação detectados: ${duplicates.length}${duplicates.length > 0 ? ' (agente enviou a mesma mensagem 2x — cliente provavelmente ficou confuso)' : ''}

═══════════════════════════════════
✅ CONVERSAS BEM-SUCEDIDAS
(o que o agente fez CERTO — por que o cliente decidiu agendar?)
═══════════════════════════════════
${bookedSamples}

═══════════════════════════════════
❌ CONVERSAS ABANDONADAS
(o que o agente NÃO percebeu no comportamento do cliente?)
═══════════════════════════════════
${abandonedSamples}

${duplicates.length > 0 ? `═══════════════════════════════════
⚠️ BUGS DE DUPLICAÇÃO
(em qual situação o agente travou e repetiu a mensagem?)
═══════════════════════════════════
${duplicateSamples}` : ''}

${globalContext ? `═══════════════════════════════════
🌐 APRENDIZADOS GLOBAIS DA PLATAFORMA
(padrões de comportamento humano identificados em múltiplos negócios)
═══════════════════════════════════
${globalContext}` : ''}

═══════════════════════════════════
ANÁLISE NECESSÁRIA
═══════════════════════════════════
Para cada conversa abandonada, responda internamente:
• Em qual momento exato o cliente sinalizou hesitação, medo, confusão ou desinteresse?
• O agente percebeu esse sinal ou ignorou e seguiu o script?
• Como o agente deveria ter respondido para manter o humano engajado?

Para cada conversa bem-sucedida, responda internamente:
• O que o agente fez que manteve o cliente confortável até confirmar o agendamento?
• Houve um momento decisivo em que o agente facilitou a decisão do cliente?

Para os bugs de duplicação:
• Em qual tipo de mensagem do cliente o agente trava?
• O cliente provavelmente ficou confuso — como evitar?

═══════════════════════════════════
OBJETIVO DO NOVO PROMPT
═══════════════════════════════════
Reescreva o prompt do agente para que ele:
1. Reconheça padrões de comportamento humano no funil de agendamento:
   → hesitação ("vou ver e te falo"), curiosidade exploratória, urgência, desconfiança, paralisia de decisão
2. Saiba QUANDO empurrar suavemente e QUANDO dar espaço
3. Responda ao que o cliente QUIS DIZER, não apenas ao que ele disse
4. Facilite a decisão em vez de transferir o peso para o cliente
5. Nunca repita a mesma mensagem — se o cliente não respondeu, mude a abordagem

Máximo 500 palavras. Em português. Prático e direto — o agente executa esse prompt em tempo real.

Responda APENAS com este JSON (sem markdown, sem texto fora do JSON):
{
  "newPrompt": "<novo prompt do agente>",
  "summary": "<o que mudou e por quê, em 2-3 frases>",
  "insights": [
    "<padrão de comportamento humano descoberto nesta análise>",
    "<padrão 2>",
    "<padrão 3>"
  ]
}`;

  // 4. Call OpenAI gpt-4.1-mini
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: analysisPrompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 1500,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '{}';
  let parsed: { newPrompt?: string; summary?: string; insights?: string[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Resposta inválida da IA — não foi possível parsear JSON');
  }

  const newPrompt = parsed.newPrompt || currentPrompt;
  const summary   = parsed.summary  || 'Otimização concluída sem alterações significativas.';
  const insights  = parsed.insights || [];
  const now       = new Date().toISOString();

  // 5. Update settings
  await db.updateSettings(tenantId, {
    systemPrompt: newPrompt,
    lastOptimizedAt: now,
    lastOptimizationSummary: summary,
  });

  // 6. Send report via Support chat
  const dateStr = new Date(now).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const insightLines = insights.length > 0
    ? `\n🧠 *Padrões de comportamento identificados:*\n${insights.map(i => `• ${i}`).join('\n')}`
    : '';

  const report =
    `📊 *Relatório de IA — ${tenantName}*\n\n` +
    `📅 ${dateStr}\n\n` +
    `✅ Agendamentos: ${bookedLogs.length}\n` +
    `❌ Abandonos: ${abandoned.length}\n` +
    `📈 Taxa de conversão: ${conversionRate}%\n` +
    (duplicates.length > 0 ? `⚠️ Bugs de duplicação: ${duplicates.length}\n` : '') +
    (globalContext ? `\n🌐 *Aprendizado global da plataforma aplicado.*\n` : '') +
    `\n🔧 *Otimização aplicada:*\n${summary}` +
    insightLines;

  await db.sendSupportReply(tenantId, report);

  return { newPrompt, summary, insights, booked: bookedLogs.length, abandoned: abandoned.length, total };
}

// ── Extract global human behavior patterns from ALL tenants ──────────────────

async function extractGlobalPatterns(
  allData: Array<{
    tenantName: string;
    booked: Array<{ turns: number; history: any[] }>;
    abandoned: Array<{ turns: number; history: any[] }>;
    duplicates: number;
  }>,
  openAiKey: string
): Promise<string> {

  const formatted = allData.map(t => {
    const successSamples = t.booked.slice(0, 2).map((l, i) => {
      const chat = (l.history || []).map((h: any) => `${h.role === 'user' ? 'Cliente' : 'IA'}: ${h.text}`).join('\n');
      return `  ✅ [${i + 1}] (${l.turns} turnos)\n${chat}`;
    }).join('\n\n');

    const abandonedSamples = t.abandoned.slice(0, 3).map((l, i) => {
      const chat = (l.history || []).map((h: any) => `${h.role === 'user' ? 'Cliente' : 'IA'}: ${h.text}`).join('\n');
      return `  ❌ [${i + 1}] (${l.turns} turnos)\n${chat}`;
    }).join('\n\n');

    return [
      `=== ${t.tenantName} ===`,
      successSamples   ? `ACERTOS:\n${successSamples}`     : '',
      abandonedSamples ? `FALHAS:\n${abandonedSamples}`    : '',
      t.duplicates > 0 ? `BUGS: ${t.duplicates} duplicações detectadas` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const prompt = `Você é um pesquisador de comportamento humano especializado no momento de decisão de agendamento via WhatsApp.

Abaixo estão conversas reais de múltiplos negócios diferentes (barbearias, clínicas, studios, etc.). Seu objetivo é identificar padrões UNIVERSAIS de comportamento humano que aparecem independentemente do nicho.

DADOS DE MÚLTIPLOS TENANTS:
${formatted}

ANÁLISE NECESSÁRIA:
Leia cada conversa e responda:
1. Quais sinais de linguagem o cliente usa quando está HESITANDO mas ainda interessado?
2. Quais sinais indicam que o cliente está PRONTO para agendar mas precisa de um facilitador?
3. Quais sinais indicam que o cliente vai ABANDONAR nos próximos turnos?
4. O que os agentes fizeram nas conversas BEM-SUCEDIDAS que manteve o cliente engajado?
5. O que os agentes fizeram nas conversas FRACASSADAS que empurrou o cliente para fora?
6. Em quais situações os bugs de duplicação aparecem e como isso afeta o cliente?

Responda com insights práticos e acionáveis em até 10 bullet points.
Cada bullet deve descrever um padrão de comportamento humano real observado nas conversas.
Em português. Seja específico — cite o tipo de mensagem ou sinal que revela o padrão.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 800,
    }),
  });

  if (!response.ok) return '';
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── Run optimization for ALL tenants with cross-tenant context ───────────────

export async function runAllTenantsOptimization(
  tenants: Array<{ id: string; name: string }>,
  openAiKey: string,
  onProgress?: (tenantId: string, tenantName: string, status: 'running' | 'ok' | 'skipped' | 'error', message?: string) => void
): Promise<{ results: AllTenantsResult[]; snapshot: EvolutionSnapshot }> {
  const results: AllTenantsResult[] = [];

  // 1. Fetch all tenants' logs in parallel
  const logsPerTenant = await Promise.all(
    tenants.map(async t => ({
      tenant: t,
      logs: await db.getConversationLogs(t.id, 7).catch(() => []),
    }))
  );

  // 2. Build combined data for global pattern extraction (success + failure + bugs)
  const allData = logsPerTenant
    .map(({ tenant, logs }) => ({
      tenantName: tenant.name,
      booked:     logs.filter(l => l.outcome === 'booked'),
      abandoned:  logs.filter(l => l.outcome === 'abandoned'),
      duplicates: logs.filter(l => l.outcome === 'duplicate').length,
    }))
    .filter(t => t.booked.length > 0 || t.abandoned.length > 0 || t.duplicates > 0);

  // 3. Extract global human behavior patterns from all tenants' data
  let globalContext = '';
  if (allData.length > 0) {
    try {
      globalContext = await extractGlobalPatterns(allData, openAiKey);
    } catch {
      // Non-fatal — proceed without global context
    }
  }

  // 4. Optimize each tenant sequentially (avoid rate limits)
  let totalBooked = 0;
  let totalConversations = 0;
  let tenantsOptimized = 0;

  for (const { tenant, logs } of logsPerTenant) {
    const total  = logs.filter(l => l.outcome !== 'duplicate').length;
    const booked = logs.filter(l => l.outcome === 'booked').length;

    totalConversations += total;
    totalBooked += booked;

    if (total < 3) {
      results.push({ tenantId: tenant.id, tenantName: tenant.name, status: 'skipped', message: `Apenas ${total} conversa(s) — mínimo 3 necessário` });
      onProgress?.(tenant.id, tenant.name, 'skipped', `Apenas ${total} conversa(s)`);
      continue;
    }

    onProgress?.(tenant.id, tenant.name, 'running');

    try {
      const settings = await db.getSettings(tenant.id);
      const cfg = await db.getGlobalConfig();
      const key = settings.openaiApiKey || cfg['shared_openai_key'] || openAiKey;
      if (!key) {
        results.push({ tenantId: tenant.id, tenantName: tenant.name, status: 'skipped', message: 'Sem chave OpenAI configurada' });
        onProgress?.(tenant.id, tenant.name, 'skipped', 'Sem chave OpenAI');
        continue;
      }

      const result = await runWeeklyOptimization(tenant.id, tenant.name, settings, key, globalContext || undefined);
      results.push({ tenantId: tenant.id, tenantName: tenant.name, status: 'ok', result });
      onProgress?.(tenant.id, tenant.name, 'ok');
      tenantsOptimized++;
    } catch (e: any) {
      results.push({ tenantId: tenant.id, tenantName: tenant.name, status: 'error', message: e.message });
      onProgress?.(tenant.id, tenant.name, 'error', e.message);
    }
  }

  // 5. Compute global score and save snapshot
  const avgConversionRate = totalConversations > 0 ? Math.round((totalBooked / totalConversations) * 100) : 0;
  const history   = loadEvolutionHistory();
  const prevScore = history[0]?.globalScore ?? 0;
  const optimizationBonus = Math.min(20, tenantsOptimized * 2);
  const rawScore  = Math.min(100, avgConversionRate + optimizationBonus);
  const globalScore = prevScore > 0 ? Math.max(prevScore - 5, rawScore) : rawScore;

  const snapshot: EvolutionSnapshot = {
    date: new Date().toISOString(),
    tenantsOptimized,
    totalTenants: tenants.length,
    avgConversionRate,
    globalScore,
    totalConversations,
    totalBooked,
  };

  saveEvolutionSnapshot(snapshot);

  return { results, snapshot };
}
