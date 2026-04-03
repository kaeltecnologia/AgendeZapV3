
export enum AppointmentStatus {
  PENDING   = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  ARRIVED   = 'ARRIVED',    // Cliente chegou — abre comanda automaticamente
  FINISHED  = 'FINISHED',
  NO_SHOW   = 'NO_SHOW',    // Faltou
  CANCELLED = 'CANCELLED',
}

export enum BookingSource {
  AI = 'AI',
  MANUAL = 'MANUAL',
  WEB = 'WEB',
  PLAN = 'PLAN'   // Appointment under an active plan — not charged financially
}

export enum PaymentMethod {
  MONEY = 'DINHEIRO',
  PIX = 'PIX',
  DEBIT = 'DÉBITO',
  CREDIT = 'CRÉDITO'
}

export enum TenantStatus {
  ACTIVE = 'ATIVA',
  PAUSED = 'PAUSADA',
  CANCELLED = 'CANCELADA',
  BLOCKED = 'BLOQUEADA',
  PENDING_PAYMENT = 'PAGAMENTO PENDENTE'
}

export interface WorkingDay {
  active: boolean;
  range: string; // "09:00-18:00"
  acceptLastSlot?: boolean; // permite agendar no horário exato de fechamento
}

export interface FollowUpConfig {
  active: boolean;
  message: string;
  timing: number; // minutes or days
  fixedTime?: string; // For "Aviso do Dia" (HH:mm)
}

/** @deprecated use RecurringEntry[] instead */
export interface RecurringSlot {
  dayOfWeek: number;
  time: string;
}

/** @deprecated use RecurringEntry[] instead */
export interface RecurringSchedule {
  enabled: boolean;
  professionalId: string;
  serviceId?: string;
  slots: RecurringSlot[];
}

// ── New recurring system ─────────────────────────────────────────────
// weekly = toda semana | biweekly = a cada 2 semanas
// triweekly = a cada 3 semanas | alternating = uma semana sim, outra não
export type RecurringFrequency = 'weekly' | 'biweekly' | 'triweekly' | 'alternating';

export interface RecurringEntry {
  id: string;
  professionalId: string;
  serviceId: string;
  dayOfWeek: number;          // 0=Dom … 6=Sáb
  time: string;               // "HH:MM"
  repeat: boolean;            // false = agendamento único; true = recorrente
  frequency?: RecurringFrequency; // só quando repeat=true
  weekOffset?: number;        // 0=Semana A | 1=Semana B | 2=Semana C (intercalação)
  price?: number;             // valor cobrado por sessão
  active: boolean;
}

// Break / interval period — blocks agent from booking during this window
export interface BreakPeriod {
  id: string;
  label: string;
  type?: 'break' | 'lunch' | 'vacation' | 'holiday'; // default 'break'
  professionalId?: string | null; // null or absent = applies to all professionals
  date?: string | null;           // YYYY-MM-DD, one-time; null = recurring
  vacationEndDate?: string | null; // for type='vacation': last day of vacation
  dayOfWeek?: number | null;      // 0-6 for weekly-recurring; null = every day
  startTime: string;              // HH:mm
  endTime: string;                // HH:mm
}

// Retail product for sale to clients (separate from InventoryItem/insumos)
export interface Product {
  id: string;
  name: string;
  category?: string;
  costPrice: number;   // custo de compra
  salePrice: number;   // preço de venda ao cliente
  quantity?: number;   // estoque opcional
  unit?: string;
  active: boolean;
  lastUpdated: string;
}

// Stock / inventory item
export interface InventoryItem {
  id: string;
  name: string;
  category?: string;
  quantity: number;
  unit: string;          // "unidades", "ml", "g", "kg", "L"
  purchaseCost: number;  // cost per unit at last purchase
  salePrice?: number;    // sale price to client (used in comandas)
  minStock?: number;     // low-stock alert threshold
  lastUpdated: string;   // ISO datetime
}

// Quota por serviço dentro de um plano
export interface PlanQuota {
  serviceId: string;
  quantity: number;    // total incluído no plano
}

// Status de pagamento do plano no cliente
export type PlanStatus = 'ativo' | 'pendente' | 'cancelado';

// Monthly / recurring service plan (package)
export interface Plan {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  price: number;             // monthly fee
  proceduresPerMonth: number;// LEGACY — kept for backward compat, use quotas instead
  serviceId?: string;        // LEGACY — kept for backward compat, use quotas instead
  quotas: PlanQuota[];       // per-service quotas (e.g. [{serviceId: "barba", quantity: 2}])
  features: string[];        // list of included services / notes
  active: boolean;
}

