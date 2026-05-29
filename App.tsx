import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import Login from './components/Login';
import AiPollingManager from './components/AiPollingManager';
import ErrorBoundary from './components/ErrorBoundary';

// Lazy-loaded views (code splitting — only loaded when needed)
const Dashboard = lazy(() => import('./components/Dashboard'));
const EvolutionConfig = lazy(() => import('./components/EvolutionConfig'));
const AIChatSimulator = lazy(() => import('./components/AIChatSimulator'));
const AppointmentsView = lazy(() => import('./components/AppointmentsView'));
const ServicesView = lazy(() => import('./components/ServicesView'));
const ProfessionalsView = lazy(() => import('./components/ProfessionalsView'));
const CustomersView = lazy(() => import('./components/CustomersView'));
const SubscriptionsView = lazy(() => import('./components/SubscriptionsView'));
const AiAgentConfig = lazy(() => import('./components/AiAgentConfig'));
const StoreProfile = lazy(() => import('./components/StoreProfile'));
const FinancialView = lazy(() => import('./components/FinancialView'));
const GeneralSettings = lazy(() => import('./components/GeneralSettings'));
const FollowUpView = lazy(() => import('./components/FollowUpView'));
const PlansView = lazy(() => import('./components/PlansView'));
const ConversationsView = lazy(() => import('./components/ConversationsView'));
const BroadcastView = lazy(() => import('./components/BroadcastView'));
const ConexoesView = lazy(() => import('./components/ConexoesView'));
const EstoqueView = lazy(() => import('./components/EstoqueView'));
const ProductsView = lazy(() => import('./components/ProductsView'));
const ComandasView = lazy(() => import('./components/ComandasView'));
const PerformanceView = lazy(() => import('./components/PerformanceView'));
const MarketingView = lazy(() => import('./components/MarketingView'));
const NotasFiscaisView = lazy(() => import('./components/NotasFiscaisView'));
const FolhaPagamentoView = lazy(() => import('./components/FolhaPagamentoView'));
const EstoqueProdutosView = lazy(() => import('./components/EstoqueProdutosView'));
const SuperAdminView = lazy(() => import('./components/SuperAdminView'));
const SupportChat = lazy(() => import('./components/SupportChat'));
const TutorialsPanel = lazy(() => import('./components/TutorialsPanel'));
const OtimizacaoView = lazy(() => import('./components/OtimizacaoView'));
const TrialExpiredView = lazy(() => import('./components/TrialExpiredView'));
const BookingPage = lazy(() => import('./components/BookingPage'));
const MarketplacePage = lazy(() => import('./components/MarketplacePage'));
const MarketplacePreview = lazy(() => import('./components/MarketplacePreview'));
const SocialMidiaView = lazy(() => import('./components/SocialMidiaView'));
const IndicacoesView = lazy(() => import('./components/IndicacoesView'));
const ReferralLandingPage = lazy(() => import('./components/ReferralLandingPage'));
const AffiliateDashboard = lazy(() => import('./components/AffiliateDashboard'));
const CustomerDashboard = lazy(() => import('./components/CustomerDashboard'));
const ProfessionalPortal = lazy(() => import('./components/ProfessionalPortal'));
const ResellerView = lazy(() => import('./components/ResellerView'));
import { db } from './services/mockDb';
import { supabase } from './services/supabase';
import { evolutionService } from './services/evolutionService';
import { TenantStatus, AppointmentStatus, AffiliateLink, ResellerProfile } from './types';
import { sendClientArrivedNotification } from './services/notificationService';
import PlanUpgradeModal from './components/PlanUpgradeModal';
import { hasFeature, FeatureKey } from './config/planConfig';
import { nichoIconMap, NichoKey } from './config/nichoConfigs';
import Toast, { ToastMessage } from './components/Toast';
import WhatsNew from './components/WhatsNew';
export const ToastContext = React.createContext<(msg: Omit<ToastMessage, 'id'>) => void>(() => {});

enum View {
  DASHBOARD = 'DASHBOARD',
  AGENDAMENTOS = 'AGENDAMENTOS',
  SERVICOS = 'SERVICOS',
  PROFISSIONAIS = 'PROFISSIONAIS',
  CLIENTES = 'CLIENTES',
  PERFIL = 'PERFIL',
  FINANCEIRO = 'FINANCEIRO',
  CONEXOES = 'CONEXOES',
  FOLLOW_UP = 'FOLLOW_UP',
  TEST_WA = 'TEST_WA',
  CONFIGURACOES = 'CONFIGURACOES',
  PLANOS = 'PLANOS',
  CONVERSAS = 'CONVERSAS',
  DISPARADOR = 'DISPARADOR',
  ESTOQUE = 'ESTOQUE',
  PRODUTOS = 'PRODUTOS',
  COMANDAS = 'COMANDAS',
  PERFORMANCE = 'PERFORMANCE',
  NOTAS_FISCAIS = 'NOTAS_FISCAIS',
  FOLHA_PAGAMENTO = 'FOLHA_PAGAMENTO',
  MARKETING = 'MARKETING',
  ESTOQUE_PRODUTOS = 'ESTOQUE_PRODUTOS',
  SUPERADMIN_DASHBOARD = 'SUPERADMIN_DASHBOARD',
  OTIMIZACAO = 'OTIMIZACAO',
  MARKETPLACE = 'MARKETPLACE',
  SOCIAL_MIDIA = 'SOCIAL_MIDIA',
  INDICACOES = 'INDICACOES',
  ASSINATURAS = 'ASSINATURAS',
}

type Role = 'TENANT' | 'SUPERADMIN' | 'AFFILIATE' | 'PROFESSIONAL';
type SuperAdminTab = 'dashboard' | 'clients' | 'avisos' | 'cobranca' | 'logs' | 'sql' | 'ia' | 'conversas' | 'disparo' | 'prospeccao' | 'suporte' | 'campanhas' | 'config' | 'central' | 'leads' | 'cashback' | 'wa_central' | 'testes' | 'whitelabel' | 'site';

const SESSION_KEY = 'agz_session';
const PRO_SESSION_KEY = 'agz_pro_session';

