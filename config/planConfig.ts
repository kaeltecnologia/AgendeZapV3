/**
 * planConfig.ts
 * Definição dos planos de assinatura do AgendeZap.
 * START | PROFISSIONAL | ELITE
 */

export type PlanId = 'GRATIS' | 'START' | 'PROFISSIONAL' | 'ELITE';

export type FeatureKey =
  | 'agenteIA'            // Agente IA de agendamento via WhatsApp — START+
  | 'financeiro'          // Financeiro Essencial: despesas, lucro, margem, comissão — PROFISSIONAL+
  | 'performance'         // Performance: ranking, metas, ticket médio, faltas — PROFISSIONAL+
  | 'caixaAvancado'       // Caixa diário + taxas de cartão configuráveis — ELITE
  | 'relatorios'          // Relatórios básicos de agendamentos — PROFISSIONAL+
  | 'relatoriosAvancados' // Relatórios comparativos e de crescimento trimestral — ELITE
  | 'reativacao'          // Reativação automática de clientes — PROFISSIONAL+
  | 'disparo'             // Disparador massivo segmentado — PROFISSIONAL+
  | 'socialMidia'         // Social Mídia: calendário, roteiros, tendências — PROFISSIONAL+
  | 'assistenteAdmin';    // Assistente administrativo via WhatsApp — ELITE

export interface PlanConfig {
  id: PlanId;
  name: string;
  subtitle: string;         // slogan do plano
  price: number;
  additionalProfessionalPrice?: number;
  maxProfessionals: number; // 9999 = ilimitado
  color: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  emoji: string;
  badge: string;
  features: string[];
  notIncluded: string[];
  permissions: Record<FeatureKey, boolean>;
}