// Helpers for multi-service appointment encoding (DB stores service_id as string)
export function parseServiceIds(val: string | null | undefined): string[] {
  if (!val) return [];
  const trimmed = val.trim();
  if (trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { return [trimmed]; }
  }
  return [trimmed];
}

export function encodeServiceIds(ids: string[]): string {
  if (ids.length <= 1) return ids[0] || '';
  return JSON.stringify(ids);
}

// Custom follow-up mode (created by admin, assigned per customer)
export interface FollowUpMode {
  id: string;
  name: string;
  description: string;
}

// Named follow-up strategy template per type (aviso / lembrete / reativacao)
export interface FollowUpNamedMode {
  id: string;
  name: string;
  active: boolean;
  message: string;
  timing: number;        // minutes (lembrete), days (reativacao), irrelevant for aviso
  fixedTime?: string;   // HH:mm — used by aviso type
  daysBefore?: number;  // aviso: 0 = no dia, 1 = 1 dia antes, etc.
}

// ── NFS-e / Nota Fiscal de Serviço ──────────────────────────────────────────

export interface FocusNfeConfig {
  token: string;                  // API token FocusNFe (deixar vazio — pendente configuração)
  cnpj: string;                   // CNPJ do prestador  ex: "12345678000199"
  inscricaoMunicipal: string;     // Inscrição Municipal
  codigoServico: string;          // Código do serviço (ex: "7.02")
  aliquotaIss: number;            // Alíquota ISS em % (ex: 5)
  municipio: number;              // Código IBGE do município (ex: 4115200 = Maringá/PR)
  ambiente: 'homologacao' | 'producao';
}

export interface NotaFiscal {
  id: string;
  comandaIds: string[];           // IDs das comandas incluídas nesta nota
  emitedAt?: string;              // ISO datetime da emissão
  status: 'nao_emitida' | 'pendente' | 'emitida' | 'erro';
  valorBruto: number;             // total das comandas (bruto)
  valorDeclaravel: number;        // cota-parte do estabelecimento (base ISS)
  focusNfeRef?: string;           // referência retornada pelo FocusNFe
  nfseNumero?: string;            // número da NFS-e emitida
  nfseLink?: string;              // link do PDF/XML
  errorMsg?: string;              // mensagem de erro (se status='erro')
  tomadorNome?: string;
  tomadorCpfCnpj?: string;
  createdAt: string;
}

export interface Adiantamento {
  id: string;
  professionalId: string;
  amount: number;
  date: string;                   // YYYY-MM-DD
  description?: string;
  createdAt: string;
}

export interface PagamentoPro {
  id: string;
  professionalId: string;
  periodoInicio: string;          // YYYY-MM-DD
  periodoFim: string;             // YYYY-MM-DD
  comissaoTotal: number;
  adiantamentosTotal: number;
  liquido: number;                // comissaoTotal - adiantamentosTotal
  status: 'pendente' | 'pago';
  paidAt?: string;
  paidMethod?: string;
  notes?: string;
  createdAt: string;
}

