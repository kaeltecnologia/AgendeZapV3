
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TenantStatus, Tenant, SupportMessage, ConversationLog, AffiliateLinkStats } from '../types';
import { runWeeklyOptimization, OptimizationResult, runAllTenantsOptimization, AllTenantsResult, EvolutionSnapshot, loadEvolutionHistory } from '../services/optimizerService';
import { evolutionService } from '../services/evolutionService';
import { fetchUsageStats, UsageSummary } from '../services/usageTracker';
import { NICHOS } from '../config/nichoConfigs';
import { PLAN_CONFIGS, getPlanConfig } from '../config/planConfig';
import { ProspectCampaign, loadCampaigns, saveCampaigns, loadAdminInstance } from '../services/serperService';
import AdminConversasPanel from './AdminConversasPanel';
import AdminProspeccaoPanel from './AdminProspeccaoPanel';
import AdminDisparoPanel from './AdminDisparoPanel';
import CampaignsStatusView from './CampaignsStatusView';
import CentralPollingManager from './CentralPollingManager';
import TestRunnerPanel from './TestRunnerPanel';
import { MarketplaceLead, CashbackBalance } from '../types';

// ── Types ──────────────────────────────────────────────────────────────────────

interface GlobalStats {
  totalTenants: number;
  activeTenants: number;
  mrr: number;
  globalVolume: number;
  totalAppts: number;
  newThisMonth: number;
  totalCustomers: number;
  byStatus: Record<string, number>;
}

interface BillingReminder {
  daysOffset: number; // 3=3 days before, 0=on due date
  label: string;
  message: string;
  enabled: boolean;
}

interface AdminLog {
  ts: string;
  action: string;
  detail: string;
}

type Tab = 'dashboard' | 'clients' | 'avisos' | 'cobranca' | 'logs' | 'sql' | 'ia' | 'conversas' | 'disparo' | 'prospeccao' | 'suporte' | 'campanhas' | 'config' | 'central' | 'leads' | 'cashback' | 'testes';

const STATUS_COLORS: Record<string, string> = {
  [TenantStatus.ACTIVE]: '#22c55e',
  [TenantStatus.PAUSED]: '#f59e0b',
  [TenantStatus.CANCELLED]: '#ef4444',
  [TenantStatus.BLOCKED]: '#64748b',
  [TenantStatus.PENDING_PAYMENT]: '#f97316',
};

const STATUS_LABELS: Record<string, string> = {
  [TenantStatus.ACTIVE]: 'Ativa',
  [TenantStatus.PAUSED]: 'Pausada',
  [TenantStatus.CANCELLED]: 'Cancelada',
  [TenantStatus.BLOCKED]: 'Bloqueada',
  [TenantStatus.PENDING_PAYMENT]: 'Pag. Pendente',
};

const DEFAULT_BILLING_REMINDERS: BillingReminder[] = [
  { daysOffset: 3, label: 'Antepenúltimo dia', message: 'Olá {nome}! 👋 Sua mensalidade AgendeZap de R$ {valor} vence em *3 dias* (dia {dia}). Renove para manter seu acesso ativo! 🚀', enabled: false },
  { daysOffset: 2, label: 'Penúltimo dia', message: 'Olá {nome}! ⏰ Sua mensalidade AgendeZap de R$ {valor} vence em *2 dias* (dia {dia}). Não deixe seu sistema parar!', enabled: false },
  { daysOffset: 1, label: 'Último dia', message: 'Atenção {nome}! ⚠️ Amanhã é o último dia para pagar sua mensalidade AgendeZap (R$ {valor}). Renove agora e continue atendendo seus clientes!', enabled: false },
  { daysOffset: 0, label: 'Dia do vencimento', message: 'Olá {nome}! 🔴 Hoje vence sua mensalidade AgendeZap (R$ {valor}). Realize o pagamento para evitar a suspensão do serviço. Obrigado!', enabled: false },
];

function loadAdminLogs(): AdminLog[] {
  try { return JSON.parse(localStorage.getItem('agz_admin_logs') || '[]'); } catch { return []; }
}
function saveAdminLog(action: string, detail: string) {
  const logs = loadAdminLogs();
  logs.unshift({ ts: new Date().toISOString(), action, detail });
  localStorage.setItem('agz_admin_logs', JSON.stringify(logs.slice(0, 100)));
}
function loadBillingConfig(): BillingReminder[] {
  try {
    const saved = JSON.parse(localStorage.getItem('agz_billing_config') || 'null');
    return saved || DEFAULT_BILLING_REMINDERS;
  } catch { return DEFAULT_BILLING_REMINDERS; }
}
function saveBillingConfig(config: BillingReminder[]) {
  localStorage.setItem('agz_billing_config', JSON.stringify(config));
}
function loadBillingSent(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem('agz_billing_sent') || '{}'); } catch { return {}; }
}
function saveBillingSent(sent: Record<string, string>) {
  localStorage.setItem('agz_billing_sent', JSON.stringify(sent));
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface SuperAdminViewProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onImpersonate: (id: string, name: string, slug: string, plan?: string) => void;
}

