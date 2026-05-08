/**
 * subscriptionService.ts
 * Sistema de assinatura de clientes (mensalidades cobradas pelo tenant aos seus clientes).
 *
 * Fluxo de status:
 *   active  → aviso (N dias antes) → pending (vencido) → overdue (carência esgotada) → BLOQUEADO
 *   overdue → admin confirma pagamento → active
 */

import { db } from './mockDb';
import { evolutionService } from './evolutionService';
import { Customer, TenantSettings, SubscriptionConfig, SubscriptionStatus } from '../types';

const EVOLUTION_API_URL = (import.meta as any).env?.VITE_EVOLUTION_API_URL || '';
const EVOLUTION_API_KEY = (import.meta as any).env?.VITE_EVOLUTION_API_KEY || '';

// ─── Dedup memory (evita re-envio na mesma sessão) ────────────────────────────
const _sentMemory = new Set<string>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setMonth(d.getMonth() + months);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function diffDays(a: string, b: string): number {
  const msA = new Date(a + 'T12:00:00').getTime();
  const msB = new Date(b + 'T12:00:00').getTime();
  return Math.round((msB - msA) / 86400000);
}

/** Calcula a data do próximo vencimento baseada no dia do mês */
function calcNextDue(dueDay: number): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), dueDay);
  if (thisMonth > now) {
    return `${thisMonth.getFullYear()}-${pad(thisMonth.getMonth() + 1)}-${pad(thisMonth.getDate())}`;
  }
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, dueDay);
  return `${nextMonth.getFullYear()}-${pad(nextMonth.getMonth() + 1)}-${pad(nextMonth.getDate())}`;
}