export interface TenantSettings {
  followUp: {
    aviso: FollowUpConfig;
    lembrete: FollowUpConfig;
    reativacao: FollowUpConfig;
  };
  operatingHours: {
    [key: number]: WorkingDay; // 0-6 (Sunday-Saturday)
  };
  aiActive: boolean;
  themeColor: string;
  whatsapp?: string;                   // official WhatsApp number
  breaks?: BreakPeriod[];              // break / interval blocks
  customModes?: FollowUpMode[];        // legacy custom follow-up modes
  avisoModes?: FollowUpNamedMode[];    // named check-in strategies
  lembreteModes?: FollowUpNamedMode[]; // named reminder strategies
  reativacaoModes?: FollowUpNamedMode[];// named reactivation strategies
  plans?: Plan[];                       // monthly plans (stored in JSONB)
  planUsage?: Record<string, number>;   // { "customerId::YYYY-MM": count }
  professionalMeta?: Record<string, {   // per-professional role (stored in JSONB)
    role: 'admin' | 'colab';
    commissionRate?: number;             // commission percentage, e.g. 40 = 40%
    monthlyGoal?: number;               // monthly revenue goal in R$
  }>;
  customerData?: Record<string, {       // per-customer plan/mode data (stored in JSONB)
    planId?: string | null;
    planStatus?: PlanStatus;             // 'ativo' | 'pendente' | 'cancelado'
    planServiceId?: string | null;
    avisoModeId?: string;
    lembreteModeId?: string;
    reativacaoModeId?: string;
    recurringSchedule?: RecurringSchedule;  // @deprecated
    recurringEntries?: RecurringEntry[];    // new multi-entry recurring system
    aiPaused?: boolean;                  // true = IA desativada manualmente para este lead
    waitlistAlert?: boolean;             // true = lead pediu lista de espera (alerta para operador)
  }>;
  followUpSent?: Record<string, string>; // tracks sent messages e.g. "aviso::apptId" → "YYYY-MM-DD"
  profAgendaSent?: Record<string, string>; // tracks daily agenda sent: "profId::YYYY-MM-DD" → "sent"
  agendaDiariaHora?: string;             // HH:MM to send daily professional agenda (default "00:01")
  inventory?: InventoryItem[];           // product stock list (insumos)
  products?: Product[];                  // retail products for sale to clients
  monthlyRevenueGoal?: number;          // meta mensal de faturamento da barbearia em R$
  cardFees?: {                          // taxas de cartão em percentual (ex: 1.5 = 1,5%)
    debit: number;
    credit: number;
    installment: number;
  };
  aiLeadActive?: boolean;               // IA para Leads toggle
  aiProfessionalActive?: boolean;       // Assessor do Profissional toggle
  systemPrompt?: string;                // AI agent system prompt
  agentName?: string;                   // AI agent personality name
  openaiApiKey?: string;                // OpenAI API key (uses gpt-4.1-mini when set)
  msgBufferSecs?: number;               // message buffer window in seconds (default 20)
  trialStartDate?: string | null;       // ISO datetime — set at first registration; null = paid account
  trialWarningSent?: boolean;           // true once Day 6 WhatsApp warning was sent
  focusNfeConfig?: FocusNfeConfig;      // NFS-e emission configuration
  adiantamentos?: Adiantamento[];       // professional advance payments
  pagamentosPro?: PagamentoPro[];       // professional payroll records
  notasFiscais?: NotaFiscal[];          // NFS-e history
  lastOptimizedAt?: string;             // ISO datetime of last IA optimization
  lastOptimizationSummary?: string;     // summary of last IA optimization
  ratingEnabled?: boolean;              // toggle for post-service rating requests
  ratingSent?: Record<string, string>;  // tracks sent rating requests: "rating::apptId" → "YYYY-MM-DD"
  ratingMessage?: string;               // custom rating message template
  googlePlaceId?: string;               // Google Place ID for review redirect
  instagramAccessToken?: string;        // long-lived IG access token (60 days)
  instagramUserId?: string;             // IG business/creator account ID
  instagramUsername?: string;           // IG handle (e.g. @barbearia)
  googleBusinessAccessToken?: string;  // Google Business Profile OAuth access token
  googleBusinessRefreshToken?: string; // Google Business Profile refresh token
  googleAccountId?: string;            // Google Business account ID (e.g. accounts/123)
  googleLocationId?: string;           // Google Business location ID (e.g. locations/456)
  googleBusinessName?: string;         // Google Business display name
  logoUrl?: string;                     // marketplace logo URL
  galleryPhotos?: string[];             // marketplace gallery photo URLs (up to 3)
  asaasCustomerId?: string;            // Asaas customer ID for billing
  asaasSubscriptionId?: string;        // Asaas subscription ID for recurring billing
  asaasPlanId?: string;                // Current Asaas plan (START, PROFISSIONAL, ELITE)
  asaasLastPaymentDate?: string;       // ISO date of last confirmed payment (for pro-rata upgrade discount)
  socialMediaProfile?: SocialMediaProfile | null;  // social media onboarding data
  contentCalendar?: ContentCalendar | null;        // AI-generated content calendar
  trendingContent?: TrendingItem[] | null;         // cached weekly trending content
  trendingContentDate?: string | null;             // ISO date of last trending fetch
}

