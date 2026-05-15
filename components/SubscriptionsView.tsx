import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { Customer, TenantSettings, SubscriptionPlan, SubscriptionConfig, SubscriptionStatus } from '../types';
import { confirmSubscriptionPayment, interpolateSubMsg } from '../services/subscriptionService';
import { evolutionService } from '../services/evolutionService';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const diffDays = (a: string, b: string) =>
  Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000);
const calcNextDue = (dueDay: number) => {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), dueDay);
  if (thisMonth > now) return `${thisMonth.getFullYear()}-${p(thisMonth.getMonth() + 1)}-${p(dueDay)}`;
  const next = new Date(now.getFullYear(), now.getMonth() + 1, dueDay);
  return `${next.getFullYear()}-${p(next.getMonth() + 1)}-${p(dueDay)}`;
};
const newUuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ─── Status badge ─────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<SubscriptionStatus | 'none', string> = {
  active: 'Ativo', pending: 'Pendente', overdue: 'Atrasado', cancelled: 'Cancelado', none: 'Sem plano',
};
const STATUS_STYLE: Record<SubscriptionStatus | 'none', string> = {
  active:    'bg-green-50 text-green-700',
  pending:   'bg-orange-50 text-orange-600',
  overdue:   'bg-red-50 text-red-600',
  cancelled: 'bg-slate-100 text-slate-400',
  none:      'bg-slate-50 text-slate-400',
};

