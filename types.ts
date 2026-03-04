
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

// One slot in a customer's recurring schedule (e.g. every Tuesday at 15:00)
export interface RecurringSlot {
  dayOfWeek: number; // 0=Sunday … 6=Saturday
  time: string;      // "HH:MM"
}

// Recurring appointment schedule — attached to a plan customer
export interface RecurringSchedule {
  enabled: boolean;
  professionalId: string;
  serviceId?: string;       // override plan service if needed
  slots: RecurringSlot[];   // one or more day/time combinations
}

// Break / interval period — blocks agent from booking during this window
export interface BreakPeriod {
  id: string;
  label: string;
  type?: 'break' | 'lunch' | 'vacation'; // default 'break'
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

// Monthly / recurring service plan (package)
export interface Plan {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  price: number;             // monthly fee
  proceduresPerMonth: number;// how many procedures are covered per month
  serviceId?: string;        // specific service covered (optional)
  features: string[];        // list of included services / notes
  active: boolean;
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
    planServiceId?: string | null;
    avisoModeId?: string;
    lembreteModeId?: string;
    reativacaoModeId?: string;
    recurringSchedule?: RecurringSchedule;
    aiPaused?: boolean;                  // true = IA desativada manualmente para este lead
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
  openaiApiKey?: string;                // OpenAI API key (uses gpt-4o-mini when set)
  msgBufferSecs?: number;               // message buffer window in seconds (default 30)
  trialStartDate?: string | null;       // ISO datetime — set at first registration; null = paid account
  trialWarningSent?: boolean;           // true once Day 6 WhatsApp warning was sent
  focusNfeConfig?: FocusNfeConfig;      // NFS-e emission configuration
  adiantamentos?: Adiantamento[];       // professional advance payments
  pagamentosPro?: PagamentoPro[];       // professional payroll records
  notasFiscais?: NotaFiscal[];          // NFS-e history
}

export interface Appointment {
  id: string;
  tenant_id: string;
  customer_id: string;
  professional_id: string;
  service_id: string;
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
  planServiceId?: string | null; // specific service covered by plan
  recurringSchedule?: RecurringSchedule; // auto-scheduling config for plan customers
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