export const PLAN_CONFIGS: Record<PlanId, PlanConfig> = {

  // ─── GRÁTIS ───────────────────────────────────────────────────────
  GRATIS: {
    id: 'GRATIS',
    name: 'Grátis',
    subtitle: 'Plano Gratuito',
    price: 0,
    additionalProfessionalPrice: 19.90,
    maxProfessionals: 1,
    color: '#6b7280',
    bgClass: 'bg-gray-50',
    textClass: 'text-gray-700',
    borderClass: 'border-gray-200',
    emoji: '⚪',
    badge: '⚪ Grátis',
    features: [
      'Agenda inteligente',
      '1 profissional',
      'Confirmação automática',
      'Lembretes automáticos',
      'Faturamento bruto básico',
      'Relatório de agendamentos',
      'Link de agendamento online',
    ],
    notIncluded: [
      'Agente IA de agendamento via WhatsApp',
      'Despesas e lucro líquido',
      'Comissão automática',
      'Ranking e metas de equipe',
      'Caixa diário e taxas de cartão',
      'Disparador de mensagens',
      'Reativação automática',
      'Social Mídia (calendário e roteiros)',
      'Assistente admin via WhatsApp',
    ],
    permissions: {
      agenteIA: false,
      financeiro: false,
      performance: false,
      caixaAvancado: false,
      relatorios: false,
      relatoriosAvancados: false,
      reativacao: false,
      disparo: false,
      socialMidia: false,
      assistenteAdmin: false,
    },
  },

  // ─── START ─────────────────────────────────────────────────────────
  START: {
    id: 'START',
    name: 'Start',
    subtitle: 'Plano Operacional',
    price: 39.90,
    additionalProfessionalPrice: 19.90,
    maxProfessionals: 2,
    color: '#16a34a',
    bgClass: 'bg-green-50',
    textClass: 'text-green-700',
    borderClass: 'border-green-200',
    emoji: '🟢',
    badge: '🟢 Start',
    features: [
      'Agente IA de agendamento via WhatsApp',
      'Automação do WhatsApp com IA para até 100 clientes mensais',
      'Confirmação automática',
      '1 profissional incluído (máx. 2)',
      'Lembretes automáticos',
      'Agenda inteligente',
      'Faturamento bruto básico',
      'Relatório de agendamentos',
      'Quantidade de procedimentos',
      'Origem dos agendamentos (visão simples)',
      '+R$19,90 por profissional adicional',
    ],
    notIncluded: [
      'Despesas e lucro líquido',
      'Comissão automática',
      'Ranking e metas de equipe',
      'Caixa diário e taxas de cartão',
      'Disparador de mensagens',
      'Reativação automática',
      'Social Mídia (calendário e roteiros)',
      'Assistente admin via WhatsApp',
    ],
    permissions: {
      agenteIA: true,
      financeiro: false,
      performance: false,
      caixaAvancado: false,
      relatorios: false,
      relatoriosAvancados: false,
      reativacao: false,
      disparo: false,
      socialMidia: false,
      assistenteAdmin: false,
    },
  },

  // ─── PROFISSIONAL ───────────────────────────────────────────────────
  PROFISSIONAL: {
    id: 'PROFISSIONAL',
    name: 'Profissional',
    subtitle: 'Plano Gestão',
    price: 89.90,
    maxProfessionals: 5,
    color: '#2563eb',
    bgClass: 'bg-blue-50',
    textClass: 'text-blue-700',
    borderClass: 'border-blue-200',
    emoji: '🔵',
    badge: '🔵 Profissional',
    features: [
      'Tudo do Start',
      'Agente IA de agendamento',
      'Até 5 profissionais',
      'Performance — ranking e metas',
      'Meta mensal com barra de progresso',
      'Meta de procedimentos por profissional',
      'Ticket médio e top procedimentos',
      'Clientes perdidos (inativos 60 dias)',
      'Despesas e lucro líquido',
      'Margem mensal',
      'Comissão automática',
      'Meta individual por profissional',
      'Relatórios por profissional',
      'Reativação automática de clientes',
      'Disparador segmentado',
      'Social Mídia — calendário e roteiros com IA',
    ],
    notIncluded: [
      'Caixa diário detalhado',
      'Taxas de cartão configuráveis',
      'Projeção e relatórios comparativos',
      'Assistente admin via WhatsApp',
    ],
    permissions: {
      agenteIA: true,
      financeiro: true,
      performance: true,
      caixaAvancado: false,
      relatorios: true,
      relatoriosAvancados: false,
      reativacao: true,
      disparo: true,
      socialMidia: true,
      assistenteAdmin: false,
    },
  },

  // ─── ELITE ─────────────────────────────────────────────────────────
  ELITE: {
    id: 'ELITE',
    name: 'Elite',
    subtitle: 'Plano Controle Total',
    price: 149.90,
    maxProfessionals: 9999,
    color: '#7c3aed',
    bgClass: 'bg-purple-50',
    textClass: 'text-purple-700',
    borderClass: 'border-purple-200',
    emoji: '🟣',
    badge: '🟣 Elite',
    features: [
      'Tudo do Profissional',
      'Profissionais ilimitados',
      'Caixa diário detalhado',
      'Registro manual de entradas e saídas',
      'Controle por forma de pagamento',
      'Taxas de cartão configuráveis (débito/crédito/parcelado)',
      'Cálculo automático de valor líquido',
      'Projeção de faturamento avançada',
      'Relatórios comparativos mensais',
      'Relatórios de crescimento trimestral',
      'Social Mídia — calendário e roteiros com IA',
      'Assistente administrativo via WhatsApp',
      'Prioridade no suporte',
    ],
    notIncluded: [],
    permissions: {
      agenteIA: true,
      financeiro: true,
      performance: true,
      caixaAvancado: true,
      relatorios: true,
      relatoriosAvancados: true,
      reativacao: true,
      disparo: true,
      socialMidia: true,
      assistenteAdmin: true,
    },
  },
};

/** Resolve plan config — unknown/legacy values fallback to START. */
export function getPlanConfig(planId?: string | null): PlanConfig {
  if (planId === 'GRATIS') return PLAN_CONFIGS.GRATIS;
  if (planId === 'PROFISSIONAL') return PLAN_CONFIGS.PROFISSIONAL;
  if (planId === 'ELITE') return PLAN_CONFIGS.ELITE;
  // Legacy aliases
  if (planId === 'PRO') return PLAN_CONFIGS.PROFISSIONAL;
  if (planId === 'ENTERPRISE') return PLAN_CONFIGS.ELITE;
  return PLAN_CONFIGS.START;
}

/** Check if a given plan has access to a feature. */
export function hasFeature(planId: string | null | undefined, feature: FeatureKey): boolean {
  return getPlanConfig(planId).permissions[feature];
}

/**
 * Returns the cheapest plan that includes the given feature.
 * Used in upgrade prompts.
 */
export function cheapestUpgradePlan(feature: FeatureKey): PlanConfig {
  const order: PlanId[] = ['GRATIS', 'START', 'PROFISSIONAL', 'ELITE'];
  for (const id of order) {
    if (PLAN_CONFIGS[id].permissions[feature]) return PLAN_CONFIGS[id];
  }
  return PLAN_CONFIGS.ELITE;
}