// Simple session fingerprint to detect tampering (not crypto-grade, but prevents casual edits)
function sessionFingerprint(data: Record<string, any>): string {
  const raw = JSON.stringify(data) + '|agz_2026';
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

const THEMES = {
  white: {
    label: 'Branco', primary: '#f97316', dark: '#ea580c', light: '#fdba74', bg: '#fff7ed', pageBg: '#f1f5f9',
    accent: '#f97316', accentLight: '#fb923c', accentDark: '#ea580c', accentDarker: '#c2410c',
    accentGlow: 'rgba(249,115,22,0.10)', accentGlowStrong: 'rgba(249,115,22,0.20)', accentSubtle: 'rgba(249,115,22,0.07)',
    accentSubtleHover: 'rgba(249,115,22,0.12)', accentBorder: 'rgba(249,115,22,0.20)', accentBorderStrong: 'rgba(249,115,22,0.35)', accentFocusShadow: 'rgba(249,115,22,0.12)',
    // Palette estrutural
    cardBg: '#ffffff', cardShadow: '0 1px 3px rgba(0,0,0,0.06)',
    sidebarBg: '#ffffff', sidebarBorder: '#e2e8f0',
    bgSubtle: '#f8fafc', bgMuted: '#f1f5f9',
    borderSubtle: '#e2e8f0', borderDefault: '#e2e8f0',
    inputBg: '#ffffff', inputText: '#0f172a', inputBorder: '#e2e8f0',
    textHeading: '#0f172a', textBody: '#334155', textMuted: '#64748b', textSubtle: '#94a3b8',
    isDark: false,
  },
  dark: {
    label: 'Escuro', primary: '#f97316', dark: '#ea580c', light: '#fdba74', bg: '#fff7ed', pageBg: '#0f172a',
    accent: '#f97316', accentLight: '#fb923c', accentDark: '#ea580c', accentDarker: '#c2410c',
    accentGlow: 'rgba(249,115,22,0.15)', accentGlowStrong: 'rgba(249,115,22,0.30)', accentSubtle: 'rgba(249,115,22,0.10)',
    accentSubtleHover: 'rgba(249,115,22,0.15)', accentBorder: 'rgba(249,115,22,0.25)', accentBorderStrong: 'rgba(249,115,22,0.45)', accentFocusShadow: 'rgba(249,115,22,0.20)',
    cardBg: '#1e293b', cardShadow: '0 1px 4px rgba(0,0,0,0.40)',
    sidebarBg: '#0f172a', sidebarBorder: '#1e293b',
    bgSubtle: '#162032', bgMuted: '#1e293b',
    borderSubtle: '#1e293b', borderDefault: '#334155',
    inputBg: '#1e293b', inputText: '#f1f5f9', inputBorder: '#334155',
    textHeading: '#f1f5f9', textBody: '#cbd5e1', textMuted: '#94a3b8', textSubtle: '#64748b',
    isDark: true,
  },
  cold: {
    label: 'Frio', primary: '#6366f1', dark: '#4f46e5', light: '#a5b4fc', bg: '#eef2ff', pageBg: '#eef2ff',
    accent: '#6366f1', accentLight: '#818cf8', accentDark: '#4f46e5', accentDarker: '#3730a3',
    accentGlow: 'rgba(99,102,241,0.10)', accentGlowStrong: 'rgba(99,102,241,0.20)', accentSubtle: 'rgba(99,102,241,0.07)',
    accentSubtleHover: 'rgba(99,102,241,0.12)', accentBorder: 'rgba(99,102,241,0.20)', accentBorderStrong: 'rgba(99,102,241,0.35)', accentFocusShadow: 'rgba(99,102,241,0.12)',
    cardBg: '#f8f9ff', cardShadow: '0 1px 3px rgba(99,102,241,0.12)',
    sidebarBg: '#f0f2ff', sidebarBorder: '#c7d2fe',
    bgSubtle: '#eef2ff', bgMuted: '#e0e7ff',
    borderSubtle: '#e0e7ff', borderDefault: '#c7d2fe',
    inputBg: '#f8f9ff', inputText: '#1e1b4b', inputBorder: '#c7d2fe',
    textHeading: '#1e1b4b', textBody: '#312e81', textMuted: '#6366f1', textSubtle: '#a5b4fc',
    isDark: false,
  },
  warm: {
    label: 'Quente', primary: '#f59e0b', dark: '#d97706', light: '#fcd34d', bg: '#fffbeb', pageBg: '#fef9f0',
    accent: '#f59e0b', accentLight: '#fbbf24', accentDark: '#d97706', accentDarker: '#b45309',
    accentGlow: 'rgba(245,158,11,0.10)', accentGlowStrong: 'rgba(245,158,11,0.20)', accentSubtle: 'rgba(245,158,11,0.07)',
    accentSubtleHover: 'rgba(245,158,11,0.12)', accentBorder: 'rgba(245,158,11,0.20)', accentBorderStrong: 'rgba(245,158,11,0.35)', accentFocusShadow: 'rgba(245,158,11,0.12)',
    cardBg: '#fffef8', cardShadow: '0 1px 3px rgba(245,158,11,0.12)',
    sidebarBg: '#fffbf0', sidebarBorder: '#fde68a',
    bgSubtle: '#fffbeb', bgMuted: '#fef3c7',
    borderSubtle: '#fef3c7', borderDefault: '#fde68a',
    inputBg: '#fffef8', inputText: '#451a03', inputBorder: '#fde68a',
    textHeading: '#451a03', textBody: '#78350f', textMuted: '#92400e', textSubtle: '#b45309',
    isDark: false,
  },
  pink: {
    label: 'Rosa', primary: '#ec4899', dark: '#db2777', light: '#f9a8d4', bg: '#fdf2f8', pageBg: '#fff0f7',
    accent: '#ec4899', accentLight: '#f472b6', accentDark: '#db2777', accentDarker: '#be185d',
    accentGlow: 'rgba(236,72,153,0.10)', accentGlowStrong: 'rgba(236,72,153,0.20)', accentSubtle: 'rgba(236,72,153,0.07)',
    accentSubtleHover: 'rgba(236,72,153,0.12)', accentBorder: 'rgba(236,72,153,0.20)', accentBorderStrong: 'rgba(236,72,153,0.35)', accentFocusShadow: 'rgba(236,72,153,0.12)',
    cardBg: '#fff5f9', cardShadow: '0 1px 3px rgba(236,72,153,0.10)',
    sidebarBg: '#fff0f7', sidebarBorder: '#fbcfe8',
    bgSubtle: '#fdf2f8', bgMuted: '#fce7f3',
    borderSubtle: '#fce7f3', borderDefault: '#fbcfe8',
    inputBg: '#fff8fb', inputText: '#500724', inputBorder: '#fbcfe8',
    textHeading: '#500724', textBody: '#831843', textMuted: '#be185d', textSubtle: '#f9a8d4',
    isDark: false,
  },
  blue: {
    label: 'Azul', primary: '#2563eb', dark: '#1d4ed8', light: '#93c5fd', bg: '#eff6ff', pageBg: '#eff6ff',
    accent: '#2563eb', accentLight: '#3b82f6', accentDark: '#1d4ed8', accentDarker: '#1e3a8a',
    accentGlow: 'rgba(37,99,235,0.10)', accentGlowStrong: 'rgba(37,99,235,0.20)', accentSubtle: 'rgba(37,99,235,0.07)',
    accentSubtleHover: 'rgba(37,99,235,0.12)', accentBorder: 'rgba(37,99,235,0.20)', accentBorderStrong: 'rgba(37,99,235,0.35)', accentFocusShadow: 'rgba(37,99,235,0.12)',
    cardBg: '#f8faff', cardShadow: '0 1px 3px rgba(37,99,235,0.10)',
    sidebarBg: '#eff4ff', sidebarBorder: '#bfdbfe',
    bgSubtle: '#eff6ff', bgMuted: '#dbeafe',
    borderSubtle: '#dbeafe', borderDefault: '#bfdbfe',
    inputBg: '#f8faff', inputText: '#1e3a8a', inputBorder: '#bfdbfe',
    textHeading: '#1e3a8a', textBody: '#1d4ed8', textMuted: '#3b82f6', textSubtle: '#93c5fd',
    isDark: false,
  },
  gray: {
    label: 'Cinza', primary: '#64748b', dark: '#475569', light: '#94a3b8', bg: '#f1f5f9', pageBg: '#f8fafc',
    accent: '#64748b', accentLight: '#94a3b8', accentDark: '#475569', accentDarker: '#334155',
    accentGlow: 'rgba(100,116,139,0.10)', accentGlowStrong: 'rgba(100,116,139,0.20)', accentSubtle: 'rgba(100,116,139,0.07)',
    accentSubtleHover: 'rgba(100,116,139,0.12)', accentBorder: 'rgba(100,116,139,0.20)', accentBorderStrong: 'rgba(100,116,139,0.35)', accentFocusShadow: 'rgba(100,116,139,0.12)',
    cardBg: '#ffffff', cardShadow: '0 1px 3px rgba(100,116,139,0.08)',
    sidebarBg: '#f8fafc', sidebarBorder: '#e2e8f0',
    bgSubtle: '#f8fafc', bgMuted: '#f1f5f9',
    borderSubtle: '#e2e8f0', borderDefault: '#cbd5e1',
    inputBg: '#ffffff', inputText: '#0f172a', inputBorder: '#e2e8f0',
    textHeading: '#0f172a', textBody: '#334155', textMuted: '#64748b', textSubtle: '#94a3b8',
    isDark: false,
  },
} as const;

const App: React.FC = () => {
  // OAuth callback: if this window is a popup opened for OAuth,
  // capture the code from query params, send it to the opener, and close.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state') || 'instagram';
    if (code && window.opener) {
      const typeMap: Record<string, string> = {
        instagram: 'instagram-oauth-code',
        google: 'google-business-oauth-code',
      };
      window.opener.postMessage({ type: typeMap[state] || 'instagram-oauth-code', code }, window.location.origin);
      window.close();
    }
  }, []);

  // Hash-based routing: re-render on hash change
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [role, setRole] = useState<Role>('TENANT');
  const [professionalId, setProfessionalId] = useState<string>('');
  const [professionalName, setProfessionalName] = useState<string>('');
  const [affiliateData, setAffiliateData] = useState<AffiliateLink | null>(null);
  const [resellerProfile, setResellerProfile] = useState<ResellerProfile | null>(null);

  // Detect reseller from current domain (used on mount and after logout)
  const detectResellerDomain = React.useCallback(async () => {
    const hostname = window.location.hostname.replace(/^www\./, '');
    if (hostname.includes('localhost') || hostname.includes('agendezap') || hostname.includes('vercel')) return;
    try {
      const rp = await db.getResellerProfileByDomain(hostname);
      if (rp) setResellerProfile(rp);
    } catch {}
  }, []);
  const [tenantResellerFeatures, setTenantResellerFeatures] = useState<string[] | null | undefined>(undefined);
  const impersonatedFromRole = React.useRef<Role>('SUPERADMIN');
  const [currentView, setCurrentView] = useState<View>(View.DASHBOARD);
  const [tenantId, setTenantId] = useState<string>('');
  const [refreshTicker, setRefreshTicker] = useState(0);
  const [tenantSlug, setTenantSlug] = useState<string>('');
  const [tenantName, setTenantName] = useState<string>('Carregando...');
  const [isReady, setIsReady] = useState(false);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [superAdminTab, setSuperAdminTab] = useState<SuperAdminTab>('dashboard');
  const [tenantPlan, setTenantPlan] = useState<string>('START');
  const [tenantNicho, setTenantNicho] = useState<string>('');
  const [colorTheme, setColorTheme] = useState<keyof typeof THEMES>(() => {
    const saved = localStorage.getItem('agz_theme');
    if (saved && saved in THEMES) return saved as keyof typeof THEMES;
    const oldDark = localStorage.getItem('agz_dark');
    if (oldDark === '1') return 'dark';
    return 'white';
  });
  const [showThemePicker, setShowThemePicker] = useState(false);
  const themePickerRef = useRef<HTMLDivElement>(null);
  // ── Notificações de chegada de clientes ──────────────────────────────
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [arrivingAppts, setArrivingAppts] = useState<any[]>([]);
  const notifPanelRef = useRef<HTMLDivElement>(null);
  const [upgradeModal, setUpgradeModal] = useState<{ feature: FeatureKey } | null>(null);
  const UPDATE_KEY = 'agz_update_seen_v3';
  const [showUpdateNotice, setShowUpdateNotice] = useState(() => !localStorage.getItem('agz_update_seen_v3'));
  const [unreadConvCount, setUnreadConvCount] = useState(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [showTutorials, setShowTutorials] = useState(false);
  // Referral: capture ?ref=<slug> or ?ref_c=<phone> from URL
  const [referralSlug] = useState(() => new URLSearchParams(window.location.search).get('ref') || '');
  const [referralCustomerPhone] = useState(() => new URLSearchParams(window.location.search).get('ref_c') || '');
  const [referralName, setReferralName] = useState('');
  // Affiliate: capture ?aff=<slug> from URL
  const [affiliateSlug] = useState(() => new URLSearchParams(window.location.search).get('aff') || '');
  const [affiliateName, setAffiliateName] = useState('');
  const [affiliateLinkId, setAffiliateLinkId] = useState('');
  useEffect(() => {
    if (!referralSlug) return;
    db.getTenantBySlug(referralSlug).then(t => { if (t?.name) setReferralName(t.name); });
  }, [referralSlug]);
  useEffect(() => {
    if (!affiliateSlug) return;
    db.getAffiliateLinkBySlug(affiliateSlug).then(aff => {
      if (aff && aff.active) { setAffiliateName(aff.name); setAffiliateLinkId(aff.id); }
    });
  }, [affiliateSlug]);

  // ── Fila de presença: todos agendamentos de hoje PENDING/CONFIRMED/ARRIVED ────
  useEffect(() => {
    if (!tenantId || role !== 'TENANT') return;
    const checkArrivals = async () => {
      try {
        const [appts, customers, professionals] = await Promise.all([
          db.getAppointments(tenantId, 1, { fresh: true }),
          db.getCustomers(tenantId),
          db.getProfessionals(tenantId),
        ]);
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const pending = appts
          .filter(a =>
            (a.status === AppointmentStatus.CONFIRMED ||
             a.status === AppointmentStatus.PENDING ||
             a.status === AppointmentStatus.ARRIVED) &&
            a.startTime.slice(0, 10) === today
          )
          .map(a => ({
            ...a,
            customerName: customers.find(c => c.id === a.customer_id)?.name || 'Cliente',
            professionalName: professionals.find(p => p.id === a.professional_id)?.name || '',
          }))
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        setArrivingAppts(pending);
      } catch { /* silently */ }
    };
    checkArrivals();
    const iv = setInterval(checkArrivals, 30_000);
    return () => clearInterval(iv);
  }, [tenantId, role]);

  // Fechar painel de notif ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifPanelRef.current && !notifPanelRef.current.contains(e.target as Node)) {
        setShowNotifPanel(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Apply reseller brand colors via CSS vars whenever profile or dark mode changes
  useEffect(() => {
    const root = document.documentElement;
    const set = (v: string, val?: string) => val ? root.style.setProperty(v, val) : root.style.removeProperty(v);

    // Accent / primary color (same for both modes)
    if (resellerProfile?.primary_color) {
      root.style.setProperty('--color-primary', resellerProfile.primary_color);
      root.style.setProperty('--color-primary-dark', resellerProfile.primary_color);
      root.style.setProperty('--color-primary-light', resellerProfile.primary_color + '99');
      root.style.setProperty('--color-primary-bg', resellerProfile.primary_color + '15');
      root.style.setProperty('--accent', resellerProfile.primary_color);
      root.style.setProperty('--accent-light', resellerProfile.primary_color + 'cc');
      root.style.setProperty('--accent-dark', resellerProfile.primary_color);
      root.style.setProperty('--accent-darker', resellerProfile.primary_color);
      root.style.setProperty('--accent-glow', resellerProfile.primary_color + '26');
      root.style.setProperty('--accent-glow-strong', resellerProfile.primary_color + '4d');
      root.style.setProperty('--accent-subtle', resellerProfile.primary_color + '14');
      root.style.setProperty('--accent-subtle-hover', resellerProfile.primary_color + '26');
      root.style.setProperty('--accent-border', resellerProfile.primary_color + '40');
      root.style.setProperty('--accent-border-strong', resellerProfile.primary_color + '66');
      root.style.setProperty('--accent-focus-shadow', resellerProfile.primary_color + '1a');
    } else {
      ['--color-primary','--color-primary-dark','--color-primary-light','--color-primary-bg',
       '--accent','--accent-light','--accent-dark','--accent-darker','--accent-glow',
       '--accent-glow-strong','--accent-subtle','--accent-subtle-hover','--accent-border',
       '--accent-border-strong','--accent-focus-shadow'].forEach(v => root.style.removeProperty(v));
    }

    // Pick light or dark color set based on current dark mode
    const isDark = THEMES[colorTheme].isDark;
    const rp = resellerProfile;
    const bgColor      = isDark ? (rp?.dark_bg_color      || rp?.bg_color)       : rp?.bg_color;
    const fontColor    = isDark ? (rp?.dark_font_color    || rp?.font_color)     : rp?.font_color;
    const iconColor    = isDark ? (rp?.dark_icon_color    || rp?.icon_color)     : rp?.icon_color;
    const pageBgColor  = isDark ? (rp?.dark_page_bg_color || rp?.page_bg_color)  : rp?.page_bg_color;
    const cardBgColor  = isDark ? (rp?.dark_card_bg_color || rp?.card_bg_color)  : rp?.card_bg_color;
    const textColor    = isDark ? (rp?.dark_text_color    || rp?.text_color)     : rp?.text_color;

    // Sidebar colors
    set('--reseller-font-color', fontColor);
    set('--reseller-bg-color',   bgColor);
    set('--reseller-icon-color', iconColor);

    // Full-theme colors (page, cards, text)
    set('--reseller-page-bg',    pageBgColor);
    set('--reseller-card-bg',    cardBgColor);
    set('--reseller-text',       textColor);
    set('--reseller-text-muted', textColor ? textColor + '99' : undefined);

    // Apply page background directly to body — CSS descendant selector can't target
    // body from a child div, so we must set it via JS to override .dark body rules.
    if (pageBgColor) {
      document.body.style.setProperty('background', pageBgColor, 'important');
    } else {
      document.body.style.removeProperty('background');
    }

    // Dynamic page title + cache brand name for next load (eliminates flash)
    if (resellerProfile?.brand_name) {
      document.title = `${resellerProfile.brand_name} - Gestão de Agendamentos`;
      localStorage.setItem('agz_reseller_brand', resellerProfile.brand_name);
    } else {
      document.title = 'AgendeZap - Gestão de Agendamentos';
      localStorage.removeItem('agz_reseller_brand');
    }

    // Dynamic favicon — prefer favicon_url, fall back to logo_url
    const faviconUrl = resellerProfile?.favicon_url || resellerProfile?.logo_url;
    if (faviconUrl) {
      document.querySelectorAll("link[rel~='icon'], link[rel='shortcut icon']").forEach(el => el.remove());
      const link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/png';
      link.href = faviconUrl + '?v=' + Date.now();
      document.head.appendChild(link);
    }
  }, [resellerProfile, colorTheme]);
  const showToast = React.useCallback((msg: Omit<ToastMessage, 'id'>) => {
    setToasts(prev => [...prev, { ...msg, id: `${Date.now()}_${Math.random()}` }]);
  }, []);
  const removeToast = React.useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);
  // Appointment arrival alert
  type ApptAlert = { id: string; clientName: string; service: string; profName: string; time: string; professionalId: string; serviceId: string; customerId: string; inicio: string };
  const [apptAlert, setApptAlert] = useState<ApptAlert | null>(null);
  const [initialApptId, setInitialApptId] = useState<string | undefined>(undefined);
  const alertedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!tenantId || role !== 'TENANT') return;
    const check = async () => {
      try {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const todayStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
        const { data } = await supabase
          .from('appointments')
          .select('id, inicio, status, professional_id, service_id, customer_id, customers(nome), professionals(nome), services(nome)')
          .eq('tenant_id', tenantId)
          .eq('status', 'CONFIRMED')
          .gte('inicio', `${todayStr}T00:00:00`)
          .lte('inicio', `${todayStr}T23:59:59`);
        for (const a of (data || [])) {
          if (alertedRef.current.has(a.id)) continue;
          const apptTime = new Date(a.inicio);
          const diffMs = apptTime.getTime() - now.getTime();
          if (diffMs >= -60000 && diffMs <= 180000) {
            alertedRef.current.add(a.id);
            setApptAlert({
              id: a.id,
              clientName:     (a.customers as any)?.nome || 'Cliente',
              service:        (a.services as any)?.nome  || 'Serviço',
              profName:       (a.professionals as any)?.nome || '',
              time:           a.inicio.slice(11, 16),
              professionalId: (a as any).professional_id || '',
              serviceId:      (a as any).service_id || '',
              customerId:     (a as any).customer_id || '',
              inicio:         a.inicio,
            });
            break;
          }
        }
      } catch {}
    };
    check();
    const t = setInterval(() => { if (!document.hidden) check(); }, 60_000);
    return () => clearInterval(t);
  }, [tenantId, role]);

  const handleClientArrived = async () => {
    if (!apptAlert) return;
    const snap = apptAlert;
    setApptAlert(null);
    try {
      // 1. Update appointment status → ARRIVED
      await db.updateAppointmentStatus(snap.id, AppointmentStatus.ARRIVED, {});

      // 2. Create comanda if one doesn't already exist for this appointment
      const [existingComandas, services] = await Promise.all([
        db.getComandas(tenantId),
        db.getServices(tenantId),
      ]);
      const alreadyHasComanda = existingComandas.some(c => c.appointment_id === snap.id);
      if (!alreadyHasComanda) {
        const svc = services.find(s => s.id === snap.serviceId);
        await db.createComanda({
          tenant_id: tenantId,
          appointment_id: snap.id,
          professional_id: snap.professionalId,
          customer_id: snap.customerId,
          status: 'open',
          items: svc ? [{
            id: crypto.randomUUID(),
            type: 'service' as const,
            itemId: svc.id,
            name: svc.name,
            qty: 1,
            unitPrice: svc.price,
            discountType: 'value' as const,
            discount: 0,
            professionalId: snap.professionalId,
          }] : [],
        });
      }

      // 3. Send WhatsApp notification to the professional (best-effort)
      sendClientArrivedNotification({
        id: snap.id,
        tenant_id: tenantId,
        professional_id: snap.professionalId,
        service_id: snap.serviceId,
        customer_id: snap.customerId,
        startTime: snap.inicio,
        durationMinutes: 0,
        status: AppointmentStatus.ARRIVED,
        source: 'AI' as any,
      }).catch(console.error);
    } catch (e) {
      console.error('[handleClientArrived]', e);
    }
    // 4. Open COMANDAS view on this appointment
    setInitialApptId(snap.id);
    setCurrentView(View.COMANDAS);
  };

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [sidebarAutoExpanded, setSidebarAutoExpanded] = useState(false);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  // No mobile, quando o menu está aberto, sempre mostra expandido (ícone + nome)
  const effectiveCollapsed = sidebarCollapsed && !sidebarOpen;
  const handleSidebarEnter = () => {
    if (isMobile) return; // mobile: only toggle via button
    if (collapseTimerRef.current) { clearTimeout(collapseTimerRef.current); collapseTimerRef.current = null; }
    if (sidebarCollapsed) {
      // Expand immediately on hover (no delay)
      setSidebarCollapsed(false);
      setSidebarAutoExpanded(true);
    }
  };
  const handleSidebarLeave = () => {
    if (isMobile) return; // mobile: only toggle via button
    if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; }
    if (sidebarAutoExpanded) {
      collapseTimerRef.current = setTimeout(() => { setSidebarCollapsed(true); setSidebarAutoExpanded(false); }, 1000);
    }
  };
  const toggleSidebar = () => {
    if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; }
    if (collapseTimerRef.current) { clearTimeout(collapseTimerRef.current); collapseTimerRef.current = null; }
    setSidebarAutoExpanded(false);
    setSidebarCollapsed(v => !v);
  };

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showInstallTutorial, setShowInstallTutorial] = useState(false);
  const [relatoriosOpen, setRelatoriosOpen] = useState(false);
  const [sistemaSectionOpen, setSistemaSectionOpen] = useState(false);

  // Auto-reload when service worker sends SW_UPDATED (new version deployed)
  useEffect(() => {
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SW_UPDATED') {
        window.location.reload();
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleSWMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', handleSWMessage);
  }, []);

  // Global keyboard shortcuts (Alt+key) — active on any screen
  useEffect(() => {
    const NAV_SHORTCUTS: Record<string, View> = {
      a: View.AGENDAMENTOS,
      c: View.CLIENTES,
      f: View.FINANCEIRO,
      m: View.MARKETING,
      e: View.PROFISSIONAIS,
      d: View.DASHBOARD,
    };
    const handler = (ev: KeyboardEvent) => {
      if (!ev.altKey) return;
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const target = NAV_SHORTCUTS[ev.key.toLowerCase()];
      if (target) { ev.preventDefault(); setCurrentView(target); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const [inviteResult, setInviteResult] = useState<{ email: string; password: string; phone: string } | null>(null);
  const [pollingStatus, setPollingStatus] = useState<{ connected: boolean; aiActive: boolean; instanceMissing?: boolean } | null>(null);
  const [trialInfo, setTrialInfo] = useState<{ daysLeft: number; isExpired: boolean; active: boolean } | null>(null);
  const [pendingPayment, setPendingPayment] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  // Persist session whenever auth/nav state changes
  useEffect(() => {
    if (isAuthenticated && role === 'AFFILIATE') {
      // Save minimal AFFILIATE session + full affiliateData in separate key
      const payload = { isAuthenticated, role };
      localStorage.setItem(SESSION_KEY, JSON.stringify({ ...payload, _fp: sessionFingerprint(payload) }));
      if (affiliateData) localStorage.setItem('agz_affiliate', JSON.stringify(affiliateData));
    } else if (isAuthenticated && role !== 'PROFESSIONAL') {
      const payload = {
        isAuthenticated, role, tenantId, tenantSlug, tenantName,
        tenantPlan, tenantNicho, isImpersonating, currentView, superAdminTab,
        _impersonatedFromRole: isImpersonating ? impersonatedFromRole.current : null,
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify({ ...payload, _fp: sessionFingerprint(payload) }));
      // Save affiliateData when impersonating so F5 restores the reseller context
      if (isImpersonating && affiliateData) localStorage.setItem('agz_affiliate', JSON.stringify(affiliateData));
    }
    if (isAuthenticated && role === 'PROFESSIONAL') {
      const payload = { isAuthenticated, role, tenantId, tenantSlug, tenantName, tenantPlan, tenantNicho, professionalId, professionalName };
      localStorage.setItem(PRO_SESSION_KEY, JSON.stringify({ ...payload, _fp: sessionFingerprint(payload) }));
    }
  }, [isAuthenticated, role, tenantId, tenantSlug, tenantName, tenantPlan, tenantNicho, isImpersonating, currentView, superAdminTab, professionalId, professionalName, affiliateData]);

  // Close sidebar on mobile after any nav action
  const navTo = (fn: () => void) => () => { fn(); setSidebarOpen(false); };

  // Close upgrade modal when navigating away (skip the nav that opened it)
  const gatedNavRef = React.useRef(false);
  useEffect(() => {
    if (upgradeModal && !gatedNavRef.current) {
      setUpgradeModal(null);
    }
    gatedNavRef.current = false;
  }, [currentView]);

  // Auto-expand Relatórios submenu when on Marketing or Performance
  useEffect(() => {
    if (currentView === View.MARKETING || currentView === View.PERFORMANCE) {
      setRelatoriosOpen(true);
    }
  }, [currentView]);

  // Apply color theme: CSS variables + dark class + page background
  useEffect(() => {
    const t = THEMES[colorTheme];
    const root = document.documentElement;
    // Only apply color vars if no reseller is overriding them
    if (!resellerProfile?.primary_color) {
      root.style.setProperty('--color-primary',       t.primary);
      root.style.setProperty('--color-primary-dark',  t.dark);
      root.style.setProperty('--color-primary-light', t.light);
      root.style.setProperty('--color-primary-bg',    t.bg);
      root.style.setProperty('--accent',              t.accent);
      root.style.setProperty('--accent-light',        t.accentLight);
      root.style.setProperty('--accent-dark',         t.accentDark);
      root.style.setProperty('--accent-darker',       t.accentDarker);
      root.style.setProperty('--accent-glow',         t.accentGlow);
      root.style.setProperty('--accent-glow-strong',  t.accentGlowStrong);
      root.style.setProperty('--accent-subtle',       t.accentSubtle);
      root.style.setProperty('--accent-subtle-hover', t.accentSubtleHover);
      root.style.setProperty('--accent-border',       t.accentBorder);
      root.style.setProperty('--accent-border-strong',t.accentBorderStrong);
      root.style.setProperty('--accent-focus-shadow', t.accentFocusShadow);
      document.body.style.setProperty('background', t.pageBg, 'important');
    }
    // Always apply structural palette vars (independent of reseller branding)
    root.style.setProperty('--theme-card-bg',        t.cardBg);
    root.style.setProperty('--theme-card-shadow',    t.cardShadow);
    root.style.setProperty('--theme-sidebar-bg',     t.sidebarBg);
    root.style.setProperty('--theme-sidebar-border', t.sidebarBorder);
    root.style.setProperty('--theme-bg-subtle',      t.bgSubtle);
    root.style.setProperty('--theme-bg-muted',       t.bgMuted);
    root.style.setProperty('--theme-border-subtle',  t.borderSubtle);
    root.style.setProperty('--theme-border-default', t.borderDefault);
    root.style.setProperty('--theme-input-bg',       t.inputBg);
    root.style.setProperty('--theme-input-text',     t.inputText);
    root.style.setProperty('--theme-input-border',   t.inputBorder);
    root.style.setProperty('--theme-text-heading',   t.textHeading);
    root.style.setProperty('--theme-text-body',      t.textBody);
    root.style.setProperty('--theme-text-muted',     t.textMuted);
    root.style.setProperty('--theme-text-subtle',    t.textSubtle);
    if (t.isDark) { root.classList.add('dark'); } else { root.classList.remove('dark'); }
    localStorage.setItem('agz_theme', colorTheme);
  }, [colorTheme, resellerProfile]);

  // Close theme picker on outside click
  useEffect(() => {
    if (!showThemePicker) return;
    const handler = (e: MouseEvent) => {
      if (themePickerRef.current && !themePickerRef.current.contains(e.target as Node)) {
        setShowThemePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showThemePicker]);

  // Load per-tenant feature overrides when a tenant session is active (direct login or page reload)
  // Impersonation already loads them inside handleImpersonate — this covers direct tenant login
  useEffect(() => {
    if (!tenantId || role !== 'TENANT' || isImpersonating) return;
    db.getSettings(tenantId).then(s => {
      setTenantResellerFeatures(s?.resellerFeatureOverrides ?? null);
    }).catch(() => setTenantResellerFeatures(null));
  }, [tenantId, role, isImpersonating]);

  // ── Trial check — runs every minute; auto-disables AI when expired ───
  useEffect(() => {
    if (!tenantId || role !== 'TENANT') { setTrialInfo(null); return; }

    const check = async () => {
      const settings = await db.getSettings(tenantId);
      if (!settings.trialStartDate) { setTrialInfo(null); return; } // paid account

      const daysPassed = Math.floor(
        (Date.now() - new Date(settings.trialStartDate).getTime()) / 86_400_000
      );
      const daysLeft = Math.max(0, 7 - daysPassed);
      const isExpired = daysPassed >= 7;

      setTrialInfo({ daysLeft, isExpired, active: !isExpired });

      if (isExpired && settings.aiActive) {
        await db.updateSettings(tenantId, { aiActive: false });
      }
    };

    check();
    const interval = setInterval(() => { if (!document.hidden) check(); }, 120_000);
    return () => clearInterval(interval);
  }, [tenantId, role]);

  // ── Supabase Realtime — invalidate cache + signal views when data changes ──
  useEffect(() => {
    if (!tenantId) return;
    const unsub = db.subscribeToTenantChanges(tenantId, () => {
      setRefreshTicker(t => t + 1);
    });
    return unsub;
  }, [tenantId]);

  // ── Pending payment check — detects unpaid tenants ──────────────────
  useEffect(() => {
    if (!tenantId || !isAuthenticated || role !== 'TENANT') return;
    const checkPayment = async () => {
      try {
        const tenant = await db.getTenant(tenantId);
        setPendingPayment(tenant?.status === TenantStatus.PENDING_PAYMENT);
        if (tenant?.nicho) setTenantNicho(tenant.nicho);
      } catch { /* ignore */ }
    };
    checkPayment();
  }, [tenantId, isAuthenticated, role]);

  useEffect(() => {
    const init = async () => {
      // Safety net: force setIsReady(true) after 8s regardless of network hangs.
      // Critical for Android where setTimeout is throttled in background tabs.
      let readySet = false;
      const safetyTimer = setTimeout(() => {
        if (!readySet) { readySet = true; setIsReady(true); }
      }, 8000);

      // Restore saved session before checking DB
      try {
        // Try professional session first
        const proSaved = localStorage.getItem(PRO_SESSION_KEY);
        if (proSaved) {
          const s = JSON.parse(proSaved);
          const { _fp, ...payload } = s;
          if (_fp && _fp === sessionFingerprint(payload) && s.isAuthenticated && s.role === 'PROFESSIONAL') {
            setIsAuthenticated(true);
            setRole('PROFESSIONAL');
            setTenantId(s.tenantId || '');
            setTenantSlug(s.tenantSlug || '');
            setTenantName(s.tenantName || '');
            setTenantPlan(s.tenantPlan || 'START');
            if (s.tenantNicho) setTenantNicho(s.tenantNicho);
            setProfessionalId(s.professionalId || '');
            setProfessionalName(s.professionalName || '');
            clearTimeout(safetyTimer);
            readySet = true; setIsReady(true);
            return; // skip admin session
          } else {
            localStorage.removeItem(PRO_SESSION_KEY);
          }
        }
        const saved = localStorage.getItem(SESSION_KEY);
        if (saved) {
          const s = JSON.parse(saved);
          // Verify session integrity — reject tampered data
          const { _fp, ...payload } = s;
          if (_fp && _fp !== sessionFingerprint(payload)) {
            localStorage.removeItem(SESSION_KEY);
          } else if (s.isAuthenticated && s.role === 'AFFILIATE') {
            // Restore reseller (affiliate) session
            const aff = localStorage.getItem('agz_affiliate');
            if (aff) {
              try { setAffiliateData(JSON.parse(aff)); } catch {}
              setIsAuthenticated(true);
              setRole('AFFILIATE');
            } else {
              // No affiliate data cached — force re-login
              localStorage.removeItem(SESSION_KEY);
            }
          } else if (s.isAuthenticated && s.role !== 'AFFILIATE') {
            setIsAuthenticated(true);
            setRole(s.role || 'TENANT');
            setTenantId(s.tenantId || '');
            setTenantSlug(s.tenantSlug || '');
            setTenantName(s.tenantName || '');
            setTenantPlan(s.tenantPlan || 'START');
            if (s.tenantNicho) setTenantNicho(s.tenantNicho);
            if (s.isImpersonating) {
              // Restore affiliate context so "Sair da conta" works after F5
              const aff = localStorage.getItem('agz_affiliate');
              if (aff) {
                try { setAffiliateData(JSON.parse(aff)); } catch {}
                impersonatedFromRole.current = 'AFFILIATE';
              } else if (s._impersonatedFromRole) {
                impersonatedFromRole.current = s._impersonatedFromRole;
              }
            }
            setIsImpersonating(s.isImpersonating || false);
            setCurrentView(s.currentView || View.DASHBOARD);
            setSuperAdminTab(s.superAdminTab || 'dashboard');
          }
        }
      } catch {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(PRO_SESSION_KEY);
      }

      try {
        await db.checkConnection();
      } catch (err) {
        console.warn("Utilizando Local Storage como fallback.");
      }

      // Domain-based reseller detection — must resolve before Login renders
      await detectResellerDomain();

      clearTimeout(safetyTimer);
      if (!readySet) { readySet = true; setIsReady(true); }
    };
    init();
  }, []);

  const handleLogin = async (selectedRole: Role, userSlug?: string, userEmail?: string, userPassword?: string, professionalData?: any) => {
    try {
      // Professional login via phone+PIN
      if (selectedRole === 'PROFESSIONAL' && professionalData) {
        setRole('PROFESSIONAL');
        setTenantId(professionalData.tenant_id || '');
        setTenantSlug(professionalData.tenant_slug || '');
        setTenantName(professionalData.tenant_name || '');
        setTenantPlan(professionalData.tenant_plan || 'START');
        if (professionalData.tenant_nicho) setTenantNicho(professionalData.tenant_nicho);
        setProfessionalId(professionalData.professional_id || '');
        setProfessionalName(professionalData.professional_name || '');
        setIsAuthenticated(true);
        return;
      }

      if (selectedRole === 'SUPERADMIN') {
        // Validate superadmin via secure RPC (credentials never leave the server)
        try {
          const { data, error } = await supabase.rpc('admin_login', {
            p_email: userEmail || '',
            p_password: userPassword || '',
          });
          if (error || !data || data.error) {
            // Fallback to client-side check if RPC not yet deployed
            const cfg = await db.getGlobalConfig();
            const customEmail = (cfg['admin_email'] || '').trim();
            const customPass  = (cfg['admin_password'] || '').trim();
            if (!customEmail || !customPass) {
              alert('Credenciais de administrador não configuradas no sistema.');
              return;
            }
            if (userEmail !== customEmail || userPassword !== customPass) {
              alert('Credenciais incorretas.');
              return;
            }
          }
        } catch {
          alert('Não foi possível verificar as credenciais. Verifique sua conexão.');
          return;
        }
        setRole('SUPERADMIN');
        setIsAuthenticated(true);
        setCurrentView(View.SUPERADMIN_DASHBOARD);
        return;
      }

      // Try affiliate login first
      if (userEmail && userPassword) {
        const aff = await db.affiliateLogin(userEmail, userPassword);
        if (aff) {
          setRole('AFFILIATE');
          setAffiliateData(aff);
          setIsAuthenticated(true);
          // Load reseller profile if affiliate is a reseller
          try {
            const rp = await db.getResellerProfile(aff.id);
            if (rp) setResellerProfile(rp);
          } catch { /* no reseller profile yet */ }
          return;
        }
      }

      if (userSlug) {
        // Use secure RPC for tenant login (password validated server-side)
        try {
          const { data, error } = await supabase.rpc('tenant_login', {
            p_email: userEmail || '',
            p_password: userPassword || '',
          });
          if (!error && data && !data.error) {
            setTenantId(data.id);
            setTenantSlug(data.slug);
            setTenantName(data.name);
            setTenantPlan(data.plan || 'START');
            setRole('TENANT');
            setIsAuthenticated(true);
            // Check if tenant still needs to pay + load nicho
            const loginTenant = await db.getTenant(data.id);
            if (loginTenant?.nicho) setTenantNicho(loginTenant.nicho);
            if (loginTenant?.status === TenantStatus.PENDING_PAYMENT) {
              setPendingPayment(true);
            }
            // Save last login timestamp
            supabase.from('tenants').update({ last_login_at: new Date().toISOString() }).eq('id', data.id).then(() => {});
            setCurrentView(View.DASHBOARD);
            return;
          }
        } catch { /* RPC not available — fallback below */ }

        // Fallback: direct DB query (for when RPC migration hasn't been run yet)
        const targetSlug = userSlug.toLowerCase().trim();
        const tenants = await db.getAllTenants();

        let myTenant = tenants.find(t => t.slug === targetSlug);
        if (!myTenant && userEmail) {
          myTenant = tenants.find(t => t.email?.toLowerCase() === userEmail.toLowerCase());
        }
        if (!myTenant) {
          alert("Barbearia não encontrada. Verifique o e-mail cadastrado ou entre em contato com o suporte.");
          return;
        }
        if (myTenant.password && userPassword && myTenant.password !== userPassword) {
          alert("Senha incorreta.");
          return;
        }
        setTenantId(myTenant.id);
        setTenantSlug(myTenant.slug);
        setTenantName(myTenant.name);
        setTenantPlan(myTenant.plan || 'START');
        if (myTenant.nicho) setTenantNicho(myTenant.nicho);
        setRole('TENANT');
        setIsAuthenticated(true);
        if (myTenant.status === TenantStatus.PENDING_PAYMENT) {
          setPendingPayment(true);
        }
        // Save last login timestamp
        supabase.from('tenants').update({ last_login_at: new Date().toISOString() }).eq('id', myTenant.id).then(() => {});
        setCurrentView(View.DASHBOARD);
      }
    } catch (err) {
      console.error("Login Error:", err);
      alert("Falha crítica na conexão com o Supabase.");
    }
  };

  const handleRegister = async (storeName: string, email: string, pass: string, phone: string) => {
    try {
      const slug = storeName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').slice(0, 30);
      const tenants = await db.getAllTenants();
      const exists = tenants.find(t => t.slug === slug);

      if (exists) {
        throw new Error("Este e-mail/slug já está cadastrado.");
      }

      // Resolve referral slug → tenant id
      let referredById: string | undefined;
      if (referralSlug) {
        const allTenants = await db.getAllTenants();
        const referrer = allTenants.find(t => t.slug === referralSlug);
        if (referrer) referredById = referrer.id;
      }

      const newTenant = await db.addTenant({
        name: storeName,
        slug: slug,
        email: email,
        password: pass,
        phone: phone,
        plan: 'START',
        status: TenantStatus.PENDING_PAYMENT,
        monthlyFee: 0,
        referred_by: referredById,
        referred_by_customer: referralCustomerPhone || undefined,
        affiliate_link_id: affiliateLinkId || undefined
      });

      if (newTenant) {
        await db.updateSettings(newTenant.id, {
          themeColor: '#f97316',
          aiActive: false,
        });

        // Dispara mensagem de boas-vindas pelo WhatsApp da central (non-blocking)
        if (phone) {
          (async () => {
            try {
              const globalCfg = await db.getGlobalConfig();
              const centralInstance = globalCfg['central_instance'] || 'central_AgendeZap';
              const cleanPhone = phone.replace(/\D/g, '');
              const msg = `Olá, ${storeName}! Aqui é o Matheus Moura, da equipe de suporte do AgendeZap! 😊\n\nVi que você se cadastrou na nossa plataforma e entrei em contato para entender melhor o que você precisa e tirar qualquer dúvida antes de começar.\n\nPode me contar um pouco sobre o seu negócio? Assim consigo te ajudar da melhor forma possível!`;
              await evolutionService.sendMessage(centralInstance, cleanPhone, msg);
            } catch (e) {
              console.error('[AgendeZap] Falha ao enviar boas-vindas WhatsApp:', e);
            }
          })();
        }

        setTenantId(newTenant.id);
        setTenantSlug(newTenant.slug);
        setTenantName(newTenant.name);
        setTenantPlan(newTenant.plan || 'START');
        if (newTenant.nicho) setTenantNicho(newTenant.nicho);
        setRole('TENANT');
        setIsAuthenticated(true);
        setPendingPayment(true);
        setCurrentView(View.DASHBOARD);
      }
    } catch (err: any) {
      throw err;
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(PRO_SESSION_KEY);
    setIsAuthenticated(false);
    setRole('TENANT');
    setTenantId('');
    setTenantSlug('');
    setTenantNicho('');
    setIsImpersonating(false);
    setPendingPayment(false);
    setProfessionalId('');
    setProfessionalName('');
    setAffiliateData(null);
    setResellerProfile(null);
    localStorage.removeItem('agz_affiliate');
    detectResellerDomain(); // re-apply domain branding after logout
    setCurrentView(View.DASHBOARD);
  };

  const handleImpersonate = async (id: string, name: string, slug: string, plan?: string) => {
    impersonatedFromRole.current = role; // save who initiated impersonation
    setTenantId(id);
    setTenantSlug(slug);
    setTenantName(name);
    setTenantPlan(plan || 'START');
    setRole('TENANT');
    setIsImpersonating(true);
    setCurrentView(View.DASHBOARD);
    try { const t = await db.getTenant(id); if (t?.nicho) setTenantNicho(t.nicho); else setTenantNicho(''); } catch { setTenantNicho(''); }
    try { const s = await db.getSettings(id); setTenantResellerFeatures(s?.resellerFeatureOverrides ?? undefined); } catch { setTenantResellerFeatures(undefined); }
  };

  // Returns true if this feature should be visible for the current tenant
  // Priority: per-tenant override > reseller global > plan default (all visible)
  const resellerAllows = (key: string) => {
    // 1. Per-tenant override takes highest priority (set by reseller or SuperAdmin)
    if (tenantResellerFeatures !== undefined && tenantResellerFeatures !== null) {
      return tenantResellerFeatures.includes(key);
    }
    // 2. Reseller global setting
    if (resellerProfile?.visible_features) {
      return resellerProfile.visible_features.includes(key);
    }
    // 3. Default: all visible
    return true;
  };

  // effectivePlan: when reseller is active OR when per-tenant overrides are configured,
  // bypass plan-based gating — feature access is controlled by resellerAllows() / sidebar
  const effectivePlan = (resellerProfile !== null || (tenantResellerFeatures !== undefined && tenantResellerFeatures !== null)) ? 'ELITE' : tenantPlan;

  const handleGatedNav = (view: View, feature: FeatureKey) => {
    setCurrentView(view);
    if (!hasFeature(effectivePlan, feature)) {
      gatedNavRef.current = true;
      setUpgradeModal({ feature });
    }
  };

  const handleExitImpersonation = () => {
    // Safety guard: if affiliateData is in memory, this impersonation was always
    // started by a reseller — never allow escalation to SUPERADMIN
    const fromRole = affiliateData ? 'AFFILIATE' : impersonatedFromRole.current;
    // Clear stale impersonation session so init() doesn't re-read it on next load
    localStorage.removeItem(SESSION_KEY);
    setRole(fromRole);
    setIsImpersonating(false);
    setTenantId('');
    setTenantSlug('');
    setTenantNicho('');
    setTenantResellerFeatures(undefined);
    if (fromRole === 'AFFILIATE') {
      // back to reseller portal — no view needed (ResellerView handles routing)
    } else {
      setCurrentView(View.SUPERADMIN_DASHBOARD);
    }
  };

  const bookingSlug = (() => {
    // Support both /agendar/slug (clean URL) and #/agendar/slug (legacy hash)
    const pathMatch = window.location.pathname.match(/\/agendar\/(.+)/);
    if (pathMatch) return pathMatch[1];
    const m = hash.match(/^#\/agendar\/(.+)$/);
    return m ? m[1] : null;
  })();
  if (bookingSlug) return <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin" /></div>}><BookingPage slug={bookingSlug} /></Suspense>;

  // Marketplace public page
  if (hash.startsWith('#/marketplace')) return <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin" /></div>}><MarketplacePage /></Suspense>;

  // Customer dashboard
  if (hash === '#/minha-conta') return <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin" /></div>}><CustomerDashboard /></Suspense>;

  if (!isReady) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center space-y-4">
        <div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin"></div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Estabelecendo Conexão Supabase...</p>
      </div>
    );
  }

  // Referral landing page (public, before auth check)
  if (!isAuthenticated && (referralSlug || referralCustomerPhone || affiliateSlug)) {
    return <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-10 h-10 border-4 border-slate-100 border-t-purple-600 rounded-full animate-spin" /></div>}><ReferralLandingPage referralName={referralName} isCustomerReferral={!!referralCustomerPhone} affiliateName={affiliateName} onRegister={handleRegister} /></Suspense>;
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} onRegister={handleRegister} resellerProfile={resellerProfile} />;
  }

  if (role === 'AFFILIATE' && affiliateData) {
    return (
      <ToastContext.Provider value={showToast}>
        <ErrorBoundary>
          <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-900"><div className="w-10 h-10 border-4 border-slate-700 border-t-orange-500 rounded-full animate-spin" /></div>}>
            <ResellerView
              affiliate={affiliateData}
              resellerProfile={resellerProfile}
              onResellerProfileChange={setResellerProfile}
              onImpersonate={handleImpersonate}
              onLogout={handleLogout}
            />
          </Suspense>
        </ErrorBoundary>
        <Toast toasts={toasts} onRemove={removeToast} />
      </ToastContext.Provider>
    );
  }

  if (role === 'PROFESSIONAL') {
    return (
      <ToastContext.Provider value={showToast}>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin" /></div>}>
          <ProfessionalPortal
            tenantId={tenantId}
            tenantName={tenantName}
            professionalId={professionalId}
            professionalName={professionalName}
            onLogout={handleLogout}
            refreshTicker={refreshTicker}
          />
        </Suspense>
        <Toast toasts={toasts} onRemove={removeToast} />
      </ToastContext.Provider>
    );
  }

  const renderView = () => {
    if (role === 'SUPERADMIN') return <SuperAdminView activeTab={superAdminTab} onTabChange={setSuperAdminTab} onImpersonate={handleImpersonate} />;

    switch (currentView) {
      case View.DASHBOARD: return <Dashboard tenantId={tenantId} tenantName={tenantName} onNavigate={setCurrentView} refreshTicker={refreshTicker} />;
      case View.AGENDAMENTOS: return <AppointmentsView tenantId={tenantId} onOpenComandas={() => setCurrentView(View.COMANDAS)} refreshTicker={refreshTicker} />;
      case View.SERVICOS: return <ServicesView tenantId={tenantId} refreshTicker={refreshTicker} />;
      case View.PROFISSIONAIS: return <ProfessionalsView tenantId={tenantId} tenantPlan={effectivePlan} onNavigate={(v) => setCurrentView(v as View)} refreshTicker={refreshTicker} />;
      case View.CLIENTES: return <CustomersView tenantId={tenantId} refreshTicker={refreshTicker} />;
      case View.PERFIL: return <StoreProfile tenantId={tenantId} refreshTicker={refreshTicker} />;
      case View.FINANCEIRO: return <FinancialView tenantId={tenantId} tenantPlan={effectivePlan} refreshTicker={refreshTicker} />;
      case View.CONEXOES: return <ConexoesView tenantId={tenantId} tenantSlug={tenantSlug} tenantPlan={effectivePlan} refreshTicker={refreshTicker} />;
      case View.FOLLOW_UP: return <FollowUpView tenantId={tenantId} tenantPlan={effectivePlan} onUpgrade={(f) => setUpgradeModal({ feature: f })} refreshTicker={refreshTicker} />;
      case View.PLANOS: return <PlansView tenantId={tenantId} refreshTicker={refreshTicker} />;
      case View.TEST_WA: return <AIChatSimulator tenantId={tenantId} />;
      case View.CONVERSAS: return <ConversationsView tenantId={tenantId} onUnreadCount={setUnreadConvCount} />;
      case View.DISPARADOR: return <BroadcastView tenantId={tenantId} refreshTicker={refreshTicker} />;
      case View.ESTOQUE: return <EstoqueView tenantId={tenantId} refreshTicker={refreshTicker} />;
      case View.PRODUTOS: return <ProductsView tenantId={tenantId} refreshTicker={refreshTicker} />;
      case View.ESTOQUE_PRODUTOS: return <EstoqueProdutosView tenantId={tenantId} />;
      case View.COMANDAS: return <ComandasView tenantId={tenantId} initialApptId={initialApptId} onApptOpened={() => setInitialApptId(undefined)} refreshTicker={refreshTicker} />;
      case View.PERFORMANCE: return <PerformanceView tenantId={tenantId} refreshTicker={refreshTicker} />;
      case View.MARKETING: return <MarketingView tenantId={tenantId} refreshTicker={refreshTicker} />;
      case View.NOTAS_FISCAIS: return <NotasFiscaisView tenantId={tenantId} refreshTicker={refreshTicker} />;
      case View.FOLHA_PAGAMENTO: return <FolhaPagamentoView tenantId={tenantId} refreshTicker={refreshTicker} />;
      case View.CONFIGURACOES: return <GeneralSettings tenantId={tenantId} tenantPlan={effectivePlan} refreshTicker={refreshTicker} />;
      case View.OTIMIZACAO: return <OtimizacaoView tenantId={tenantId} tenantName={tenantName} refreshTicker={refreshTicker} />;
      case View.SOCIAL_MIDIA: return <SocialMidiaView tenantId={tenantId} refreshTicker={refreshTicker} />;
      case View.INDICACOES: return <IndicacoesView tenantId={tenantId} refreshTicker={refreshTicker} />;
      case View.ASSINATURAS: return <SubscriptionsView tenantId={tenantId} refreshTicker={refreshTicker} />;
      default: return <Dashboard tenantId={tenantId} />;
    }
  };

  const dbOnline = db.isOnline();

  // Nicho → CSS theme class
  const nichoThemeMap: Record<string, string> = {
    'Manicure/Pedicure': 'theme-manicure',
  };
  const nichoThemeClass = nichoThemeMap[tenantNicho] || '';
  const resellerThemeClass = resellerProfile && (resellerProfile.page_bg_color || resellerProfile.card_bg_color || resellerProfile.text_color) ? 'reseller-theme' : '';
  const themeClass = [nichoThemeClass, resellerThemeClass].filter(Boolean).join(' ');

  // Nicho → ícone dinâmico para Comandas e Serviços
  const nichoIconComponents: Record<string, () => React.JSX.Element> = {
    'scissors': IconScissors,
    'sparkle': IconSparkle,
    'paw': IconPaw,
    'tooth': IconTooth,
    'pen-nib': IconPenNib,
    'hand': IconHand,
    'heartbeat': IconHeartbeat,
  };
  const nichoIconKey = nichoIconMap[tenantNicho as NichoKey] || 'scissors';
  const NichoIcon = nichoIconComponents[nichoIconKey] || IconScissors;

  return (
    // ✅ CORREÇÃO: sem overflow nem transform aqui — deixa fixed dos modais escapar para a viewport
    <ToastContext.Provider value={showToast}>
    <div className={`flex h-screen bg-slate-50/30 ${themeClass}`}>
      <Toast toasts={toasts} onRemove={removeToast} />
      {role === 'TENANT' && !pendingPayment && !resellerProfile && <WhatsNew />}
      {tenantId && role === 'TENANT' && (
        <AiPollingManager
          tenantId={tenantId}
          onStatus={(connected, aiActive, instanceMissing) => setPollingStatus({ connected, aiActive, instanceMissing })}
        />
      )}

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        onMouseEnter={handleSidebarEnter}
        onMouseLeave={handleSidebarLeave}
        className={`agz-sidebar fixed md:relative inset-y-0 left-0 ${effectiveCollapsed ? 'w-[68px]' : 'w-64'} flex flex-col shrink-0 border-r z-[500] h-screen md:sticky md:top-0 transition-all duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
        style={{
          ...(() => { const _isDark = THEMES[colorTheme].isDark; return (_isDark ? (resellerProfile?.dark_bg_color || resellerProfile?.bg_color) : resellerProfile?.bg_color) ? { backgroundColor: _isDark ? (resellerProfile?.dark_bg_color || resellerProfile?.bg_color) : resellerProfile?.bg_color } : {}; })(),
          ...(() => { const _isDark = THEMES[colorTheme].isDark; return (_isDark ? (resellerProfile?.dark_font_color || resellerProfile?.font_color) : resellerProfile?.font_color) ? { color: _isDark ? (resellerProfile?.dark_font_color || resellerProfile?.font_color) : resellerProfile?.font_color } : {}; })(),
        }}
      >
        {/* Logo / toggle */}
        <div className={`flex ${effectiveCollapsed ? 'flex-col items-center py-4 px-2 gap-3' : 'flex-row items-center justify-between px-5 py-5'} transition-all duration-300`}>
          {effectiveCollapsed ? (
            <>
              {resellerProfile
                ? (resellerProfile.logo_url
                    ? <img src={resellerProfile.logo_url} alt="logo" className="w-8 h-8 rounded-lg object-contain" />
                    : resellerProfile.brand_name
                      ? <span className="text-lg font-black text-orange-500 uppercase italic leading-none tracking-tighter">{resellerProfile.brand_name.slice(0, 3)}</span>
                      : null
                  )
                : <span className="text-lg font-black text-orange-500 uppercase italic leading-none tracking-tighter">AGZ</span>
              }
              <button onClick={toggleSidebar} title="Expandir menu" className="text-slate-300 hover:text-orange-500 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/></svg>
              </button>
            </>
          ) : (
            <>
              <div>
                {resellerProfile
                  ? (resellerProfile.logo_url
                      ? <img src={resellerProfile.logo_url} alt={resellerProfile.brand_name || 'Logo'} className="h-8 max-w-[140px] object-contain" />
                      : resellerProfile.brand_name
                        ? <h1 className="text-2xl font-black text-black tracking-tighter uppercase italic">{resellerProfile.brand_name}</h1>
                        : null
                    )
                  : <h1 className="text-2xl font-black text-black tracking-tighter uppercase italic">AgendeZap</h1>
                }
                {role === 'SUPERADMIN' && <span className="bg-orange-500 text-white text-[8px] font-black px-2 py-0.5 rounded-full w-fit tracking-widest uppercase mt-1 block">SUPER ADMIN</span>}
              </div>
              <button onClick={toggleSidebar} title="Minimizar menu" className="text-slate-300 hover:text-slate-600 transition-colors p-1.5 rounded-lg hover:bg-slate-100 shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/></svg>
              </button>
            </>
          )}
        </div>

        <nav className="flex-1 px-2 py-2 space-y-1 overflow-y-auto custom-scrollbar">
          {role === 'SUPERADMIN' ? (
            <>
              <NavItem collapsed={effectiveCollapsed} active={superAdminTab === 'dashboard'} onClick={navTo(() => setSuperAdminTab('dashboard'))} icon={<IconDashboard />} label="Dashboard" />
              <NavItem collapsed={effectiveCollapsed} active={superAdminTab === 'clients'} onClick={navTo(() => setSuperAdminTab('clients'))} icon={<IconUsers />} label="Clientes SaaS" />
              <NavItem collapsed={effectiveCollapsed} active={superAdminTab === 'avisos'} onClick={navTo(() => setSuperAdminTab('avisos'))} icon={<IconBroadcast />} label="Avisos" />
              <NavItem collapsed={effectiveCollapsed} active={superAdminTab === 'cobranca'} onClick={navTo(() => setSuperAdminTab('cobranca'))} icon={<IconFinance />} label="Cobrança" />
              <NavItem collapsed={effectiveCollapsed} active={superAdminTab === 'suporte'} onClick={navTo(() => setSuperAdminTab('suporte'))} icon={<IconChat />} label="Caixa de Entrada" />
              <div className="pt-4 border-t border-slate-100 mt-2 space-y-1">
                {!effectiveCollapsed && <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.2em] px-4 pb-1">WhatsApp Admin</p>}
                <NavItem collapsed={effectiveCollapsed} active={superAdminTab === 'conversas'} onClick={navTo(() => setSuperAdminTab('conversas'))} icon={<IconChat />} label="WA Atendimento" />
                <NavItem collapsed={effectiveCollapsed} active={superAdminTab === 'disparo'} onClick={navTo(() => setSuperAdminTab('disparo'))} icon={<IconBroadcast />} label="Disparador" />
                <NavItem collapsed={effectiveCollapsed} active={superAdminTab === 'campanhas'} onClick={navTo(() => setSuperAdminTab('campanhas'))} icon={<IconBroadcast />} label="Campanhas" />
                <NavItem collapsed={effectiveCollapsed} active={superAdminTab === 'prospeccao'} onClick={navTo(() => setSuperAdminTab('prospeccao'))} icon={<IconUsers />} label="Prospecção" />
              </div>
              <div className="pt-4 border-t border-slate-100 mt-2 space-y-1">
                {!effectiveCollapsed && <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.2em] px-4 pb-1">Central</p>}
                <NavItem collapsed={effectiveCollapsed} active={superAdminTab === 'central'} onClick={navTo(() => setSuperAdminTab('central'))} icon={<IconBroadcast />} label="Central" />
                <NavItem collapsed={effectiveCollapsed} active={superAdminTab === 'wa_central'} onClick={navTo(() => setSuperAdminTab('wa_central'))} icon={<IconChat />} label="WA Central" />
                <NavItem collapsed={effectiveCollapsed} active={superAdminTab === 'leads'} onClick={navTo(() => setSuperAdminTab('leads'))} icon={<IconUsers />} label="Leads" />
                <NavItem collapsed={effectiveCollapsed} active={superAdminTab === 'cashback'} onClick={navTo(() => setSuperAdminTab('cashback'))} icon={<IconFinance />} label="Cashback" />
                <NavItem collapsed={effectiveCollapsed} active={superAdminTab === 'whitelabel'} onClick={navTo(() => setSuperAdminTab('whitelabel'))} icon={<IconSettings />} label="White-label" />
                <NavItem collapsed={effectiveCollapsed} active={superAdminTab === 'site'} onClick={navTo(() => setSuperAdminTab('site'))} icon={<IconMarketing />} label="Site" />
              </div>
              <div className="pt-4 border-t border-slate-100 mt-2 space-y-1">
                {effectiveCollapsed ? (
                  <>
                    <NavItem collapsed={true} active={['logs','sql','ia','config','testes'].includes(superAdminTab)} onClick={() => setSistemaSectionOpen(v => !v)} icon={<IconTerminal />} label="Sistema" />
                    {sistemaSectionOpen && <>
                      <NavItem collapsed={true} active={superAdminTab === 'logs'} onClick={navTo(() => setSuperAdminTab('logs'))} icon={<IconTerminal />} label="Logs" />
                      <NavItem collapsed={true} active={superAdminTab === 'sql'} onClick={navTo(() => setSuperAdminTab('sql'))} icon={<IconSettings />} label="Banco SQL" />
                      <NavItem collapsed={true} active={superAdminTab === 'ia'} onClick={navTo(() => setSuperAdminTab('ia'))} icon={<IconTerminal />} label="IA / Tokens" />
                      <NavItem collapsed={true} active={superAdminTab === 'config'} onClick={navTo(() => setSuperAdminTab('config'))} icon={<IconSettings />} label="Configurações" />
                      <NavItem collapsed={true} active={superAdminTab === 'testes'} onClick={navTo(() => setSuperAdminTab('testes'))} icon={<IconTerminal />} label="Testes" />
                    </>}
                  </>
                ) : (
                  <>
                    <button onClick={() => setSistemaSectionOpen(v => !v)}
                      className="w-full flex items-center px-4 py-2 rounded-xl text-slate-400 hover:bg-slate-100 transition-all">
                      <span className="font-black text-[8px] uppercase tracking-[0.2em] flex-1 text-left">Sistema</span>
                      <span className={`text-[9px] font-black transition-transform duration-200 ${sistemaSectionOpen ? 'rotate-90' : ''}`}>▶</span>
                    </button>
                    {sistemaSectionOpen && (
                      <div className="pl-3 space-y-0.5 border-l-2 border-slate-100 ml-4">
                        <NavItem collapsed={false} active={superAdminTab === 'logs'} onClick={navTo(() => setSuperAdminTab('logs'))} icon={<IconTerminal />} label="Logs" />
                        <NavItem collapsed={false} active={superAdminTab === 'sql'} onClick={navTo(() => setSuperAdminTab('sql'))} icon={<IconSettings />} label="Banco SQL" />
                        <NavItem collapsed={false} active={superAdminTab === 'ia'} onClick={navTo(() => setSuperAdminTab('ia'))} icon={<IconTerminal />} label="IA / Tokens" />
                        <NavItem collapsed={false} active={superAdminTab === 'config'} onClick={navTo(() => setSuperAdminTab('config'))} icon={<IconSettings />} label="Configurações" />
                        <NavItem collapsed={false} active={superAdminTab === 'testes'} onClick={navTo(() => setSuperAdminTab('testes'))} icon={<IconTerminal />} label="Testes" />
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              {/* ── Convidar Parceiro — hidden for reseller clients ── */}
              {!resellerProfile && (
              <button
                onClick={navTo(() => setShowInviteModal(true))}
                className={`w-full flex items-center gap-2 ${effectiveCollapsed ? 'justify-center px-2' : 'px-4'} py-2 rounded-xl bg-white hover:bg-orange-50 border-2 border-orange-400 transition-all group mb-1`}
              >
                <IconGift />
                {!effectiveCollapsed && <span className="font-black text-[9px] uppercase tracking-widest text-orange-500">Convidar Parceiro</span>}
              </button>
              )}
              {/* ── Tutorial: Salvar app ── */}
              <button
                onClick={navTo(() => setShowInstallTutorial(true))}
                className={`w-full flex items-center gap-2 ${effectiveCollapsed ? 'justify-center px-2' : 'px-4'} py-2 rounded-xl bg-white hover:bg-orange-50 border-2 border-orange-400 transition-all group mb-3`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
                {!effectiveCollapsed && <span className="font-black text-[9px] uppercase tracking-widest text-orange-500">Download do App</span>}
              </button>

              {/* ── Operacional ── */}
              <div className="space-y-0.5">
                {!effectiveCollapsed && <p className="text-[8px] font-black text-slate-300 uppercase tracking-[0.2em] px-4 pb-1">Operacional</p>}
                <NavItem collapsed={effectiveCollapsed} active={currentView === View.DASHBOARD} onClick={navTo(() => setCurrentView(View.DASHBOARD))} icon={<IconDashboard />} label="Dashboard" />
                {resellerAllows('agendamentos') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.AGENDAMENTOS} onClick={navTo(() => setCurrentView(View.AGENDAMENTOS))} icon={<IconCalendar />} label="Agenda" />}
                {resellerAllows('comandas') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.COMANDAS} onClick={navTo(() => handleGatedNav(View.COMANDAS, 'caixaAvancado'))} icon={<IconNotebook />} label="Comandas" />}
                {resellerAllows('conversas') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.CONVERSAS} onClick={navTo(() => setCurrentView(View.CONVERSAS))} icon={<IconChat />} label="WhatsApp" badge={unreadConvCount} />}
                {resellerAllows('clientes') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.CLIENTES} onClick={navTo(() => setCurrentView(View.CLIENTES))} icon={<IconUserCircle />} label="Clientes" />}
                <NavItem collapsed={effectiveCollapsed} active={currentView === View.ASSINATURAS} onClick={navTo(() => setCurrentView(View.ASSINATURAS))} icon={<IconCreditCard />} label="Assinaturas" />
              </div>

              {/* ── Operação ── */}
              <div className="pt-3 mt-1 border-t border-slate-100 space-y-0.5">
                {!effectiveCollapsed && <p className="text-[8px] font-black text-slate-300 uppercase tracking-[0.2em] px-4 pb-1">Operação</p>}
                {resellerAllows('socialMidia') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.SOCIAL_MIDIA} onClick={navTo(() => handleGatedNav(View.SOCIAL_MIDIA, 'socialMidia'))} icon={<IconBroadcast />} label="Social Mídia" />}
                {resellerAllows('follow_up') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.FOLLOW_UP} onClick={navTo(() => setCurrentView(View.FOLLOW_UP))} icon={<IconClock />} label="Lembretes" />}
                {resellerAllows('estoque') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.ESTOQUE_PRODUTOS} onClick={navTo(() => handleGatedNav(View.ESTOQUE_PRODUTOS, 'financeiro'))} icon={<IconBox />} label="Estoque" />}
                {!resellerProfile && resellerAllows('planos') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.PLANOS} onClick={navTo(() => setCurrentView(View.PLANOS))} icon={<IconPlans />} label="Planos" />}
                {!resellerProfile && resellerAllows('indicacoes') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.INDICACOES} onClick={navTo(() => setCurrentView(View.INDICACOES))} icon={<IconGift />} label="Indicações" />}
              </div>

              {/* ── Financeiro & Vendas ── */}
              <div className="pt-3 mt-1 border-t border-slate-100 space-y-0.5">
                {!effectiveCollapsed && <p className="text-[8px] font-black text-slate-300 uppercase tracking-[0.2em] px-4 pb-1">💰 Financeiro & Vendas</p>}
                {resellerAllows('financeiro') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.FINANCEIRO} onClick={navTo(() => handleGatedNav(View.FINANCEIRO, 'financeiro'))} icon={<IconFinance />} label="Financeiro" />}
                {resellerAllows('notasFiscais') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.NOTAS_FISCAIS} onClick={navTo(() => handleGatedNav(View.NOTAS_FISCAIS, 'caixaAvancado'))} icon={<IconDoc />} label="Notas Fiscais" />}
                {resellerAllows('folhaPagamento') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.FOLHA_PAGAMENTO} onClick={navTo(() => handleGatedNav(View.FOLHA_PAGAMENTO, 'financeiro'))} icon={<IconWallet />} label="Folha Pgto." />}
                {/* Relatórios — sempre visíveis */}
                {resellerAllows('relatorios') && <>
                  <NavItem collapsed={effectiveCollapsed} active={currentView === View.MARKETING} onClick={navTo(() => handleGatedNav(View.MARKETING, 'relatorios'))} icon={<IconMarketing />} label="Marketing" />
                  <NavItem collapsed={effectiveCollapsed} active={currentView === View.PERFORMANCE} onClick={navTo(() => handleGatedNav(View.PERFORMANCE, 'performance'))} icon={<IconTrophy />} label="Performance" />
                </>}
              </div>

              {/* ── Base ── */}
              <div className="pt-3 mt-1 border-t border-slate-100 space-y-0.5">
                {!effectiveCollapsed && <p className="text-[8px] font-black text-slate-300 uppercase tracking-[0.2em] px-4 pb-1">Base</p>}
                {resellerAllows('servicos') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.SERVICOS} onClick={navTo(() => setCurrentView(View.SERVICOS))} icon={<NichoIcon />} label="Serviços" />}
                {resellerAllows('equipe') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.PROFISSIONAIS} onClick={navTo(() => setCurrentView(View.PROFISSIONAIS))} icon={<IconUsers />} label="Equipe" />}
                {resellerAllows('conexoes') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.CONEXOES} onClick={navTo(() => setCurrentView(View.CONEXOES))} icon={<IconWhatsapp />} label="Conexões" color="text-green-600" />}
                {resellerAllows('configuracoes') && <NavItem collapsed={effectiveCollapsed} active={currentView === View.CONFIGURACOES} onClick={navTo(() => setCurrentView(View.CONFIGURACOES))} icon={<IconSettings />} label="Configurações" />}
              </div>
            </>
          )}
        </nav>

        <div className={`${effectiveCollapsed ? 'px-2 py-4 flex flex-col items-center gap-2' : 'p-6 space-y-2'} border-t border-slate-100 bg-slate-50/50 transition-all duration-300`}>
          {isImpersonating && (
            <button onClick={handleExitImpersonation} className={`flex items-center gap-2 w-full bg-orange-500 text-white ${effectiveCollapsed ? 'justify-center px-2 py-2' : 'px-4 py-2.5'} rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-black transition-all`}>
              <span>↩</span>
              {!effectiveCollapsed && <span>Sair da conta</span>}
            </button>
          )}
          <button onClick={handleLogout} className={`flex items-center ${effectiveCollapsed ? 'justify-center' : 'space-x-3'} w-full text-slate-400 hover:text-red-500 transition-all font-bold text-xs uppercase tracking-widest`}>
            <IconLogout />
            {!effectiveCollapsed && <span>Sair</span>}
          </button>
        </div>
      </aside>

      {/* ✅ CORREÇÃO PRINCIPAL: main sem overflow-auto — o scroll fica no div interno */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="px-4 md:px-6 py-4 flex items-center justify-between shrink-0 bg-slate-50 z-40 border-b border-slate-200 sticky top-0">
          <div className="flex items-center gap-3">
            {/* Hamburger — mobile only */}
            <button
              className="md:hidden flex flex-col gap-1.5 p-2 rounded-xl hover:bg-slate-100 transition-all"
              onClick={() => setSidebarOpen(v => !v)}
              aria-label="Menu"
            >
              <span className="w-5 h-0.5 bg-slate-700 block" />
              <span className="w-5 h-0.5 bg-slate-700 block" />
              <span className="w-5 h-0.5 bg-slate-700 block" />
            </button>
            <div className="w-1 h-6 rounded-full bg-orange-500" />
            <h2 className="text-sm font-black text-slate-700 tracking-widest uppercase">
              {role === 'SUPERADMIN'
                ? ({ dashboard: 'Dashboard Global', clients: 'Clientes SaaS', avisos: 'Enviar Avisos', cobranca: 'Gestão de Cobrança', logs: 'Logs de Atividade', sql: 'Configurar Banco SQL', ia: 'IA / Tokens', conversas: 'WA Atendimento', disparo: 'Disparador Admin', campanhas: 'Campanhas em Andamento', prospeccao: 'Prospecção de Clientes', suporte: 'Caixa de Entrada', config: 'Configurações do Sistema', central: 'Central WhatsApp', wa_central: 'WA Central', leads: 'Leads & Indicações', cashback: 'Cashback', whitelabel: 'Afiliados White-label' } as Record<SuperAdminTab, string>)[superAdminTab]
                : tenantName}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {!dbOnline && (
              <div className="bg-red-50 border border-red-100 px-4 py-2 rounded-xl flex items-center space-x-3">
                <span className="text-[10px] font-black text-red-600 uppercase">Modo Offline</span>
                <button onClick={() => window.location.reload()} className="text-[9px] font-black text-red-500 underline uppercase">Reconectar</button>
              </div>
            )}
            {/* AI / WhatsApp status badge — only for tenant users */}
            {role === 'TENANT' && pollingStatus !== null && (
              <button
                onClick={() => setCurrentView(View.CONEXOES)}
                title={
                  pollingStatus.instanceMissing ? 'Instância Evolution API não encontrada — clique para recriar' :
                  !pollingStatus.connected ? 'WhatsApp desconectado — clique para reconectar' :
                  !pollingStatus.aiActive ? 'WhatsApp conectado · IA desligada — clique para configurar' :
                  'IA Online'
                }
                className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[9px] font-black uppercase tracking-widest transition-all ${
                  pollingStatus.instanceMissing
                    ? 'border-orange-300 bg-orange-50 text-orange-600 hover:bg-orange-100 animate-pulse'
                    : !pollingStatus.connected
                    ? 'border-red-200 bg-red-50 text-red-500 hover:bg-red-100 animate-pulse'
                    : !pollingStatus.aiActive
                    ? 'border-green-200 bg-green-50 text-green-600 hover:bg-green-100'
                    : 'border-green-200 bg-green-50 text-green-600 hover:bg-green-100'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${
                  pollingStatus.instanceMissing ? 'bg-orange-500' :
                  !pollingStatus.connected ? 'bg-red-500' :
                  'bg-green-500'
                }`} />
                {pollingStatus.instanceMissing ? 'sem instância' : !pollingStatus.connected ? 'WA offline' : !pollingStatus.aiActive ? 'WA ok · IA off' : 'IA online'}
              </button>
            )}
            {/* Notificações de chegada — só para tenant */}
            {role === 'TENANT' && (
              <div className="relative" ref={notifPanelRef}>
                <button
                  onClick={() => setShowNotifPanel(v => !v)}
                  title="Notificações de chegada"
                  className="relative w-9 h-9 rounded-xl border border-slate-200 bg-white flex items-center justify-center hover:border-orange-400 hover:bg-orange-50 transition-all"
                >
                  <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {arrivingAppts.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-white text-[9px] font-black rounded-full flex items-center justify-center animate-pulse">
                      {arrivingAppts.length}
                    </span>
                  )}
                </button>
                {showNotifPanel && (
                  <div className="absolute right-0 top-full mt-2 z-50 bg-white border border-slate-200 rounded-2xl shadow-xl w-80">
                    <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Fila de atendimento — hoje</p>
                      <span className="text-[9px] text-slate-400">{arrivingAppts.length} pendente{arrivingAppts.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {arrivingAppts.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-6 font-semibold">Todos os clientes foram atendidos ✓</p>
                      ) : arrivingAppts.map(a => {
                        const start = new Date(a.startTime);
                        const hhmm = `${String(start.getHours()).padStart(2,'0')}:${String(start.getMinutes()).padStart(2,'0')}`;
                        const now = new Date();
                        const isPast = start < now;
                        const isArrived = a.status === AppointmentStatus.ARRIVED;
                        return (
                          <div key={a.id} className={`p-3 border-b border-slate-50 ${isArrived ? 'bg-emerald-50' : ''}`}>
                            <div className="flex items-start gap-2 mb-2">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isArrived ? 'bg-emerald-200' : isPast ? 'bg-red-100' : 'bg-orange-100'}`}>
                                <span className={`text-xs font-black ${isArrived ? 'text-emerald-700' : isPast ? 'text-red-500' : 'text-orange-500'}`}>{((a as any).customerName || '?').charAt(0).toUpperCase()}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-xs font-black text-slate-800 truncate">{(a as any).customerName || 'Cliente'}</p>
                                  {isArrived && <span className="text-[8px] font-black bg-emerald-500 text-white px-1.5 py-0.5 rounded-full uppercase tracking-wide">Chegou!</span>}
                                </div>
                                <p className={`text-[10px] font-bold ${isArrived ? 'text-emerald-600' : isPast ? 'text-red-400' : 'text-slate-400'}`}>{hhmm}{!isArrived && isPast ? ' · atrasado' : ''}</p>
                                {(a as any).professionalName && <p className="text-[10px] text-slate-400">{(a as any).professionalName}</p>}
                              </div>
                            </div>
                            {!isArrived && (
                              <button
                                onClick={async () => {
                                  try {
                                    await db.updateAppointmentStatus(a.id, AppointmentStatus.ARRIVED, {});
                                    setArrivingAppts(prev => prev.map(x => x.id === a.id ? { ...x, status: AppointmentStatus.ARRIVED } : x));
                                  } catch { /* silently */ }
                                }}
                                className="w-full py-1.5 bg-orange-500 text-white text-[9px] font-black rounded-lg uppercase hover:bg-orange-600 transition-all"
                              >
                                ✓ Confirmar chegada
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Theme picker */}
            <div className="relative" ref={themePickerRef}>
              <button
                onClick={() => setShowThemePicker(v => !v)}
                title="Escolher tema de cores"
                className="w-9 h-9 rounded-xl border border-slate-200 bg-white flex items-center justify-center hover:border-slate-400 hover:bg-slate-100 transition-all"
              >
                <span className="w-4 h-4 rounded-full border-2 border-white shadow-md block" style={{ backgroundColor: THEMES[colorTheme].primary }} />
              </button>
              {showThemePicker && (
                <div className="absolute right-0 top-full mt-2 z-50 bg-white border border-slate-200 rounded-2xl shadow-xl p-3 min-w-[160px]">
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Tema de cores</p>
                  <div className="space-y-0.5">
                    {(Object.keys(THEMES) as (keyof typeof THEMES)[]).map(key => (
                      <button
                        key={key}
                        onClick={() => { setColorTheme(key); setShowThemePicker(false); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all ${colorTheme === key ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                      >
                        <span className="w-3.5 h-3.5 rounded-full border border-slate-200 shadow-sm shrink-0" style={{ backgroundColor: THEMES[key].primary }} />
                        <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex-1 text-left">{THEMES[key].label}</span>
                        {colorTheme === key && <span className="text-[9px] text-slate-400">✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* ✅ Scroll acontece aqui, não no main — fixed dos modais escapa para a viewport corretamente */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Trial banner — never shown for reseller clients ──────── */}
          {trialInfo?.active && !trialInfo.isExpired && role === 'TENANT' && !resellerProfile && (
            <div className={`mx-4 md:mx-6 mt-4 px-4 md:px-5 py-3 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 ${
              trialInfo.daysLeft <= 1
                ? 'bg-orange-50 border border-orange-200'
                : 'bg-amber-50 border border-amber-100'
            }`}>
              <div className="flex items-center gap-2.5">
                <span className="text-base">{trialInfo.daysLeft <= 1 ? '⚠️' : '⏱️'}</span>
                <span className={`text-[10px] font-black uppercase tracking-widest ${
                  trialInfo.daysLeft <= 1 ? 'text-orange-700' : 'text-amber-700'
                }`}>
                  {trialInfo.daysLeft === 0
                    ? 'Teste grátis — último dia!'
                    : `Teste grátis — faltam ${trialInfo.daysLeft} dia${trialInfo.daysLeft !== 1 ? 's' : ''}`}
                </span>
              </div>
              <button
                onClick={() => setCurrentView(View.PLANOS)}
                className={`text-[9px] font-black uppercase tracking-widest underline transition-colors ${
                  trialInfo.daysLeft <= 1
                    ? 'text-orange-600 hover:text-orange-800'
                    : 'text-amber-600 hover:text-amber-800'
                }`}
              >
                Ver planos →
              </button>
            </div>
          )}

          {/* ── Main content / Expired overlay ─────────────────────── */}
          <Suspense fallback={<div className="p-20 text-center"><div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto" /></div>}>
            <ErrorBoundary key={currentView}>
              {trialInfo?.isExpired && role === 'TENANT' && !resellerProfile
                ? <TrialExpiredView tenantId={tenantId} onActivated={() => { setTrialInfo(null); window.location.reload(); }} />
                : <div className="p-4 md:p-6">{renderView()}</div>
              }
            </ErrorBoundary>
          </Suspense>
        </div>
      </main>

      {/* Upgrade modal: never shown for reseller clients (reseller controls access via visible_features) */}
      {upgradeModal && !resellerProfile && (
        <PlanUpgradeModal
          feature={upgradeModal.feature}
          tenantPlan={tenantPlan}
          tenantId={tenantId}
          onClose={() => setUpgradeModal(null)}
          onActivated={() => window.location.reload()}
        />
      )}

      {/* ── Payment popup for unpaid tenants (7s delay) — never for reseller clients ──── */}
      {pendingPayment && role === 'TENANT' && tenantId && !isImpersonating && !resellerProfile && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="rounded-[32px] shadow-2xl w-full max-w-4xl max-h-[95vh] overflow-y-auto relative animate-toastIn" style={{ background: '#ffffff' }}>
            <div className="p-4 md:p-8">
              <Suspense fallback={<div className="p-20 text-center"><div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto" /></div>}>
                <TrialExpiredView
                  tenantId={tenantId}
                  mode="pending_payment"
                  onActivated={() => {
                    setPendingPayment(false);
                    setShowWelcome(true);
                  }}
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}

      {/* ── Welcome popup after first payment ──── */}
      {showWelcome && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="rounded-[32px] shadow-2xl w-full max-w-md animate-toastIn" style={{ background: '#ffffff' }}>
            <div className="p-8 sm:p-10 text-center space-y-6">
              <div className="w-20 h-20 bg-green-100 rounded-[24px] flex items-center justify-center mx-auto text-4xl">
                🎉
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-black uppercase tracking-tight" style={{ color: '#000' }}>
                  Bem-vindo ao AgendeZap!
                </h2>
                <p className="text-sm font-bold" style={{ color: '#64748b' }}>
                  Pagamento confirmado com sucesso. Sua conta esta ativa e pronta para uso!
                </p>
              </div>
              <div className="rounded-2xl p-5 space-y-3 text-left" style={{ background: '#fff7ed', border: '2px solid #fed7aa' }}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0 text-lg" style={{ color: '#fff' }}>
                    💬
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide" style={{ color: '#000' }}>Precisa de ajuda?</p>
                    <p className="text-xs font-bold mt-1" style={{ color: '#64748b' }}>
                      O botao laranja flutuante no canto inferior direito e nosso chat direto ao suporte. Estamos disponiveis de <strong style={{ color: '#000' }}>segunda a sabado, das 8h as 20h</strong>.
                    </p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowWelcome(false);
                  localStorage.setItem('agz_whats_new_seen_v5', '1');
                  window.location.reload();
                }}
                className="w-full py-5 rounded-2xl font-black text-sm uppercase tracking-widest transition-all hover:opacity-90"
                style={{ background: '#f97316', color: '#fff' }}
              >
                Comecar a usar!
              </button>
              <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#cbd5e1' }}>
                Obrigado por escolher o AgendeZap
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Install Tutorial Modal ──── */}
      {showInstallTutorial && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowInstallTutorial(false)}>
          <div className="rounded-[32px] shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-toastIn" style={{ background: '#ffffff' }} onClick={e => e.stopPropagation()}>
            <div className="p-6 sm:p-8 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-2xl">📱</div>
                  <div>
                    <h2 className="text-lg font-black uppercase tracking-tight" style={{ color: '#000' }}>Download do App</h2>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#94a3b8' }}>Instale como aplicativo</p>
                  </div>
                </div>
                <button onClick={() => setShowInstallTutorial(false)} className="text-slate-300 hover:text-slate-600 text-xl font-black transition-colors">✕</button>
              </div>

              <p className="text-xs font-bold" style={{ color: '#64748b' }}>
                O AgendeZap funciona como um app nativo no seu celular! Siga as instrucoes abaixo para o seu navegador:
              </p>

              {/* Safari iOS */}
              <div className="rounded-2xl p-5 space-y-3" style={{ background: '#f0f9ff', border: '2px solid #bae6fd' }}>
                <div className="flex items-center gap-2">
                  <span className="text-lg">🍎</span>
                  <p className="text-xs font-black uppercase tracking-wide" style={{ color: '#0369a1' }}>Safari (iPhone / iPad)</p>
                </div>
                <ol className="text-xs font-bold space-y-2 ml-7 list-decimal" style={{ color: '#475569' }}>
                  <li>Abra <strong>agendezap.com</strong> no Safari</li>
                  <li>Toque no botao de <strong>compartilhar</strong> (quadrado com seta para cima)</li>
                  <li>Role para baixo e toque em <strong>"Adicionar a Tela de Inicio"</strong></li>
                  <li>Toque em <strong>"Adicionar"</strong> para confirmar</li>
                </ol>
              </div>

              {/* Chrome Android */}
              <div className="rounded-2xl p-5 space-y-3" style={{ background: '#f0fdf4', border: '2px solid #bbf7d0' }}>
                <div className="flex items-center gap-2">
                  <span className="text-lg">🤖</span>
                  <p className="text-xs font-black uppercase tracking-wide" style={{ color: '#15803d' }}>Chrome (Android)</p>
                </div>
                <ol className="text-xs font-bold space-y-2 ml-7 list-decimal" style={{ color: '#475569' }}>
                  <li>Abra <strong>agendezap.com</strong> no Chrome</li>
                  <li>Toque nos <strong>3 pontinhos</strong> (canto superior direito)</li>
                  <li>Toque em <strong>"Adicionar a tela inicial"</strong></li>
                  <li>Toque em <strong>"Adicionar"</strong> para confirmar</li>
                </ol>
              </div>

              {/* Chrome iOS */}
              <div className="rounded-2xl p-5 space-y-3" style={{ background: '#fffbeb', border: '2px solid #fde68a' }}>
                <div className="flex items-center gap-2">
                  <span className="text-lg">🌐</span>
                  <p className="text-xs font-black uppercase tracking-wide" style={{ color: '#a16207' }}>Chrome (iPhone / iPad)</p>
                </div>
                <ol className="text-xs font-bold space-y-2 ml-7 list-decimal" style={{ color: '#475569' }}>
                  <li>Abra <strong>agendezap.com</strong> no Chrome</li>
                  <li>Toque no botao de <strong>compartilhar</strong> (icone de compartilhar)</li>
                  <li>Toque em <strong>"Adicionar a Tela de Inicio"</strong></li>
                  <li>Se nao aparecer, abra no <strong>Safari</strong> e siga o tutorial acima</li>
                </ol>
              </div>

              <div className="rounded-2xl p-4 text-center" style={{ background: '#f8fafc' }}>
                <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#94a3b8' }}>
                  Apos instalar, o AgendeZap abrira como um app independente sem barra do navegador!
                </p>
              </div>

              <button
                onClick={() => setShowInstallTutorial(false)}
                className="w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all hover:opacity-90"
                style={{ background: '#000', color: '#fff' }}
              >
                Entendi!
              </button>
            </div>
          </div>
        </div>
      )}

      {showInviteModal && (
        <InvitePartnerModal
          tenantId={tenantId}
          tenantName={tenantName}
          onClose={() => { setShowInviteModal(false); setInviteResult(null); }}
          result={inviteResult}
          onResult={setInviteResult}
        />
      )}

      {isAuthenticated && role === 'TENANT' && tenantId && (
        <>
          {/* Floating Tutorials button + shortcut hints */}
          <div className="fixed bottom-24 right-6 z-50">
            {/* Tooltip only shows on button hover via group placed on the button */}
            <div className="group/tut relative">
              <button
                onClick={() => setShowTutorials(true)}
                title="Tutoriais"
                className="w-14 h-14 bg-slate-800 rounded-full shadow-xl flex items-center justify-center hover:scale-105 hover:shadow-2xl transition-all cursor-pointer"
              >
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </button>
              {/* Shortcut tooltip — only appears when hovering the button itself, desktop only */}
              <div className="hidden md:block absolute bottom-full right-0 mb-2 pointer-events-none opacity-0 group-hover/tut:opacity-100 transition-opacity duration-150 delay-300">
                <div className="bg-slate-900 text-white rounded-2xl shadow-2xl p-3 w-48">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Atalhos de Teclado</p>
                  <div className="space-y-1.5">
                    {[
                      { key: 'D', label: 'Dashboard' },
                      { key: 'A', label: 'Agenda' },
                      { key: 'C', label: 'Clientes' },
                      { key: 'F', label: 'Financeiro' },
                      { key: 'M', label: 'Marketing' },
                      { key: 'E', label: 'Equipe' },
                    ].map(s => (
                      <div key={s.key} className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-300">{s.label}</span>
                        <kbd className="inline-flex items-center justify-center px-1.5 h-5 bg-slate-700 rounded text-[10px] font-black text-slate-200 tracking-tight">Alt+{s.key}</kbd>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <TutorialsPanel open={showTutorials} onClose={() => setShowTutorials(false)} />
          {!resellerProfile && <SupportChat tenantId={tenantId} tenantName={tenantName} />}
        </>
      )}

      {/* ── One-time update notice ───────────────────────── */}
      {showUpdateNotice && role === 'TENANT' && isAuthenticated && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4" onClick={() => { localStorage.setItem(UPDATE_KEY, '1'); setShowUpdateNotice(false); }}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-7 space-y-5 animate-toastIn" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <span className="text-3xl">🚀</span>
              <div>
                <p className="font-black text-base text-black">Novidades do AgendeZap</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Atualização de hoje</p>
              </div>
            </div>
            <ul className="space-y-3 text-sm text-slate-700">
              <li className="flex gap-2"><span>👍</span><span>O agente agora reconhece <strong>joinha</strong> como confirmação de agendamento</span></li>
              <li className="flex gap-2"><span>🕐</span><span>O agente sabe a <strong>hora atual</strong> — não oferece mais manhã se já passou do meio-dia</span></li>
              <li className="flex gap-2"><span>📋</span><span>Confirmação de agendamento agora mostra <strong>serviço + profissional + data + horário</strong></span></li>
              <li className="flex gap-2"><span>🔕</span><span>Corrigido: follow-up não enviava mais a <strong>mesma mensagem duas vezes</strong></span></li>
              <li className="flex gap-2"><span>📸</span><span>Novo: poste <strong>stories de 24h</strong> no AZ Marketplace pelo seu perfil</span></li>
            </ul>
            <button
              onClick={() => { localStorage.setItem(UPDATE_KEY, '1'); setShowUpdateNotice(false); }}
              className="w-full py-3 bg-black text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-orange-500 transition-all"
            >
              Entendido! ✓
            </button>
          </div>
        </div>
      )}

      {/* ── Appointment arrival alert ────────────────────── */}
      {apptAlert && (
        <div className="fixed bottom-6 right-6 z-[9997] w-80 bg-white dark:bg-[#132040] rounded-2xl shadow-2xl border border-slate-100 dark:border-[#1e3a5f] p-5 animate-toastIn">
          <div className="flex items-start gap-3 mb-3">
            <span className="text-2xl">⏰</span>
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm text-black dark:text-white">Horário do atendimento!</p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">{apptAlert.clientName} · {apptAlert.service}</p>
              {apptAlert.profName && <p className="text-[10px] text-orange-500 font-bold mt-0.5">{apptAlert.profName} · {apptAlert.time}</p>}
            </div>
            <button onClick={() => setApptAlert(null)} className="text-slate-300 hover:text-slate-500 font-black text-sm leading-none">✕</button>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">O cliente chegou? Deseja abrir a comanda?</p>
          <div className="flex gap-2">
            <button
              onClick={handleClientArrived}
              className="flex-1 py-2.5 bg-orange-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-600 transition-all"
            >
              Cliente Chegou!
            </button>
            <button
              onClick={() => setApptAlert(null)}
              className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
    </ToastContext.Provider>
  );
};

// ─── Invite Partner Modal ──────────────────────────────────────────────────
const InvitePartnerModal: React.FC<{
  tenantId: string;
  tenantName: string;
  onClose: () => void;
  result: { email: string; password: string; phone: string } | null;
  onResult: (r: { email: string; password: string; phone: string }) => void;
}> = ({ tenantId, tenantName, onClose, result, onResult }) => {
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState('');
  const [waSending, setWaSending] = React.useState(false);
  const [waSent, setWaSent] = React.useState(false);
  const [waError, setWaError] = React.useState('');

  const handleSend = async () => {
    if (!name.trim() || !phone.trim()) { setError('Preencha nome e WhatsApp.'); return; }
    setSending(true);
    setError('');
    try {
      const creds = await (db as any).createInvitedDemo(tenantId, tenantName, name.trim(), phone.trim());
      onResult({ ...creds, phone: phone.trim() });
    } catch (e: any) {
      setError('Erro ao criar convite: ' + (e.message || 'tente novamente.'));
    } finally {
      setSending(false);
    }
  };

  const handleWhatsAppSend = async () => {
    if (!result) return;
    setWaSending(true);
    setWaError('');
    try {
      // Get the connected WhatsApp instance name from settings
      const settings = await db.getSettings(tenantId);
      const instanceName = settings.whatsapp;
      if (!instanceName) {
        setWaError('WhatsApp não conectado. Configure a integração em Configurações → WhatsApp.');
        return;
      }

      const cleanPhone = result.phone.replace(/\D/g, '');
      const message =
        `Olá ${name.trim()}! 🎉\n\n` +
        `Você foi convidado(a) para testar o *AgendeZap* gratuitamente por 7 dias!\n\n` +
        `Acesse: https://www.agendezap.com\n` +
        `Login: ${result.email}\nSenha: ${result.password}\n\n` +
        `Qualquer dúvida, é só chamar! 😊`;

      const sent = await evolutionService.sendToWhatsApp(instanceName, cleanPhone, message);
      if (!sent.success) {
        setWaError('Falha ao enviar: ' + (sent.error || 'verifique a conexão do WhatsApp.'));
        return;
      }

      // Save contact as customer (ignore if already exists)
      try {
        await db.addCustomer({ tenant_id: tenantId, name: name.trim(), phone: cleanPhone });
      } catch { /* already registered — no action needed */ }

      setWaSent(true);
    } catch (e: any) {
      setWaError('Erro: ' + (e.message || 'tente novamente.'));
    } finally {
      setWaSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-md p-10 space-y-6 animate-scaleUp">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black text-black uppercase tracking-tight">Convidar Parceiro</h2>
            <p className="text-xs text-slate-400 mt-0.5">Gera acesso demo de 7 dias + notifica o suporte</p>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-black text-2xl font-black transition-all">✕</button>
        </div>

        {!result ? (
          <>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Nome do Estabelecimento</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Ex: Barbearia do João"
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500 transition-all"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">WhatsApp (com DDD)</label>
                <input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="5511999999999"
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500 transition-all"
                />
              </div>
              {error && <p className="text-xs font-bold text-red-500">{error}</p>}
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={onClose} className="flex-1 py-3.5 font-black text-slate-400 text-xs uppercase tracking-widest">Cancelar</button>
              <button
                onClick={handleSend}
                disabled={sending}
                className="flex-1 py-3.5 bg-orange-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all disabled:opacity-50"
              >
                {sending ? 'Gerando...' : 'Enviar Convite'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="bg-green-50 border border-green-200 rounded-2xl p-5 space-y-3">
              <p className="text-xs font-black text-green-700 uppercase tracking-widest">Convite gerado com sucesso!</p>
              <div className="space-y-1.5 text-sm">
                <p><span className="font-black text-slate-500">Login:</span> <span className="font-bold text-black">{result.email}</span></p>
                <p><span className="font-black text-slate-500">Senha:</span> <span className="font-bold text-black">{result.password}</span></p>
                <p className="text-[10px] text-slate-400 pt-1">Acesso gratuito por 7 dias · Registrado na caixa de suporte</p>
              </div>
            </div>

            {waSent ? (
              <div className="flex items-center justify-center gap-2 w-full py-3.5 bg-green-100 text-green-700 rounded-2xl font-black text-xs uppercase tracking-widest">
                ✅ Mensagem enviada pelo WhatsApp!
              </div>
            ) : (
              <button
                onClick={handleWhatsAppSend}
                disabled={waSending}
                className="flex items-center justify-center gap-2 w-full py-3.5 bg-green-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-green-600 transition-all disabled:opacity-60"
              >
                <IconWhatsapp2 /> {waSending ? 'Enviando...' : 'Enviar pelo WhatsApp'}
              </button>
            )}
            {waError && <p className="text-xs font-bold text-red-500 text-center">{waError}</p>}

            <button onClick={onClose} className="w-full py-3 font-black text-slate-400 text-xs uppercase tracking-widest hover:text-black transition-all">Fechar</button>
          </>
        )}
      </div>
    </div>
  );
};

const NavItem = ({ active, onClick, icon, label, color, collapsed, badge }: any) => (
  <div className="relative group/ni">
    <button
      onClick={onClick}
      style={active ? { backgroundColor: 'var(--color-primary)', boxShadow: '0 4px 12px var(--accent-glow-strong)' } : undefined}
      className={`w-full flex items-center ${collapsed ? 'justify-center py-3 px-0' : 'px-4 py-3'} rounded-xl transition-all group ${
        active ? 'text-white shadow-none' : `text-slate-500 hover:bg-slate-100 ${color || ''}`
      }`}
    >
      <span className={`text-xl ${collapsed ? '' : 'mr-3'} ${active ? 'text-white' : 'group-hover:text-black'}`} style={!active ? { color: 'var(--reseller-icon-color, #94a3b8)' } : undefined}>{icon}</span>
      {!collapsed && <span className={`font-black text-[10px] uppercase tracking-widest ${active ? 'text-white' : ''}`}>{label}</span>}
      {!collapsed && badge > 0 && (
        <span className="ml-auto bg-orange-500 text-white text-[9px] font-black rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
    {collapsed && badge > 0 && (
      <span className="absolute top-0.5 right-0.5 bg-orange-500 text-white text-[8px] font-black rounded-full w-4 h-4 flex items-center justify-center z-10 pointer-events-none">
        {badge > 9 ? '9+' : badge}
      </span>
    )}
    {collapsed && (
      <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-3 py-1.5 bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest rounded-lg opacity-0 group-hover/ni:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-nowrap z-[100] shadow-xl">
        <div className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-gray-900" />
        {label}
      </div>
    )}
  </div>
);

const IconDashboard = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>;
const IconCalendar = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>;
const IconScissors = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>;
const IconUsers = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>;
const IconUserCircle = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="10" r="3"></circle><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"></path></svg>;
const IconFinance = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>;
const IconBox = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>;
const IconWhatsapp = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 1 1-7.6-11.7 8.38 8.38 0 0 1 3.8.9L21 3z"></path></svg>;
const IconClock = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>;
const IconSettings = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1-2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>;
const IconTerminal = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>;
const IconLogout = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>;
const IconPlans = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>;
const IconChat = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>;
const IconCreditCard = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>;
const IconNotebook = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><line x1="9" y1="8" x2="16" y2="8"/><line x1="9" y1="12" x2="16" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>;
const IconBroadcast = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>;
const IconTrophy = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>;
const IconMarketing = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>;
const IconShoppingBag = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>;
const IconGift = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>;
const IconWhatsapp2 = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 1 1-7.6-11.7 8.38 8.38 0 0 1 3.8.9L21 3z"/></svg>;
const IconCamera = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>;
const IconGlobe = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;
const IconDoc = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>;
const IconWallet = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4z"/></svg>;

// ── Ícones por nicho ──────────────────────────────────────────────────────────
const IconPaw = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="8" cy="6" rx="2" ry="2.5"/><ellipse cx="16" cy="6" rx="2" ry="2.5"/><ellipse cx="5" cy="11" rx="2" ry="2.5"/><ellipse cx="19" cy="11" rx="2" ry="2.5"/><path d="M12 17c-2.5 0-4.5-1.5-5-3.5-.3-1.2.5-2.5 1.8-2.5h6.4c1.3 0 2.1 1.3 1.8 2.5-.5 2-2.5 3.5-5 3.5z"/></svg>;
const IconTooth = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C9.5 2 7 3.5 7 6c0 2 .5 4-1 8-.5 1.5 0 3 1 4s2.5 1 3.5 0c.7-.7 1-1.5 1.5-1.5s.8.8 1.5 1.5c1 1 2.5 1 3.5 0s1.5-2.5 1-4c-1.5-4-1-6-1-8 0-2.5-2.5-4-5-4z"/></svg>;
const IconPenNib = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>;
const IconSparkle = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z"/></svg>;
const IconHand = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v1"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>;
const IconHeartbeat = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/><path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0L12 5.36l-.77-.78a5.4 5.4 0 0 0-7.65 0 5.4 5.4 0 0 0 0 7.65L12 20.65l8.42-8.42a5.4 5.4 0 0 0 0-7.65z" opacity="0.3"/></svg>;

export default App;