export interface Appointment {
  id: string;
  tenant_id: string;
  customer_id: string;
  professional_id: string;
  service_id: string;          // DB column — may contain JSON array for multi-service
  serviceIds?: string[];       // computed: parsed from service_id (always array)
  startTime: string;
  durationMinutes: number;
  status: AppointmentStatus;
  source: BookingSource;
  paymentMethod?: PaymentMethod;
  amountPaid?: number;
  extraNote?: string;
  extraValue?: number;
  isPlan?: boolean; // if true, appointment is covered by a plan → excluded from financial totals
}

export interface Expense {
  id: string;
  tenant_id: string;
  description: string;
  amount: number;
  category: 'COMPANY' | 'PROFESSIONAL';
  professional_id?: string;
  date: string;
  paymentMethod?: PaymentMethod;
}

export enum SessionStatus {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING'
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  email?: string;
  password?: string;
  phone?: string;           // owner phone for billing/announcement reminders
  due_day?: number;         // payment due day of month (1-31)
  evolution_instance?: string;
  nicho?: string;           // business niche e.g. 'Barbearia', 'Salão de Beleza'
  plan: string; // 'START' | 'PROFISSIONAL' | 'ELITE' (legacy: 'BASIC' | 'PRO' | 'ENTERPRISE')
  status: TenantStatus;
  monthlyFee: number;
  createdAt: string;
  // ── Central / Marketplace fields ──
  endereco?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  latitude?: number;
  longitude?: number;
  descricao?: string;
  marketplaceVisible?: boolean;
}

export interface Professional {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  specialty: string;
  active: boolean;
  role?: 'admin' | 'colab'; // 'admin' = proprietário (acesso total), 'colab' = funcionário (próprios dados)
}

export interface Service {
  id: string;
  tenant_id: string;
  name: string;
  price: number;
  durationMinutes: number;
  active: boolean;
}

export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  birthDate?: string;
  active: boolean;
  followUpPreferences: {
    aviso: boolean;
    lembrete: boolean;
    reativacao: boolean;
  };
  avisoModeId?: string;       // named aviso mode id (or 'standard')
  lembreteModeId?: string;    // named lembrete mode id (or 'standard')
  reativacaoModeId?: string;  // named reativacao mode id (or 'standard')
  planId?: string | null;     // active plan id
  planStatus?: PlanStatus;    // 'ativo' | 'pendente' | 'cancelado'
  planServiceId?: string | null; // LEGACY — specific service covered by plan
  recurringSchedule?: RecurringSchedule;  // @deprecated
  recurringEntries?: RecurringEntry[];    // new multi-entry recurring system
}

// ── Comanda (ordem de serviço) ─────────────────────────────────────────────

export interface ComandaItem {
  id: string;
  type: 'service' | 'product';
  itemId: string;       // service_id or product id
  name: string;
  qty: number;
  unitPrice: number;
  discountType: 'value' | 'percent'; // tipo de desconto: R$ ou %
  discount: number;     // valor digitado (R$ flat ou % dependendo de discountType)
  professionalId?: string; // profissional responsável por este item
}

export interface Comanda {
  id: string;
  tenant_id: string;
  appointment_id: string;
  professional_id: string;
  customer_id: string;
  items: ComandaItem[];
  status: 'open' | 'closed';
  paymentMethod?: PaymentMethod;
  notes?: string;
  createdAt: string;
  closedAt?: string;
  number?: number;  // sequential comanda number per tenant (#001, #002…)
}

export interface SupportMessage {
  id: string;
  tenantId: string;
  sender: 'tenant' | 'support';
  content?: string;
  imageUrl?: string;
  read: boolean;
  createdAt: string;
}

export interface ConversationLog {
  id: string;
  tenantId: string;
  phone: string;
  outcome: 'booked' | 'abandoned' | 'info' | 'duplicate';
  turns: number;
  history: Array<{ role: 'user' | 'bot'; text: string }>;
  startedAt?: string;
  createdAt: string;
}

// ── Central / Marketplace ───────────────────────────────────────────

export interface Review {
  id: string;
  tenantId: string;
  customerPhone: string;
  customerName?: string;
  appointmentId?: string;
  rating: number;       // 0-10
  comment?: string;
  createdAt: string;
}

export interface MarketplaceLead {
  id: string;
  phone: string;
  name?: string;
  city?: string;
  nichoInterest?: string;
  latitude?: number;
  longitude?: number;
  source: 'marketplace' | 'central_whatsapp' | 'ads';
  createdAt: string;
}

export interface CentralBooking {
  id: string;
  leadPhone: string;
  tenantId: string;
  appointmentId: string;
  cashbackEarned: number;
  createdAt: string;
}

