import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { supabase } from '../services/supabase';
import { AffiliateLink, ResellerProfile, TenantStatus } from '../types';

interface Props {
  affiliate: AffiliateLink;
  resellerProfile: ResellerProfile | null;
  onResellerProfileChange: (rp: ResellerProfile) => void;
  onImpersonate: (id: string, name: string, slug: string, plan?: string) => void;
  onLogout: () => void;
}

type Tab = 'dashboard' | 'clientes' | 'marca' | 'precos' | 'recursos' | 'ia';

const FEATURE_KEYS = [
  { key: 'agendamentos', label: 'Agenda' },
  { key: 'clientes',     label: 'Clientes' },
  { key: 'conversas',    label: 'WhatsApp' },
  { key: 'comandas',     label: 'Comandas' },
  { key: 'financeiro',   label: 'Financeiro' },
  { key: 'estoque',      label: 'Estoque' },
  { key: 'follow_up',    label: 'Lembretes' },
  { key: 'disparos',     label: 'Disparos' },
  { key: 'social_midia', label: 'Social Mídia' },
  { key: 'indicacoes',   label: 'Indicações' },
  { key: 'relatorios',   label: 'Relatórios' },
  { key: 'equipe',       label: 'Equipe' },
  { key: 'servicos',     label: 'Serviços' },
  { key: 'conexoes',     label: 'Conexões' },
  { key: 'configuracoes',label: 'Configurações' },
  { key: 'planos',       label: 'Planos' },
];

const PLAN_LABELS: Record<string, string> = {
  START: 'Start',
  PROFISSIONAL: 'Profissional',
  ELITE: 'Elite',
};