const DEFAULT_CONFIG: SubscriptionConfig = {
  enabled: true,
  plans: [],
  daysBeforeWarning: 5,
  gracePeriodDays: 3,
  pixKey: '',
  warningMessage: 'Olá {nome}! Seu plano {plano} vence em {diasRestantes} dia(s), no dia {vencimento}. O valor é {valor}.\n\nPague via PIX: *{chavePix}* 💳',
  dueTodayMessage: 'Olá {nome}! Hoje é o dia de renovar seu plano {plano} — {valor}.\n\nPague via PIX: *{chavePix}* para continuar agendando normalmente! 😊',
  overdueMessage: 'Olá {nome}! Seu plano {plano} está em atraso há {diasAtraso} dia(s). Regularize o pagamento de {valor} para continuar agendando.\n\nPIX: *{chavePix}* 💳',
  blockedMessage: 'Olá {nome}! Seu plano está com pagamento em atraso. Regularize para voltar a agendar! 💳',
  paymentConfirmedMessage: 'Pagamento confirmado! ✅ Obrigado, {nome}! Seu plano {plano} está ativo até {vencimento}. Pode agendar normalmente!',
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface ProofModalData {
  customer: Customer;
  plan: SubscriptionPlan | undefined;
  proofBase64: string;
  analysis: any;
}

interface AssocModalData {
  customer: Customer | null;
  planId: string;
  dueDay: number;
}

const SubscriptionsView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPlan, setFilterPlan] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [saving, setSaving] = useState(false);

  // Config form state
  const [cfg, setCfg] = useState<SubscriptionConfig>(DEFAULT_CONFIG);

  // Plans edit
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanValue, setNewPlanValue] = useState('');
  const [newPlanDesc, setNewPlanDesc] = useState('');

  // Modals
  const [proofModal, setProofModal] = useState<ProofModalData | null>(null);
  const [assocModal, setAssocModal] = useState<AssocModalData | null>(null);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [assocSearchTerm, setAssocSearchTerm] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [s, c] = await Promise.all([db.getSettings(tenantId), db.getCustomers(tenantId)]);
    setSettings(s);
    setCustomers(c);
    if (s.subscriptionConfig) {
      setCfg({ ...DEFAULT_CONFIG, ...s.subscriptionConfig });
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const subscribedCustomers = customers.filter(c => c.subscriptionPlanId);
  const allCustomers = customers;

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = {
    total:    subscribedCustomers.length,
    active:   subscribedCustomers.filter(c => c.subscriptionStatus === 'active').length,
    pending:  subscribedCustomers.filter(c => c.subscriptionStatus === 'pending').length,
    overdue:  subscribedCustomers.filter(c => c.subscriptionStatus === 'overdue').length,
    monthlyRevenue: subscribedCustomers.reduce((sum, c) => {
      if (c.subscriptionStatus === 'cancelled') return sum;
      const plan = cfg.plans.find(p => p.id === c.subscriptionPlanId);
      return sum + (plan?.value || 0);
    }, 0),
  };

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = subscribedCustomers.filter(c => {
    if (filterStatus !== 'all' && c.subscriptionStatus !== filterStatus) return false;
    if (filterPlan !== 'all' && c.subscriptionPlanId !== filterPlan) return false;
    if (searchTerm && !c.name.toLowerCase().includes(searchTerm.toLowerCase()) && !c.phone.includes(searchTerm)) return false;
    return true;
  });

  // ── Save config ────────────────────────────────────────────────────────────
  const saveConfig = async () => {
    setSaving(true);
    await db.updateSettings(tenantId, { subscriptionConfig: cfg });
    setSaving(false);
    setShowConfig(false);
    load();
  };

  // ── Plan CRUD ─────────────────────────────────────────────────────────────
  const addPlan = () => {
    if (!newPlanName.trim() || !newPlanValue) return;
    const plan: SubscriptionPlan = {
      id: newUuid(),
      name: newPlanName.trim(),
      value: parseFloat(newPlanValue.replace(',', '.')),
      description: newPlanDesc.trim() || undefined,
    };
    setCfg(prev => ({ ...prev, plans: [...prev.plans, plan] }));
    setNewPlanName(''); setNewPlanValue(''); setNewPlanDesc('');
  };
  const removePlan = (id: string) => {
    setCfg(prev => ({ ...prev, plans: prev.plans.filter(p => p.id !== id) }));
  };
  const updatePlan = (id: string, field: keyof SubscriptionPlan, value: any) => {
    setCfg(prev => ({
      ...prev,
      plans: prev.plans.map(p => p.id === id ? { ...p, [field]: value } : p),
    }));
  };

  // ── Associate subscription ─────────────────────────────────────────────────
  const openAssoc = () => {
    setAssocModal({ customer: null, planId: cfg.plans[0]?.id || '', dueDay: 5 });
    setAssocSearchTerm('');
  };
  const saveAssoc = async () => {
    if (!assocModal?.customer || !assocModal.planId || !assocModal.dueDay) return;
    const nextDue = calcNextDue(assocModal.dueDay);
    await db.updateCustomer(tenantId, assocModal.customer.id, {
      subscriptionPlanId: assocModal.planId,
      subscriptionStatus: 'active',
      subscriptionDueDay: assocModal.dueDay,
      subscriptionNextDue: nextDue,
    } as any);
    setAssocModal(null);
    load();
  };

  // ── Remove subscription ────────────────────────────────────────────────────
  const removeSubscription = async (cust: Customer) => {
    if (!confirm(`Remover assinatura de ${cust.name}?`)) return;
    await db.updateCustomer(tenantId, cust.id, {
      subscriptionPlanId: null,
      subscriptionStatus: null,
    } as any);
    load();
  };

  // ── Manual charge ──────────────────────────────────────────────────────────
  const sendChargeManual = async (cust: Customer) => {
    if (!settings) return;
    const plan = cfg.plans.find(p => p.id === cust.subscriptionPlanId);
    const tenant = await db.getAllTenants().then(ts => ts.find(t => t.id === tenantId));
    if (!tenant?.evolution_instance || !cust.phone) {
      alert('Instância WhatsApp não configurada.');
      return;
    }
    const daysOverdue = cust.subscriptionNextDue
      ? Math.max(0, diffDays(cust.subscriptionNextDue, today()))
      : 0;
    const msg = interpolateSubMsg(cfg.overdueMessage, {
      nome: cust.name,
      plano: plan?.name || '',
      valor: plan ? `R$ ${fmtBRL(plan.value)}` : '',
      vencimento: fmtDate(cust.subscriptionNextDue),
      diasAtraso: daysOverdue,
    });
    await evolutionService.sendMessage(tenant.evolution_instance, cust.phone, msg);
    alert('Mensagem enviada!');
  };

  // ── Renew (manual, no proof) ───────────────────────────────────────────────
  const renewManual = async (cust: Customer) => {
    if (!settings) return;
    await confirmSubscriptionPayment(tenantId, cust.id, '', settings);
    load();
  };

  // ── Confirm proof (admin) ──────────────────────────────────────────────────
  const confirmProof = async () => {
    if (!proofModal || !settings) return;
    setConfirmingPayment(true);
    const tenant = await db.getAllTenants().then(ts => ts.find(t => t.id === tenantId));
    await confirmSubscriptionPayment(
      tenantId,
      proofModal.customer.id,
      tenant?.evolution_instance || '',
      settings
    );
    setProofModal(null);
    setConfirmingPayment(false);
    load();
  };

  // ── Open proof modal ───────────────────────────────────────────────────────
  const openProof = (cust: Customer) => {
    if (!cust.subscriptionPendingProof) return;
    let analysis: any = null;
    try { analysis = JSON.parse(cust.subscriptionProofAnalysis || '{}'); } catch { /* */ }
    const plan = cfg.plans.find(p => p.id === cust.subscriptionPlanId);
    setProofModal({ customer: cust, plan, proofBase64: cust.subscriptionPendingProof, analysis });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20">
        <div className="w-8 h-8 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin" />
      </div>
    );
  }

  const hasCfg = cfg.plans.length > 0;

  return (
    <div className="space-y-5 animate-fadeIn">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Assinaturas</h2>
          <p className="text-xs font-medium text-slate-500 mt-0.5">Gerencie mensalidades dos seus clientes</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openAssoc}
            disabled={!hasCfg}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-xl transition-all disabled:opacity-40"
          >
            + Associar assinatura
          </button>
          <button
            onClick={() => setShowConfig(v => !v)}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 transition-all"
          >
            ⚙️ Configurações
          </button>
        </div>
      </div>

      {/* Config panel */}
      {showConfig && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-6">
          <h3 className="font-semibold text-sm text-slate-700">Configurações do Sistema de Assinatura</h3>

          {/* Enable toggle */}
          <div className="flex items-center gap-3">
            <input type="checkbox" id="subEnabled" checked={cfg.enabled}
              onChange={e => setCfg(p => ({ ...p, enabled: e.target.checked }))}
              className="w-4 h-4 accent-orange-500" />
            <label htmlFor="subEnabled" className="text-sm font-medium text-slate-700">Sistema ativo</label>
          </div>

          {/* Timing */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Aviso prévio (dias antes)</label>
              <input type="number" min={0} max={30} value={cfg.daysBeforeWarning}
                onChange={e => setCfg(p => ({ ...p, daysBeforeWarning: Number(e.target.value) }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:border-orange-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Carência após vencimento (dias)</label>
              <input type="number" min={0} max={30} value={cfg.gracePeriodDays}
                onChange={e => setCfg(p => ({ ...p, gracePeriodDays: Number(e.target.value) }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:border-orange-400" />
            </div>
          </div>

          {/* Chave PIX */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Chave PIX do estabelecimento</label>
            <input
              value={cfg.pixKey || ''}
              onChange={e => setCfg(p => ({ ...p, pixKey: e.target.value }))}
              placeholder="Ex: contato@salao.com, 11999999999, CPF ou CNPJ"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:border-orange-400"
            />
            <p className="text-[11px] text-slate-400 mt-1">Use a variável <strong>{'{chavePix}'}</strong> nas mensagens para incluir esta chave.</p>
          </div>

          {/* Plans */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Planos</p>
            <div className="space-y-2 mb-3">
              {cfg.plans.map(plan => (
                <div key={plan.id} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                  <input value={plan.name} onChange={e => updatePlan(plan.id, 'name', e.target.value)}
                    className="flex-1 bg-transparent text-sm font-semibold text-slate-700 outline-none" placeholder="Nome" />
                  <span className="text-slate-300">|</span>
                  <span className="text-xs text-slate-400">R$</span>
                  <input type="number" value={plan.value} onChange={e => updatePlan(plan.id, 'value', parseFloat(e.target.value) || 0)}
                    className="w-20 bg-transparent text-sm text-slate-700 outline-none text-right" />
                  <button onClick={() => removePlan(plan.id)} className="text-red-400 hover:text-red-600 text-xs font-bold ml-1">✕</button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input value={newPlanName} onChange={e => setNewPlanName(e.target.value)}
                placeholder="Nome do plano" className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400" />
              <input value={newPlanValue} onChange={e => setNewPlanValue(e.target.value)}
                placeholder="R$ Valor" className="w-28 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400" />
              <button onClick={addPlan} className="px-3 py-2 bg-orange-500 text-white text-xs font-bold rounded-xl hover:bg-orange-600">+ Adicionar</button>
            </div>
          </div>

          {/* Messages */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Mensagens automáticas</p>
            <p className="text-[11px] text-slate-400">Variáveis: {'{nome}'} {'{plano}'} {'{valor}'} {'{vencimento}'} {'{diasRestantes}'} {'{diasAtraso}'} {'{chavePix}'}</p>

            {[
              { key: 'warningMessage', label: 'Aviso 3 dias antes do vencimento' },
              { key: 'dueTodayMessage', label: 'Lembrete no dia do vencimento (manhã)' },
              { key: 'overdueMessage', label: 'Cobrança diária (após vencimento)' },
              { key: 'blockedMessage', label: 'Mensagem de bloqueio (agente/web)' },
              { key: 'paymentConfirmedMessage', label: 'Confirmação de pagamento' },
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
                <textarea rows={2} value={(cfg as any)[key]}
                  onChange={e => setCfg(p => ({ ...p, [key]: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:border-orange-400 resize-none" />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => setShowConfig(false)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">Cancelar</button>
            <button onClick={saveConfig} disabled={saving} className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar configurações'}
            </button>
          </div>
        </div>
      )}

      {/* KPI bar */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-slate-100">
          {[
            { label: 'Total', value: kpis.total, color: 'text-slate-800' },
            { label: 'Ativos', value: kpis.active, color: 'text-green-600' },
            { label: 'Pendentes', value: kpis.pending, color: 'text-orange-500' },
            { label: 'Atrasados', value: kpis.overdue, color: 'text-red-500' },
            { label: 'Receita estimada', value: null, brl: kpis.monthlyRevenue, color: 'text-slate-800' },
          ].map((k, i) => (
            <div key={i} className="p-4 text-center">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{k.label}</p>
              <p className={`text-2xl font-extrabold ${k.color}`}>
                {k.brl !== undefined ? `R$ ${fmtBRL(k.brl)}` : k.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
          placeholder="Buscar cliente..." className="border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400 w-48" />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600 outline-none cursor-pointer">
          <option value="all">Todos status</option>
          <option value="active">Ativo</option>
          <option value="pending">Pendente</option>
          <option value="overdue">Atrasado</option>
          <option value="cancelled">Cancelado</option>
        </select>
        <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600 outline-none cursor-pointer">
          <option value="all">Todos planos</option>
          {cfg.plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Subscribers list */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center">
          <p className="text-3xl mb-2">💳</p>
          <p className="text-slate-500 font-medium">Nenhum assinante encontrado</p>
          {!hasCfg && <p className="text-xs text-slate-400 mt-1">Configure planos antes de associar clientes.</p>}
        </div>
      ) : (
        <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-100">
                <tr>
                  {['Cliente', 'Plano', 'Status', 'Vencimento', 'Último pgto', 'Ações'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(cust => {
                  const plan = cfg.plans.find(p => p.id === cust.subscriptionPlanId);
                  const status = (cust.subscriptionStatus || 'none') as SubscriptionStatus | 'none';
                  const now = today();
                  const daysUntil = cust.subscriptionNextDue ? diffDays(now, cust.subscriptionNextDue) : null;
                  const daysOverdue = daysUntil !== null && daysUntil < 0 ? -daysUntil : 0;
                  const hasProof = !!cust.subscriptionPendingProof;

                  return (
                    <tr key={cust.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-bold shrink-0">
                            {cust.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-700">{cust.name}</p>
                            <p className="text-[10px] font-medium text-slate-400">{cust.phone}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-slate-700">{plan?.name || '—'}</span>
                        {plan && <span className="block text-[10px] font-medium text-slate-500">R$ {fmtBRL(plan.value)}/mês</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLE[status]}`}>
                          {STATUS_LABEL[status]}
                          {daysOverdue > 0 && <span>· {daysOverdue}d</span>}
                        </span>
                        {hasProof && (
                          <button onClick={() => openProof(cust)} className="mt-1 flex items-center gap-1 text-[10px] font-bold text-blue-500 hover:text-blue-700">
                            📄 Comprovante
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-slate-700">{fmtDate(cust.subscriptionNextDue)}</span>
                        {daysUntil !== null && daysUntil >= 0 && daysUntil <= 7 && !daysOverdue && (
                          <span className="block text-[10px] font-medium text-orange-500">em {daysUntil}d</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-slate-500">{fmtDate(cust.subscriptionLastPaid)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          <button
                            onClick={() => renewManual(cust)}
                            title="Confirmar pagamento manualmente"
                            className="px-2.5 py-1 bg-green-50 hover:bg-green-100 text-green-700 text-[10px] font-bold rounded-lg transition-all"
                          >✓ Renovar</button>
                          <button
                            onClick={() => sendChargeManual(cust)}
                            title="Enviar cobrança agora"
                            className="px-2.5 py-1 bg-orange-50 hover:bg-orange-100 text-orange-600 text-[10px] font-bold rounded-lg transition-all"
                          >💬 Cobrar</button>
                          <button
                            onClick={() => removeSubscription(cust)}
                            title="Remover assinatura"
                            className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-500 text-[10px] font-bold rounded-lg transition-all"
                          >✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Proof Modal ────────────────────────────────────────────────────── */}
      {proofModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800">Comprovante de Pagamento</h3>
                <p className="text-xs font-medium text-slate-500 mt-0.5">{proofModal.customer.name} · {proofModal.plan?.name}</p>
              </div>
              <button onClick={() => setProofModal(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {/* Image */}
              <div className="bg-slate-50 rounded-xl overflow-hidden flex items-center justify-center min-h-[200px]">
                <img
                  src={`data:image/jpeg;base64,${proofModal.proofBase64}`}
                  alt="Comprovante"
                  className="max-w-full max-h-64 object-contain rounded-xl"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>

              {/* AI Analysis */}
              {proofModal.analysis && (
                <div className={`rounded-xl p-4 ${proofModal.analysis.isPaymentProof ? 'bg-green-50 border border-green-100' : 'bg-red-50 border border-red-100'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base">{proofModal.analysis.isPaymentProof ? '✅' : '❌'}</span>
                    <span className="text-sm font-bold text-slate-700">
                      {proofModal.analysis.isPaymentProof ? 'Comprovante detectado' : 'Não parece um comprovante'}
                    </span>
                    <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                      proofModal.analysis.confidence === 'high' ? 'bg-green-100 text-green-700' :
                      proofModal.analysis.confidence === 'medium' ? 'bg-orange-100 text-orange-600' :
                      'bg-red-100 text-red-600'
                    }`}>{proofModal.analysis.confidence || 'low'}</span>
                  </div>
                  <div className="space-y-1 text-xs text-slate-600">
                    {proofModal.analysis.amount != null && (
                      <p>💰 Valor detectado: <span className="font-bold">R$ {fmtBRL(proofModal.analysis.amount)}</span>
                        {proofModal.plan && Math.abs(proofModal.analysis.amount - proofModal.plan.value) > 1 && (
                          <span className="text-orange-500 ml-1">(esperado: R$ {fmtBRL(proofModal.plan.value)})</span>
                        )}
                      </p>
                    )}
                    {proofModal.analysis.date && <p>📅 Data: <span className="font-bold">{fmtDate(proofModal.analysis.date)}</span></p>}
                    {proofModal.analysis.recipient && <p>👤 Destinatário: <span className="font-bold">{proofModal.analysis.recipient}</span></p>}
                    {proofModal.analysis.notes && <p className="text-slate-500 italic mt-1">{proofModal.analysis.notes}</p>}
                  </div>
                </div>
              )}
            </div>
            <div className="p-5 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setProofModal(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">Fechar</button>
              <button
                onClick={confirmProof}
                disabled={confirmingPayment}
                className="px-5 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50"
              >
                {confirmingPayment ? 'Confirmando...' : '✓ Confirmar pagamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Assoc Modal ────────────────────────────────────────────────────── */}
      {assocModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-800">Associar Assinatura</h3>
              <button onClick={() => setAssocModal(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {/* Client search */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Cliente</label>
                <input
                  value={assocModal.customer ? assocModal.customer.name : assocSearchTerm}
                  onChange={e => {
                    setAssocSearchTerm(e.target.value);
                    setAssocModal(prev => prev ? { ...prev, customer: null } : null);
                  }}
                  placeholder="Buscar por nome ou telefone..."
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400"
                />
                {!assocModal.customer && assocSearchTerm.length > 1 && (
                  <div className="mt-1 border border-slate-200 rounded-xl overflow-hidden max-h-40 overflow-y-auto">
                    {allCustomers
                      .filter(c => c.name.toLowerCase().includes(assocSearchTerm.toLowerCase()) || c.phone.includes(assocSearchTerm))
                      .slice(0, 8)
                      .map(c => (
                        <button key={c.id} onClick={() => { setAssocModal(p => p ? { ...p, customer: c } : null); setAssocSearchTerm(''); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0">
                          <span className="font-medium text-slate-700">{c.name}</span>
                          <span className="text-slate-400 text-xs ml-2">{c.phone}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>

              {/* Plan */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Plano</label>
                <select value={assocModal.planId} onChange={e => setAssocModal(p => p ? { ...p, planId: e.target.value } : null)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:border-orange-400 cursor-pointer">
                  {cfg.plans.map(p => (
                    <option key={p.id} value={p.id}>{p.name} — R$ {fmtBRL(p.value)}/mês</option>
                  ))}
                </select>
              </div>

              {/* Due day */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Dia de vencimento (mensal)</label>
                <input type="number" min={1} max={28} value={assocModal.dueDay}
                  onChange={e => setAssocModal(p => p ? { ...p, dueDay: Number(e.target.value) } : null)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400" />
                <p className="text-[11px] text-slate-400 mt-1">
                  Próximo vencimento: <span className="font-semibold">{fmtDate(calcNextDue(assocModal.dueDay))}</span>
                </p>
              </div>
            </div>
            <div className="p-5 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setAssocModal(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">Cancelar</button>
              <button
                onClick={saveAssoc}
                disabled={!assocModal.customer || !assocModal.planId}
                className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold rounded-xl transition-all disabled:opacity-40"
              >Associar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubscriptionsView;