export interface CashbackBalance {
  phone: string;
  balance: number;
  totalEarned: number;
  totalUsed: number;
  bookingsCount: number;
  updatedAt: string;
}

export interface CustomerAccount {
  id: string;
  phone: string;
  name: string;
  city?: string;
  createdAt: string;
}

export interface CustomerFavorite {
  id: string;
  customerPhone: string;
  tenantId: string;
  createdAt: string;
}

// ── Marketplace Posts (Social Feed) ──────────────────────────────────

export interface MarketplacePost {
  id: string;
  tenantId: string;
  imageUrl: string;
  caption?: string;
  cidade?: string;
  nicho?: string;
  likesCount: number;
  createdAt: string;
  tenantName?: string;
  tenantSlug?: string;
}

export interface MarketplacePostComment {
  id: string;
  postId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface MarketplaceStory {
  id: string;
  tenantId: string;
  imageUrl: string;
  caption?: string;
  createdAt: string;
  expiresAt: string;
}

// ── Social Media Content Planning ──────────────────────────────────

export interface SocialMediaProfile {
  nicho: string;
  estiloImagem: string[];       // ex: ['premium', 'moderno']
  publicoAlvo: string[];        // ex: ['homens', 'jovens']
  tiposConteudo: string[];      // ex: ['antes_depois', 'bastidores']
  tomComunicacao: string[];     // ex: ['descontraido', 'profissional']
  objetivos: string[];          // ex: ['atrair_clientes', 'autoridade']
  diferenciais: string[];       // ex: ['atendimento', 'ambiente']
  postsPerWeek: number;
  diasSemana: string[];         // ex: ['seg', 'ter', 'qua', 'qui', 'sex']
  plataformas: string[];
  gerarImagem?: boolean;        // se quer geração de imagem por IA (foco é vídeo/roteiros)
  createdAt: string;
}

export interface StoryEngagement {
  horario: string;              // ex: "10:00"
  tipo: string;                 // ex: "foto", "video_trecho", "enquete", "caixinha"
  descricao: string;            // o que postar no story
}

export interface ScriptScene {
  startSec: number;             // ex: 0
  endSec: number;               // ex: 5
  label: string;                // ex: "Abertura", "Revelação", "CTA"
  action: string;               // o que acontece visualmente
  spokenLine?: string;          // fala exata (se houver)
  music?: string;               // sugestão de música/áudio nesse trecho
  gesture?: string;             // gesto/expressão do profissional
  cameraAngle?: string;         // ângulo de câmera (close, wide, POV)
  onScreenText?: string;        // texto/legenda na tela nesse trecho
}

export interface ContentDay {
  date: string;
  postTime: string;             // horário de postagem (ex: "18:00")
  title: string;
  mediaType: string;            // "video" | "foto" | "carrossel"
  placement: string;            // "feed" | "story" | "reels"
  objective: string;            // resumo do objetivo
  intro: string;                // texto introdutório da estratégia do dia
  scriptTimeline: ScriptScene[]; // roteiro segundo a segundo dividido em cenas
  musicSuggestion: string;      // música principal sugerida para o conteúdo
  totalDuration: string;        // duração total (ex: "30-45s")
  editing: string;              // EDIÇÃO — cortes, transições, legenda
  cta: string;                  // call-to-action resumido
  hashtags: string[];
  captionSuggestion: string;    // sugestão de legenda para a postagem
  storyEngagement: StoryEngagement[]; // sugestões de stories para engajamento
  completed: boolean;
}

export interface MonthStrategy {
  month: number;
  year: number;
  theme: string;
  description: string;
  days: ContentDay[];
  generated: boolean;
}

export interface ContentCalendar {
  strategies: MonthStrategy[];
  startMonth: number;
  startYear: number;
}

export interface TrendingItem {
  platform: 'tiktok' | 'instagram';
  title: string;
  description: string;
  adaptationTip: string;
  estimatedViews: string;
  viralReference: string;       // descrição de vídeo viral de referência
  trendingAudio: string;        // nome da música/áudio trending
  audioArtist: string;          // artista ou criador do áudio
  recreationSteps: string[];    // passo-a-passo para recriar a trend
  hashtags: string[];           // hashtags da trend
  difficulty: 'facil' | 'medio' | 'avancado';
  contentFormat: string;        // formato (POV, Before/After, Tutorial, etc.)
}