const ResellerView: React.FC<Props> = ({
  affiliate, resellerProfile, onResellerProfileChange, onImpersonate, onLogout,
}) => {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Brand form
  const [brandName, setBrandName] = useState(resellerProfile?.brand_name || '');
  const [logoUrl, setLogoUrl] = useState(resellerProfile?.logo_url || '');
  const [primaryColor, setPrimaryColor] = useState(resellerProfile?.primary_color || '#f97316');
  const [fontColor, setFontColor] = useState(resellerProfile?.font_color || '');
  const [bgColor, setBgColor] = useState(resellerProfile?.bg_color || '');
  const [iconColor, setIconColor] = useState(resellerProfile?.icon_color || '');
  const [pageBgColor, setPageBgColor] = useState(resellerProfile?.page_bg_color || '');
  const [cardBgColor, setCardBgColor] = useState(resellerProfile?.card_bg_color || '');
  const [textColor, setTextColor] = useState(resellerProfile?.text_color || '');
  const [customDomain, setCustomDomain] = useState(resellerProfile?.custom_domain || '');

  // Pricing form
  const [priceStart, setPriceStart] = useState<string>(String(resellerProfile?.plan_pricing?.START || ''));
  const [pricePro, setPricePro] = useState<string>(String(resellerProfile?.plan_pricing?.PROFISSIONAL || ''));
  const [priceElite, setPriceElite] = useState<string>(String(resellerProfile?.plan_pricing?.ELITE || ''));

  // Features form
  const [allFeatures, setAllFeatures] = useState(resellerProfile?.visible_features === null || !resellerProfile?.visible_features);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(resellerProfile?.visible_features || FEATURE_KEYS.map(f => f.key));

  // AI form
  const [openaiKey, setOpenaiKey] = useState(resellerProfile?.openai_api_key || '');
  const [systemPrompt, setSystemPrompt] = useState(resellerProfile?.system_prompt_template || '');
  const [agentName, setAgentName] = useState(resellerProfile?.default_agent_name || '');

  // New client form
  const [showNewClient, setShowNewClient] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPlan, setNewPlan] = useState('START');
  const [creatingClient, setCreatingClient] = useState(false);

  // Edit client modal
  const [editTenant, setEditTenant] = useState<any | null>(null);
  const [editPlan, setEditPlan] = useState('START');
  const [editFee, setEditFee] = useState('');
  const [editAllFeatures, setEditAllFeatures] = useState(true);
  const [editFeatures, setEditFeatures] = useState<string[]>(FEATURE_KEYS.map(f => f.key));
  const [editLoading, setEditLoading] = useState(false);

  const loadTenants = useCallback(async () => {
    if (!resellerProfile?.id) { setLoading(false); return; }
    try {
      const { data } = await supabase
        .from('tenants')
        .select('id, nome, slug, status, plan, mensalidade, created_at, last_login_at, email, phone')
        .eq('reseller_id', resellerProfile.id)
        .order('created_at', { ascending: false });
      setTenants(data || []);
    } catch {}
    setLoading(false);
  }, [resellerProfile?.id]);

  useEffect(() => { loadTenants(); }, [loadTenants]);

  // Sync form state when resellerProfile changes
  useEffect(() => {
    if (!resellerProfile) return;
    setBrandName(resellerProfile.brand_name || '');
    setLogoUrl(resellerProfile.logo_url || '');
    setPrimaryColor(resellerProfile.primary_color || '#f97316');
    setFontColor(resellerProfile.font_color || '');
    setBgColor(resellerProfile.bg_color || '');
    setIconColor(resellerProfile.icon_color || '');
    setPageBgColor(resellerProfile.page_bg_color || '');
    setCardBgColor(resellerProfile.card_bg_color || '');
    setTextColor(resellerProfile.text_color || '');
    setCustomDomain(resellerProfile.custom_domain || '');
    setPriceStart(String(resellerProfile.plan_pricing?.START || ''));
    setPricePro(String(resellerProfile.plan_pricing?.PROFISSIONAL || ''));
    setPriceElite(String(resellerProfile.plan_pricing?.ELITE || ''));
    const hasFlags = resellerProfile.visible_features !== null && resellerProfile.visible_features !== undefined;
    setAllFeatures(!hasFlags);
    setSelectedFeatures(hasFlags ? resellerProfile.visible_features! : FEATURE_KEYS.map(f => f.key));
    setOpenaiKey(resellerProfile.openai_api_key || '');
    setSystemPrompt(resellerProfile.system_prompt_template || '');
    setAgentName(resellerProfile.default_agent_name || '');
  }, [resellerProfile]);

  const saveProfile = async (patch: Partial<ResellerProfile>) => {
    setSaving(true);
    try {
      const saved = await db.saveResellerProfile(affiliate.id, patch);
      onResellerProfileChange(saved);
    } catch (e: any) {
      console.error('[saveProfile]', e);
      const msg: string = e?.message || String(e);
      if (msg.includes('policy') || msg.includes('permission') || msg.includes('violates') || msg.includes('RLS')) {
        alert('Sem permissão para salvar. Aplique a migration 20260426000005 no Supabase SQL Editor e tente novamente.');
      } else {
        alert('Erro ao salvar: ' + msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBrand = () => saveProfile({
    brand_name: brandName || undefined,
    logo_url: logoUrl || undefined,
    primary_color: primaryColor,
    font_color: fontColor || undefined,
    bg_color: bgColor || undefined,
    icon_color: iconColor || undefined,
    page_bg_color: pageBgColor || undefined,
    card_bg_color: cardBgColor || undefined,
    text_color: textColor || undefined,
    custom_domain: customDomain || undefined,
  });

  const handleSavePricing = () => saveProfile({
    plan_pricing: {
      START: priceStart ? parseFloat(priceStart) : undefined,
      PROFISSIONAL: pricePro ? parseFloat(pricePro) : undefined,
      ELITE: priceElite ? parseFloat(priceElite) : undefined,
    },
  });

  const handleSaveFeatures = () => saveProfile({
    visible_features: allFeatures ? null : selectedFeatures,
  });

  const handleSaveAI = () => saveProfile({
    openai_api_key: openaiKey || undefined,
    system_prompt_template: systemPrompt || undefined,
    default_agent_name: agentName || undefined,
  });

  const handleCreateClient = async () => {
    if (!newName || !newEmail || !newPass) return;
    // Enforce reseller tenant limit
    if (resellerProfile?.max_tenants != null && tenants.length >= resellerProfile.max_tenants) {
      alert(`Limite de ${resellerProfile.max_tenants} cliente${resellerProfile.max_tenants !== 1 ? 's' : ''} atingido. Fale com o administrador para aumentar seu limite.`);
      return;
    }
    setCreatingClient(true);
    try {
      const slug = newName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').slice(0, 30);
      const pricing = resellerProfile?.plan_pricing;
      const fee = pricing?.[newPlan as keyof typeof pricing] || 0;
      const tenant = await db.addTenant({
        name: newName,
        slug,
        email: newEmail,
        password: newPass,
        phone: newPhone,
        plan: newPlan,
        status: TenantStatus.ACTIVE,
        monthlyFee: Number(fee),
        reseller_id: resellerProfile?.id,
      });
      if (tenant) {
        await db.updateSettings(tenant.id, { aiActive: false });
        setNewName(''); setNewEmail(''); setNewPass(''); setNewPhone(''); setNewPlan('START');
        setShowNewClient(false);
        loadTenants();
      }
    } catch (e: any) {
      alert(e?.message || 'Erro ao criar cliente.');
    } finally {
      setCreatingClient(false);
    }
  };

  const openEditModal = async (t: any) => {
    setEditTenant(t);
    setEditPlan(t.plan || 'START');
    setEditFee(t.mensalidade ? String(t.mensalidade) : '');
    // Load per-tenant feature overrides from settings
    try {
      const { data } = await supabase
        .from('tenant_settings')
        .select('follow_up')
        .eq('tenant_id', t.id)
        .maybeSingle();
      const overrides = data?.follow_up?._resellerFeatureOverrides;
      if (overrides && Array.isArray(overrides)) {
        setEditAllFeatures(false);
        setEditFeatures(overrides);
      } else {
        setEditAllFeatures(true);
        setEditFeatures(FEATURE_KEYS.map(f => f.key));
      }
    } catch {
      setEditAllFeatures(true);
      setEditFeatures(FEATURE_KEYS.map(f => f.key));
    }
  };

  const handleSaveEdit = async () => {
    if (!editTenant) return;
    setEditLoading(true);
    try {
      await db.updateTenant(editTenant.id, {
        plan: editPlan,
        monthlyFee: editFee ? parseFloat(editFee) : 0,
      });
      await db.updateSettings(editTenant.id, {
        resellerFeatureOverrides: editAllFeatures ? null : editFeatures,
      });
      setEditTenant(null);
      loadTenants();
    } catch (e: any) {
      alert(e?.message || 'Erro ao salvar.');
    } finally {
      setEditLoading(false);
    }
  };

  // KPIs
  const active = tenants.filter(t => t.status === 'ATIVA');
  const mrr = active.reduce((s, t) => s + Number(t.mensalidade || 0), 0);
  const BASE_PERCENT = affiliate.commissionPercent || 10;
  const commission = mrr * (BASE_PERCENT / 100);

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      ATIVA: 'bg-green-100 text-green-700',
      PENDENTE_PAGAMENTO: 'bg-amber-100 text-amber-700',
      BLOQUEADA: 'bg-red-100 text-red-600',
      CANCELADA: 'bg-slate-100 text-slate-500',
    };
    return map[status] || 'bg-slate-100 text-slate-500';
  };

  const TabBtn: React.FC<{ id: Tab; label: string }> = ({ id, label }) => (
    <button
      onClick={() => setTab(id)}
      className={`px-4 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${tab === id ? 'bg-black text-white' : 'text-slate-500 hover:bg-slate-100'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {resellerProfile?.logo_url
            ? <img src={resellerProfile.logo_url} alt="logo" className="h-8 object-contain" />
            : resellerProfile?.brand_name
              ? <span className="text-xl font-black text-orange-500 uppercase italic">{resellerProfile.brand_name}</span>
              : null
          }
          <span className="bg-orange-100 text-orange-600 text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">Afiliado</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 hidden md:block">{affiliate.email}</span>
          <button onClick={onLogout} className="text-xs font-black uppercase tracking-widest text-slate-400 hover:text-red-500 transition-colors px-3 py-2 rounded-xl hover:bg-red-50">
            Sair
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200 px-6 flex gap-1 overflow-x-auto">
        <TabBtn id="dashboard" label="Dashboard" />
        <TabBtn id="clientes" label="Clientes" />
        <TabBtn id="marca" label="Marca" />
        <TabBtn id="precos" label="Preços" />
        <TabBtn id="recursos" label="Recursos" />
        <TabBtn id="ia" label="IA" />
      </div>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {/* ── DASHBOARD ── */}
        {tab === 'dashboard' && (
          <div className="space-y-6">
            <h2 className="text-lg font-black text-slate-800">Visão Geral</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Clientes Ativos', value: active.length, color: 'text-green-600' },
                { label: 'Total Clientes', value: tenants.length, color: 'text-slate-700' },
                { label: 'MRR', value: `R$ ${mrr.toFixed(2).replace('.', ',')}`, color: 'text-blue-600' },
                { label: `Comissão (${BASE_PERCENT}%)`, value: `R$ ${commission.toFixed(2).replace('.', ',')}`, color: 'text-orange-500' },
              ].map(kpi => (
                <div key={kpi.label} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{kpi.label}</p>
                  <p className={`text-2xl font-black ${kpi.color}`}>{loading ? '—' : kpi.value}</p>
                </div>
              ))}
            </div>
            {!resellerProfile && (
              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5">
                <p className="text-sm font-bold text-orange-700 mb-2">Configure seu portal white-label</p>
                <p className="text-xs text-orange-600">Acesse a aba <strong>Marca</strong> para configurar seu domínio, logo e cores. Depois configure os <strong>Preços</strong> e as <strong>abas visíveis</strong> para seus clientes.</p>
              </div>
            )}
          </div>
        )}

        {/* ── CLIENTES ── */}
        {tab === 'clientes' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-800">Clientes</h2>
                {resellerProfile?.max_tenants != null && (
                  <p className={`text-xs mt-0.5 font-bold ${tenants.length >= resellerProfile.max_tenants ? 'text-red-500' : 'text-slate-400'}`}>
                    {tenants.length} / {resellerProfile.max_tenants} clientes utilizados
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowNewClient(true)}
                disabled={resellerProfile?.max_tenants != null && tenants.length >= resellerProfile.max_tenants}
                className="bg-black text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl hover:bg-orange-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                + Novo Cliente
              </button>
            </div>

            {showNewClient && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
                <p className="font-black text-sm text-slate-800 uppercase tracking-widest">Novo Cliente</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Nome do Estabelecimento *</label>
                    <input value={newName} onChange={e => setNewName(e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm" placeholder="Ex: Barbearia do João" />
                  </div>
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">E-mail *</label>
                    <input value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm" type="email" placeholder="joao@email.com" />
                  </div>
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Senha *</label>
                    <input value={newPass} onChange={e => setNewPass(e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm" type="password" placeholder="Senha de acesso" />
                  </div>
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">WhatsApp</label>
                    <input value={newPhone} onChange={e => setNewPhone(e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm" placeholder="5511999999999" />
                  </div>
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Plano</label>
                    <select value={newPlan} onChange={e => setNewPlan(e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm">
                      {Object.entries(PLAN_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v} {resellerProfile?.plan_pricing?.[k as keyof typeof resellerProfile.plan_pricing] ? `— R$ ${resellerProfile.plan_pricing![k as keyof typeof resellerProfile.plan_pricing]}` : ''}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleCreateClient} disabled={creatingClient || !newName || !newEmail || !newPass} className="bg-black text-white text-[10px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl hover:bg-orange-500 transition-colors disabled:opacity-50">
                    {creatingClient ? 'Criando...' : 'Criar Cliente'}
                  </button>
                  <button onClick={() => setShowNewClient(false)} className="text-slate-500 text-[10px] font-black uppercase tracking-widest px-4 py-2.5 rounded-xl hover:bg-slate-100">
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin" /></div>
            ) : tenants.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">Nenhum cliente ainda. Crie o primeiro!</div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Nome</th>
                      <th className="text-left px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400 hidden md:table-cell">Plano</th>
                      <th className="text-left px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Status</th>
                      <th className="text-left px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400 hidden md:table-cell">Mensalidade</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tenants.map(t => (
                      <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-800">{t.nome}</p>
                          <p className="text-[10px] text-slate-400">{t.email}</p>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-[10px] font-black uppercase text-slate-500">{PLAN_LABELS[t.plan] || t.plan}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${statusBadge(t.status)}`}>{t.status}</span>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-slate-600 font-bold">
                          {t.mensalidade ? `R$ ${Number(t.mensalidade).toFixed(2).replace('.', ',')}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEditModal(t)}
                            className="text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-black transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-100"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => onImpersonate(t.id, t.nome, t.slug || '', t.plan)}
                            className="text-[9px] font-black uppercase tracking-widest text-orange-500 hover:text-orange-700 transition-colors px-3 py-1.5 rounded-lg hover:bg-orange-50"
                          >
                            Acessar →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── MARCA ── */}
        {tab === 'marca' && (
          <div className="space-y-6">
            <h2 className="text-lg font-black text-slate-800">Identidade de Marca</h2>
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Nome da Marca</label>
                  <input value={brandName} onChange={e => setBrandName(e.target.value)} className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="Ex: AgendaPro, ScheduleMax…" />
                  <p className="text-[10px] text-slate-400 mt-1">Aparece no topo do menu lateral</p>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">URL do Logo</label>
                  <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="https://cdn.seu-site.com/logo.png" />
                  <p className="text-[10px] text-slate-400 mt-1">PNG/SVG transparente recomendado</p>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Cor Principal (Botões)</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="w-12 h-10 rounded-lg border border-slate-200 cursor-pointer p-0.5" />
                    <input value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono" placeholder="#f97316" />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Cor dos botões e destaques</p>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Cor do Menu (Fundo)</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="color" value={bgColor || '#ffffff'} onChange={e => setBgColor(e.target.value)} className="w-12 h-10 rounded-lg border border-slate-200 cursor-pointer p-0.5" />
                    <input value={bgColor} onChange={e => setBgColor(e.target.value)} className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono" placeholder="(padrão do tema)" />
                    {bgColor && <button onClick={() => setBgColor('')} className="text-[9px] text-slate-400 hover:text-red-500 font-bold">✕</button>}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Cor de fundo do menu lateral</p>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Cor do Texto do Menu</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="color" value={fontColor || '#000000'} onChange={e => setFontColor(e.target.value)} className="w-12 h-10 rounded-lg border border-slate-200 cursor-pointer p-0.5" />
                    <input value={fontColor} onChange={e => setFontColor(e.target.value)} className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono" placeholder="(padrão do tema)" />
                    {fontColor && <button onClick={() => setFontColor('')} className="text-[9px] text-slate-400 hover:text-red-500 font-bold">✕</button>}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Cor das fontes no menu lateral</p>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Cor dos Ícones</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="color" value={iconColor || '#94a3b8'} onChange={e => setIconColor(e.target.value)} className="w-12 h-10 rounded-lg border border-slate-200 cursor-pointer p-0.5" />
                    <input value={iconColor} onChange={e => setIconColor(e.target.value)} className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono" placeholder="(padrão do tema)" />
                    {iconColor && <button onClick={() => setIconColor('')} className="text-[9px] text-slate-400 hover:text-red-500 font-bold">✕</button>}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Cor dos ícones no menu lateral</p>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Cor de Fundo da Página</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="color" value={pageBgColor || '#d0d2da'} onChange={e => setPageBgColor(e.target.value)} className="w-12 h-10 rounded-lg border border-slate-200 cursor-pointer p-0.5" />
                    <input value={pageBgColor} onChange={e => setPageBgColor(e.target.value)} className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono" placeholder="(padrão do tema)" />
                    {pageBgColor && <button onClick={() => setPageBgColor('')} className="text-[9px] text-slate-400 hover:text-red-500 font-bold">✕</button>}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Cor de fundo principal da tela</p>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Cor dos Cards / Painéis</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="color" value={cardBgColor || '#ffffff'} onChange={e => setCardBgColor(e.target.value)} className="w-12 h-10 rounded-lg border border-slate-200 cursor-pointer p-0.5" />
                    <input value={cardBgColor} onChange={e => setCardBgColor(e.target.value)} className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono" placeholder="(padrão do tema)" />
                    {cardBgColor && <button onClick={() => setCardBgColor('')} className="text-[9px] text-slate-400 hover:text-red-500 font-bold">✕</button>}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Cor de fundo dos cards, tabelas e modais</p>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Cor do Texto Principal</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="color" value={textColor || '#1e1e32'} onChange={e => setTextColor(e.target.value)} className="w-12 h-10 rounded-lg border border-slate-200 cursor-pointer p-0.5" />
                    <input value={textColor} onChange={e => setTextColor(e.target.value)} className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono" placeholder="(padrão do tema)" />
                    {textColor && <button onClick={() => setTextColor('')} className="text-[9px] text-slate-400 hover:text-red-500 font-bold">✕</button>}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Cor dos títulos, números e textos do conteúdo</p>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Domínio Personalizado</label>
                  <input value={customDomain} onChange={e => setCustomDomain(e.target.value)} className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono" placeholder="app.minhamarca.com.br" />
                  <p className="text-[10px] text-slate-400 mt-1">CNAME apontando para o seu domínio Vercel</p>
                </div>
              </div>
              {logoUrl && (
                <div className="border border-slate-100 rounded-xl p-3 bg-slate-50 inline-flex items-center gap-3">
                  <span className="text-[9px] font-black text-slate-400 uppercase">Preview:</span>
                  <img src={logoUrl} alt="logo preview" className="h-8 object-contain" onError={e => (e.currentTarget.style.display = 'none')} />
                </div>
              )}
              <button onClick={handleSaveBrand} disabled={saving} className="bg-black text-white text-[10px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl hover:bg-orange-500 transition-colors disabled:opacity-50">
                {saving ? 'Salvando…' : 'Salvar Marca'}
              </button>
            </div>
          </div>
        )}

        {/* ── PREÇOS ── */}
        {tab === 'precos' && (
          <div className="space-y-6">
            <h2 className="text-lg font-black text-slate-800">Preços dos Planos</h2>
            <p className="text-sm text-slate-500">Defina o valor mensal que seus clientes pagam em cada plano. Você cobra diretamente, sem intermediários.</p>
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {[
                  { key: 'START', label: 'Start', state: priceStart, setter: setPriceStart },
                  { key: 'PROFISSIONAL', label: 'Profissional', state: pricePro, setter: setPricePro },
                  { key: 'ELITE', label: 'Elite', state: priceElite, setter: setPriceElite },
                ].map(p => (
                  <div key={p.key} className="border border-slate-100 rounded-xl p-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Plano {p.label}</p>
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-bold text-slate-500">R$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={p.state}
                        onChange={e => p.setter(e.target.value)}
                        className="flex-1 px-2 py-2 border border-slate-200 rounded-lg text-sm"
                        placeholder="0,00"
                      />
                      <span className="text-xs text-slate-400">/mês</span>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={handleSavePricing} disabled={saving} className="bg-black text-white text-[10px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl hover:bg-orange-500 transition-colors disabled:opacity-50">
                {saving ? 'Salvando…' : 'Salvar Preços'}
              </button>
            </div>
          </div>
        )}

        {/* ── RECURSOS ── */}
        {tab === 'recursos' && (
          <div className="space-y-6">
            <h2 className="text-lg font-black text-slate-800">Recursos Visíveis</h2>
            <p className="text-sm text-slate-500">Controle quais abas e módulos aparecem no sistema para todos os seus clientes.</p>
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={allFeatures} onChange={e => setAllFeatures(e.target.checked)} className="w-4 h-4 rounded" />
                <span className="text-sm font-bold text-slate-700">Mostrar todos os recursos</span>
              </label>
              {!allFeatures && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-2 border-t border-slate-100">
                  {FEATURE_KEYS.map(f => (
                    <label key={f.key} className="flex items-center gap-2 cursor-pointer p-2.5 rounded-xl hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selectedFeatures.includes(f.key)}
                        onChange={e => {
                          setSelectedFeatures(prev =>
                            e.target.checked ? [...prev, f.key] : prev.filter(k => k !== f.key)
                          );
                        }}
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-sm text-slate-700">{f.label}</span>
                    </label>
                  ))}
                </div>
              )}
              <button onClick={handleSaveFeatures} disabled={saving} className="bg-black text-white text-[10px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl hover:bg-orange-500 transition-colors disabled:opacity-50">
                {saving ? 'Salvando…' : 'Salvar Recursos'}
              </button>
            </div>
          </div>
        )}

        {/* ── IA ── */}
        {tab === 'ia' && (
          <div className="space-y-6">
            <h2 className="text-lg font-black text-slate-800">Configuração da IA</h2>
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Chave OpenAI (sua própria)</label>
                <input
                  type="password"
                  value={openaiKey}
                  onChange={e => setOpenaiKey(e.target.value)}
                  className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono"
                  placeholder="sk-proj-…"
                />
                <p className="text-[10px] text-slate-400 mt-1">Substitui a chave global para todos seus clientes. Deixe em branco para usar a chave da plataforma.</p>
              </div>
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Nome do Agente IA</label>
                <input
                  value={agentName}
                  onChange={e => setAgentName(e.target.value)}
                  className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm"
                  placeholder="Ex: Sofia, Max, Lia…"
                />
                <p className="text-[10px] text-slate-400 mt-1">Nome padrão do agente IA para seus clientes</p>
              </div>
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Prompt de Sistema (Pré-fixo)</label>
                <textarea
                  value={systemPrompt}
                  onChange={e => setSystemPrompt(e.target.value)}
                  rows={6}
                  className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono resize-y"
                  placeholder="Instruções globais que serão adicionadas antes do prompt personalizado de cada cliente..."
                />
                <p className="text-[10px] text-slate-400 mt-1">Este texto é adicionado no início de todos os prompts dos seus clientes. Use para definir tom, regras de marca ou restrições globais.</p>
              </div>
              <button onClick={handleSaveAI} disabled={saving} className="bg-black text-white text-[10px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl hover:bg-orange-500 transition-colors disabled:opacity-50">
                {saving ? 'Salvando…' : 'Salvar IA'}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ── EDIT CLIENT MODAL ── */}
      {editTenant && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <p className="font-black text-sm text-slate-800 uppercase tracking-widest">Editar — {editTenant.nome}</p>
              <button onClick={() => setEditTenant(null)} className="text-slate-400 hover:text-black text-lg">✕</button>
            </div>

            {/* Plan */}
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Plano</label>
              <select value={editPlan} onChange={e => setEditPlan(e.target.value)} className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm">
                {Object.entries(PLAN_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            {/* Monthly fee */}
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Mensalidade (R$)</label>
              <input
                type="number" min="0" step="0.01"
                value={editFee}
                onChange={e => setEditFee(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm"
                placeholder="0,00"
              />
            </div>

            {/* Features */}
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-2">Recursos Visíveis</label>
              <label className="flex items-center gap-2 cursor-pointer mb-3">
                <input type="checkbox" checked={editAllFeatures} onChange={e => setEditAllFeatures(e.target.checked)} className="w-4 h-4 rounded" />
                <span className="text-sm font-bold text-slate-700">Usar padrão do portal (todos)</span>
              </label>
              {!editAllFeatures && (
                <div className="grid grid-cols-2 gap-1.5 border-t border-slate-100 pt-3">
                  {FEATURE_KEYS.map(f => (
                    <label key={f.key} className="flex items-center gap-2 cursor-pointer p-2 rounded-xl hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={editFeatures.includes(f.key)}
                        onChange={e => setEditFeatures(prev =>
                          e.target.checked ? [...prev, f.key] : prev.filter(k => k !== f.key)
                        )}
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-sm text-slate-700">{f.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={handleSaveEdit} disabled={editLoading} className="bg-black text-white text-[10px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl hover:bg-orange-500 transition-colors disabled:opacity-50">
                {editLoading ? 'Salvando…' : 'Salvar'}
              </button>
              <button onClick={() => setEditTenant(null)} className="text-slate-500 text-[10px] font-black uppercase tracking-widest px-4 py-2.5 rounded-xl hover:bg-slate-100">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResellerView;
