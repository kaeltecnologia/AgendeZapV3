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
const CustomerDashboard = lazy(() => import('./components/CustomerDashboard'));
import { db } from './services/mockDb';
import { supabase } from './services/supabase';
import { evolutionService } from './services/evolutionService';
import { TenantStatus, AppointmentStatus } from './types';
import { sendClientArrivedNotification } from './services/notificationService';
import PlanGate from './components/PlanGate';
import PlanUpgradeModal from './components/PlanUpgradeModal';
import { hasFeature, FeatureKey } from './config/planConfig';
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
}

type Role = 'TENANT' | 'SUPERADMIN';
type SuperAdminTab = 'dashboard' | 'clients' | 'avisos' | 'cobranca' | 'logs' | 'sql' | 'ia' | 'conversas' | 'disparo' | 'prospeccao' | 'suporte' | 'campanhas' | 'config' | 'central' | 'leads' | 'cashback' | 'wa_central' | 'testes';

const SESSION_KEY = 'agz_session';

// Simple session fingerprint to detect tampering (not crypto-grade, but prevents casual edits)
function sessionFingerprint(data: Record<string, any>): string {
  const raw = JSON.stringify(data) + '|agz_2026';
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

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
  const [currentView, setCurrentView] = useState<View>(View.DASHBOARD);
  const [tenantId, setTenantId] = useState<string>('');
  const [tenantSlug, setTenantSlug] = useState<string>('');
  const [tenantName, setTenantName] = useState<string>('Carregando...');
  const [isReady, setIsReady] = useState(false);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [superAdminTab, setSuperAdminTab] = useState<SuperAdminTab>('dashboard');
  const [tenantPlan, setTenantPlan] = useState<string>('START');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('agz_dark') !== '0');
  const [upgradeModal, setUpgradeModal] = useState<{ feature: FeatureKey } | null>(null);
  const UPDATE_KEY = 'agz_update_seen_v3';
  const [showUpdateNotice, setShowUpdateNotice] = useState(() => !localStorage.getItem('agz_update_seen_v3'));
  const [unreadConvCount, setUnreadConvCount] = useState(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [showTutorials, setShowTutorials] = useState(false);
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
    const t = setInterval(check, 60000);
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

  const handleSidebarEnter = () => {
    if (collapseTimerRef.current) { clearTimeout(collapseTimerRef.current); collapseTimerRef.current = null; }
    if (sidebarCollapsed) {
      expandTimerRef.current = setTimeout(() => { setSidebarCollapsed(false); setSidebarAutoExpanded(true); }, 1000);
    }
  };
  const handleSidebarLeave = () => {
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
  const [relatoriosOpen, setRelatoriosOpen] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ email: string; password: string; phone: string } | null>(null);
  const [pollingStatus, setPollingStatus] = useState<{ connected: boolean; aiActive: boolean } | null>(null);
  const [trialInfo, setTrialInfo] = useState<{ daysLeft: number; isExpired: boolean; active: boolean } | null>(null);
  const [pendingPayment, setPendingPayment] = useState(false);
  const [showPaymentPopup, setShowPaymentPopup] = useState(false);

  // Persist session whenever auth/nav state changes
  useEffect(() => {
    if (isAuthenticated) {
      const payload = {
        isAuthenticated, role, tenantId, tenantSlug, tenantName,
        tenantPlan, isImpersonating, currentView, superAdminTab,
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify({ ...payload, _fp: sessionFingerprint(payload) }));
    }
  }, [isAuthenticated, role, tenantId, tenantSlug, tenantName, tenantPlan, isImpersonating, currentView, superAdminTab]);

  // Close sidebar on mobile after any nav action
  const navTo = (fn: () => void) => () => { fn(); setSidebarOpen(false); };

  // Auto-expand Relatórios submenu when on Marketing or Performance
  useEffect(() => {
    if (currentView === View.MARKETING || currentView === View.PERFORMANCE) {
      setRelatoriosOpen(true);
    }
  }, [currentView]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('agz_dark', '1');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('agz_dark', '0');
    }
  }, [darkMode]);

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
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [tenantId, role]);

  // ── Pending payment check — detects unpaid tenants ──────────────────
  useEffect(() => {
    if (!tenantId || !isAuthenticated || role !== 'TENANT') return;
    const checkPayment = async () => {
      try {
        const tenant = await db.getTenant(tenantId);
        setPendingPayment(tenant?.status === TenantStatus.PENDING_PAYMENT);
      } catch { /* ignore */ }
    };
    checkPayment();
  }, [tenantId, isAuthenticated, role]);

  // ── Payment popup timer — shows after 7s for unpaid tenants ─────────
  useEffect(() => {
    if (!pendingPayment || role !== 'TENANT' || !tenantId || isImpersonating) {
      setShowPaymentPopup(false);
      return;
    }
    const timer = setTimeout(() => setShowPaymentPopup(true), 7000);
    return () => clearTimeout(timer);
  }, [pendingPayment, role, tenantId, isImpersonating]);

  useEffect(() => {
    const init = async () => {
      // Restore saved session before checking DB
      try {
        const saved = localStorage.getItem(SESSION_KEY);
        if (saved) {
          const s = JSON.parse(saved);
          // Verify session integrity — reject tampered data
          const { _fp, ...payload } = s;
          if (_fp && _fp !== sessionFingerprint(payload)) {
            localStorage.removeItem(SESSION_KEY);
          } else if (s.isAuthenticated) {
            setIsAuthenticated(true);
            setRole(s.role || 'TENANT');
            setTenantId(s.tenantId || '');
            setTenantSlug(s.tenantSlug || '');
            setTenantName(s.tenantName || '');
            setTenantPlan(s.tenantPlan || 'START');
            setIsImpersonating(s.isImpersonating || false);
            setCurrentView(s.currentView || View.DASHBOARD);
            setSuperAdminTab(s.superAdminTab || 'dashboard');
          }
        }
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }

      try {
        await db.checkConnection();
      } catch (err) {
        console.warn("Utilizando Local Storage como fallback.");
      } finally {
        setIsReady(true);
      }
    };
    init();
  }, []);

  const handleLogin = async (selectedRole: Role, userSlug?: string, userEmail?: string, userPassword?: string) => {
    try {
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
            // Check if tenant still needs to pay
            const loginTenant = await db.getTenant(data.id);
            if (loginTenant?.status === TenantStatus.PENDING_PAYMENT) {
              setPendingPayment(true);
            }
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
        setRole('TENANT');
        setIsAuthenticated(true);
        if (myTenant.status === TenantStatus.PENDING_PAYMENT) {
          setPendingPayment(true);
        }
        setCurrentView(View.DASHBOARD);
      }
    } catch (err) {
      console.error("Login Error:", err);
      alert("Falha crítica na conexão com o Supabase.");
    }
  };

  const handleRegister = async (storeName: string, email: string, pass: string, phone: string) => {
    try {
      const slug = email.split('@')[0].toLowerCase().trim();
      const tenants = await db.getAllTenants();
      const exists = tenants.find(t => t.slug === slug);

      if (exists) {
        throw new Error("Este e-mail/slug já está cadastrado.");
      }

      const newTenant = await db.addTenant({
        name: storeName,
        slug: slug,
        email: email,
        password: pass,
        phone: phone,
        plan: 'START',
        status: TenantStatus.PENDING_PAYMENT,
        monthlyFee: 0
      });

      if (newTenant) {
        await db.updateSettings(newTenant.id, {
          themeColor: '#f97316',
          aiActive: false,
        });

        setTenantId(newTenant.id);
        setTenantSlug(newTenant.slug);
        setTenantName(newTenant.name);
        setTenantPlan(newTenant.plan || 'START');
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
    setIsAuthenticated(false);
    setRole('TENANT');
    setTenantId('');
    setTenantSlug('');
    setIsImpersonating(false);
    setPendingPayment(false);
    setCurrentView(View.DASHBOARD);
  };

  const handleImpersonate = (id: string, name: string, slug: string, plan?: string) => {
    setTenantId(id);
    setTenantSlug(slug);
    setTenantName(name);
    setTenantPlan(plan || 'START');
    setRole('TENANT');
    setIsImpersonating(true);
    setCurrentView(View.DASHBOARD);
  };

  const handleGatedNav = (view: View, feature: FeatureKey) => {
    if (!hasFeature(tenantPlan, feature)) {
      setUpgradeModal({ feature });
    } else {
      setCurrentView(view);
    }
  };

  const handleExitImpersonation = () => {
    setRole('SUPERADMIN');
    setIsImpersonating(false);
    setTenantId('');
    setTenantSlug('');
    setCurrentView(View.SUPERADMIN_DASHBOARD);
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

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} onRegister={handleRegister} />;
  }

  const renderView = () => {
    if (role === 'SUPERADMIN') return <SuperAdminView activeTab={superAdminTab} onTabChange={setSuperAdminTab} onImpersonate={handleImpersonate} />;

    switch (currentView) {
      case View.DASHBOARD: return <Dashboard tenantId={tenantId} tenantName={tenantName} onNavigate={setCurrentView} />;
      case View.AGENDAMENTOS: return <AppointmentsView tenantId={tenantId} onOpenComandas={() => setCurrentView(View.COMANDAS)} />;
      case View.SERVICOS: return <ServicesView tenantId={tenantId} />;
      case View.PROFISSIONAIS: return <ProfessionalsView tenantId={tenantId} />;
      case View.CLIENTES: return <CustomersView tenantId={tenantId} />;
      case View.PERFIL: return <StoreProfile tenantId={tenantId} />;
      case View.FINANCEIRO: return (
        <PlanGate feature="financeiro" tenantPlan={tenantPlan}>
          <FinancialView tenantId={tenantId} tenantPlan={tenantPlan} />
        </PlanGate>
      );
      case View.CONEXOES: return <ConexoesView tenantId={tenantId} tenantSlug={tenantSlug} tenantPlan={tenantPlan} />;
      case View.FOLLOW_UP: return <FollowUpView tenantId={tenantId} tenantPlan={tenantPlan} />;
      case View.PLANOS: return <PlansView tenantId={tenantId} />;
      case View.TEST_WA: return (
        <PlanGate feature="assistenteAdmin" tenantPlan={tenantPlan}>
          <AIChatSimulator tenantId={tenantId} />
        </PlanGate>
      );
      case View.CONVERSAS: return <ConversationsView tenantId={tenantId} onUnreadCount={setUnreadConvCount} />;
      case View.DISPARADOR: return (
        <PlanGate feature="disparo" tenantPlan={tenantPlan}>
          <BroadcastView tenantId={tenantId} />
        </PlanGate>
      );
      case View.ESTOQUE: return (
        <PlanGate feature="financeiro" tenantPlan={tenantPlan}>
          <EstoqueView tenantId={tenantId} />
        </PlanGate>
      );
      case View.PRODUTOS: return <ProductsView tenantId={tenantId} />;
      case View.ESTOQUE_PRODUTOS: return (
        <PlanGate feature="financeiro" tenantPlan={tenantPlan}>
          <EstoqueProdutosView tenantId={tenantId} />
        </PlanGate>
      );
      case View.COMANDAS: return (
        <PlanGate feature="caixaAvancado" tenantPlan={tenantPlan}>
          <ComandasView tenantId={tenantId} initialApptId={initialApptId} onApptOpened={() => setInitialApptId(undefined)} />
        </PlanGate>
      );
      case View.PERFORMANCE: return (
        <PlanGate feature="performance" tenantPlan={tenantPlan}>
          <PerformanceView tenantId={tenantId} />
        </PlanGate>
      );
      case View.MARKETING: return (
        <PlanGate feature="relatorios" tenantPlan={tenantPlan}>
          <MarketingView tenantId={tenantId} />
        </PlanGate>
      );
      case View.NOTAS_FISCAIS: return (
        <PlanGate feature="financeiro" tenantPlan={tenantPlan}>
          <NotasFiscaisView tenantId={tenantId} />
        </PlanGate>
      );
      case View.FOLHA_PAGAMENTO: return (
        <PlanGate feature="financeiro" tenantPlan={tenantPlan}>
          <FolhaPagamentoView tenantId={tenantId} />
        </PlanGate>
      );
      case View.CONFIGURACOES: return <GeneralSettings tenantId={tenantId} />;
      case View.OTIMIZACAO: return <OtimizacaoView tenantId={tenantId} tenantName={tenantName} />;
      case View.MARKETPLACE: return <MarketplacePreview tenantId={tenantId} />;
      case View.SOCIAL_MIDIA: return <PlanGate feature="socialMidia" tenantPlan={tenantPlan}><SocialMidiaView tenantId={tenantId} /></PlanGate>;
      default: return <Dashboard tenantId={tenantId} />;
    }
  };

  const dbOnline = db.isOnline();

  return (
    // ✅ CORREÇÃO: sem overflow nem transform aqui — deixa fixed dos modais escapar para a viewport
    <ToastContext.Provider value={showToast}>
    <div className="flex h-screen bg-slate-50/30">
      <Toast toasts={toasts} onRemove={removeToast} />
      {role === 'TENANT' && <WhatsNew />}
      {tenantId && hasFeature(tenantPlan, 'agenteIA') && (
        <AiPollingManager
          tenantId={tenantId}
          onStatus={(connected, aiActive) => setPollingStatus({ connected, aiActive })}
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
        className={`agz-sidebar fixed md:relative inset-y-0 left-0 ${sidebarCollapsed ? 'w-[68px]' : 'w-64'} flex flex-col shrink-0 border-r z-[500] h-screen md:sticky md:top-0 transition-all duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        {/* Logo / toggle */}
        <div className={`flex ${sidebarCollapsed ? 'flex-col items-center py-4 px-2 gap-3' : 'flex-row items-center justify-between px-5 py-5'} transition-all duration-300`}>
          {sidebarCollapsed ? (
            <>
              <span className="text-lg font-black text-orange-500 uppercase italic leading-none tracking-tighter">AGZ</span>
              <button onClick={toggleSidebar} title="Expandir menu" className="text-slate-300 hover:text-orange-500 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/></svg>
              </button>
            </>
          ) : (
            <>
              <div>
                <h1 className="text-2xl font-black text-black tracking-tighter uppercase italic">AgendeZap</h1>
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
              <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'dashboard'} onClick={navTo(() => setSuperAdminTab('dashboard'))} icon={<IconDashboard />} label="Dashboard" />
              <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'clients'} onClick={navTo(() => setSuperAdminTab('clients'))} icon={<IconUsers />} label="Clientes SaaS" />
              <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'avisos'} onClick={navTo(() => setSuperAdminTab('avisos'))} icon={<IconBroadcast />} label="Avisos" />
              <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'cobranca'} onClick={navTo(() => setSuperAdminTab('cobranca'))} icon={<IconFinance />} label="Cobrança" />
              <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'suporte'} onClick={navTo(() => setSuperAdminTab('suporte'))} icon={<IconChat />} label="Caixa de Entrada" />
              <div className="pt-4 border-t border-slate-100 mt-2 space-y-1">
                {!sidebarCollapsed && <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.2em] px-4 pb-1">WhatsApp Admin</p>}
                <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'conversas'} onClick={navTo(() => setSuperAdminTab('conversas'))} icon={<IconChat />} label="WA Atendimento" />
                <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'disparo'} onClick={navTo(() => setSuperAdminTab('disparo'))} icon={<IconBroadcast />} label="Disparador" />
                <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'campanhas'} onClick={navTo(() => setSuperAdminTab('campanhas'))} icon={<IconBroadcast />} label="Campanhas" />
                <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'prospeccao'} onClick={navTo(() => setSuperAdminTab('prospeccao'))} icon={<IconUsers />} label="Prospecção" />
              </div>
              <div className="pt-4 border-t border-slate-100 mt-2 space-y-1">
                {!sidebarCollapsed && <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.2em] px-4 pb-1">Central</p>}
                <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'central'} onClick={navTo(() => setSuperAdminTab('central'))} icon={<IconBroadcast />} label="Central" />
                <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'wa_central'} onClick={navTo(() => setSuperAdminTab('wa_central'))} icon={<IconChat />} label="WA Central" />
                <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'leads'} onClick={navTo(() => setSuperAdminTab('leads'))} icon={<IconUsers />} label="Leads" />
                <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'cashback'} onClick={navTo(() => setSuperAdminTab('cashback'))} icon={<IconFinance />} label="Cashback" />
              </div>
              <div className="pt-4 border-t border-slate-100 mt-2 space-y-1">
                {!sidebarCollapsed && <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.2em] px-4 pb-1">Sistema</p>}
                <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'logs'} onClick={navTo(() => setSuperAdminTab('logs'))} icon={<IconTerminal />} label="Logs" />
                <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'sql'} onClick={navTo(() => setSuperAdminTab('sql'))} icon={<IconSettings />} label="Banco SQL" />
                <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'ia'} onClick={navTo(() => setSuperAdminTab('ia'))} icon={<IconTerminal />} label="IA / Tokens" />
                <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'config'} onClick={navTo(() => setSuperAdminTab('config'))} icon={<IconSettings />} label="Configurações" />
                <NavItem collapsed={sidebarCollapsed} active={superAdminTab === 'testes'} onClick={navTo(() => setSuperAdminTab('testes'))} icon={<IconTerminal />} label="Testes" />
              </div>
            </>
          ) : (
            <>
              {/* ── Convidar Parceiro ── */}
              <button
                onClick={navTo(() => setShowInviteModal(true))}
                className={`w-full flex items-center gap-2 ${sidebarCollapsed ? 'justify-center px-2' : 'px-4'} py-2 rounded-xl bg-orange-50 hover:bg-orange-100 border border-orange-200 transition-all group mb-3`}
              >
                <IconGift />
                {!sidebarCollapsed && <span className="font-black text-[9px] uppercase tracking-widest text-orange-500">Convidar Parceiro</span>}
              </button>

              {/* ── Operacional ── */}
              <div className="space-y-0.5">
                {!sidebarCollapsed && <p className="text-[8px] font-black text-slate-300 uppercase tracking-[0.2em] px-4 pb-1">Operacional</p>}
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.DASHBOARD} onClick={navTo(() => setCurrentView(View.DASHBOARD))} icon={<IconDashboard />} label="Dashboard" />
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.AGENDAMENTOS} onClick={navTo(() => setCurrentView(View.AGENDAMENTOS))} icon={<IconCalendar />} label="Agenda" />
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.COMANDAS} onClick={navTo(() => handleGatedNav(View.COMANDAS, 'caixaAvancado'))} icon={<IconScissors />} label="Comandas" />
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.CONVERSAS} onClick={navTo(() => setCurrentView(View.CONVERSAS))} icon={<IconChat />} label="WhatsApp" badge={unreadConvCount} />
              </div>

              {/* ── Operação ── */}
              <div className="pt-3 mt-1 border-t border-slate-100 space-y-0.5">
                {!sidebarCollapsed && <p className="text-[8px] font-black text-slate-300 uppercase tracking-[0.2em] px-4 pb-1">Operação</p>}
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.SOCIAL_MIDIA} onClick={navTo(() => handleGatedNav(View.SOCIAL_MIDIA, 'socialMidia'))} icon={<IconCamera />} label="Social Mídia" />
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.DISPARADOR} onClick={navTo(() => handleGatedNav(View.DISPARADOR, 'disparo'))} icon={<IconBroadcast />} label="Disparos" />
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.FOLLOW_UP} onClick={navTo(() => setCurrentView(View.FOLLOW_UP))} icon={<IconClock />} label="Lembretes" />
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.CLIENTES} onClick={navTo(() => setCurrentView(View.CLIENTES))} icon={<IconUserCircle />} label="Clientes" />
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.ESTOQUE_PRODUTOS} onClick={navTo(() => handleGatedNav(View.ESTOQUE_PRODUTOS, 'financeiro'))} icon={<IconBox />} label="Estoque" />
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.PLANOS} onClick={navTo(() => setCurrentView(View.PLANOS))} icon={<IconPlans />} label="Planos" />
              </div>

              {/* ── Financeiro & Vendas ── */}
              <div className="pt-3 mt-1 border-t border-slate-100 space-y-0.5">
                {!sidebarCollapsed && <p className="text-[8px] font-black text-slate-300 uppercase tracking-[0.2em] px-4 pb-1">💰 Financeiro & Vendas</p>}
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.FINANCEIRO} onClick={navTo(() => handleGatedNav(View.FINANCEIRO, 'financeiro'))} icon={<IconFinance />} label="Financeiro" />
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.NOTAS_FISCAIS} onClick={navTo(() => handleGatedNav(View.NOTAS_FISCAIS, 'financeiro'))} icon={<IconDoc />} label="Notas Fiscais" />
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.FOLHA_PAGAMENTO} onClick={navTo(() => handleGatedNav(View.FOLHA_PAGAMENTO, 'financeiro'))} icon={<IconWallet />} label="Folha Pgto." />
                {/* Relatórios */}
                {sidebarCollapsed ? (
                  <NavItem collapsed={true} active={currentView === View.MARKETING || currentView === View.PERFORMANCE} onClick={navTo(() => handleGatedNav(View.MARKETING, 'relatorios'))} icon={<IconMarketing />} label="Relatórios" />
                ) : (
                  <>
                    <button
                      onClick={() => setRelatoriosOpen(v => !v)}
                      className={`w-full flex items-center px-4 py-3 rounded-xl transition-all group ${currentView === View.MARKETING || currentView === View.PERFORMANCE ? 'bg-black text-white shadow-xl scale-105' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                      <span className={`text-xl mr-3 ${currentView === View.MARKETING || currentView === View.PERFORMANCE ? 'text-orange-500' : 'text-slate-400 group-hover:text-black'}`}><IconMarketing /></span>
                      <span className={`font-black text-[10px] uppercase tracking-widest flex-1 text-left ${currentView === View.MARKETING || currentView === View.PERFORMANCE ? 'text-white' : ''}`}>Relatórios</span>
                      <span className={`text-[9px] font-black transition-transform duration-200 ${relatoriosOpen ? 'rotate-90' : ''} ${currentView === View.MARKETING || currentView === View.PERFORMANCE ? 'text-white' : 'text-slate-300'}`}>▶</span>
                    </button>
                    {relatoriosOpen && (
                      <div className="pl-3 space-y-0.5 border-l-2 border-slate-100 ml-4">
                        <NavItem collapsed={false} active={currentView === View.MARKETING} onClick={navTo(() => handleGatedNav(View.MARKETING, 'relatorios'))} icon={<IconMarketing />} label="Marketing" />
                        <NavItem collapsed={false} active={currentView === View.PERFORMANCE} onClick={navTo(() => handleGatedNav(View.PERFORMANCE, 'performance'))} icon={<IconTrophy />} label="Performance" />
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Base ── */}
              <div className="pt-3 mt-1 border-t border-slate-100 space-y-0.5">
                {!sidebarCollapsed && <p className="text-[8px] font-black text-slate-300 uppercase tracking-[0.2em] px-4 pb-1">Base</p>}
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.SERVICOS} onClick={navTo(() => setCurrentView(View.SERVICOS))} icon={<IconScissors />} label="Serviços" />
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.PROFISSIONAIS} onClick={navTo(() => setCurrentView(View.PROFISSIONAIS))} icon={<IconUsers />} label="Equipe" />
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.CONEXOES} onClick={navTo(() => setCurrentView(View.CONEXOES))} icon={<IconWhatsapp />} label="Conexões" color="text-green-600" />
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.CONFIGURACOES} onClick={navTo(() => setCurrentView(View.CONFIGURACOES))} icon={<IconSettings />} label="Configurações" />
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.MARKETPLACE} onClick={navTo(() => setCurrentView(View.MARKETPLACE))} icon={<IconGlobe />} label="Marketplace" />
                <NavItem collapsed={sidebarCollapsed} active={currentView === View.OTIMIZACAO} onClick={navTo(() => setCurrentView(View.OTIMIZACAO))} icon={<IconTerminal />} label="Dados IA" />
              </div>
            </>
          )}
        </nav>

        <div className={`${sidebarCollapsed ? 'px-2 py-4 flex flex-col items-center gap-2' : 'p-6 space-y-2'} border-t border-slate-100 bg-slate-50/50 transition-all duration-300`}>
          {isImpersonating && (
            <button onClick={handleExitImpersonation} className={`flex items-center gap-2 w-full bg-orange-500 text-white ${sidebarCollapsed ? 'justify-center px-2 py-2' : 'px-4 py-2.5'} rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-black transition-all`}>
              <span>↩</span>
              {!sidebarCollapsed && <span>Sair da conta</span>}
            </button>
          )}
          <button onClick={handleLogout} className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'space-x-3'} w-full text-slate-400 hover:text-red-500 transition-all font-bold text-xs uppercase tracking-widest`}>
            <IconLogout />
            {!sidebarCollapsed && <span>Sair</span>}
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
                ? ({ dashboard: 'Dashboard Global', clients: 'Clientes SaaS', avisos: 'Enviar Avisos', cobranca: 'Gestão de Cobrança', logs: 'Logs de Atividade', sql: 'Configurar Banco SQL', ia: 'IA / Tokens', conversas: 'WA Atendimento', disparo: 'Disparador Admin', campanhas: 'Campanhas em Andamento', prospeccao: 'Prospecção de Clientes', suporte: 'Caixa de Entrada', config: 'Configurações do Sistema', central: 'Central WhatsApp', wa_central: 'WA Central', leads: 'Leads Marketplace', cashback: 'Cashback' } as Record<SuperAdminTab, string>)[superAdminTab]
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
                  !pollingStatus.aiActive ? 'IA desligada — clique para configurar' :
                  !pollingStatus.connected ? 'WhatsApp desconectado — clique para reconectar' :
                  'IA Online'
                }
                className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[9px] font-black uppercase tracking-widest transition-all ${
                  !pollingStatus.aiActive
                    ? 'border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100'
                    : pollingStatus.connected
                    ? 'border-green-200 bg-green-50 text-green-600 hover:bg-green-100'
                    : 'border-red-200 bg-red-50 text-red-500 hover:bg-red-100 animate-pulse'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${
                  !pollingStatus.aiActive ? 'bg-slate-300' :
                  pollingStatus.connected ? 'bg-green-500' : 'bg-red-500'
                }`} />
                {!pollingStatus.aiActive ? 'IA off' : pollingStatus.connected ? 'IA online' : 'WA offline'}
              </button>
            )}
            <button
              onClick={() => setDarkMode(d => !d)}
              title={darkMode ? 'Modo Claro' : 'Modo Escuro'}
              className="w-9 h-9 rounded-xl border border-slate-200 bg-white flex items-center justify-center hover:border-slate-400 hover:bg-slate-100 transition-all"
            >
              {darkMode
                ? <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                : <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              }
            </button>
          </div>
        </header>

        {/* ✅ Scroll acontece aqui, não no main — fixed dos modais escapa para a viewport corretamente */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Trial banner (active, non-expired) ──────────────────── */}
          {trialInfo?.active && !trialInfo.isExpired && role === 'TENANT' && (
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
              {trialInfo?.isExpired && role === 'TENANT'
                ? <TrialExpiredView tenantId={tenantId} onActivated={() => { setTrialInfo(null); window.location.reload(); }} />
                : <div className="p-4 md:p-6">{renderView()}</div>
              }
            </ErrorBoundary>
          </Suspense>
        </div>
      </main>

      {upgradeModal && (
        <PlanUpgradeModal
          feature={upgradeModal.feature}
          tenantPlan={tenantPlan}
          tenantId={tenantId}
          onClose={() => setUpgradeModal(null)}
        />
      )}

      {/* ── Payment popup for unpaid tenants (7s delay) ──── */}
      {showPaymentPopup && pendingPayment && role === 'TENANT' && tenantId && !isImpersonating && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-white dark:bg-[#0b1a2e] rounded-[32px] shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto relative animate-toastIn">
            <button
              onClick={() => setShowPaymentPopup(false)}
              className="absolute top-4 right-5 text-slate-300 hover:text-slate-600 text-xl font-black z-10 transition-colors"
            >
              ✕
            </button>
            <div className="p-6 md:p-8">
              <Suspense fallback={<div className="p-20 text-center"><div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto" /></div>}>
                <TrialExpiredView
                  tenantId={tenantId}
                  mode="pending_payment"
                  onActivated={() => {
                    setPendingPayment(false);
                    setShowPaymentPopup(false);
                    window.location.reload();
                  }}
                />
              </Suspense>
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
          {/* Floating Tutorials button */}
          <div className="fixed bottom-[10.5rem] right-6 z-50">
            <button
              onClick={() => setShowTutorials(true)}
              title="Tutoriais"
              className="w-14 h-14 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-full shadow-xl flex items-center justify-center hover:scale-105 hover:shadow-2xl transition-all cursor-pointer"
            >
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </button>
          </div>
          <TutorialsPanel open={showTutorials} onClose={() => setShowTutorials(false)} />
          {/* Floating Marketplace button — opens in new tab */}
          <div className="fixed bottom-24 right-6 z-50">
            <button
              onClick={() => window.open(`${window.location.origin}/#/marketplace?tid=${tenantId}&tn=${encodeURIComponent(tenantName)}`, '_blank')}
              title="Visitar Marketplace"
              className="w-14 h-14 bg-black rounded-full shadow-xl flex items-center justify-center hover:scale-105 hover:bg-orange-500 transition-all cursor-pointer"
            >
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </button>
          </div>
          <SupportChat tenantId={tenantId} tenantName={tenantName} />
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
        `Acesse: https://app.agendezap.com\n` +
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
      className={`w-full flex items-center ${collapsed ? 'justify-center py-3 px-0' : 'px-4 py-3'} rounded-xl transition-all group ${
        active ? 'bg-black text-white shadow-xl scale-105' : `text-slate-500 hover:bg-slate-100 ${color || ''}`
      }`}
    >
      <span className={`text-xl ${collapsed ? '' : 'mr-3'} ${active ? 'text-orange-500' : 'text-slate-400 group-hover:text-black'}`}>{icon}</span>
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

export default App;