const SuperAdminView: React.FC<SuperAdminViewProps> = ({ activeTab: tab, onTabChange: setTab, onImpersonate }) => {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  // New tenant modal
  const [showNew, setShowNew] = useState(false);
  const [successData, setSuccessData] = useState<{ email: string; pass: string; slug: string; isDemo: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newFee, setNewFee] = useState('0');
  const [newPhone, setNewPhone] = useState('');
  const [newDueDay, setNewDueDay] = useState('');
  const [newNicho, setNewNicho] = useState('Barbearia');
  const [newSubscriptionPlan, setNewSubscriptionPlan] = useState('START');
  const [newProCount, setNewProCount] = useState(1);
  const [newIsDemo, setNewIsDemo] = useState(false);

  // Edit modal
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Client list filters
  const [clientSearch, setClientSearch] = useState('');
  const [clientStatusFilter, setClientStatusFilter] = useState('');
  const [clientNichoFilter, setClientNichoFilter] = useState('');

  // Announcements
  const [announceTo, setAnnounceTo] = useState<'all' | 'active'>('active');
  const [announceMsg, setAnnounceMsg] = useState('');
  const [sendingAnnounce, setSendingAnnounce] = useState(false);
  const [announceResult, setAnnounceResult] = useState<{ ok: number; fail: number } | null>(null);

  // AI usage
  const [usagePeriod, setUsagePeriod] = useState<'today' | 'week' | 'month'>('week');
  const [usageStats, setUsageStats] = useState<UsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usdToBrl, setUsdToBrl] = useState<number | null>(null);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const cached = localStorage.getItem('agz_usd_brl');
    if (cached) {
      try {
        const { date, rate } = JSON.parse(cached);
        if (date === today) { setUsdToBrl(rate); return; }
      } catch { /* ignore */ }
    }
    fetch('https://open.er-api.com/v6/latest/USD')
      .then(r => r.json())
      .then(d => {
        const rate = d?.rates?.BRL;
        if (rate) {
          setUsdToBrl(rate);
          localStorage.setItem('agz_usd_brl', JSON.stringify({ date: today, rate }));
        }
      })
      .catch(() => {});
  }, []);

  // Shared OpenAI key
  const [sharedOpenAiKey, setSharedOpenAiKey] = useState('');
  const [showSharedKey, setShowSharedKey] = useState(false);
  const [savingSharedKey, setSavingSharedKey] = useState(false);
  const [sharedKeySaved, setSharedKeySaved] = useState(false);

  // System config
  const [cfgEmail, setCfgEmail] = useState('');
  const [cfgPass, setCfgPass] = useState('');
  const [cfgPassConfirm, setCfgPassConfirm] = useState('');
  const [cfgPlatformName, setCfgPlatformName] = useState('AgendeZap');
  const [cfgSupportEmail, setCfgSupportEmail] = useState('');
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgSaved, setCfgSaved] = useState(false);
  const [cfgError, setCfgError] = useState('');
  const [showCfgPass, setShowCfgPass] = useState(false);

  // Billing
  const [billingReminders, setBillingReminders] = useState<BillingReminder[]>(loadBillingConfig);
  const [runningBilling, setRunningBilling] = useState(false);
  const [billingResult, setBillingResult] = useState<string | null>(null);

  // Logs
  const [logs, setLogs] = useState<AdminLog[]>(loadAdminLogs);

  // Admin WhatsApp + prospecção
  const [adminInstanceName, setAdminInstanceName] = useState(() => loadAdminInstance());
  const [adminConnected, setAdminConnected] = useState(false);
  const [prospectCampaigns, setProspectCampaigns] = useState<ProspectCampaign[]>(() => loadCampaigns());

  // Central WhatsApp instance
  const [centralInstanceName, setCentralInstanceName] = useState('central_AgendeZap');
  const [centralConnected, setCentralConnected] = useState(false);
  const [disparoCampaignId, setDisparoCampaignId] = useState<string | undefined>(undefined);

  // Support inbox (legacy upgrade requests)
  type SupportRequest = { tenantId: string; tenantName: string; plan: string; request: { message: string; currentPlan: string; feature: string; ts: string; status: string } };
  const [supportRequests, setSupportRequests] = useState<SupportRequest[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);

  // IA Optimizer (superadmin only)
  const [optimizerTenantId, setOptimizerTenantId] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [optimizerResult, setOptimizerResult] = useState<OptimizationResult | null>(null);
  const [optimizerError, setOptimizerError] = useState<string | null>(null);
  const [optimizerLogs, setOptimizerLogs] = useState<ConversationLog[]>([]);
  const [optimizerLogsLoading, setOptimizerLogsLoading] = useState(false);
  const [optimizerSettings, setOptimizerSettings] = useState<import('../types').TenantSettings | null>(null);
  const [optimizerSinceDays, setOptimizerSinceDays] = useState(7);
  const [optimizerExpandedId, setOptimizerExpandedId] = useState<string | null>(null);
  const [optimizerOutcomeFilter, setOptimizerOutcomeFilter] = useState<string | null>(null);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editingOutcome, setEditingOutcome] = useState<ConversationLog['outcome']>('abandoned');
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);

  // "Otimizar Todos" — global cross-tenant optimization
  const [optimizingAll, setOptimizingAll] = useState(false);
  const [allProgress, setAllProgress] = useState<Array<{ tenantId: string; tenantName: string; status: 'pending' | 'running' | 'ok' | 'skipped' | 'error'; message?: string }>>([]);
  const [allResults, setAllResults] = useState<AllTenantsResult[] | null>(null);
  const [evolutionHistory, setEvolutionHistory] = useState<EvolutionSnapshot[]>([]);

  // Bidirectional support chat
  type SupportChatSummary = { tenantId: string; tenantName: string; lastMessage: string; lastAt: string; unreadCount: number };
  const [supportChats, setSupportChats] = useState<SupportChatSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<SupportMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [expandedImg, setExpandedImg] = useState('');
  const [chatsLoading, setChatsLoading] = useState(false);
  const chatBottomRef = React.useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([db.getGlobalStats(), db.getAllTenants()]);
      setStats(s as GlobalStats);
      setTenants([...t].reverse());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    const stats = await fetchUsageStats(usagePeriod);
    setUsageStats(stats);
    setUsageLoading(false);
  }, [usagePeriod]);

  useEffect(() => {
    if (tab === 'ia') {
      loadUsage();
      db.getGlobalConfig().then(cfg => setSharedOpenAiKey(cfg['shared_openai_key'] || ''));
      setEvolutionHistory(loadEvolutionHistory());
    }
  }, [tab, loadUsage]);

  const loadSupportRequests = useCallback(async () => {
    setSupportLoading(true);
    try {
      const reqs = await (db as any).getAllSupportRequests();
      setSupportRequests(reqs);
    } catch (e) { console.error(e); }
    finally { setSupportLoading(false); }
  }, []);

  useEffect(() => { if (tab === 'suporte') loadSupportRequests(); }, [tab, loadSupportRequests]);

  useEffect(() => {
    if (tab === 'config') {
      db.getGlobalConfig().then(cfg => {
        setCfgEmail(cfg['admin_email'] || '');
        setCfgPlatformName(cfg['platform_name'] || 'AgendeZap');
        setCfgSupportEmail(cfg['support_email'] || '');
      });
    }
  }, [tab]);

  // Load central instance name from global config
  useEffect(() => {
    if (tab === 'central' || tab === 'wa_central') {
      db.getGlobalConfig().then(cfg => {
        const name = cfg['central_instance'] || 'central_AgendeZap';
        setCentralInstanceName(name);
      });
    }
  }, [tab]);

  const handleDismissSupport = async (tenantId: string) => {
    await (db as any).dismissSupportRequest(tenantId);
    setSupportRequests(prev => prev.filter(r => r.tenantId !== tenantId));
  };

  // IA Optimizer handlers
  const loadOptimizerData = useCallback(async (tenantId: string, sinceDays: number) => {
    if (!tenantId) return;
    setOptimizerLogsLoading(true);
    try {
      const [logs, s] = await Promise.all([
        db.getConversationLogs(tenantId, sinceDays),
        db.getSettings(tenantId),
      ]);
      setOptimizerLogs(logs);
      setOptimizerSettings(s);
    } finally {
      setOptimizerLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (optimizerTenantId) loadOptimizerData(optimizerTenantId, optimizerSinceDays);
  }, [optimizerTenantId, optimizerSinceDays, loadOptimizerData]);

  const handleRunOptimizer = async () => {
    if (!optimizerTenantId || !optimizerSettings) return;
    setOptimizing(true);
    setOptimizerError(null);
    setOptimizerResult(null);
    try {
      const tenant = tenants.find(t => t.id === optimizerTenantId);
      const cfg = await db.getGlobalConfig();
      const key = optimizerSettings.openaiApiKey || cfg['shared_openai_key'] || '';
      if (!key) throw new Error('Nenhuma chave OpenAI configurada (nem do tenant nem compartilhada)');
      const result = await runWeeklyOptimization(
        optimizerTenantId,
        tenant?.name || 'Tenant',
        optimizerSettings,
        key
      );
      setOptimizerResult(result);
      await loadOptimizerData(optimizerTenantId, optimizerSinceDays);
    } catch (e: any) {
      setOptimizerError(e.message || 'Erro ao otimizar');
    } finally {
      setOptimizing(false);
    }
  };

  const handleRunAllOptimizer = async () => {
    if (optimizingAll || tenants.length === 0) return;
    setOptimizingAll(true);
    setAllResults(null);
    setAllProgress(tenants.map(t => ({ tenantId: t.id, tenantName: t.name, status: 'pending' })));
    try {
      const cfg = await db.getGlobalConfig();
      const key = cfg['shared_openai_key'] || '';
      if (!key) {
        setAllProgress([]);
        setOptimizingAll(false);
        alert('Configure uma chave OpenAI compartilhada em Configurações antes de otimizar todos.');
        return;
      }
      const { results } = await runAllTenantsOptimization(
        tenants.map(t => ({ id: t.id, name: t.name })),
        key,
        (tenantId, tenantName, status, message) => {
          setAllProgress(prev => prev.map(p =>
            p.tenantId === tenantId ? { ...p, status, message } : p
          ));
        }
      );
      setAllResults(results);
      setEvolutionHistory(loadEvolutionHistory());
    } catch (e: any) {
      console.error('Erro ao otimizar todos:', e);
    } finally {
      setOptimizingAll(false);
    }
  };

  const handleDeleteLog = async (id: string) => {
    await db.deleteConversationLog(id);
    setOptimizerLogs(prev => prev.filter(l => l.id !== id));
    setDeletingLogId(null);
    setOptimizerExpandedId(null);
  };

  const handleSaveLogEdit = async (id: string) => {
    await db.updateConversationLog(id, { outcome: editingOutcome });
    setOptimizerLogs(prev => prev.map(l => l.id === id ? { ...l, outcome: editingOutcome } : l));
    setEditingLogId(null);
  };

  // Bidirectional support chat handlers
  const loadSupportChats = useCallback(async () => {
    setChatsLoading(true);
    try {
      const chats = await db.getAllSupportChats();
      setSupportChats(chats);
    } catch (e) { console.error(e); }
    finally { setChatsLoading(false); }
  }, []);

  const loadChatMessages = useCallback(async (tenantId: string) => {
    const msgs = await db.getSupportMessages(tenantId);
    setChatMessages(msgs);
    await db.markSupportRead(tenantId, 'tenant');
    setSupportChats(prev => prev.map(c => c.tenantId === tenantId ? { ...c, unreadCount: 0 } : c));
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, []);

  useEffect(() => {
    if (tab === 'suporte') {
      loadSupportRequests();
      loadSupportChats();
    }
  }, [tab, loadSupportRequests, loadSupportChats]);

  useEffect(() => {
    if (selectedChatId) loadChatMessages(selectedChatId);
  }, [selectedChatId, loadChatMessages]);

  const handleSelectChat = (tenantId: string) => {
    setSelectedChatId(tenantId);
    setChatText('');
  };

  const handleSendSupportReply = async () => {
    if (!selectedChatId || !chatText.trim() || chatSending) return;
    setChatSending(true);
    const content = chatText.trim();
    setChatText('');
    try {
      await db.sendSupportReply(selectedChatId, content);
      await loadChatMessages(selectedChatId);
      await loadSupportChats();
    } finally {
      setChatSending(false);
    }
  };

  const handleCampaignsChange = (updated: ProspectCampaign[]) => {
    setProspectCampaigns(updated);
    saveCampaigns(updated);
  };

  const handleGoToDisparo = (campaignId: string) => {
    setDisparoCampaignId(campaignId);
    setTab('disparo' as Tab);
  };

  // ── Create tenant ────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const slug = newName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^\w-]/g, '');
      const email = newEmail.trim() || `${slug}@agendezap.com`;
      const pass = newPass.trim() || `Zap@${Math.floor(1000 + Math.random() * 9000)}`;
      const fee = parseFloat(newFee) || 0;
      const dueDay = parseInt(newDueDay) || undefined;
      const phone = newPhone.trim() || undefined;

      const t = await db.addTenant({ name: newName, slug, email, password: pass, subscriptionPlan: newSubscriptionPlan, status: TenantStatus.ACTIVE, monthlyFee: fee, nicho: newNicho });
      if (phone || dueDay) await db.updateTenant(t.id, { phone, due_day: dueDay });

      // Demo/trial: activate 7-day trial period
      // Also inject the shared OpenAI key if one is configured globally
      const globalCfg = await db.getGlobalConfig().catch(() => ({} as Record<string, string>));
      const inheritedKey = (globalCfg['shared_openai_key'] || '').trim();
      const extraProsCount = newSubscriptionPlan === 'START' ? Math.max(0, newProCount - 1) : 0;
      await db.updateSettings(t.id, {
        themeColor: '#f97316',
        aiActive: false,
        trialStartDate: newIsDemo ? new Date().toISOString() : null,
        ...(inheritedKey ? { openaiApiKey: inheritedKey } : {}),
        ...(extraProsCount > 0 ? { follow_up: { _extraProfessionals: extraProsCount } } : {}),
      } as any);

      try {
        await Promise.race([
          evolutionService.createAndFetchQr(slug),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
        ]);
      } catch { /* Evolution timeout is non-fatal */ }

      setSuccessData({ email, pass, slug, isDemo: newIsDemo });
      setNewName(''); setNewEmail(''); setNewPass(''); setNewFee('0'); setNewPhone(''); setNewDueDay(''); setNewNicho('Barbearia'); setNewSubscriptionPlan('START'); setNewProCount(1); setNewIsDemo(false);
      saveAdminLog('TENANT_CREATED', `${newName} (${email})${newIsDemo ? ' [DEMO]' : ''}`);
      setLogs(loadAdminLogs());
      load();
    } catch (e: any) {
      alert('Erro ao criar unidade: ' + (e.message || 'Verifique o console'));
    } finally { setCreating(false); }
  };

  // ── Update tenant ────────────────────────────────────────────────────────────

  const handleUpdate = async () => {
    if (!editingTenant) return;
    setSaving(true);
    try {
      await db.updateTenant(editingTenant.id, {
        status: editingTenant.status,
        monthlyFee: editingTenant.monthlyFee,
        email: editingTenant.email,
        password: editingTenant.password,
        phone: editingTenant.phone,
        due_day: editingTenant.due_day,
        nicho: editingTenant.nicho,
        plan: editingTenant.plan,
      });
      saveAdminLog('TENANT_UPDATED', `${editingTenant.name}`);
      setLogs(loadAdminLogs());
      setEditingTenant(null);
      load();
    } catch (e) { alert('Erro ao atualizar'); }
    finally { setSaving(false); }
  };

  // ── Delete tenant ────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteId) return;
    const t = tenants.find(x => x.id === deleteId);
    try {
      await db.deleteTenant(deleteId);
      saveAdminLog('TENANT_DELETED', t?.name || deleteId);
      setLogs(loadAdminLogs());
      setDeleteId(null);
      load();
    } catch (e) { alert('Erro ao excluir'); }
  };

  // ── Announcements ────────────────────────────────────────────────────────────

  const handleSaveSharedKey = async () => {
    const key = sharedOpenAiKey.trim();
    if (!key) return;
    setSavingSharedKey(true);

    // 1. Save to global config (localStorage + Supabase global_settings if table exists)
    await db.saveGlobalConfig({ shared_openai_key: key });

    // 2. Propagate to ALL tenants (overwrite existing keys with the shared one)
    //    This ensures Edge Functions (server-side) also get the key via tenant_settings
    try {
      const allTenants = tenants.length > 0 ? tenants : await db.getAllTenants();
      let propagated = 0;
      for (const t of allTenants) {
        try {
          await db.updateSettings(t.id, { openaiApiKey: key });
          propagated++;
        } catch { /* skip individual tenant errors */ }
      }
      console.log(`[SharedKey] Propagated to ${propagated}/${allTenants.length} tenant(s)`);
    } catch { /* non-fatal */ }

    setSavingSharedKey(false);
    setSharedKeySaved(true);
    setTimeout(() => setSharedKeySaved(false), 2500);
  };

  const handleAnnounce = async () => {
    if (!announceMsg.trim()) return;
    setSendingAnnounce(true);
    setAnnounceResult(null);
    let ok = 0, fail = 0;
    // Use central instance for all announcements
    const cfg = await db.getGlobalConfig();
    const instance = cfg['central_instance'] || centralInstanceName || 'central_AgendeZap';
    const targets = announceTo === 'active' ? tenants.filter(t => t.status === TenantStatus.ACTIVE) : tenants;
    for (const t of targets) {
      if (!t.phone) { fail++; continue; }
      try {
        await evolutionService.sendMessage(instance, t.phone, announceMsg);
        ok++;
      } catch { fail++; }
    }
    setAnnounceResult({ ok, fail });
    saveAdminLog('ANNOUNCEMENT_SENT', `${ok} enviados, ${fail} falhas`);
    setLogs(loadAdminLogs());
    setSendingAnnounce(false);
  };

  // ── Billing reminders ────────────────────────────────────────────────────────

  const handleRunBilling = async () => {
    setRunningBilling(true);
    setBillingResult(null);
    const sent = loadBillingSent();
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    let ok = 0, skip = 0;

    const enabledReminders = billingReminders.filter(r => r.enabled);
    if (!enabledReminders.length) {
      setBillingResult('Nenhum lembrete habilitado.');
      setRunningBilling(false);
      return;
    }

    // Use central instance for all billing messages
    const cfg = await db.getGlobalConfig();
    const instance = cfg['central_instance'] || centralInstanceName || 'central_AgendeZap';

    for (const t of tenants) {
      if (!t.due_day || !t.phone) continue;
      if (t.status !== TenantStatus.ACTIVE && t.status !== TenantStatus.PENDING_PAYMENT) continue;

      const dueDate = new Date(now.getFullYear(), now.getMonth(), t.due_day);
      if (dueDate < now && dueDate.getMonth() === now.getMonth()) {
        // Due date already passed this month — skip
        continue;
      }
      const daysUntil = Math.round((dueDate.getTime() - now.setHours(0, 0, 0, 0)) / 86400000);

      for (const reminder of enabledReminders) {
        if (daysUntil !== reminder.daysOffset) continue;
        const key = `${t.id}::${month}::${reminder.daysOffset}`;
        if (sent[key]) { skip++; continue; }

        const msg = reminder.message
          .replace(/\{nome\}/gi, t.name)
          .replace(/\{valor\}/gi, `R$ ${t.monthlyFee.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
          .replace(/\{dia\}/gi, String(t.due_day));

        try {
          await evolutionService.sendMessage(instance, t.phone, msg);
          sent[key] = new Date().toISOString();
          ok++;
        } catch { skip++; }
      }
    }
    saveBillingSent(sent);
    saveAdminLog('BILLING_RUN', `${ok} enviados, ${skip} ignorados`);
    setLogs(loadAdminLogs());
    setBillingResult(`✅ ${ok} lembretes enviados · ${skip} ignorados (já enviados)`);
    setRunningBilling(false);
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const filteredTenants = tenants.filter(t => {
    if (clientSearch && !t.name.toLowerCase().includes(clientSearch.toLowerCase()) && !t.email?.toLowerCase().includes(clientSearch.toLowerCase())) return false;
    if (clientStatusFilter && t.status !== clientStatusFilter) return false;
    if (clientNichoFilter && ((t as any).nicho || 'Barbearia') !== clientNichoFilter) return false;
    return true;
  });

  // ── Charts data ──────────────────────────────────────────────────────────────

  const statusPieData = stats
    ? Object.entries(stats.byStatus || {})
        .filter(([, v]) => (v as number) > 0)
        .map(([k, v]) => ({ name: STATUS_LABELS[k] || k, value: v as number, color: STATUS_COLORS[k] || '#94a3b8' }))
    : [];

  const topTenantsByFee = [...tenants]
    .sort((a, b) => b.monthlyFee - a.monthlyFee)
    .slice(0, 6)
    .map(t => ({ name: t.name.split(' ')[0], fee: t.monthlyFee }));

  // ── SQL script ───────────────────────────────────────────────────────────────

  const sqlScript = `-- SCRIPT DE REPARO AGENDEZAP --
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='email') THEN ALTER TABLE tenants ADD COLUMN email TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='password') THEN ALTER TABLE tenants ADD COLUMN password TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='plan') THEN ALTER TABLE tenants ADD COLUMN plan TEXT DEFAULT 'BASIC'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='status') THEN ALTER TABLE tenants ADD COLUMN status TEXT DEFAULT 'ATIVA'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='mensalidade') THEN ALTER TABLE tenants ADD COLUMN mensalidade NUMERIC DEFAULT 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='nome') THEN ALTER TABLE tenants ADD COLUMN nome TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='phone') THEN ALTER TABLE tenants ADD COLUMN phone TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='due_day') THEN ALTER TABLE tenants ADD COLUMN due_day INTEGER; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='nicho') THEN ALTER TABLE tenants ADD COLUMN nicho TEXT DEFAULT 'Barbearia'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='evolution_instance') THEN ALTER TABLE tenants ALTER COLUMN evolution_instance DROP NOT NULL; END IF;
END $$;

CREATE TABLE IF NOT EXISTS professionals (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID REFERENCES tenants(id), nome TEXT, phone TEXT NOT NULL, especialidade TEXT, ativo BOOLEAN DEFAULT true);
CREATE TABLE IF NOT EXISTS services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID REFERENCES tenants(id), nome TEXT, preco NUMERIC, duracao_minutos INTEGER, ativo BOOLEAN DEFAULT true);
CREATE TABLE IF NOT EXISTS customers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID REFERENCES tenants(id), nome TEXT, telefone TEXT NOT NULL, ativo BOOLEAN DEFAULT true, plan_id UUID, follow_up_mode TEXT);
CREATE TABLE IF NOT EXISTS tenant_settings (tenant_id UUID PRIMARY KEY REFERENCES tenants(id), follow_up JSONB, operating_hours JSONB, ai_active BOOLEAN DEFAULT false, theme_color TEXT DEFAULT '#f97316');
CREATE TABLE IF NOT EXISTS appointments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID REFERENCES tenants(id), customer_id UUID REFERENCES customers(id), professional_id UUID REFERENCES professionals(id), service_id UUID REFERENCES services(id), inicio TIMESTAMPTZ, fim TIMESTAMPTZ, status TEXT DEFAULT 'PENDING', origem TEXT DEFAULT 'WEB', payment_method TEXT, amount_paid NUMERIC, extra_note TEXT, extra_value NUMERIC);
CREATE TABLE IF NOT EXISTS expenses (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID REFERENCES tenants(id), description TEXT, amount NUMERIC, category TEXT, professional_id UUID REFERENCES professionals(id), date TIMESTAMPTZ DEFAULT now());

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  TRACKING DE TOKENS DE IA — execute para habilitar o painel ║
-- ╚══════════════════════════════════════════════════════════════╝
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  phone_number TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
  estimated_cost_usd DECIMAL(12,8) DEFAULT 0,
  success BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant ON ai_usage_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_date ON ai_usage_logs(created_at DESC);
-- Habilitar RLS e acesso service_role:
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_usage_logs' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON ai_usage_logs FOR ALL TO service_role USING (true);
  END IF;
