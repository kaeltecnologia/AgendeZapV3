import { TenantSettings } from '../types';
import { db } from './mockDb';

export interface OptimizationResult {
  newPrompt: string;
  summary: string;
  booked: number;
  abandoned: number;
  total: number;
}

export async function runWeeklyOptimization(
  tenantId: string,
  tenantName: string,
  settings: TenantSettings,
  openAiKey: string
): Promise<OptimizationResult> {
  // 1. Fetch last 7 days of conversation logs
  const logs = await db.getConversationLogs(tenantId, 7);
  const booked = logs.filter(l => l.outcome === 'booked').length;
  const abandoned = logs.filter(l => l.outcome === 'abandoned');
  const total = logs.length;

  if (total < 3) {
    throw new Error('Dados insuficientes para otimização (mínimo 3 conversas nos últimos 7 dias)');
  }

  const currentPrompt = settings.systemPrompt || '';
  const conversionRate = total > 0 ? Math.round((booked / total) * 100) : 0;

  // 2. Build abandoned conversation samples (max 5)
  const abandonedSamples = abandoned.slice(0, 5).map((l, i) => {
    const chat = (l.history || [])
      .map(h => `${h.role === 'user' ? 'Cliente' : 'IA'}: ${h.text}`)
      .join('\n');
    return `--- Conversa abandonada ${i + 1} (${l.turns} turnos) ---\n${chat}`;
  }).join('\n\n');

  // 3. Compose GPT-4o Mini analysis prompt
  const analysisPrompt = `Você é um especialista em bots de agendamento via WhatsApp. Sua tarefa é analisar conversas abandonadas e melhorar o prompt do agente de IA para aumentar a taxa de conversão.

PROMPT ATUAL DO AGENTE:
${currentPrompt || '(sem prompt personalizado — usando padrão do sistema)'}

RESULTADO DA ÚLTIMA SEMANA:
- Total de conversas: ${total}
- Agendamentos realizados: ${booked}
- Conversas abandonadas: ${abandoned.length}
- Taxa de conversão: ${conversionRate}%

AMOSTRAS DE CONVERSAS ABANDONADAS (para análise):
${abandonedSamples || 'Nenhuma conversa abandonada esta semana.'}

INSTRUÇÕES:
1. Identifique padrões de abandono (resistência, confusão, falta de informação)
2. Proponha melhorias específicas no tom, clareza e proatividade do agente
3. Se não houver problemas evidentes ou dados insuficientes, mantenha o prompt atual
4. O novo prompt deve ser em português, focado em agendamento, máximo 400 palavras

Responda APENAS com este JSON (sem markdown, sem explicações fora do JSON):
{
  "newPrompt": "<novo prompt do agente, em português>",
  "summary": "<resumo das mudanças em 2-3 frases, em português>"
}`;

  // 4. Call OpenAI gpt-4o-mini
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: analysisPrompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '{}';
  let parsed: { newPrompt?: string; summary?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Resposta inválida da IA — não foi possível parsear JSON');
  }

  const newPrompt = parsed.newPrompt || currentPrompt;
  const summary = parsed.summary || 'Otimização concluída sem alterações significativas.';
  const now = new Date().toISOString();

  // 5. Update settings with new prompt and optimization metadata
  await db.updateSettings(tenantId, {
    systemPrompt: newPrompt,
    lastOptimizedAt: now,
    lastOptimizationSummary: summary,
  });

  // 6. Send report via Support chat
  const dateStr = new Date(now).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const report =
    `📊 *Relatório Semanal de IA — ${tenantName}*\n\n` +
    `📅 ${dateStr}\n\n` +
    `✅ Agendamentos: ${booked}\n` +
    `❌ Abandonos: ${abandoned.length}\n` +
    `📈 Taxa de conversão: ${conversionRate}%\n\n` +
    `🔧 *Otimização aplicada:*\n${summary}`;

  await db.sendSupportReply(tenantId, report);

  return { newPrompt, summary, booked, abandoned: abandoned.length, total };
}