export function interpolateSubMsg(
  template: string,
  vars: {
    nome?: string;
    plano?: string;
    valor?: string;
    vencimento?: string;
    diasRestantes?: string | number;
    diasAtraso?: string | number;
  }
): string {
  return template
    .replace(/\{nome\}/gi, vars.nome || '')
    .replace(/\{plano\}/gi, vars.plano || '')
    .replace(/\{valor\}/gi, vars.valor || '')
    .replace(/\{vencimento\}/gi, vars.vencimento || '')
    .replace(/\{diasRestantes\}/gi, String(vars.diasRestantes ?? ''))
    .replace(/\{diasAtraso\}/gi, String(vars.diasAtraso ?? ''));
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtBRL(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

// ─── Ciclo automático ─────────────────────────────────────────────────────────

/**
 * Percorre todos os clientes com assinatura e:
 * 1. Atualiza status (active → pending → overdue)
 * 2. Envia mensagens de aviso/cobrança via WhatsApp
 * Chame uma vez por dia no ciclo de follow-ups.
 */
export async function runSubscriptionCycle(
  tenantId: string,
  settings: TenantSettings,
  customers: Customer[],
  evolutionInstance: string
): Promise<void> {
  const cfg = settings.subscriptionConfig;
  if (!cfg?.enabled || !cfg.plans.length) return;

  const now = today();

  for (const cust of customers) {
    if (!cust.subscriptionPlanId) continue;
    if (cust.subscriptionStatus === 'cancelled') continue;

    const plan = cfg.plans.find(p => p.id === cust.subscriptionPlanId);
    if (!plan) continue;

    // Calcular nextDue se ainda não definido
    let nextDue = cust.subscriptionNextDue;
    if (!nextDue && cust.subscriptionDueDay) {
      nextDue = calcNextDue(cust.subscriptionDueDay);
      // Salvar nextDue calculado
      await db.updateCustomer(tenantId, cust.id, { subscriptionNextDue: nextDue } as any);
    }
    if (!nextDue) continue;

    const daysUntilDue = diffDays(now, nextDue); // positivo = falta N dias, negativo = venceu há N dias
    const daysOverdue = -daysUntilDue; // positivo quando vencido

    const vars = {
      nome: cust.name,
      plano: plan.name,
      valor: `R$ ${fmtBRL(plan.value)}`,
      vencimento: fmtDate(nextDue),
      diasRestantes: Math.max(0, daysUntilDue),
      diasAtraso: Math.max(0, daysOverdue),
    };

    // ── 1. Atualizar status ─────────────────────────────────────────────────
    let newStatus: SubscriptionStatus | null = cust.subscriptionStatus ?? null;

    if (daysOverdue <= 0) {
      // Ainda não venceu → garantir que está active
      if (!newStatus || newStatus === 'pending' || newStatus === 'overdue') {
        newStatus = 'active';
      }
    } else if (daysOverdue > 0 && daysOverdue <= cfg.gracePeriodDays) {
      // Dentro da carência → pending
      if (newStatus !== 'overdue') newStatus = 'pending';
    } else if (daysOverdue > cfg.gracePeriodDays) {
      // Carência esgotada → overdue (bloqueado)
      newStatus = 'overdue';
    }

    if (newStatus !== cust.subscriptionStatus) {
      await db.updateCustomer(tenantId, cust.id, { subscriptionStatus: newStatus } as any);
    }

    // ── 2. Enviar mensagens ─────────────────────────────────────────────────
    if (!cust.phone || !evolutionInstance) continue;

    // Aviso prévio: daysBeforeWarning dias antes do vencimento (1x por mês)
    if (daysUntilDue === cfg.daysBeforeWarning && newStatus === 'active') {
      const claimKey = `sub_warn_${cust.id}_${nextDue}`;
      if (!_sentMemory.has(claimKey)) {
        const claimed = await db.claimMessage(claimKey);
        if (claimed) {
          _sentMemory.add(claimKey);
          const msg = interpolateSubMsg(cfg.warningMessage, vars);
          await evolutionService.sendMessage(evolutionInstance, cust.phone, msg);
        }
      }
    }

    // Cobrança diária enquanto pendente
    if ((newStatus === 'pending' || newStatus === 'overdue') && daysOverdue > 0) {
      const claimKey = `sub_charge_${cust.id}_${now}`;
      if (!_sentMemory.has(claimKey)) {
        const claimed = await db.claimMessage(claimKey);
        if (claimed) {
          _sentMemory.add(claimKey);
          const msg = interpolateSubMsg(cfg.overdueMessage, vars);
          await evolutionService.sendMessage(evolutionInstance, cust.phone, msg);
        }
      }
    }
  }
}

// ─── Confirmação de pagamento pelo admin ──────────────────────────────────────

/**
 * Confirma pagamento de um cliente e avança subscriptionNextDue em 1 mês.
 * Envia mensagem de confirmação ao cliente.
 */
export async function confirmSubscriptionPayment(
  tenantId: string,
  customerId: string,
  evolutionInstance: string,
  settings: TenantSettings
): Promise<void> {
  const now = today();
  const cust = (await db.getCustomers(tenantId)).find(c => c.id === customerId);
  if (!cust) return;

  const nextDue = cust.subscriptionNextDue
    ? addMonths(cust.subscriptionNextDue, 1)
    : cust.subscriptionDueDay ? calcNextDue(cust.subscriptionDueDay) : '';

  const plan = settings.subscriptionConfig?.plans.find(p => p.id === cust.subscriptionPlanId);

  await db.updateCustomer(tenantId, customerId, {
    subscriptionStatus: 'active',
    subscriptionNextDue: nextDue,
    subscriptionLastPaid: now,
    subscriptionPendingProof: undefined,
    subscriptionProofAnalysis: undefined,
  } as any);

  // Enviar confirmação ao cliente
  const cfg = settings.subscriptionConfig;
  if (cfg?.paymentConfirmedMessage && cust.phone && evolutionInstance) {
    const msg = interpolateSubMsg(cfg.paymentConfirmedMessage, {
      nome: cust.name,
      plano: plan?.name || '',
      valor: plan ? `R$ ${fmtBRL(plan.value)}` : '',
      vencimento: nextDue ? fmtDate(nextDue) : '',
    });
    await evolutionService.sendMessage(evolutionInstance, cust.phone, msg);
  }
}

// ─── Análise de comprovante (Gemini Vision) ───────────────────────────────────

export interface ProofAnalysisResult {
  isPaymentProof: boolean;
  amount: number | null;
  date: string | null;        // YYYY-MM-DD
  recipient: string | null;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
}

/**
 * Analisa uma imagem para verificar se é um comprovante de pagamento válido.
 * Usa Gemini Vision (inline_data).
 */
export async function analyzePaymentProof(
  imageBase64: string,
  imageMimeType: string,
  geminiApiKey: string,
  expectedAmount?: number
): Promise<ProofAnalysisResult> {
  const fallback: ProofAnalysisResult = {
    isPaymentProof: false, amount: null, date: null,
    recipient: null, confidence: 'low',
    notes: 'Não foi possível analisar a imagem.',
  };

  if (!geminiApiKey || !imageBase64) return fallback;

  const amountHint = expectedAmount
    ? ` O valor esperado é R$ ${fmtBRL(expectedAmount)}.`
    : '';

  const prompt = `Analise esta imagem e determine se é um comprovante de pagamento (PIX, transferência bancária, boleto ou recibo).${amountHint}

Responda APENAS com JSON válido no formato:
{
  "isPaymentProof": true ou false,
  "amount": número ou null,
  "date": "YYYY-MM-DD" ou null,
  "recipient": "nome do destinatário" ou null,
  "confidence": "high" ou "medium" ou "low",
  "notes": "breve observação em português"
}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: imageMimeType, data: imageBase64 } },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });

    if (!res.ok) return fallback;
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed: ProofAnalysisResult = JSON.parse(raw);
    return parsed;
  } catch {
    return fallback;
  }
}

/**
 * Faz download da imagem via Evolution API (mesmo endpoint do áudio).
 */
export async function fetchImageBase64(
  instanceName: string,
  msg: any
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${instanceName}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
        body: JSON.stringify({ message: msg, convertToMp4: false }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const base64: string = data.base64 || data.data || '';
    const mimeType: string = (data.mimetype || data.mimeType || 'image/jpeg').split(';')[0].trim();
    if (!base64) return null;
    return { base64, mimeType };
  } catch {
    return null;
  }
}

// ─── Verificação de bloqueio ──────────────────────────────────────────────────

/**
 * Retorna true se o cliente está bloqueado para novos agendamentos.
 */
export function isSubscriptionBlocked(customer: Customer): boolean {
  return customer.subscriptionStatus === 'overdue';
}

/**
 * Retorna mensagem de bloqueio do agente/bot configurada pelo tenant.
 */
export function getBlockedMessage(customer: Customer, cfg?: SubscriptionConfig | null): string {
  if (!cfg?.blockedMessage) {
    return `Olá ${customer.name}! Seu plano está com pagamento em atraso. Por favor, regularize para voltar a agendar. 💳`;
  }
  return interpolateSubMsg(cfg.blockedMessage, { nome: customer.name });
}
