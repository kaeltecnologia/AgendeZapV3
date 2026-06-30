export interface SiteContent {
  brandName: string;
  primaryColor: string;
  navCta: string;
  heroTitle: string;
  heroSubtitle: string;
  heroCta: string;
  heroTrustBadges: string[];
  featuresTitle: string;
  featuresSubtitle: string;
  features: { icon: string; title: string; desc: string }[];
  stats: { value: string; label: string }[];
  pricingTitle: string;
  pricingBasePrice: string;
  pricingSubtitle: string;
  plans: { name: string; price: string; features: string[]; highlight: boolean }[];
  formTitle: string;
  formSubtitle: string;
  formTrustBadges: string[];
  footerText: string;
}

export const SITE_DEFAULTS: SiteContent = {
  brandName: 'AgendeZap',
  primaryColor: '#f97316',
  navCta: 'Criar Conta',
  heroTitle: 'Sistema de agendamento pelo WhatsApp para seu negócio',
  heroSubtitle: 'AgendeZap: sistema completo para barbearias, salões de beleza, manicures, cabeleireiros e esteticistas. Agenda inteligente com IA, relatórios financeiros em tempo real e controle total do seu negócio.',
  heroCta: 'Começar Agora',
  heroTrustBadges: ['Sem complicação', 'Sem contrato', 'Garantia de 7 dias'],
  featuresTitle: 'Tudo que seu negócio precisa',
  featuresSubtitle: 'O sistema completo para transformar seu negócio com inteligência artificial',
  features: [
    { icon: '🤖', title: 'Agendamento com IA', desc: 'Seus clientes agendam pelo WhatsApp com IA. 24h por dia, sem precisar atender.' },
    { icon: '📊', title: 'Dashboard Inteligente', desc: 'Visão geral do seu negócio em tempo real: faturamento, agendamentos e crescimento.' },
    { icon: '💰', title: 'Gestão Financeira', desc: 'Controle de caixa, comandas, folha de pagamento e notas fiscais integradas.' },
    { icon: '📱', title: 'Agenda Operacional', desc: 'Visualize todos os agendamentos do dia, filtre por profissional e acompanhe cada atendimento.' },
  ],
  stats: [
    { value: '500+', label: 'Estabelecimentos' },
    { value: '50.000+', label: 'Agendamentos' },
    { value: '4.9 ★', label: 'Avaliação Média' },
  ],
  pricingTitle: 'Planos a partir de',
  pricingBasePrice: '89,90',
  pricingSubtitle: 'Comece com o plano Profissional e evolua conforme cresce',
  plans: [
    { name: 'Profissional', price: '89,90', features: ['🤖 Agente IA WhatsApp', 'Até 5 profissionais', 'Relatórios e follow-up'], highlight: true },
    { name: 'Elite', price: '149,90', features: ['Ilimitado', 'Assistente Admin', 'Todas as features'], highlight: false },
  ],
  formTitle: 'Crie sua conta agora',
  formSubtitle: 'Garantia de reembolso total em até 7 dias',
  formTrustBadges: ['Pagamento seguro', 'Sem contrato', 'Reembolso em até 7 dias'],
  footerText: 'AgendeZap © 2026 · Gestão de Agendamentos Inteligente',
};