END $$;`.trim();

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center p-20 gap-4">
        <div className="w-8 h-8 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sincronizando Painel Mestre...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Visão global do AgendeZap SaaS</p>
        </div>
        {tab === 'clients' && (
          <button
            onClick={() => { setShowNew(true); setSuccessData(null); }}
            className="bg-orange-500 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-100 hover:bg-black transition-all"
          >
            + Nova Unidade
          </button>
        )}
      </div>

      {/* ══════════════════════ DASHBOARD ══════════════════════ */}
      {tab === 'dashboard' && (
        <div className="space-y-8">
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <StatCard label="Total de Clientes" value={String(stats.totalTenants)} icon="🏢" sub={`${stats.newThisMonth} novos este mês`} />
            <StatCard label="Clientes Ativos" value={String(stats.activeTenants)} icon="✅" color="text-green-600" />
            <StatCard label="MRR" value={`R$ ${stats.mrr.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`} icon="💰" color="text-orange-500" highlight />
            <StatCard label="Faturamento Bruto" value={`R$ ${stats.globalVolume.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`} icon="💹" sub="Soma de todos os agendamentos finalizados" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <StatCard label="Total de Agendamentos" value={stats.totalAppts.toLocaleString()} icon="📅" />
            <StatCard label="Total de Clientes Finais" value={stats.totalCustomers.toLocaleString()} icon="👥" />
            <StatCard label="Ticket Médio Mensalidade" value={stats.activeTenants > 0 ? `R$ ${(stats.mrr / stats.activeTenants).toFixed(0)}` : 'R$ 0'} icon="🎯" />
            <StatCard label="Inadimplentes / Pausados" value={String((stats.byStatus?.[TenantStatus.PENDING_PAYMENT] || 0) + (stats.byStatus?.[TenantStatus.PAUSED] || 0))} icon="⚠️" color="text-amber-500" />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Status distribution pie */}
            <div className="bg-white rounded-3xl border border-slate-100 p-8">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Distribuição por Status</p>
              {statusPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={statusPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3}>
                      {statusPieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => [`${v} cliente(s)`, '']} contentStyle={{ borderRadius: 10, border: '1px solid #f1f5f9', fontSize: 11, background: '#fff', color: '#0f172a' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-center text-slate-300 text-xs py-12">Sem dados</p>}
              <div className="flex flex-wrap gap-3 mt-4">
                {statusPieData.map(d => (
                  <div key={d.name} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="text-[9px] font-black text-slate-500 uppercase">{d.name} ({d.value})</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top clients by fee bar chart */}
            <div className="bg-white rounded-3xl border border-slate-100 p-8">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Top Clientes por Mensalidade</p>
              {topTenantsByFee.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={topTenantsByFee} barSize={24}>
                    <XAxis dataKey="name" tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip formatter={(v: any) => [`R$ ${Number(v).toFixed(2)}`, 'Mensalidade']} contentStyle={{ borderRadius: 10, border: '1px solid #f1f5f9', fontSize: 11, background: '#fff', color: '#0f172a' }} />
                    <Bar dataKey="fee" fill="#000" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-center text-slate-300 text-xs py-12">Sem dados</p>}
            </div>
          </div>

          {/* Recent tenants list */}
          <div className="bg-white rounded-3xl border border-slate-100 p-8">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Últimos Clientes Cadastrados</p>
            <div className="space-y-3">
              {tenants.slice(0, 5).map(t => (
                <div key={t.id} className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center font-black text-sm">{t.name[0]}</div>
                    <div>
                      <p className="font-black text-sm text-black uppercase">{t.name}</p>
                      <p className="text-[9px] text-slate-400 font-bold">{t.createdAt ? new Date(t.createdAt).toLocaleDateString('pt-BR') : '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase`} style={{ backgroundColor: `${STATUS_COLORS[t.status]}20`, color: STATUS_COLORS[t.status] }}>
                      {STATUS_LABELS[t.status] || t.status}
                    </span>
                    <span className="font-black text-black text-sm">R$ {t.monthlyFee.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ CLIENTS ══════════════════════ */}
      {tab === 'clients' && (
        <div className="space-y-6">
          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <input
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              placeholder="🔍 Buscar por nome ou email..."
              className="flex-1 min-w-[220px] p-3 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:border-orange-500"
            />
            <select
              value={clientStatusFilter}
              onChange={e => setClientStatusFilter(e.target.value)}
              className="p-3 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:border-orange-500"
            >
              <option value="">Todos os status</option>
              {Object.values(TenantStatus).map(s => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
            </select>
            <select
              value={clientNichoFilter}
              onChange={e => setClientNichoFilter(e.target.value)}
              className="p-3 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:border-orange-500"
            >
              <option value="">Todos os nichos</option>
              {NICHOS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Table */}
          <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden">
            <div className="overflow-y-auto max-h-[600px]">
              <table className="w-full">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    {['Empresa', 'Nicho', 'Plano', 'Acesso', 'Telefone', 'Status', 'Mensalidade', 'Venc.', 'Ações'].map(h => (
                      <th key={h} className="px-5 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredTenants.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-12 text-slate-300 font-black uppercase text-xs">Nenhum cliente encontrado</td></tr>
                  ) : filteredTenants.map(t => (
                    <tr key={t.id} className="hover:bg-orange-50/40 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-black text-white rounded-xl flex items-center justify-center font-black text-sm shrink-0">{t.name[0]}</div>
                          <div>
                            <p className="font-black text-sm text-black">{t.name}</p>
                            <p className="text-[9px] text-slate-400">{t.createdAt ? new Date(t.createdAt).toLocaleDateString('pt-BR') : ''}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-[9px] font-black px-2 py-1 bg-slate-100 text-slate-600 rounded-lg uppercase">{(t as any).nicho || 'Barbearia'}</span>
                      </td>
                      <td className="px-5 py-4">
                        {(() => { const p = getPlanConfig(t.plan); return (
                          <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase border ${p.bgClass} ${p.textClass} ${p.borderClass}`}>
                            {p.emoji} {p.name}
                          </span>
                        ); })()}
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-[10px] font-black text-black">{t.email || '—'}</p>
                        <p className="text-[9px] text-slate-400 font-mono">{t.password || '—'}</p>
                      </td>
                      <td className="px-5 py-4 text-[10px] font-bold text-slate-600">{t.phone || '—'}</td>
                      <td className="px-5 py-4">
                        <span className="text-[9px] font-black px-3 py-1.5 rounded-full uppercase" style={{ backgroundColor: `${STATUS_COLORS[t.status]}20`, color: STATUS_COLORS[t.status] }}>
                          {STATUS_LABELS[t.status] || t.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-black text-black">R$ {t.monthlyFee.toLocaleString()}</td>
                      <td className="px-5 py-4 text-sm font-black text-slate-600">{t.due_day ? `Dia ${t.due_day}` : '—'}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <button onClick={() => onImpersonate(t.id, t.name, t.slug, t.plan)} className="px-3 py-1.5 bg-orange-50 text-orange-600 rounded-xl font-black text-[9px] uppercase hover:bg-orange-100 transition-all">
                            Acessar
                          </button>
                          <button onClick={() => setEditingTenant({ ...t })} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-xl font-black text-[9px] uppercase hover:bg-slate-200 transition-all">
                            Editar
                          </button>
                          <button onClick={async (e) => { e.stopPropagation(); if (window.confirm(`Excluir "${t.name}"? Esta ação não pode ser desfeita.`)) { try { await db.deleteTenant(t.id); saveAdminLog('TENANT_DELETED', t.name); load(); } catch { alert('Erro ao excluir tenant'); } } }} className="px-3 py-1.5 bg-red-50 text-red-500 rounded-xl font-black text-[9px] uppercase hover:bg-red-100 transition-all">
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ AVISOS ══════════════════════ */}
      {tab === 'avisos' && (
        <div className="space-y-6 max-w-2xl">
          <div className="bg-white rounded-3xl border border-slate-100 p-8 space-y-6">
            <div>
              <h2 className="text-xl font-black text-black uppercase">Enviar Aviso</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Mensagem enviada via WhatsApp de cada cliente para o telefone do proprietário</p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Destinatários</label>
              <div className="flex gap-3">
                {(['active', 'all'] as const).map(v => (
                  <button key={v} onClick={() => setAnnounceTo(v)}
                    className={`flex-1 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${announceTo === v ? 'bg-black text-white border-black' : 'border-slate-200 text-slate-400 hover:border-black hover:text-black'}`}>
                    {v === 'active' ? `✅ Somente Ativos (${tenants.filter(t => t.status === TenantStatus.ACTIVE).length})` : `📢 Todos (${tenants.length})`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mensagem</label>
              <textarea
                value={announceMsg}
                onChange={e => setAnnounceMsg(e.target.value)}
                rows={5}
                placeholder="Digite o aviso para os clientes..."
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-semibold text-sm outline-none focus:border-orange-500 resize-none"
              />
            </div>

            {announceResult && (
              <div className={`p-4 rounded-2xl ${announceResult.fail > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
                <p className="text-[10px] font-black uppercase tracking-widest">
                  ✅ {announceResult.ok} enviados · {announceResult.fail > 0 ? `⚠️ ${announceResult.fail} sem telefone/instância` : ''}
                </p>
              </div>
            )}

            <div className="flex gap-4">
              <button onClick={() => { setAnnounceMsg(''); setAnnounceResult(null); }} className="flex-1 py-3 font-black text-slate-400 uppercase text-xs" disabled={sendingAnnounce}>Limpar</button>
              <button onClick={handleAnnounce} disabled={sendingAnnounce || !announceMsg.trim()} className="flex-1 py-3 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-40">
                {sendingAnnounce ? 'Enviando...' : 'Enviar Aviso →'}
              </button>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
            <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">⚠️ Pré-requisito</p>
            <p className="text-xs text-amber-600 mt-1">Para enviar avisos, cada cliente precisa ter o campo <strong>Telefone do Proprietário</strong> preenchido e o WhatsApp conectado.</p>
          </div>
        </div>
      )}

      {/* ══════════════════════ COBRANÇA ══════════════════════ */}
      {tab === 'cobranca' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Reminder config */}
            <div className="bg-white rounded-3xl border border-slate-100 p-8 space-y-6">
              <div>
                <h2 className="text-xl font-black text-black uppercase">Lembretes de Cobrança</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Configure as mensagens enviadas antes do vencimento</p>
              </div>

              <div className="space-y-4">
                {billingReminders.map((r, i) => (
                  <div key={r.daysOffset} className={`rounded-2xl border-2 p-5 space-y-3 transition-all ${r.enabled ? 'border-orange-200 bg-orange-50' : 'border-slate-100 bg-slate-50'}`}>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black text-black uppercase tracking-widest">{r.label}</p>
                      <button
                        onClick={() => {
                          const next = [...billingReminders];
                          next[i] = { ...r, enabled: !r.enabled };
                          setBillingReminders(next);
                          saveBillingConfig(next);
                        }}
                        className={`w-12 h-6 rounded-full transition-all relative ${r.enabled ? 'bg-orange-500' : 'bg-slate-200'}`}
                      >
                        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${r.enabled ? 'left-6' : 'left-0.5'}`} />
                      </button>
                    </div>
                    {r.enabled && (
                      <textarea
                        value={r.message}
                        onChange={e => {
                          const next = [...billingReminders];
                          next[i] = { ...r, message: e.target.value };
                          setBillingReminders(next);
                          saveBillingConfig(next);
                        }}
                        rows={3}
                        className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-orange-400 resize-none"
                      />
                    )}
                    {r.enabled && (
                      <p className="text-[9px] text-slate-400 font-bold">Variáveis: <span className="text-orange-500">{'{nome}'} {'{valor}'} {'{dia}'}</span></p>
                    )}
                  </div>
                ))}
              </div>

              {billingResult && (
                <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
                  <p className="text-[10px] font-black text-green-700 uppercase tracking-widest">{billingResult}</p>
                </div>
              )}

              <button onClick={handleRunBilling} disabled={runningBilling} className="w-full py-3 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-40">
                {runningBilling ? 'Verificando...' : '▶ Executar Verificação Agora'}
              </button>
            </div>

            {/* Per-tenant due day config */}
            <div className="bg-white rounded-3xl border border-slate-100 p-8 space-y-4">
              <div>
                <h2 className="text-xl font-black text-black uppercase">Vencimentos por Cliente</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Dia do mês em que a mensalidade vence</p>
              </div>
              <div className="space-y-3 overflow-y-auto max-h-[420px] pr-1">
                {tenants.filter(t => t.status === TenantStatus.ACTIVE || t.status === TenantStatus.PENDING_PAYMENT).map(t => (
                  <div key={t.id} className="flex items-center gap-4 py-3 border-b border-slate-50 last:border-0">
                    <div className="w-8 h-8 bg-black text-white rounded-xl flex items-center justify-center font-black text-xs shrink-0">{t.name[0]}</div>
                    <p className="font-black text-xs text-black flex-1 uppercase truncate">{t.name}</p>
                    <p className="text-[9px] text-slate-400 truncate max-w-[100px]">{t.phone || 'sem tel.'}</p>
                    <input
                      type="number"
                      min={1} max={31}
                      value={t.due_day || ''}
                      placeholder="dia"
                      onChange={async e => {
                        const d = parseInt(e.target.value) || undefined;
                        await db.updateTenant(t.id, { due_day: d });
                        setTenants(prev => prev.map(x => x.id === t.id ? { ...x, due_day: d } : x));
                      }}
                      className="w-16 p-2 bg-slate-50 border border-slate-200 rounded-xl font-black text-center text-xs outline-none focus:border-orange-400"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ LOGS ══════════════════════ */}
      {tab === 'logs' && (
        <div className="bg-white rounded-3xl border border-slate-100 p-8 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black text-black uppercase">Logs de Atividade</h2>
            <button onClick={() => { localStorage.removeItem('agz_admin_logs'); setLogs([]); }} className="text-[9px] font-black text-red-400 uppercase hover:text-red-600">Limpar</button>
          </div>
          {logs.length === 0 ? (
            <p className="text-center text-slate-300 font-black uppercase text-xs py-12">Nenhuma atividade registrada</p>
          ) : (
            <div className="space-y-2 overflow-y-auto max-h-[600px]">
              {logs.map((log, i) => (
                <div key={i} className="flex items-start gap-4 py-3 border-b border-slate-50 last:border-0">
                  <div className="text-[9px] font-black text-slate-300 w-32 shrink-0">{new Date(log.ts).toLocaleString('pt-BR')}</div>
                  <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase shrink-0 ${
                    log.action.includes('CREATED') ? 'bg-green-100 text-green-600' :
                    log.action.includes('DELETED') ? 'bg-red-100 text-red-500' :
                    log.action.includes('BILLING') ? 'bg-orange-100 text-orange-600' :
                    'bg-slate-100 text-slate-500'
                  }`}>{log.action.replace(/_/g, ' ')}</span>
                  <p className="text-xs font-bold text-slate-600 flex-1">{log.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════ SQL ══════════════════════ */}
      {tab === 'sql' && (
        <div className="bg-slate-900 p-10 rounded-3xl shadow-2xl space-y-6 animate-scaleUp">
          <div className="flex items-start gap-5">
            <div className="text-4xl">🚀</div>
            <div>
              <h3 className="text-xl font-black text-white uppercase">Configuração do Supabase</h3>
              <p className="text-slate-400 text-xs font-bold leading-relaxed mt-1 uppercase tracking-widest">Execute no SQL Editor do Supabase para criar/reparar as tabelas.</p>
            </div>
          </div>
          <div className="relative">
            <textarea readOnly value={sqlScript} className="w-full h-80 bg-black/50 border-2 border-slate-800 rounded-2xl p-6 font-mono text-[11px] text-orange-400 outline-none resize-none" />
            <button onClick={() => { navigator.clipboard.writeText(sqlScript); }} className="absolute top-4 right-4 bg-orange-500 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-white hover:text-orange-500 transition-all">
              Copiar
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════ IA / TOKENS ══════════════════════ */}
      {tab === 'ia' && (
        <div className="space-y-6">

          {/* Period selector + refresh */}
          <div className="flex items-center gap-4 flex-wrap">
            {(['today', 'week', 'month'] as const).map(p => (
              <button key={p} onClick={() => setUsagePeriod(p)}
                className={`px-5 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${usagePeriod === p ? 'bg-black text-white border-black' : 'border-slate-200 text-slate-400 hover:border-black hover:text-black'}`}>
                {p === 'today' ? 'Hoje' : p === 'week' ? 'Última Semana' : 'Último Mês'}
              </button>
            ))}
            <button onClick={loadUsage} disabled={usageLoading}
              className="px-5 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 border-orange-300 text-orange-500 hover:bg-orange-50 transition-all disabled:opacity-40">
              {usageLoading ? 'Atualizando...' : '↺ Atualizar'}
            </button>
          </div>

          {/* Summary cards */}
          {usageStats && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
              <StatCard label="Total de Tokens" value={usageStats.total_tokens.toLocaleString()} icon="🧠" />
              <StatCard
                label="Custo Estimado"
                value={`$${usageStats.total_cost_usd.toFixed(4)}${usdToBrl ? ` · R$${(usageStats.total_cost_usd * usdToBrl).toFixed(2)}` : ''}`}
                icon="💵"
                color="text-green-600"
              />
              <StatCard label="Chamadas IA" value={usageStats.total_calls.toLocaleString()} icon="📡" />
            </div>
          )}

          {/* Per-tenant table */}
          <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto max-h-[560px]">
              <table className="w-full">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    {['Tenant', 'Nicho', 'Tokens In', 'Tokens Out', 'Total', 'Custo (USD)', 'Chamadas', 'Última atividade'].map(h => (
                      <th key={h} className="px-5 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {usageLoading ? (
                    <tr><td colSpan={8} className="text-center py-12 text-slate-300 font-black uppercase text-xs">Carregando...</td></tr>
                  ) : !usageStats || usageStats.by_tenant.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-slate-300 font-black uppercase text-xs">
                      Nenhum dado de uso encontrado.<br/>
                      <span className="text-[9px] font-bold normal-case text-slate-300">Execute o script SQL para criar a tabela ai_usage_logs.</span>
                    </td></tr>
                  ) : usageStats.by_tenant.map(row => (
                    <tr key={row.tenant_id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-4 font-black text-sm text-black">{row.tenant_name}</td>
                      <td className="px-5 py-4">
                        <span className="text-[9px] font-black px-2 py-1 bg-slate-100 text-slate-600 rounded-lg uppercase">{row.nicho}</span>
                      </td>
                      <td className="px-5 py-4 text-[11px] font-bold text-slate-600 text-right">{row.input_tokens.toLocaleString()}</td>
                      <td className="px-5 py-4 text-[11px] font-bold text-slate-600 text-right">{row.output_tokens.toLocaleString()}</td>
                      <td className="px-5 py-4 font-black text-sm text-black text-right">{row.total_tokens.toLocaleString()}</td>
                      <td className="px-5 py-4 text-right">
                        <span className="font-black text-sm text-green-600">${row.estimated_cost_usd.toFixed(4)}</span>
                        {usdToBrl && (
                          <span className="block text-[10px] font-bold text-slate-400">R${(row.estimated_cost_usd * usdToBrl).toFixed(2)}</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-[11px] font-bold text-slate-600 text-right">{row.calls.toLocaleString()}</td>
                      <td className="px-5 py-4 text-[10px] font-bold text-slate-400 whitespace-nowrap">
                        {row.last_activity ? new Date(row.last_activity).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5">
            <p className="text-[10px] font-black text-blue-700 uppercase tracking-widest">ℹ️ Preços de referência</p>
            <p className="text-xs text-blue-600 mt-1">GPT-4.1 Mini: $0,400/1M tokens entrada · $1,600/1M tokens saída &nbsp;|&nbsp; Gemini 2.0 Flash: gratuito (tier free)</p>
          </div>

          {/* ── Motor Global de IA — Otimizar Todos ── */}
          <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-3xl border-2 border-violet-200 p-8 space-y-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[10px] font-black text-violet-700 uppercase tracking-widest">🌐 Motor Global de IA</p>
                <p className="font-black text-xl text-violet-900 mt-1">Otimizar Todos os Tenants</p>
                <p className="text-xs text-violet-600 mt-1 max-w-lg">
                  Analisa as conversas de <strong>todos os tenants simultaneamente</strong>, extrai padrões globais de sucesso/falha com GPT-4.1 Mini e aplica aprendizados cruzados — o que funciona em um negócio melhora os outros.
                </p>
              </div>
              <button
                onClick={handleRunAllOptimizer}
                disabled={optimizingAll || tenants.length === 0}
                className="px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-widest bg-violet-700 text-white hover:bg-violet-800 disabled:opacity-40 transition-all flex items-center gap-3 shrink-0 shadow-lg shadow-violet-200"
              >
                {optimizingAll ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Otimizando {allProgress.filter(p => p.status === 'ok').length}/{tenants.length}...</>
                ) : '🚀 Otimizar Todos'}
              </button>
            </div>

            {/* Progress list */}
            {allProgress.length > 0 && (
              <div className="bg-white/70 backdrop-blur rounded-2xl border border-violet-100 divide-y divide-violet-50 overflow-hidden">
                {allProgress.map(p => {
                  const icon = p.status === 'pending' ? '⏳' : p.status === 'running' ? '⚙️' : p.status === 'ok' ? '✅' : p.status === 'skipped' ? '⏭️' : '❌';
                  const color = p.status === 'ok' ? 'text-green-700' : p.status === 'error' ? 'text-red-600' : p.status === 'skipped' ? 'text-slate-400' : p.status === 'running' ? 'text-violet-700' : 'text-slate-300';
                  return (
                    <div key={p.tenantId} className="flex items-center gap-3 px-4 py-2.5">
                      <span className={`text-base shrink-0 ${p.status === 'running' ? 'animate-spin' : ''}`}>{p.status === 'running' ? '⚙️' : icon}</span>
                      <p className={`text-xs font-black flex-1 ${color}`}>{p.tenantName}</p>
                      {p.message && <p className="text-[10px] font-bold text-slate-400 truncate max-w-48">{p.message}</p>}
                      {p.status === 'running' && <div className="w-3 h-3 border-2 border-violet-300 border-t-violet-700 rounded-full animate-spin shrink-0" />}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Summary after all done */}
            {allResults && (
              <div className="bg-white rounded-2xl border border-violet-100 p-5 space-y-3">
                <p className="text-[10px] font-black text-violet-600 uppercase tracking-widest">Resultado Global</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-green-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-black text-green-700">{allResults.filter(r => r.status === 'ok').length}</p>
                    <p className="text-[9px] font-black text-green-600 uppercase tracking-widest mt-0.5">Otimizados</p>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-black text-slate-400">{allResults.filter(r => r.status === 'skipped').length}</p>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Sem dados</p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-black text-red-600">{allResults.filter(r => r.status === 'error').length}</p>
                    <p className="text-[9px] font-black text-red-500 uppercase tracking-widest mt-0.5">Erros</p>
                  </div>
                </div>
                {allResults.filter(r => r.status === 'ok').length > 0 && (
                  <p className="text-[10px] font-bold text-violet-600">
                    ✅ Acertos, falhas e bugs coletados de todos os tenants — padrões de comportamento humano aplicados em cada agente.
                  </p>
                )}
                {/* Insights discovered this cycle */}
                {(() => {
                  const allInsights = allResults.flatMap(r => r.result?.insights || []).filter(Boolean);
                  if (allInsights.length === 0) return null;
                  return (
                    <div className="bg-violet-50 rounded-xl p-4 space-y-2">
                      <p className="text-[9px] font-black text-violet-600 uppercase tracking-widest">🧠 Padrões de comportamento humano descobertos neste ciclo</p>
                      <ul className="space-y-1.5">
                        {allInsights.slice(0, 8).map((insight, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-violet-400 font-black text-xs shrink-0 mt-0.5">•</span>
                            <p className="text-xs text-slate-700 leading-relaxed">{insight}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* ── Evolução Global do Agente ── */}
          {evolutionHistory.length > 0 && (
            <div className="bg-white rounded-3xl border-2 border-slate-100 p-8 space-y-5">
              <div>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">📈 Evolução do Agente Global</p>
                <p className="font-black text-lg text-black mt-1">Nível de Capacidade da IA</p>
                <p className="text-xs text-slate-400">Score composto: taxa de conversão + otimizações realizadas. Aumenta conforme mais ciclos são executados.</p>
              </div>

              {/* Score gauge */}
              <div className="flex items-center gap-6">
                <div className="relative w-28 h-28 shrink-0">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#f1f5f9" strokeWidth="12" />
                    <circle
                      cx="50" cy="50" r="40" fill="none"
                      stroke={evolutionHistory[0].globalScore >= 70 ? '#7c3aed' : evolutionHistory[0].globalScore >= 40 ? '#f97316' : '#ef4444'}
                      strokeWidth="12"
                      strokeDasharray={`${evolutionHistory[0].globalScore * 2.51} 251`}
                      strokeLinecap="round"
                      className="transition-all duration-700"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <p className="text-2xl font-black text-black leading-none">{evolutionHistory[0].globalScore}</p>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">/ 100</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Taxa média de conversão</p>
                    <p className="text-2xl font-black text-orange-600">{evolutionHistory[0].avgConversionRate}%</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Conversas</p>
                      <p className="text-sm font-black text-slate-700">{evolutionHistory[0].totalConversations.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Agendados</p>
                      <p className="text-sm font-black text-green-700">{evolutionHistory[0].totalBooked.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Tenants opt.</p>
                      <p className="text-sm font-black text-violet-700">{evolutionHistory[0].tenantsOptimized}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* History timeline */}
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Histórico de Ciclos</p>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {evolutionHistory.map((snap, i) => {
                    const prev = evolutionHistory[i + 1];
                    const delta = prev ? snap.globalScore - prev.globalScore : 0;
                    return (
                      <div key={snap.date} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-2.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                        <p className="text-[10px] font-black text-slate-500 shrink-0 w-24">
                          {(() => { try { return new Date(snap.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }); } catch { return ''; } })()}
                        </p>
                        <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${snap.globalScore}%`,
                              backgroundColor: snap.globalScore >= 70 ? '#7c3aed' : snap.globalScore >= 40 ? '#f97316' : '#ef4444'
                            }}
                          />
                        </div>
                        <p className="font-black text-sm text-black w-8 text-right">{snap.globalScore}</p>
                        {delta !== 0 && (
                          <p className={`text-[9px] font-black w-10 text-right ${delta > 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {delta > 0 ? '+' : ''}{delta}
                          </p>
                        )}
                        <p className="text-[9px] font-bold text-slate-400 shrink-0">{snap.tenantsOptimized}/{snap.totalTenants} tenants · {snap.avgConversionRate}% conv.</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── Otimização de IA por Tenant ── */}
          <div className="bg-white rounded-3xl border-2 border-violet-100 p-8 space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black text-violet-600 uppercase tracking-widest">🔧 Otimização de IA por Tenant</p>
                <p className="text-xs text-slate-400 mt-1">Analisa conversas com GPT-4.1 Mini, melhora o prompt e envia relatório no chat de Suporte do tenant.</p>
              </div>
            </div>

            {/* Tenant selector + period + optimize button */}
            <div className="flex flex-wrap gap-3 items-end">
              <select
                value={optimizerTenantId}
                onChange={e => { setOptimizerTenantId(e.target.value); setOptimizerResult(null); setOptimizerError(null); }}
                className="flex-1 min-w-48 p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-violet-400 transition-all"
              >
                <option value="">Selecionar tenant...</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <div className="flex items-center gap-1.5">
                {[7, 14, 30].map(d => (
                  <button key={d} onClick={() => setOptimizerSinceDays(d)}
                    className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      optimizerSinceDays === d ? 'bg-black text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}>{d}d</button>
                ))}
              </div>
              <button
                onClick={handleRunOptimizer}
                disabled={!optimizerTenantId || optimizing}
                className="px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-all flex items-center gap-2 shrink-0"
              >
                {optimizing ? (
                  <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Otimizando...</>
                ) : '🔧 Otimizar Agora'}
              </button>
            </div>

            {/* Errors / Result */}
            {optimizerError && (
              <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-3">
                <p className="text-sm font-bold text-red-700">⚠️ {optimizerError}</p>
              </div>
            )}
            {optimizerResult && (
              <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-4 space-y-3">
                <p className="text-[10px] font-black text-green-700 uppercase tracking-widest">✅ Otimização concluída — relatório enviado no Suporte do tenant</p>
                <p className="text-sm font-bold text-green-800">{optimizerResult.summary}</p>
                <p className="text-[10px] font-bold text-green-600">
                  ✅ {optimizerResult.booked} agendados · ❌ {optimizerResult.abandoned} abandonados · 💬 {optimizerResult.total} conversas analisadas
                </p>
                {optimizerResult.insights && optimizerResult.insights.length > 0 && (
                  <div className="border-t border-green-200 pt-3 space-y-1.5">
                    <p className="text-[9px] font-black text-green-700 uppercase tracking-widest">🧠 Padrões de comportamento humano identificados</p>
                    {optimizerResult.insights.map((ins, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-green-500 font-black text-xs shrink-0 mt-0.5">•</span>
                        <p className="text-xs text-green-800 leading-relaxed">{ins}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Stats cards (only when tenant selected) */}
            {optimizerTenantId && (() => {
              const booked = optimizerLogs.filter(l => l.outcome === 'booked').length;
              const abandoned = optimizerLogs.filter(l => l.outcome === 'abandoned').length;
              const duplicates = optimizerLogs.filter(l => l.outcome === 'duplicate').length;
              const total = optimizerLogs.filter(l => l.outcome !== 'duplicate').length;
              const rate = total > 0 ? Math.round(booked / total * 100) : 0;
              return (
                <div className="grid grid-cols-5 gap-3">
                  {[
                    { label: 'Conversas',   value: total,      color: 'text-slate-800',  bg: 'bg-slate-50',    emoji: '💬',  filter: 'all' },
                    { label: 'Agendados',   value: booked,     color: 'text-green-700',  bg: 'bg-green-50',    emoji: '✅',  filter: 'booked' },
                    { label: 'Abandonados', value: abandoned,  color: 'text-red-600',    bg: 'bg-red-50',      emoji: '❌',  filter: 'abandoned' },
                    { label: 'Conversão',   value: `${rate}%`, color: 'text-orange-600', bg: 'bg-orange-50',   emoji: '🎯',  filter: null },
                    { label: 'Duplicatas',  value: duplicates, color: duplicates > 0 ? 'text-yellow-600' : 'text-slate-400', bg: duplicates > 0 ? 'bg-yellow-50' : 'bg-slate-50', emoji: duplicates > 0 ? '⚠️' : '✔️', filter: 'duplicate' },
                  ].map(c => {
                    const isActive = c.filter === 'all'
                      ? optimizerOutcomeFilter === null
                      : optimizerOutcomeFilter === c.filter;
                    const handleClick = () => {
                      if (c.filter === null) return;
                      if (c.filter === 'all') { setOptimizerOutcomeFilter(null); return; }
                      setOptimizerOutcomeFilter(prev => prev === c.filter ? null : c.filter);
                    };
                    return (
                      <div
                        key={c.label}
                        onClick={handleClick}
                        title={c.filter && c.filter !== null ? `Filtrar por: ${c.label}` : undefined}
                        className={`${c.bg} rounded-2xl p-4 space-y-1 border transition-all select-none ${c.filter ? 'cursor-pointer hover:shadow-md hover:scale-[1.02]' : ''} ${isActive ? 'ring-2 ring-black shadow-md' : 'border-slate-100'}`}
                      >
                        <p className="text-xl">{c.emoji}</p>
                        <p className={`text-2xl font-black ${c.color}`}>{optimizerLogsLoading ? '—' : c.value}</p>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{c.label}</p>
                        {isActive && c.filter && (
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">● filtro ativo</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Last optimization info */}
            {optimizerTenantId && optimizerSettings && (
              <div className="bg-violet-50 border border-violet-100 rounded-2xl px-5 py-4 space-y-1">
                <p className="text-[10px] font-black text-violet-600 uppercase tracking-widest">Última Otimização Aplicada</p>
                {optimizerSettings.lastOptimizedAt ? (
                  <>
                    <p className="text-xs font-bold text-slate-600">
                      {(() => { try { return new Date(optimizerSettings.lastOptimizedAt!).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } })()}
                    </p>
                    {optimizerSettings.lastOptimizationSummary && (
                      <p className="text-xs text-slate-700 leading-relaxed">{optimizerSettings.lastOptimizationSummary}</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs font-bold text-slate-400">Nenhuma otimização realizada ainda para este tenant.</p>
                )}
              </div>
            )}

            {/* Current prompt */}
            {optimizerTenantId && optimizerSettings && (
              <div className="space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Prompt Atual do Agente</p>
                <textarea
                  readOnly
                  value={optimizerSettings.systemPrompt || '(sem prompt personalizado)'}
                  className="w-full h-28 resize-none rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-mono text-slate-700 focus:outline-none"
                />
              </div>
            )}

            {/* Conversation logs */}
            {optimizerTenantId && (() => {
              const LABELS: Record<string, { label: string; color: string; emoji: string }> = {
                booked:    { label: 'Agendado',   color: 'bg-green-100 text-green-700',   emoji: '✅' },
                abandoned: { label: 'Abandonado', color: 'bg-red-100 text-red-600',       emoji: '❌' },
                info:      { label: 'Informação', color: 'bg-slate-100 text-slate-600',   emoji: 'ℹ️' },
                duplicate: { label: 'Duplicata',  color: 'bg-yellow-100 text-yellow-700', emoji: '⚠️' },
              };
              const visibleLogs = optimizerOutcomeFilter
                ? optimizerLogs.filter(l => l.outcome === optimizerOutcomeFilter)
                : optimizerLogs;
              return (
                <div className="border border-slate-100 rounded-2xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Conversas do Tenant</p>
                      {optimizerOutcomeFilter && (
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${LABELS[optimizerOutcomeFilter]?.color}`}>
                          {LABELS[optimizerOutcomeFilter]?.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-black text-slate-400">{visibleLogs.length} registros</p>
                      {optimizerOutcomeFilter && (
                        <button onClick={() => setOptimizerOutcomeFilter(null)}
                          className="text-[9px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest transition-colors">
                          ✕ limpar filtro
                        </button>
                      )}
                    </div>
                  </div>
                  {optimizerLogsLoading ? (
                    <div className="flex items-center gap-3 p-8">
                      <div className="w-4 h-4 border-2 border-slate-100 border-t-violet-500 rounded-full animate-spin" />
                      <p className="text-xs font-black text-slate-400 uppercase">Carregando...</p>
                    </div>
                  ) : visibleLogs.length === 0 ? (
                    <div className="p-10 text-center">
                      <p className="text-3xl mb-2">{optimizerOutcomeFilter ? LABELS[optimizerOutcomeFilter]?.emoji : '💬'}</p>
                      <p className="text-xs font-black text-slate-300 uppercase tracking-wider">
                        {optimizerOutcomeFilter ? `Nenhum registro de "${LABELS[optimizerOutcomeFilter]?.label}" no período` : 'Nenhuma conversa registrada no período'}
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-50 max-h-96 overflow-y-auto">
                      {visibleLogs.map(log => {
                        const info = LABELS[log.outcome] || LABELS.info;
                        const isExp = optimizerExpandedId === log.id;
                        const isDuplicate = log.outcome === 'duplicate';
                        const dupMsg = isDuplicate ? (log.history?.[0] as any)?.text || '' : '';
                        const isEditing = editingLogId === log.id;
                        const isDeleting = deletingLogId === log.id;
                        return (
                          <div key={log.id} className="group">
                            <div className={`flex items-center gap-0 ${isDuplicate ? 'border-l-[3px] border-l-yellow-400' : ''}`}>
                              {/* Main row — expand on click */}
                              <button
                                onClick={() => { setOptimizerExpandedId(isExp ? null : log.id); setEditingLogId(null); setDeletingLogId(null); }}
                                className="flex-1 flex items-center gap-4 px-5 py-3 hover:bg-slate-50 transition-all text-left"
                              >
                                <span className="text-sm shrink-0">{info.emoji}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-xs font-black text-slate-800">
                                      {(() => { try { return new Date(log.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } })()}
                                    </p>
                                    {log.phone && <p className="text-[10px] font-bold text-slate-400">{log.phone}</p>}
                                  </div>
                                  {isDuplicate ? (
                                    <p className="text-[10px] font-bold text-yellow-600 truncate mt-0.5">
                                      Msg repetida: "{dupMsg.slice(0, 60)}{dupMsg.length > 60 ? '…' : ''}"
                                    </p>
                                  ) : (
                                    <p className="text-[10px] font-bold text-slate-400">{log.turns} turnos na conversa</p>
                                  )}
                                </div>
                                <span className={`shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full ${info.color}`}>{info.label}</span>
                                <span className={`text-[10px] text-slate-300 font-black transition-transform ${isExp ? 'rotate-90' : ''}`}>▶</span>
                              </button>
                              {/* Action buttons — visible on hover */}
                              <div className="flex items-center gap-1 pr-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                <button
                                  onClick={e => { e.stopPropagation(); setEditingLogId(isEditing ? null : log.id); setEditingOutcome(log.outcome); setDeletingLogId(null); setOptimizerExpandedId(log.id); }}
                                  title="Reclassificar apontamento"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-all"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                </button>
                                <button
                                  onClick={e => { e.stopPropagation(); setDeletingLogId(isDeleting ? null : log.id); setEditingLogId(null); setOptimizerExpandedId(log.id); }}
                                  title="Apagar apontamento"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                              </div>
                            </div>

                            {/* Expanded panel */}
                            {isExp && (
                              <div className="px-5 pb-4 pt-2 bg-slate-50 space-y-3">

                                {/* Edit panel */}
                                {isEditing && (
                                  <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
                                    <p className="text-[10px] font-black text-violet-700 uppercase tracking-widest shrink-0">Reclassificar como:</p>
                                    <select
                                      value={editingOutcome}
                                      onChange={e => setEditingOutcome(e.target.value as ConversationLog['outcome'])}
                                      className="flex-1 min-w-28 px-3 py-1.5 rounded-lg border border-violet-200 bg-white text-xs font-bold text-slate-700 outline-none focus:border-violet-500"
                                    >
                                      <option value="booked">✅ Agendado</option>
                                      <option value="abandoned">❌ Abandonado</option>
                                      <option value="info">ℹ️ Informação</option>
                                      <option value="duplicate">⚠️ Duplicata</option>
                                    </select>
                                    <button onClick={() => handleSaveLogEdit(log.id)} className="px-3 py-1.5 bg-violet-600 text-white text-[10px] font-black rounded-lg hover:bg-violet-700 transition-all uppercase tracking-widest">Salvar</button>
                                    <button onClick={() => setEditingLogId(null)} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 text-[10px] font-black rounded-lg hover:bg-slate-50 transition-all uppercase tracking-widest">Cancelar</button>
                                  </div>
                                )}

                                {/* Delete confirmation */}
                                {isDeleting && (
                                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
                                    <p className="text-xs font-bold text-red-700 flex-1">Apagar este apontamento permanentemente? Ele não será mais considerado nas próximas otimizações.</p>
                                    <button onClick={() => handleDeleteLog(log.id)} className="px-3 py-1.5 bg-red-600 text-white text-[10px] font-black rounded-lg hover:bg-red-700 transition-all uppercase tracking-widest shrink-0">Apagar</button>
                                    <button onClick={() => setDeletingLogId(null)} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 text-[10px] font-black rounded-lg hover:bg-slate-50 transition-all uppercase tracking-widest shrink-0">Cancelar</button>
                                  </div>
                                )}

                                {isDuplicate ? (
                                  <div className="space-y-2">
                                    <p className="text-[10px] font-black text-yellow-700 uppercase tracking-widest">⚠️ Mensagem Duplicada Detectada</p>
                                    <div className="bg-yellow-50 border-2 border-yellow-200 rounded-2xl px-4 py-3 space-y-1">
                                      <p className="text-[9px] font-black text-yellow-600 uppercase tracking-widest">Mensagem repetida</p>
                                      <p className="text-sm font-bold text-slate-800">"{dupMsg}"</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                                      <div className="bg-white border border-slate-100 rounded-xl px-3 py-2">
                                        <p className="font-black text-slate-400 uppercase tracking-widest mb-0.5">Lead (telefone)</p>
                                        <p className="font-bold text-slate-700">{log.phone || '—'}</p>
                                      </div>
                                      <div className="bg-white border border-slate-100 rounded-xl px-3 py-2">
                                        <p className="font-black text-slate-400 uppercase tracking-widest mb-0.5">Quando ocorreu</p>
                                        <p className="font-bold text-slate-700">
                                          {(() => { try { return new Date(log.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return '—'; } })()}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="bg-white border border-slate-100 rounded-xl px-3 py-2">
                                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Motivo provável</p>
                                      <p className="text-[10px] font-bold text-slate-600">O agente detectou o mesmo gatilho duas vezes em menos de 10 minutos (ex: mensagem de reset/sair recebida duplicada pelo webhook) e enviou a mesma resposta novamente. O GPT-4.1 Mini incluirá este padrão na próxima otimização automática.</p>
                                    </div>
                                  </div>
                                ) : (
                                  (log.history || []).map((msg, i) => (
                                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                      <div className={`max-w-[80%] px-3 py-1.5 rounded-[12px] text-xs font-medium ${
                                        msg.role === 'user' ? 'bg-black text-white' : 'bg-orange-50 border border-orange-100 text-slate-700'
                                      }`}>{msg.text}</div>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ══════════════════════ CONVERSAS ══════════════════════ */}
      {tab === 'conversas' && (
        <AdminConversasPanel
          instanceName={adminInstanceName}
          setInstanceName={setAdminInstanceName}
          connected={adminConnected}
          setConnected={setAdminConnected}
        />
      )}

      {/* ══════════════════════ PROSPECÇÃO ══════════════════════ */}
      {tab === 'prospeccao' && (
        <AdminProspeccaoPanel
          campaigns={prospectCampaigns}
          onCampaignsChange={handleCampaignsChange}
          onGoToDisparo={handleGoToDisparo}
        />
      )}

      {/* ══════════════════════ DISPARADOR ADMIN ══════════════════════ */}
      {tab === 'disparo' && (
        <AdminDisparoPanel
          adminInstanceName={adminInstanceName}
          adminConnected={adminConnected}
          campaigns={prospectCampaigns}
          initialCampaignId={disparoCampaignId}
          onGoToConexao={() => setTab('conversas' as Tab)}
          onDeleteCampaign={(id) => handleCampaignsChange(prospectCampaigns.filter(c => c.id !== id))}
          onGoToCampaigns={() => setTab('campanhas' as Tab)}
        />
      )}

      {/* ══════════════════════ CAMPANHAS (status) ══════════════════════ */}
      {tab === 'campanhas' && <CampaignsStatusView />}

      {/* ══════════════════════ SUPORTE ══════════════════════ */}
      {tab === 'suporte' && (
        <div className="flex gap-0 h-[calc(100vh-180px)] bg-white rounded-[24px] border-2 border-slate-100 overflow-hidden">
          {/* Left column — tenant chat list */}
          <div className="w-72 shrink-0 border-r border-slate-100 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Conversas</p>
              <button
                onClick={loadSupportChats}
                className="text-[10px] font-black text-orange-500 uppercase tracking-widest hover:underline"
              >
                ↻
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {chatsLoading ? (
                <div className="flex items-center justify-center h-24">
                  <div className="w-5 h-5 border-2 border-slate-100 border-t-orange-500 rounded-full animate-spin" />
                </div>
              ) : supportChats.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-12 text-center px-4">
                  <p className="text-3xl mb-2">💬</p>
                  <p className="text-xs font-black text-slate-300 uppercase tracking-wider">Nenhuma conversa</p>
                </div>
              ) : (
                supportChats.map(chat => (
                  <button
                    key={chat.tenantId}
                    onClick={() => handleSelectChat(chat.tenantId)}
                    className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-all flex items-center gap-3 ${selectedChatId === chat.tenantId ? 'bg-orange-50 border-l-2 border-l-orange-500' : ''}`}
                  >
                    <div className="w-9 h-9 shrink-0 rounded-full bg-orange-100 flex items-center justify-center font-black text-orange-600 text-sm uppercase">
                      {chat.tenantName.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <p className="font-black text-slate-800 text-xs truncate">{chat.tenantName}</p>
                        {chat.unreadCount > 0 && (
                          <span className="shrink-0 bg-orange-500 text-white text-[9px] font-black rounded-full w-4 h-4 flex items-center justify-center">
                            {chat.unreadCount}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 truncate font-medium">{chat.lastMessage || '—'}</p>
                      <p className="text-[9px] text-slate-300 font-bold">
                        {chat.lastAt ? new Date(chat.lastAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right column — messages */}
          <div className="flex-1 flex flex-col min-w-0">
            {!selectedChatId ? (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
                <p className="text-4xl">👈</p>
                <p className="text-sm font-black text-slate-300 uppercase tracking-wider">Selecione uma conversa</p>
              </div>
            ) : (
              <>
                {/* Chat header */}
                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center font-black text-orange-600 text-sm uppercase">
                    {(supportChats.find(c => c.tenantId === selectedChatId)?.tenantName || '?').charAt(0)}
                  </div>
                  <div>
                    <p className="font-black text-slate-800 text-sm">{supportChats.find(c => c.tenantId === selectedChatId)?.tenantName || selectedChatId}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Chat de Suporte</p>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                  {chatMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                      <p className="text-3xl mb-2">💬</p>
                      <p className="text-xs font-bold text-slate-300">Nenhuma mensagem ainda.</p>
                    </div>
                  ) : (
                    chatMessages.map(msg => (
                      <div key={msg.id} className={`flex ${msg.sender === 'tenant' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[70%] space-y-1 ${msg.sender === 'tenant' ? 'items-end' : 'items-start'} flex flex-col`}>
                          <div className={`px-4 py-2.5 rounded-[18px] text-sm font-medium leading-relaxed ${
                            msg.sender === 'tenant'
                              ? 'bg-slate-100 text-slate-800 rounded-br-sm'
                              : 'bg-orange-50 border border-orange-100 text-slate-800 rounded-bl-sm'
                          }`}>
                            {msg.imageUrl && (
                              <img
                                src={msg.imageUrl}
                                alt="imagem"
                                className="max-w-full rounded-xl mb-1 cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => setExpandedImg(msg.imageUrl!)}
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            )}
                            {msg.content && <span>{msg.content}</span>}
                          </div>
                          <div className="flex items-center gap-1 px-1">
                            <span className="text-[9px] text-slate-300 font-bold">
                              {msg.sender === 'support' ? '🎧 Suporte · ' : ''}
                              {(() => { try { return new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } })()}
                            </span>
                            {msg.sender === 'support' && (
                              <span className={`text-[9px] font-black ${msg.read ? 'text-orange-400' : 'text-slate-300'}`}>
                                {msg.read ? '✓✓ Visualizada' : '✓'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={chatBottomRef} />
                </div>

                {/* Reply footer */}
                <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex items-end gap-2">
                  <textarea
                    value={chatText}
                    onChange={e => setChatText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendSupportReply(); } }}
                    placeholder="Digite sua resposta..."
                    rows={1}
                    className="flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:border-orange-300 transition-all leading-snug"
                    style={{ maxHeight: 80, overflowY: 'auto' }}
                  />
                  <button
                    onClick={handleSendSupportReply}
                    disabled={chatSending || !chatText.trim()}
                    className="w-10 h-10 shrink-0 rounded-xl bg-orange-500 flex items-center justify-center hover:bg-orange-600 transition-all disabled:opacity-40"
                  >
                    {chatSending
                      ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    }
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Image lightbox */}
      {expandedImg && (
        <div
          className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setExpandedImg('')}
        >
          <button
            onClick={() => setExpandedImg('')}
            className="absolute top-4 right-4 w-10 h-10 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30 transition-all"
          >
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <img
            src={expandedImg}
            alt="imagem expandida"
            className="max-w-full max-h-full rounded-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* ══════════════════════ CONFIGURAÇÕES ══════════════════════ */}
      {tab === 'config' && (
        <div className="space-y-6 max-w-2xl">

          {/* ── Credenciais de Acesso ── */}
          <div className="bg-white rounded-3xl border-2 border-slate-100 p-8 space-y-5">
            <div>
              <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">🔐 Credenciais de Acesso</p>
              <p className="text-xs text-slate-400 mt-1">Altere o e-mail e a senha de login do superadmin. Após salvar, as novas credenciais serão exigidas no próximo login.</p>
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Novo E-mail de Acesso</label>
                <input
                  type="email"
                  value={cfgEmail}
                  onChange={e => setCfgEmail(e.target.value)}
                  placeholder="admin@suaempresa.com"
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-mono text-sm outline-none focus:border-orange-500 transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Nova Senha</label>
                <div className="relative">
                  <input
                    type={showCfgPass ? 'text' : 'password'}
                    value={cfgPass}
                    onChange={e => setCfgPass(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-mono text-sm outline-none focus:border-orange-500 transition-all pr-16"
                  />
                  <button type="button" onClick={() => setShowCfgPass(v => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-black text-xs font-black uppercase">
                    {showCfgPass ? 'Ocultar' : 'Ver'}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Confirmar Nova Senha</label>
                <input
                  type="password"
                  value={cfgPassConfirm}
                  onChange={e => setCfgPassConfirm(e.target.value)}
                  placeholder="Repita a senha"
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-mono text-sm outline-none focus:border-orange-500 transition-all"
                />
              </div>
            </div>
            {cfgError && <p className="text-xs font-bold text-red-500">{cfgError}</p>}
            <button
              onClick={async () => {
                setCfgError('');
                if (!cfgEmail.trim()) { setCfgError('Informe o e-mail.'); return; }
                if (cfgPass && cfgPass !== cfgPassConfirm) { setCfgError('As senhas não coincidem.'); return; }
                if (cfgPass && cfgPass.length < 8) { setCfgError('Senha deve ter no mínimo 8 caracteres.'); return; }
                setCfgSaving(true);
                try {
                  const updates: Record<string, string> = { admin_email: cfgEmail.trim() };
                  if (cfgPass) updates['admin_password'] = cfgPass;
                  await db.saveGlobalConfig(updates);
                  setCfgSaved(true);
                  setCfgPass(''); setCfgPassConfirm('');
                  setTimeout(() => setCfgSaved(false), 3000);
                } finally { setCfgSaving(false); }
              }}
              disabled={cfgSaving}
              className={`px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all disabled:opacity-50 ${cfgSaved ? 'bg-green-500 text-white' : 'bg-black text-white hover:bg-orange-500'}`}
            >
              {cfgSaving ? 'Salvando...' : cfgSaved ? '✓ Credenciais Salvas' : 'Salvar Credenciais'}
            </button>
          </div>

          {/* ── Chave OpenAI ── */}
          <div className="bg-white rounded-3xl border-2 border-orange-100 p-8 space-y-5">
            <div>
              <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">🔑 Chave OpenAI Compartilhada</p>
              <p className="text-xs text-slate-400 mt-1">Chave da API OpenAI, usada para IA (calendário de conteúdo, tendências). Propagada para todos os tenants. Obtenha em <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" className="text-orange-500 underline">platform.openai.com/api-keys</a></p>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  type={showSharedKey ? 'text' : 'password'}
                  value={sharedOpenAiKey}
                  onChange={e => setSharedOpenAiKey(e.target.value)}
                  placeholder="sk-proj-..."
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-mono text-sm outline-none focus:border-orange-500 transition-all pr-16"
                />
                <button type="button" onClick={() => setShowSharedKey(v => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-black text-xs font-black uppercase">
                  {showSharedKey ? 'Ocultar' : 'Ver'}
                </button>
              </div>
              <button onClick={handleSaveSharedKey} disabled={savingSharedKey}
                className={`px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all disabled:opacity-50 ${sharedKeySaved ? 'bg-green-500 text-white' : 'bg-black text-white hover:bg-orange-500'}`}>
                {savingSharedKey ? 'Salvando...' : sharedKeySaved ? '✓ Aplicado' : 'Salvar & Aplicar'}
              </button>
            </div>
            {sharedOpenAiKey && (
              <p className="text-[10px] font-black text-green-600 uppercase tracking-widest">
                ✓ Chave configurada — {sharedOpenAiKey.length} caracteres
              </p>
            )}
          </div>

          {/* ── Plataforma ── */}
          <div className="bg-white rounded-3xl border-2 border-slate-100 p-8 space-y-5">
            <div>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">🏢 Dados da Plataforma</p>
              <p className="text-xs text-slate-400 mt-1">Informações gerais exibidas no sistema.</p>
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Nome da Plataforma</label>
                <input type="text" value={cfgPlatformName} onChange={e => setCfgPlatformName(e.target.value)}
                  placeholder="AgendeZap"
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none focus:border-orange-500 transition-all" />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">E-mail de Suporte</label>
                <input type="email" value={cfgSupportEmail} onChange={e => setCfgSupportEmail(e.target.value)}
                  placeholder="suporte@agendezap.com"
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none focus:border-orange-500 transition-all" />
              </div>
            </div>
            <button
              onClick={async () => {
                await db.saveGlobalConfig({ platform_name: cfgPlatformName, support_email: cfgSupportEmail });
                setCfgSaved(true); setTimeout(() => setCfgSaved(false), 2000);
              }}
              className="px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest bg-black text-white hover:bg-orange-500 transition-all">
              Salvar Plataforma
            </button>
          </div>

          {/* ── Danger Zone ── */}
          <div className="bg-white rounded-3xl border-2 border-red-100 p-8 space-y-4">
            <p className="text-[10px] font-black text-red-500 uppercase tracking-widest">⚠️ Zona de Risco</p>
            <p className="text-xs text-slate-400">Credenciais de emergência (hardcoded): <span className="font-mono text-slate-600">admin@super.com</span> — use apenas se perder acesso às credenciais configuradas acima.</p>
          </div>

        </div>
      )}

      {/* ══════════════════════ CENTRAL ══════════════════════ */}
      {tab === 'central' && (
        <CentralTab
          instanceName={centralInstanceName}
          setInstanceName={setCentralInstanceName}
          connected={centralConnected}
          setConnected={setCentralConnected}
        />
      )}

      {/* ══════════════════════ WA CENTRAL (Conversas) ══════════════════════ */}
      {tab === 'wa_central' && (
        <AdminConversasPanel
          instanceName={centralInstanceName}
          setInstanceName={(v: string) => setCentralInstanceName(v)}
          connected={centralConnected}
          setConnected={setCentralConnected}
        />
      )}

      {/* ══════════════════════ LEADS ══════════════════════ */}
      {tab === 'leads' && (
        <LeadsTab />
      )}

      {/* ══════════════════════ CASHBACK ══════════════════════ */}
      {tab === 'cashback' && (
        <CashbackTab />
      )}

      {/* ══════════════════════ TESTES ══════════════════════ */}
      {tab === 'testes' && (
        <TestRunnerPanel tenants={tenants} />
      )}

      {/* ══════════════════════ MODALS ══════════════════════ */}

      {/* New tenant modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex items-start justify-center min-h-full py-8 px-4">
            <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp border-4 border-black">
              {!successData ? (
                <>
                  <h2 className="text-2xl font-black text-black uppercase tracking-tight">Nova Unidade</h2>
                  <div className="space-y-4">
                    {([
                      ['Nome da unidade *', newName, setNewName, 'text', 'Ex: Barber Centro'],
                      ['E-mail (auto se vazio)', newEmail, setNewEmail, 'email', 'email@exemplo.com'],
                      ['Senha (auto se vazio)', newPass, setNewPass, 'text', 'Senha123'],
                      ['Telefone do proprietário', newPhone, setNewPhone, 'text', '5511999999999'],
                    ] as [string, string, (v: string) => void, string, string][]).map(([label, val, fn, type, ph]) => (
                      <div key={label} className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">{label}</label>
                        <input type={type} value={val} onChange={e => fn(e.target.value)} placeholder={ph}
                          className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
                      </div>
                    ))}
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Nicho / Segmento</label>
                      <select value={newNicho} onChange={e => setNewNicho(e.target.value)}
                        className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500">
                        {NICHOS.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    {/* Plan selector */}
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Plano de Assinatura</label>
                      <div className="grid grid-cols-3 gap-2">
                        {Object.values(PLAN_CONFIGS).map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setNewSubscriptionPlan(p.id);
                              if (p.id !== 'START' && p.id !== 'GRATIS') setNewProCount(1);
                              // Auto-update fee
                              const extra = (p.id === 'START' || p.id === 'GRATIS') ? Math.max(0, newProCount - 1) : 0;
                              setNewFee(String((p.price + extra * (p.additionalProfessionalPrice || 0)).toFixed(2)));
                            }}
                            className={`p-3 rounded-2xl border-2 text-center transition-all ${newSubscriptionPlan === p.id ? `${p.bgClass} ${p.borderClass}` : 'bg-white border-slate-100 hover:border-slate-300'}`}
                          >
                            <p className="text-lg">{p.emoji}</p>
                            <p className={`text-[10px] font-black uppercase ${newSubscriptionPlan === p.id ? p.textClass : 'text-slate-500'}`}>{p.name}</p>
                            <p className={`text-[9px] font-bold ${newSubscriptionPlan === p.id ? p.textClass : 'text-slate-400'}`}>R${p.price.toFixed(2).replace('.', ',')}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Professional count for START */}
                    {newSubscriptionPlan === 'START' && (
                      <div className="space-y-2">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Quantidade de Profissionais</label>
                        <div className="grid grid-cols-2 gap-3">
                          {[1, 2].map(n => {
                            const addonPrice = PLAN_CONFIGS.START.additionalProfessionalPrice || 19.90;
                            const total = PLAN_CONFIGS.START.price + (n - 1) * addonPrice;
                            return (
                              <button
                                key={n}
                                type="button"
                                onClick={() => {
                                  setNewProCount(n);
                                  setNewFee(String(total.toFixed(2)));
                                }}
                                className={`p-4 rounded-2xl border-2 text-center transition-all ${
                                  newProCount === n
                                    ? 'bg-green-50 border-green-300'
                                    : 'bg-white border-slate-100 hover:border-slate-300'
                                }`}
                              >
                                <p className="text-2xl font-black">{n}</p>
                                <p className={`text-[10px] font-black uppercase ${newProCount === n ? 'text-green-700' : 'text-slate-500'}`}>
                                  {n === 1 ? 'profissional' : 'profissionais'}
                                </p>
                                <p className={`text-xs font-black mt-1 ${newProCount === n ? 'text-green-600' : 'text-slate-400'}`}>
                                  R$ {total.toFixed(2).replace('.', ',')}
                                  <span className="text-[9px] font-bold">/mês</span>
                                </p>
                                {n === 2 && (
                                  <p className="text-[8px] font-bold text-orange-500 mt-0.5">+R$ {addonPrice.toFixed(2).replace('.', ',')} adicional</p>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {/* Demo / Trial toggle */}
                    <button
                      type="button"
                      onClick={() => setNewIsDemo(v => !v)}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${
                        newIsDemo
                          ? 'bg-amber-50 border-amber-400'
                          : 'bg-slate-50 border-slate-100 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{newIsDemo ? '🕐' : '💳'}</span>
                        <div className="text-left">
                          <p className={`text-xs font-black uppercase tracking-widest ${newIsDemo ? 'text-amber-700' : 'text-slate-500'}`}>
                            {newIsDemo ? 'Conta Demo (trial 7 dias)' : 'Conta Paga'}
                          </p>
                          <p className={`text-[10px] font-bold ${newIsDemo ? 'text-amber-500' : 'text-slate-400'}`}>
                            {newIsDemo ? 'IA desativada — expira em 7 dias' : 'Sem restrições de trial'}
                          </p>
                        </div>
                      </div>
                      <div className={`w-11 h-6 rounded-full transition-all flex items-center px-0.5 ${newIsDemo ? 'bg-amber-400' : 'bg-slate-200'}`}>
                        <div className={`w-5 h-5 rounded-full bg-white shadow transition-all ${newIsDemo ? 'translate-x-5' : 'translate-x-0'}`} />
                      </div>
                    </button>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Mensalidade (R$)</label>
                        <input type="number" value={newFee} onChange={e => setNewFee(e.target.value)} placeholder="0.00"
                          className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Dia de vencimento</label>
                        <input type="number" min={1} max={31} value={newDueDay} onChange={e => setNewDueDay(e.target.value)} placeholder="Ex: 10"
                          className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <button onClick={() => setShowNew(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs" disabled={creating}>Cancelar</button>
                    <button onClick={handleCreate} disabled={creating || !newName.trim()} className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-50">
                      {creating ? 'Criando...' : 'Ativar Acesso'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center space-y-8">
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center text-4xl mx-auto ${successData.isDemo ? 'bg-amber-100 text-amber-500' : 'bg-green-100 text-green-500'}`}>
                    {successData.isDemo ? '🕐' : '✓'}
                  </div>
                  <h2 className="text-2xl font-black text-black uppercase">
                    {successData.isDemo ? 'Demo Criado!' : 'Licença Ativada!'}
                  </h2>
                  {successData.isDemo && (
                    <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 text-center">
                      <p className="text-xs font-black text-amber-700 uppercase tracking-widest">Conta Trial — 7 dias</p>
                      <p className="text-[10px] font-bold text-amber-600 mt-1">IA desativada até ativar assinatura. O cliente verá o aviso de expiração no sistema.</p>
                    </div>
                  )}
                  <div className="bg-slate-50 p-6 rounded-2xl text-left border border-slate-100 space-y-3">
                    <p className="text-[9px] font-black text-slate-400 uppercase">E-mail</p>
                    <p className="font-black text-black break-all">{successData.email}</p>
                    <p className="text-[9px] font-black text-slate-400 uppercase mt-3">Senha</p>
                    <p className="text-xl font-black text-orange-500 font-mono">{successData.pass}</p>
                    <p className="text-[9px] font-black text-slate-400 uppercase mt-3">Link de agendamento</p>
                    <p className="text-xs font-bold text-blue-500 break-all">{window.location.origin}/agendar/{successData.slug}</p>
                  </div>
                  <button onClick={() => { setShowNew(false); setSuccessData(null); }} className="w-full py-4 bg-black text-white rounded-2xl font-black uppercase text-xs">Fechar</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit tenant modal */}
      {editingTenant && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex items-center justify-center min-h-full p-4">
            <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-6 animate-scaleUp border-4 border-orange-500">
              <h2 className="text-2xl font-black text-black uppercase tracking-tight">Editar — {editingTenant.name}</h2>
              <div className="space-y-4">
                {([
                  ['E-mail', editingTenant.email || '', (v: string) => setEditingTenant({ ...editingTenant, email: v }), 'email'],
                  ['Senha', editingTenant.password || '', (v: string) => setEditingTenant({ ...editingTenant, password: v }), 'text'],
                  ['Telefone do proprietário', editingTenant.phone || '', (v: string) => setEditingTenant({ ...editingTenant, phone: v }), 'text'],
                ] as [string, string, (v: string) => void, string][]).map(([label, val, fn, type]) => (
                  <div key={label} className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">{label}</label>
                    <input type={type} value={val} onChange={e => fn(e.target.value)}
                      className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Status</label>
                    <select value={editingTenant.status} onChange={e => setEditingTenant({ ...editingTenant, status: e.target.value as TenantStatus })}
                      className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500">
                      {Object.values(TenantStatus).map(s => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Dia de vencimento</label>
                    <input type="number" min={1} max={31} value={editingTenant.due_day || ''} onChange={e => setEditingTenant({ ...editingTenant, due_day: parseInt(e.target.value) || undefined })}
                      className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-center focus:border-orange-500" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Mensalidade (R$)</label>
                  <input type="number" value={editingTenant.monthlyFee} onChange={e => setEditingTenant({ ...editingTenant, monthlyFee: parseFloat(e.target.value) || 0 })}
                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Nicho / Segmento</label>
                  <select value={(editingTenant as any).nicho || 'Barbearia'} onChange={e => setEditingTenant({ ...editingTenant, nicho: e.target.value } as Tenant)}
                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500">
                    {NICHOS.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                {/* Plan selector */}
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Plano de Assinatura</label>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.values(PLAN_CONFIGS).map(p => {
                      const currentPlanId = getPlanConfig(editingTenant?.plan).id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setEditingTenant({ ...editingTenant!, plan: p.id })}
                          className={`p-3 rounded-2xl border-2 text-center transition-all ${currentPlanId === p.id ? `${p.bgClass} ${p.borderClass}` : 'bg-white border-slate-100 hover:border-slate-300'}`}
                        >
                          <p className="text-lg">{p.emoji}</p>
                          <p className={`text-[10px] font-black uppercase ${currentPlanId === p.id ? p.textClass : 'text-slate-500'}`}>{p.name}</p>
                          <p className={`text-[9px] font-bold ${currentPlanId === p.id ? p.textClass : 'text-slate-400'}`}>R${p.price.toFixed(2).replace('.', ',')}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Reset quiz */}
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Quiz Social Midia</label>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!editingTenant) return;
                      if (!confirm(`Reiniciar o quiz e o contador de resets de "${editingTenant.name}"?`)) return;
                      try {
                        const settings = await db.getSettings(editingTenant.id);
                        const followUp = (settings as any).follow_up || {};
                        await db.updateSettings(editingTenant.id, {
                          socialMediaProfile: null,
                          contentCalendar: null,
                          follow_up: { ...followUp, _quizResetCount: 0, _quizResetMonth: '' },
                        } as any);
                        alert('Quiz reiniciado com sucesso! O tenant pode refazer o quiz agora.');
                      } catch (e) { alert('Erro ao reiniciar quiz'); }
                    }}
                    className="w-full p-4 bg-amber-50 border-2 border-amber-200 rounded-2xl text-amber-700 font-black text-xs uppercase tracking-widest hover:bg-amber-100 transition-all"
                  >
                    Reiniciar Quiz + Zerar Contador
                  </button>
                </div>
              </div>
              <div className="flex gap-4">
                <button onClick={() => setEditingTenant(null)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs" disabled={saving}>Cancelar</button>
                <button onClick={handleUpdate} disabled={saving} className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-50">
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-sm p-10 space-y-6 animate-scaleUp border-4 border-red-500 text-center">
            <div className="text-5xl">⚠️</div>
            <h2 className="text-2xl font-black text-black uppercase">Excluir Cliente?</h2>
            <p className="text-sm text-slate-500 font-bold">
              Esta ação irá excluir <strong>{tenants.find(t => t.id === deleteId)?.name}</strong> e todos os dados relacionados. <span className="text-red-500">Não pode ser desfeito.</span>
            </p>
            <div className="flex gap-4">
              <button onClick={() => setDeleteId(null)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs border-2 border-slate-100 rounded-2xl hover:border-black transition-all">Cancelar</button>
              <button onClick={handleDelete} className="flex-1 py-4 bg-red-500 text-white rounded-2xl font-black uppercase text-xs hover:bg-red-600 transition-all">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const StatCard = ({ label, value, icon, sub, color, highlight }: {
  label: string; value: string; icon: string; sub?: string; color?: string; highlight?: boolean;
}) => {
  const [hidden, setHidden] = React.useState(false);
  return (
    <div className={`bg-white rounded-2xl border-2 p-6 transition-all ${highlight ? 'border-orange-400 shadow-lg shadow-orange-100/50' : 'border-slate-100 hover:border-slate-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        <button onClick={() => setHidden(!hidden)} className="text-slate-300 hover:text-slate-500 transition-colors text-sm">
          {hidden ? '🙈' : '👁️'}
        </button>
      </div>
      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-2xl font-black ${color || 'text-black'}`}>{hidden ? '••••••' : value}</p>
      {sub && <p className="text-[8px] font-bold text-slate-300 uppercase tracking-widest mt-1">{hidden ? '' : sub}</p>}
    </div>
  );
};

// ── Central Tab ─────────────────────────────────────────────────────────────

interface CentralTabProps {
  instanceName: string;
  setInstanceName: (v: string) => void;
  connected: boolean;
  setConnected: (v: boolean) => void;
}

const CentralTab: React.FC<CentralTabProps> = ({ instanceName, setInstanceName, connected, setConnected }) => {
  const [centralActive, setCentralActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bookingsCount, setBookingsCount] = useState(0);

  // QR code flow
  const [qr, setQr] = useState<string | null>(null);
  const [connectingQr, setConnectingQr] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Cashback config
  const [cbActive, setCbActive] = useState(false);
  const [cbMode, setCbMode] = useState<'percentual' | 'fidelidade'>('percentual');
  const [cbPercent, setCbPercent] = useState(5);
  const [cbThreshold, setCbThreshold] = useState(10);

  // Heartbeat — check connection every 30s
  useEffect(() => {
    if (!instanceName) return;
    const tick = () => evolutionService.checkStatus(instanceName).then(s => setConnected(s === 'open')).catch(() => {});
    tick();
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, [instanceName, setConnected]);

  useEffect(() => {
    (async () => {
      const cfg = await db.getGlobalConfig();
      setCentralActive(cfg['central_active'] === 'true');
      // Cashback config
      if (cfg['cashback_config']) {
        try {
          const cb = JSON.parse(cfg['cashback_config']);
          setCbActive(cb.active || false);
          setCbMode(cb.mode || 'percentual');
          setCbPercent(cb.percent || 5);
          setCbThreshold(cb.threshold || 10);
        } catch {}
      }
      // Count bookings
      try {
        const bookings = await db.getCentralBookings();
        setBookingsCount(bookings.length);
      } catch {}
    })();
  }, []);

  const handleConnect = async () => {
    if (!instanceName.trim()) return;
    setConnectingQr(true);
    setQr(null);
    try {
      const result = await evolutionService.createAndFetchQr(instanceName.trim());
      if (result.status === 'success' && result.qrcode) {
        setQr(result.qrcode);
      } else if (result.status === 'success' && !result.qrcode) {
        setConnected(true);
        setQr(null);
      } else {
        alert(result.message || 'Erro ao gerar QR Code');
      }
    } finally {
      setConnectingQr(false);
    }
  };

  const checkConnectionStatus = async () => {
    setCheckingStatus(true);
    try {
      const s = await evolutionService.checkStatus(instanceName);
      setConnected(s === 'open');
      if (s === 'open') setQr(null);
    } finally {
      setCheckingStatus(false);
    }
  };

  const save = async () => {
    setSaving(true);
    await db.saveGlobalConfig({
      central_instance: instanceName,
      central_active: String(centralActive),
      cashback_config: JSON.stringify({
        active: cbActive,
        mode: cbMode,
        percent: cbPercent,
        threshold: cbThreshold,
      }),
    });
    setSaving(false);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <CentralPollingManager instanceName={instanceName} active={centralActive} />

      {/* ── Conexão / QR Code ── */}
      <div className="bg-white rounded-3xl border-2 border-slate-100 p-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-black text-white rounded-2xl flex items-center justify-center text-2xl">📡</div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight">Central WhatsApp</h2>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Agente multi-tenant para leads de anúncios</p>
            </div>
          </div>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border-2 ${connected ? 'bg-green-50 border-green-100 text-green-600' : 'bg-red-50 border-red-100 text-red-500'}`}>
            <div className={`w-2 h-2 rounded-full animate-pulse ${connected ? 'bg-green-500' : 'bg-red-400'}`} />
            <span className="text-[10px] font-black uppercase tracking-widest">{connected ? 'Conectado' : 'Desconectado'}</span>
          </div>
        </div>

        <div className="flex items-center justify-between bg-slate-50 rounded-2xl p-4">
          <span className="text-sm font-black">Central Ativa</span>
          <button
            onClick={() => setCentralActive(v => !v)}
            className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${centralActive ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-500'}`}
          >
            {centralActive ? 'ON' : 'OFF'}
          </button>
        </div>

        <div className="space-y-3">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nome da instância Evolution</label>
          <input
            type="text"
            value={instanceName}
            onChange={e => setInstanceName(e.target.value)}
            placeholder="central_AgendeZap"
            className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleConnect}
            disabled={connectingQr || !instanceName.trim()}
            className="px-5 py-2.5 bg-black text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-500 transition-all disabled:opacity-40"
          >
            {connectingQr ? 'Gerando...' : connected ? '↺ Reconectar' : '📱 Conectar'}
          </button>
          <button
            onClick={checkConnectionStatus}
            disabled={checkingStatus}
            className="px-5 py-2.5 bg-slate-100 text-slate-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all disabled:opacity-40"
          >
            {checkingStatus ? '...' : '⟳ Status'}
          </button>
        </div>

        {qr && (
          <div className="flex flex-col items-center gap-4 pt-2 border-t border-slate-100">
            <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Escaneie o QR Code com o WhatsApp da Central</p>
            <div className="p-3 bg-white border-2 border-orange-200 rounded-2xl shadow-xl shadow-orange-100">
              <img
                src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
                alt="QR Code"
                className="w-56 h-56 object-contain"
              />
            </div>
            <button
              onClick={checkConnectionStatus}
              className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-orange-500 transition-all"
            >
              ✓ Já escaneei — verificar conexão
            </button>
          </div>
        )}

        <div className="bg-slate-50 rounded-2xl p-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Geocodificação</p>
          <p className="text-xs font-bold text-slate-500 mt-1">OpenStreetMap (Nominatim) — gratuito, sem API key necessária</p>
        </div>

        <button onClick={save} className="px-8 py-3 bg-orange-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">
          {saving ? 'Salvando...' : 'Salvar Configuração'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Agendamentos via Central" value={String(bookingsCount)} icon="📋" />
        <StatCard label="Status" value={connected ? 'Conectada' : 'Desconectada'} icon={connected ? '🟢' : '🔴'} />
      </div>

      {/* ── Cashback / Fidelidade ── */}
      <div className="bg-white rounded-3xl border-2 border-green-100 p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-green-100 text-green-700 rounded-2xl flex items-center justify-center text-2xl">💰</div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight">Cashback / Fidelidade</h2>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Recompensa para leads que agendam via Central</p>
            </div>
          </div>
          <button
            onClick={() => setCbActive(v => !v)}
            className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${cbActive ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-500'}`}
          >
            {cbActive ? 'ON' : 'OFF'}
          </button>
        </div>

        {cbActive && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <button
                onClick={() => setCbMode('percentual')}
                className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${cbMode === 'percentual' ? 'bg-black text-white' : 'bg-slate-100 text-slate-500'}`}
              >
                Percentual (R$)
              </button>
              <button
                onClick={() => setCbMode('fidelidade')}
                className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${cbMode === 'fidelidade' ? 'bg-black text-white' : 'bg-slate-100 text-slate-500'}`}
              >
                Fidelidade (grátis)
              </button>
            </div>

            {cbMode === 'percentual' ? (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Percentual de cashback (%)</label>
                <input
                  type="number"
                  value={cbPercent}
                  onChange={e => setCbPercent(Number(e.target.value))}
                  min={1} max={50}
                  className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-green-400"
                />
                <p className="text-[9px] text-slate-300 font-bold">Ex: 5% = R$ 2,50 de cashback em um serviço de R$ 50</p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">A cada quantos agendamentos ganha 1 grátis?</label>
                <input
                  type="number"
                  value={cbThreshold}
                  onChange={e => setCbThreshold(Number(e.target.value))}
                  min={2} max={50}
                  className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-green-400"
                />
                <p className="text-[9px] text-slate-300 font-bold">Ex: A cada 10 agendamentos via Central, o cliente ganha 1 grátis</p>
              </div>
            )}
          </div>
        )}

        <button onClick={save} className="px-8 py-3 bg-green-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">
          {saving ? 'Salvando...' : 'Salvar Cashback'}
        </button>
      </div>
    </div>
  );
};

// ── Affiliates Sub-Tab ────────────────────────────────────────────────────────

const AffiliatesSubTab: React.FC = () => {
  const [stats, setStats] = useState<AffiliateLinkStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAffEmail, setNewAffEmail] = useState('');
  const [newAffPass, setNewAffPass] = useState('');
  const [newCommission, setNewCommission] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPass, setEditPass] = useState('');
  const [editCommission, setEditCommission] = useState('');
  const [copied, setCopied] = useState('');

  const reload = async () => {
    try { setStats(await db.getAffiliateLinkStats()); } catch {}
    setLoading(false);
  };
  useEffect(() => { reload(); }, []);

  const handleCreate = async () => {
    if (!newName.trim() || !newCommission.trim()) return;
    setCreating(true);
    try {
      await db.createAffiliateLink(newName.trim(), parseFloat(newCommission), newSlug.trim() || undefined, newPhone.trim() || undefined, newAffEmail.trim() || undefined, newAffPass.trim() || undefined);
      setNewName(''); setNewSlug(''); setNewPhone(''); setNewAffEmail(''); setNewAffPass(''); setNewCommission(''); setShowCreate(false);
      await reload();
    } catch (e: any) { alert('Erro ao criar link: ' + (e.message || '')); }
    setCreating(false);
  };

  const handleUpdate = async (id: string) => {
    try {
      await db.updateAffiliateLink(id, {
        name: editName.trim() || undefined,
        phone: editPhone.trim(),
        email: editEmail.trim() || undefined,
        password: editPass.trim() || undefined,
        commissionPercent: editCommission ? parseFloat(editCommission) : undefined,
      });
      setEditingId(null);
      await reload();
    } catch (e: any) { alert('Erro ao atualizar: ' + (e.message || '')); }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try { await db.updateAffiliateLink(id, { active: !currentActive }); await reload(); } catch {}
  };

  const handleCopy = (slug: string) => {
    navigator.clipboard.writeText(`https://www.agendezap.com/?aff=${slug}`);
    setCopied(slug);
    setTimeout(() => setCopied(''), 2000);
  };

  const filtered = stats.filter(a => {
    const q = search.toLowerCase();
    return !q || a.name.toLowerCase().includes(q) || a.slug.toLowerCase().includes(q);
  });

  const totalSignups = stats.reduce((s, a) => s + a.totalSignups, 0);
  const totalActive = stats.reduce((s, a) => s + a.activeCount, 0);
  const totalRevenue = stats.reduce((s, a) => s + a.totalMonthlyRevenue, 0);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Links Ativos</p>
          <p className="text-2xl font-black">{stats.filter(a => a.active).length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Cadastros</p>
          <p className="text-2xl font-black">{totalSignups}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Ativos Pagando</p>
          <p className="text-2xl font-black text-green-600">{totalActive}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">MRR Afiliados</p>
          <p className="text-2xl font-black text-orange-500">R${totalRevenue.toFixed(2)}</p>
        </div>
      </div>

      {/* Create button + search */}
      <div className="flex items-center gap-3">
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-5 py-2.5 bg-orange-500 text-white text-[10px] font-black uppercase tracking-wider rounded-xl hover:bg-orange-600 transition-all">
          {showCreate ? 'Cancelar' : '+ Gerar Novo Link'}
        </button>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar afiliado..."
          className="flex-1 border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-orange-50 rounded-2xl border border-orange-200 p-5 space-y-3 animate-fadeIn">
          <p className="text-xs font-black text-orange-700 uppercase tracking-wider">Novo Link de Afiliado</p>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input type="text" placeholder="Nome do afiliado" value={newName}
              onChange={e => setNewName(e.target.value)}
              className="border-2 border-orange-200 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
            <input type="text" placeholder="Slug do link (ex: promo2026)" value={newSlug}
              onChange={e => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              className="border-2 border-orange-200 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
            <input type="tel" placeholder="WhatsApp (5511999999999)" value={newPhone}
              onChange={e => setNewPhone(e.target.value.replace(/\D/g, ''))}
              className="border-2 border-orange-200 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
            <input type="number" placeholder="Comissao %" value={newCommission}
              onChange={e => setNewCommission(e.target.value)} step="0.5" min="0" max="100"
              className="border-2 border-orange-200 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input type="email" placeholder="Email de login do afiliado" value={newAffEmail}
              onChange={e => setNewAffEmail(e.target.value)}
              className="border-2 border-orange-200 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
            <input type="text" placeholder="Senha de acesso" value={newAffPass}
              onChange={e => setNewAffPass(e.target.value)}
              className="border-2 border-orange-200 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
            <button onClick={handleCreate} disabled={creating}
              className="px-5 py-2.5 bg-black text-white text-[10px] font-black uppercase tracking-wider rounded-xl hover:bg-slate-800 disabled:opacity-50 transition-all">
              {creating ? 'Criando...' : 'Criar Link'}
            </button>
          </div>
        </div>
      )}

      {/* Affiliate table */}
      {loading ? <p className="text-sm text-slate-400 font-bold">Carregando...</p> : (
        <div className="bg-white rounded-3xl border-2 border-slate-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50">
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Afiliado</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Link</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">WhatsApp</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Login</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Comissao</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Cadastros</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Ativos</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Pendentes</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Cancelados</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">MRR</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Acoes</th>
            </tr></thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="p-4 font-bold">
                    {editingId === a.id ? (
                      <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                        className="border-2 border-slate-200 rounded-lg p-1.5 text-sm w-32 focus:outline-none focus:border-orange-400" />
                    ) : (
                      <span className={!a.active ? 'line-through text-slate-400' : ''}>{a.name}</span>
                    )}
                  </td>
                  <td className="p-4">
                    <button onClick={() => handleCopy(a.slug)}
                      className={`text-[8px] font-black px-2 py-1 rounded-full uppercase transition-all ${
                        copied === a.slug ? 'bg-green-50 text-green-600' : 'bg-purple-50 text-purple-600 hover:bg-purple-100'
                      }`}>
                      {copied === a.slug ? 'Copiado!' : `?aff=${a.slug} (copiar)`}
                    </button>
                  </td>
                  <td className="p-4">
                    {editingId === a.id ? (
                      <input type="tel" value={editPhone} onChange={e => setEditPhone(e.target.value.replace(/\D/g, ''))}
                        placeholder="5511999999999"
                        className="border-2 border-slate-200 rounded-lg p-1.5 text-sm w-28 focus:outline-none focus:border-orange-400" />
                    ) : (
                      <span className="text-xs text-slate-500 font-mono">{a.phone || '-'}</span>
                    )}
                  </td>
                  <td className="p-4">
                    {editingId === a.id ? (
                      <div className="flex flex-col gap-1">
                        <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)}
                          placeholder="Email"
                          className="border-2 border-slate-200 rounded-lg p-1.5 text-sm w-32 focus:outline-none focus:border-orange-400" />
                        <input type="text" value={editPass} onChange={e => setEditPass(e.target.value)}
                          placeholder="Nova senha"
                          className="border-2 border-slate-200 rounded-lg p-1.5 text-sm w-32 focus:outline-none focus:border-orange-400" />
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">{a.email || '-'}</span>
                    )}
                  </td>
                  <td className="p-4">
                    {editingId === a.id ? (
                      <input type="number" value={editCommission} onChange={e => setEditCommission(e.target.value)}
                        className="border-2 border-slate-200 rounded-lg p-1.5 text-sm w-16 focus:outline-none focus:border-orange-400" step="0.5" />
                    ) : (
                      <span className="font-bold text-orange-600">{a.commissionPercent}%</span>
                    )}
                  </td>
                  <td className="p-4 font-mono">{a.totalSignups}</td>
                  <td className="p-4"><span className="text-[8px] font-black px-2 py-1 rounded-full bg-green-50 text-green-600">{a.activeCount}</span></td>
                  <td className="p-4"><span className="text-[8px] font-black px-2 py-1 rounded-full bg-yellow-50 text-yellow-600">{a.pendingCount}</span></td>
                  <td className="p-4"><span className="text-[8px] font-black px-2 py-1 rounded-full bg-red-50 text-red-600">{a.cancelledCount}</span></td>
                  <td className="p-4 font-mono font-bold">R${a.totalMonthlyRevenue.toFixed(2)}</td>
                  <td className="p-4">
                    <div className="flex gap-1">
                      {editingId === a.id ? (
                        <>
                          <button onClick={() => handleUpdate(a.id)}
                            className="text-[8px] font-black px-2 py-1 rounded-full bg-green-50 text-green-600 hover:bg-green-100 transition-all">Salvar</button>
                          <button onClick={() => setEditingId(null)}
                            className="text-[8px] font-black px-2 py-1 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">Cancelar</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => { setEditingId(a.id); setEditName(a.name); setEditPhone(a.phone || ''); setEditEmail(a.email || ''); setEditPass(''); setEditCommission(String(a.commissionPercent)); }}
                            className="text-[8px] font-black px-2 py-1 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-all">Editar</button>
                          <button onClick={() => handleToggleActive(a.id, a.active)}
                            className={`text-[8px] font-black px-2 py-1 rounded-full transition-all ${a.active ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                            {a.active ? 'Desativar' : 'Ativar'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="p-8 text-center text-slate-400 font-bold text-sm">Nenhum afiliado encontrado. Clique em "+ Gerar Novo Link" para criar.</p>}
        </div>
      )}
    </div>
  );
};

// ── Leads & Indicações Tab ────────────────────────────────────────────────────

const LeadsTab: React.FC = () => {
  const [subTab, setSubTab] = useState<'leads' | 'indicacoes' | 'afiliados' | 'convites'>('leads');
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-1 w-fit flex-wrap">
        {([
          { key: 'leads' as const, label: 'Leads Marketplace' },
          { key: 'indicacoes' as const, label: 'Indicacoes' },
          { key: 'afiliados' as const, label: 'Afiliados' },
          { key: 'convites' as const, label: 'Convites Demo' },
        ]).map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
              subTab === t.key ? 'bg-black text-white shadow-sm' : 'text-slate-500 hover:text-black'
            }`}>{t.label}</button>
        ))}
      </div>
      {subTab === 'leads' && <LeadsSubTab />}
      {subTab === 'indicacoes' && <ReferralsSubTab />}
      {subTab === 'afiliados' && <AffiliatesSubTab />}
      {subTab === 'convites' && <InvitesSubTab />}
    </div>
  );
};

const LeadsSubTab: React.FC = () => {
  const [leads, setLeads] = useState<MarketplaceLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  useEffect(() => { (async () => { try { setLeads(await db.getAllMarketplaceLeads()); } catch {} setLoading(false); })(); }, []);
  const filtered = leads.filter(l => { const q = search.toLowerCase(); return !q || (l.name || '').toLowerCase().includes(q) || l.phone.includes(q) || (l.city || '').toLowerCase().includes(q); });
  return (
    <div className="space-y-4">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{leads.length} leads capturados</p>
      <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome, telefone ou cidade..."
        className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
      {loading ? <p className="text-sm text-slate-400 font-bold">Carregando...</p> : (
        <div className="bg-white rounded-3xl border-2 border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50">
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Nome</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Telefone</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Cidade</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Nicho</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Origem</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Data</th>
            </tr></thead>
            <tbody>
              {filtered.slice(0, 100).map(l => (
                <tr key={l.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="p-4 font-bold">{l.name || '-'}</td>
                  <td className="p-4 font-mono text-xs">{l.phone}</td>
                  <td className="p-4">{l.city || '-'}</td>
                  <td className="p-4">{l.nichoInterest || '-'}</td>
                  <td className="p-4"><span className="text-[8px] font-black px-2 py-1 rounded-full bg-blue-50 text-blue-600 uppercase">{l.source}</span></td>
                  <td className="p-4 text-xs text-slate-400">{new Date(l.createdAt).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="p-8 text-center text-slate-400 font-bold text-sm">Nenhum lead encontrado.</p>}
        </div>
      )}
    </div>
  );
};

const ReferralsSubTab: React.FC = () => {
  const [referrals, setReferrals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  useEffect(() => { (async () => { try { setReferrals(await db.getAllReferrals()); } catch {} setLoading(false); })(); }, []);
  const filtered = referrals.filter(r => { const q = search.toLowerCase(); return !q || r.referredName.toLowerCase().includes(q) || r.referrerName.toLowerCase().includes(q); });
  const statusBadge = (s: string) => {
    if (s === 'ATIVA') return 'bg-green-50 text-green-600';
    if (s === 'TRIAL' || s === 'PAGAMENTO PENDENTE') return 'bg-yellow-50 text-yellow-600';
    if (s === 'BLOQUEADA' || s === 'CANCELADA') return 'bg-red-50 text-red-600';
    return 'bg-slate-100 text-slate-500';
  };
  return (
    <div className="space-y-4">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{referrals.length} indicacoes rastreadas</p>
      <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por indicado ou indicador..."
        className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
      {loading ? <p className="text-sm text-slate-400 font-bold">Carregando...</p> : (
        <div className="bg-white rounded-3xl border-2 border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50">
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Indicado</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Indicador</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Status</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Plano</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Mensalidade</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Data</th>
            </tr></thead>
            <tbody>
              {filtered.slice(0, 100).map(r => (
                <tr key={r.referredId} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="p-4 font-bold">{r.referredName}</td>
                  <td className="p-4 text-purple-600 font-bold">{r.referrerName}</td>
                  <td className="p-4"><span className={`text-[8px] font-black px-2 py-1 rounded-full uppercase ${statusBadge(r.referredStatus)}`}>{r.referredStatus}</span></td>
                  <td className="p-4 text-xs">{r.referredPlan}</td>
                  <td className="p-4 text-xs font-mono">R${Number(r.referredFee).toFixed(2)}</td>
                  <td className="p-4 text-xs text-slate-400">{new Date(r.referredCreatedAt).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="p-8 text-center text-slate-400 font-bold text-sm">Nenhuma indicacao encontrada.</p>}
        </div>
      )}
    </div>
  );
};

const InvitesSubTab: React.FC = () => {
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const all = await db.getAllTenants();
        setInvites(all.filter(t => t.slug?.endsWith('-demo')));
      } catch {}
      setLoading(false);
    })();
  }, []);
  return (
    <div className="space-y-4">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{invites.length} convites demo</p>
      {loading ? <p className="text-sm text-slate-400 font-bold">Carregando...</p> : (
        <div className="bg-white rounded-3xl border-2 border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50">
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Nome</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Slug</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Status</th>
              <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Data</th>
            </tr></thead>
            <tbody>
              {invites.slice(0, 100).map(t => (
                <tr key={t.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="p-4 font-bold">{t.name}</td>
                  <td className="p-4 font-mono text-xs">{t.slug}</td>
                  <td className="p-4"><span className={`text-[8px] font-black px-2 py-1 rounded-full uppercase ${
                    t.status === 'ATIVA' ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-400'
                  }`}>{t.status}</span></td>
                  <td className="p-4 text-xs text-slate-400">{new Date(t.createdAt).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {invites.length === 0 && <p className="p-8 text-center text-slate-400 font-bold text-sm">Nenhum convite demo encontrado.</p>}
        </div>
      )}
    </div>
  );
};

// ── Cashback Tab ──────────────────────────────────────────────────────────────

const CashbackTab: React.FC = () => {
  const [searchPhone, setSearchPhone] = useState('');
  const [result, setResult] = useState<CashbackBalance | null | 'not_found'>(null);
  const [searching, setSearching] = useState(false);

  const search = async () => {
    if (!searchPhone.trim()) return;
    setSearching(true);
    setResult(null);
    try {
      const balance = await db.getCashbackBalance(searchPhone.replace(/\D/g, ''));
      setResult(balance || 'not_found');
    } catch {
      setResult('not_found');
    }
    setSearching(false);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-black uppercase tracking-tight">Cashback / Fidelidade</h2>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Consulte o saldo de cashback por telefone</p>
      </div>

      <div className="flex gap-3">
        <input
          type="text"
          value={searchPhone}
          onChange={e => setSearchPhone(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="Telefone do cliente (ex: 5544999999999)"
          className="flex-1 border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400"
        />
        <button
          onClick={search}
          className="px-6 py-3 bg-orange-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all"
        >
          {searching ? '...' : 'Buscar'}
        </button>
      </div>

      {result && result !== 'not_found' && (
        <div className="bg-white rounded-3xl border-2 border-green-100 p-8 space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-green-100 text-green-700 rounded-2xl flex items-center justify-center text-2xl font-black">$</div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{result.phone}</p>
              <p className="text-3xl font-black text-green-600">R$ {result.balance.toFixed(2)}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="text-center">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Ganho</p>
              <p className="text-lg font-black">R$ {result.totalEarned.toFixed(2)}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Usado</p>
              <p className="text-lg font-black">R$ {result.totalUsed.toFixed(2)}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Agendamentos</p>
              <p className="text-lg font-black">{result.bookingsCount}</p>
            </div>
          </div>
        </div>
      )}

      {result === 'not_found' && (
        <div className="bg-slate-50 rounded-2xl p-6 text-center">
          <p className="text-sm font-bold text-slate-400">Nenhum saldo encontrado para este telefone.</p>
        </div>
      )}
    </div>
  );
};

export default SuperAdminView;
