import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { db } from '../services/mockDb';
import { evolutionService } from '../services/evolutionService';
import {
  Professional, Comanda, ComandaItem,
  Adiantamento, PagamentoPro, Customer, Service,
  Appointment, AppointmentStatus
} from '../types';

// ── helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 11);
}

function itemTotal(item: ComandaItem): number {
  const subtotal = item.qty * item.unitPrice;
  if (item.discountType === 'percent') return subtotal * (1 - item.discount / 100);
  return Math.max(0, subtotal - item.discount);
}

function fmtCurrency(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return iso; }
}

function fmtDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch { return iso; }
}

// ── interfaces ─────────────────────────────────────────────────────────────

interface ProcedimentoRow {
  comandaId: string;
  comandaNumber?: number;
  closedAt: string;
  customerId: string;
  item: ComandaItem;
  valor: number;
  grossBase: number;
  materialDeduction: number;
  comissao: number;
  alreadyPaid: boolean;       // true se esta comanda já está em algum PagamentoPro
  paidInPagamento?: string;   // ID do PagamentoPro que cobre esta comanda
}

interface Props {
  tenantId: string;
  refreshTicker?: number;
}

// ── component ──────────────────────────────────────────────────────────────

const PAYMENT_METHODS = ['Dinheiro', 'PIX', 'Transferência/TED', 'Débito', 'Crédito', 'Outro'];

const FolhaPagamentoView: React.FC<Props> = ({ tenantId, refreshTicker = 0 }) => {
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [comandas, setComandas]           = useState<Comanda[]>([]);
  const [customers, setCustomers]         = useState<Customer[]>([]);
  const [services, setServices]           = useState<Service[]>([]);
  const [adiantamentos, setAdiantamentos] = useState<Adiantamento[]>([]);
  const [pagamentos, setPagamentos]       = useState<PagamentoPro[]>([]);
  const [commissionMap, setCommissionMap] = useState<Record<string, number>>({});
  const [cancelledApptIds, setCancelledApptIds] = useState<Set<string>>(new Set());
  const [loading, setLoading]             = useState(true);
  const firstLoad = useRef(true);

  const [selectedProfId, setSelectedProfId] = useState('');

  const today = new Date();
  const firstDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay  = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    .toISOString().slice(0, 10);

  const [periodoInicio, setPeriodoInicio] = useState(firstDay);
  const [periodoFim, setPeriodoFim]       = useState(lastDay);

  // Pagar modal
  const [showPagarModal, setShowPagarModal] = useState(false);
  const [pagarMethod, setPagarMethod]       = useState(PAYMENT_METHODS[0]);
  const [pagarNotes, setPagarNotes]         = useState('');
  const [paying, setPaying]                 = useState(false);

  const commRate = selectedProfId ? (commissionMap[selectedProfId] ?? 0) : 0;

  // ── load ─────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (firstLoad.current) setLoading(true);
    const [profs, cmds, custs, svcs, adis, pgtos, settings, apps, exps] = await Promise.all([
      db.getProfessionals(tenantId),
      db.getComandas(tenantId),
      db.getCustomers(tenantId),
      db.getServices(tenantId),
      db.getAdiantamentos(tenantId),
      db.getPagamentosPro(tenantId),
      db.getSettings(tenantId),
      db.getAppointments(tenantId),
      db.getExpenses(tenantId),
    ]);
    setProfessionals(profs.filter(p => p.active));
    setComandas(cmds.filter(c => c.status === 'closed'));
    setCustomers(custs);
    setServices(svcs);

    // Merge adiantamentos from two sources:
    // 1. Direct adiantamentos stored in follow_up._adiantamentos
    // 2. Expenses registered as PROFESSIONAL in FinancialView (professional_id set)
    //    — deduplicated by matching description+amount+date+professionalId
    const adisSet = new Set(adis.map(a => `${a.professionalId}|${a.amount}|${a.date}|${a.description ?? ''}`));
    const expAsAdis: typeof adis = (exps as any[])
      .filter(e => e.professional_id && e.category === 'PROFESSIONAL')
      .filter(e => !adisSet.has(`${e.professional_id}|${e.amount}|${(e.date || '').slice(0, 10)}|${e.description ?? ''}`))
      .map(e => ({
        id: e.id,
        professionalId: e.professional_id,
        amount: e.amount,
        date: (e.date || '').slice(0, 10),
        description: e.description,
        createdAt: e.date || e.created_at || '',
      }));

    setAdiantamentos([...adis, ...expAsAdis]);
    setPagamentos(pgtos);
    const cMap: Record<string, number> = {};
    if (settings.professionalMeta) {
      for (const [id, meta] of Object.entries(settings.professionalMeta)) {
        cMap[id] = meta.commissionRate ?? 0;
      }
    }
    setCommissionMap(cMap);
    setCancelledApptIds(new Set(
      (apps as Appointment[]).filter(a => a.status === AppointmentStatus.CANCELLED).map(a => a.id)
    ));
    if (!selectedProfId && profs.length > 0) setSelectedProfId(profs[0].id);
    firstLoad.current = false;
    setLoading(false);
  }, [tenantId, refreshTicker]);

  useEffect(() => { load(); }, [load]);

  // ── derived ───────────────────────────────────────────────────────────────

  // Set of comanda IDs already covered by a PagamentoPro
  const paidComandaIds = useMemo(() => {
    const set = new Set<string>();
    pagamentos.forEach(p => (p.comandaIds ?? []).forEach(id => set.add(id)));
    return set;
  }, [pagamentos]);

  // Map from comanda ID → pagamento ID (for showing which payment covered it)
  const comandaToPagamentoId = useMemo(() => {
    const map: Record<string, string> = {};
    pagamentos.forEach(p => (p.comandaIds ?? []).forEach(id => { map[id] = p.id; }));
    return map;
  }, [pagamentos]);

  const allProcedimentos: ProcedimentoRow[] = useMemo(() => comandas
    .filter(c => {
      if (!c.closedAt) return false;
      if (c.appointment_id && cancelledApptIds.has(c.appointment_id)) return false;
      const d = c.closedAt.slice(0, 10);
      return d >= periodoInicio && d <= periodoFim;
    })
    .flatMap(c =>
      c.items
        .filter(i => (i.professionalId ?? c.professional_id) === selectedProfId)
        .map(i => {
          const val       = itemTotal(i);
          const grossBase = i.qty * i.unitPrice;
          const svc       = i.type === 'service' ? services.find(s => s.id === i.itemId) : undefined;
          const matPct    = svc?.materialCostPercent ?? 0;
          const materialDeduction = grossBase * matPct / 100;
          const comissao  = i.commissionOverride !== undefined
            ? i.commissionOverride
            : (grossBase * commRate / 100) - materialDeduction;
          return {
            comandaId: c.id,
            comandaNumber: c.number,
            closedAt: c.closedAt!,
            customerId: c.customer_id,
            item: i,
            valor: val,
            grossBase,
            materialDeduction,
            comissao,
            alreadyPaid: paidComandaIds.has(c.id),
            paidInPagamento: comandaToPagamentoId[c.id],
          };
        })
    )
    .sort((a, b) => a.closedAt.localeCompare(b.closedAt)),
    [comandas, cancelledApptIds, periodoInicio, periodoFim, selectedProfId, services, commRate, paidComandaIds, comandaToPagamentoId]
  );

  // Unpaid only — these are what will be included in the next payment
  const procedimentos = useMemo(() => allProcedimentos.filter(r => !r.alreadyPaid), [allProcedimentos]);
  const paidProcedimentos = useMemo(() => allProcedimentos.filter(r => r.alreadyPaid), [allProcedimentos]);

  const comissaoTotal = procedimentos.reduce((s, p) => s + p.comissao, 0);

  const profAdiantamentos = adiantamentos.filter(a => {
    if (a.professionalId !== selectedProfId) return false;
    return a.date >= periodoInicio && a.date <= periodoFim;
  });
  const adiantamentosTotal = profAdiantamentos.reduce((s, a) => s + a.amount, 0);

  const liquido = comissaoTotal - adiantamentosTotal;

  const profHistorico = pagamentos
    .filter(p => p.professionalId === selectedProfId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const getCustomer    = (id: string) => customers.find(c => c.id === id);
  const getServiceName = (itemId: string) => services.find(s => s.id === itemId)?.name ?? itemId;

  const selectedProf = professionals.find(p => p.id === selectedProfId);

  // ── marcar pago ───────────────────────────────────────────────────────────

  const handlePagar = async () => {
    if (!selectedProfId || !selectedProf) return;
    setPaying(true);
    try {
      // Collect unique comanda IDs from the unpaid procedimentos
      const comandaIdsToMark: string[] = Array.from(new Set(procedimentos.map(r => r.comandaId)));

      const pgto = await db.addPagamentoPro(tenantId, {
        professionalId: selectedProfId,
        periodoInicio,
        periodoFim,
        comissaoTotal,
        adiantamentosTotal,
        liquido,
        status: 'pago',
        paidAt: new Date().toISOString(),
        paidMethod: pagarMethod,
        notes: pagarNotes || undefined,
        comandaIds: comandaIdsToMark,
      });

      try {
        const tenant = await db.getTenant(tenantId);
        const instance = tenant?.evolution_instance;
        if (instance && selectedProf.phone) {
          const msg =
            `✅ *Pagamento Confirmado!*\n\n` +
            `Olá, ${selectedProf.name}! Seu pagamento foi processado com sucesso.\n\n` +
            `📅 *Período:* ${fmtDateShort(periodoInicio)} a ${fmtDateShort(periodoFim)}\n` +
            `📊 *Procedimentos pagos:* ${comandaIdsToMark.length}\n` +
            `📊 *Comissão bruta:* ${fmtCurrency(comissaoTotal)}\n` +
            `➖ *Adiantamentos descontados:* ${fmtCurrency(adiantamentosTotal)}\n` +
            `💰 *Valor pago:* ${fmtCurrency(liquido)}\n` +
            `💳 *Forma:* ${pagarMethod}\n\n` +
            `Obrigado pelo seu trabalho! 💪\n— ${tenant?.name ?? ''}`;
          await evolutionService.sendMessage(instance, selectedProf.phone, msg);
        }
      } catch (wErr) {
        console.warn('WhatsApp send error (non-fatal):', wErr);
      }

      alert(`Pagamento registrado! Referência: #${pgto.id.slice(0, 8)}`);
      setShowPagarModal(false);
      setPagarNotes('');
      setPagarMethod(PAYMENT_METHODS[0]);
      await load();
    } finally {
      setPaying(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO...</div>;

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fadeIn">

      {/* Header */}
      <div>
        <h1 className="text-3xl font-black text-black uppercase tracking-tight">Folha de Pagamento</h1>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Comissões, adiantamentos e pagamentos</p>
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-[30px] border-2 border-slate-100 shadow-lg shadow-slate-100/50 flex flex-wrap gap-4 items-end">
        <div className="space-y-1 flex-1 min-w-[180px]">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Profissional</label>
          <select
            value={selectedProfId}
            onChange={e => setSelectedProfId(e.target.value)}
            className="w-full p-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-black outline-none focus:border-orange-500 transition-all"
          >
            {professionals.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">De</label>
          <input
            type="date"
            value={periodoInicio}
            onChange={e => setPeriodoInicio(e.target.value)}
            className="p-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-black outline-none focus:border-orange-500 transition-all"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Até</label>
          <input
            type="date"
            value={periodoFim}
            onChange={e => setPeriodoFim(e.target.value)}
            className="p-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-black outline-none focus:border-orange-500 transition-all"
          />
        </div>
        {selectedProf && (
          <div className="bg-orange-50 rounded-2xl px-5 py-3 text-xs font-black text-orange-700">
            Comissão: {commRate}%
          </div>
        )}
      </div>

      {/* Procedimentos a pagar */}
      <div className="bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 overflow-hidden">
        <div className="px-8 py-5 border-b-2 border-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-black text-white rounded-xl flex items-center justify-center text-sm">📋</div>
            <div>
              <h3 className="font-black text-black uppercase tracking-widest text-sm">Procedimentos a Pagar</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mt-0.5">Não incluídos em pagamento anterior</p>
            </div>
          </div>
          <span className="text-sm font-black text-slate-500">{procedimentos.length} item{procedimentos.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-slate-50">
                {['Data / Hora', 'Cliente', 'Serviço / Produto', 'Valor', `Comissão (${commRate}%)`, '# Comanda'].map(h => (
                  <th key={h} className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-50">
              {procedimentos.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-xs font-bold text-slate-300 uppercase">
                    Nenhum procedimento pendente no período
                  </td>
                </tr>
              )}
              {procedimentos.map((row, idx) => {
                const cust = getCustomer(row.customerId);
                return (
                  <tr key={idx} className="hover:bg-slate-50/40 transition-colors">
                    <td className="px-6 py-4 text-xs font-bold text-slate-500 whitespace-nowrap">{fmtDate(row.closedAt)}</td>
                    <td className="px-6 py-4 font-black text-sm">{cust?.name ?? '—'}</td>
                    <td className="px-6 py-4 text-sm font-bold text-slate-700">
                      {row.item.type === 'service' ? getServiceName(row.item.itemId) : row.item.name}
                      {row.item.qty > 1 && <span className="text-slate-400 ml-1">×{row.item.qty}</span>}
                    </td>
                    <td className="px-6 py-4 font-black text-sm text-green-700">
                      {fmtCurrency(row.valor)}
                      {row.grossBase !== row.valor && (
                        <div className="text-[10px] font-semibold text-slate-400">base: {fmtCurrency(row.grossBase)}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 font-black text-sm text-orange-600">
                      {fmtCurrency(row.comissao)}
                      {row.materialDeduction > 0 && (
                        <div className="text-[10px] font-semibold text-slate-400">−{fmtCurrency(row.materialDeduction)} mat.</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs font-bold text-slate-400">#{row.comandaNumber ?? row.comandaId.slice(0, 6)}</td>
                  </tr>
                );
              })}
            </tbody>
            {procedimentos.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-100 bg-slate-50/50">
                  <td colSpan={3} className="px-6 py-4 text-xs font-black text-slate-500 uppercase">Total</td>
                  <td className="px-6 py-4 font-black text-base text-green-700">{fmtCurrency(procedimentos.reduce((a, p) => a + p.valor, 0))}</td>
                  <td className="px-6 py-4 font-black text-base text-orange-600">{fmtCurrency(comissaoTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Procedimentos já pagos (no período) */}
      {paidProcedimentos.length > 0 && (
        <div className="bg-white rounded-[40px] border-2 border-green-100 shadow-xl shadow-slate-100/50 overflow-hidden">
          <div className="px-8 py-5 border-b-2 border-green-50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-green-500 text-white rounded-xl flex items-center justify-center text-sm">✓</div>
              <div>
                <h3 className="font-black text-black uppercase tracking-widest text-sm">Já Pagos no Período</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mt-0.5">Incluídos em pagamentos anteriores</p>
              </div>
            </div>
            <span className="text-sm font-black text-green-600">{paidProcedimentos.length} item{paidProcedimentos.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-green-50">
                  {['Data / Hora', 'Cliente', 'Serviço / Produto', 'Valor', `Comissão (${commRate}%)`, '# Comanda', 'Pagamento'].map(h => (
                    <th key={h} className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-green-50">
                {paidProcedimentos.map((row, idx) => {
                  const cust = getCustomer(row.customerId);
                  const pgto = row.paidInPagamento ? profHistorico.find(p => p.id === row.paidInPagamento) : undefined;
                  return (
                    <tr key={idx} className="bg-green-50/20 hover:bg-green-50/40 transition-colors opacity-75">
                      <td className="px-6 py-4 text-xs font-bold text-slate-500 whitespace-nowrap">{fmtDate(row.closedAt)}</td>
                      <td className="px-6 py-4 font-black text-sm">{cust?.name ?? '—'}</td>
                      <td className="px-6 py-4 text-sm font-bold text-slate-700">
                        {row.item.type === 'service' ? getServiceName(row.item.itemId) : row.item.name}
                        {row.item.qty > 1 && <span className="text-slate-400 ml-1">×{row.item.qty}</span>}
                      </td>
                      <td className="px-6 py-4 font-black text-sm text-green-700">{fmtCurrency(row.valor)}</td>
                      <td className="px-6 py-4 font-black text-sm text-orange-600">{fmtCurrency(row.comissao)}</td>
                      <td className="px-6 py-4 text-xs font-bold text-slate-400">#{row.comandaNumber ?? row.comandaId.slice(0, 6)}</td>
                      <td className="px-6 py-4">
                        {pgto ? (
                          <span className="text-[10px] font-black px-2.5 py-1 rounded-xl bg-green-100 text-green-700 whitespace-nowrap">
                            {pgto.paidAt ? fmtDateShort(pgto.paidAt) : 'Pago'}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-300">Pago</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Adiantamentos — somente leitura */}
      <div className="bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 overflow-hidden">
        <div className="px-8 py-5 border-b-2 border-slate-50 flex items-center gap-3">
          <div className="w-9 h-9 bg-orange-500 text-white rounded-xl flex items-center justify-center text-sm">💸</div>
          <div>
            <h3 className="font-black text-black uppercase tracking-widest text-sm">Adiantamentos</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mt-0.5">Para registrar adiantamentos, acesse Financeiro</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-slate-50">
                {['Data', 'Descrição', 'Valor'].map(h => (
                  <th key={h} className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-50">
              {profAdiantamentos.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-10 text-center text-xs font-bold text-slate-300 uppercase">
                    Nenhum adiantamento no período
                  </td>
                </tr>
              )}
              {profAdiantamentos.map(a => (
                <tr key={a.id} className="hover:bg-slate-50/40 transition-colors">
                  <td className="px-6 py-4 text-xs font-bold text-slate-500">{fmtDateShort(a.date)}</td>
                  <td className="px-6 py-4 text-sm font-bold text-slate-700">{a.description || '—'}</td>
                  <td className="px-6 py-4 font-black text-sm text-red-600">- {fmtCurrency(a.amount)}</td>
                </tr>
              ))}
            </tbody>
            {profAdiantamentos.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-100 bg-slate-50/50">
                  <td colSpan={2} className="px-6 py-4 text-xs font-black text-slate-500 uppercase">Total Adiantamentos</td>
                  <td className="px-6 py-4 font-black text-base text-red-600">- {fmtCurrency(adiantamentosTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Resumo */}
      <div className="bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 p-8 space-y-5">
        <div className="flex items-center gap-3 border-b-2 border-slate-50 pb-5">
          <div className="w-9 h-9 bg-green-500 text-white rounded-xl flex items-center justify-center text-sm">💰</div>
          <h3 className="font-black text-black uppercase tracking-widest text-sm">Resumo do Período</h3>
        </div>
        <div className="space-y-3 max-w-sm">
          <div className="flex justify-between items-center">
            <span className="text-sm font-bold text-slate-600">Comissão Bruta</span>
            <span className="text-lg font-black text-green-700">{fmtCurrency(comissaoTotal)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm font-bold text-slate-400">(-) Adiantamentos</span>
            <span className="text-lg font-black text-red-500">- {fmtCurrency(adiantamentosTotal)}</span>
          </div>
          <div className="flex justify-between items-center border-t-2 border-slate-100 pt-3">
            <span className="text-base font-black text-black uppercase tracking-wide">A Pagar</span>
            <span className={`text-2xl font-black ${liquido >= 0 ? 'text-black' : 'text-red-600'}`}>{fmtCurrency(liquido)}</span>
          </div>
        </div>
        <button
          onClick={() => setShowPagarModal(true)}
          disabled={procedimentos.length === 0 || !selectedProf}
          className="w-full bg-orange-500 text-white py-5 rounded-[24px] font-black text-sm uppercase tracking-[0.2em] hover:bg-orange-400 disabled:opacity-40 transition-all active:scale-[0.98] shadow-lg shadow-orange-200"
        >
          Marcar como Pago
        </button>
      </div>

      {/* Histórico de pagamentos */}
      <div className="bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 overflow-hidden">
        <div className="px-8 py-5 border-b-2 border-slate-50 flex items-center gap-3">
          <div className="w-9 h-9 bg-slate-200 text-slate-600 rounded-xl flex items-center justify-center text-sm">🗓️</div>
          <h3 className="font-black text-black uppercase tracking-widest text-sm">Histórico de Pagamentos</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-slate-50">
                {['Data Pgto', 'Período', 'Procedimentos', 'Comissão', 'Adiant.', 'Líquido', 'Forma', 'Status'].map(h => (
                  <th key={h} className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-50">
              {profHistorico.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-xs font-bold text-slate-300 uppercase">
                    Sem pagamentos registrados
                  </td>
                </tr>
              )}
              {profHistorico.map(p => (
                <tr key={p.id} className="hover:bg-slate-50/40 transition-colors">
                  <td className="px-6 py-4 text-xs font-bold text-slate-500 whitespace-nowrap">
                    {p.paidAt ? fmtDate(p.paidAt) : '—'}
                  </td>
                  <td className="px-6 py-4 text-xs font-bold text-slate-500 whitespace-nowrap">
                    {fmtDateShort(p.periodoInicio)} – {fmtDateShort(p.periodoFim)}
                  </td>
                  <td className="px-6 py-4 text-xs font-bold text-slate-500">
                    {p.comandaIds?.length ?? '—'}
                  </td>
                  <td className="px-6 py-4 font-black text-sm text-green-700">{fmtCurrency(p.comissaoTotal)}</td>
                  <td className="px-6 py-4 font-black text-sm text-red-500">- {fmtCurrency(p.adiantamentosTotal)}</td>
                  <td className="px-6 py-4 font-black text-sm text-black">{fmtCurrency(p.liquido)}</td>
                  <td className="px-6 py-4 text-xs font-bold text-slate-500">{p.paidMethod ?? '—'}</td>
                  <td className="px-6 py-4">
                    <span className={`text-[10px] font-black px-3 py-1.5 rounded-xl uppercase ${
                      p.status === 'pago' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {p.status === 'pago' ? 'Pago' : 'Pendente'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal marcar como pago */}
      {showPagarModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[40px] shadow-2xl p-10 w-full max-w-md space-y-6">
            <h2 className="text-xl font-black uppercase tracking-tight">Confirmar Pagamento</h2>

            <div className="bg-slate-50 rounded-2xl p-5 space-y-2 text-sm">
              <div className="flex justify-between font-bold text-slate-600">
                <span>Profissional</span>
                <span>{selectedProf?.name}</span>
              </div>
              <div className="flex justify-between font-bold text-slate-600">
                <span>Período</span>
                <span>{fmtDateShort(periodoInicio)} – {fmtDateShort(periodoFim)}</span>
              </div>
              <div className="flex justify-between font-bold text-slate-600">
                <span>Procedimentos</span>
                <span>{procedimentos.length}</span>
              </div>
              <div className="flex justify-between font-bold text-slate-600">
                <span>Comissão bruta</span>
                <span className="text-green-700">{fmtCurrency(comissaoTotal)}</span>
              </div>
              <div className="flex justify-between font-bold text-slate-400">
                <span>Adiantamentos</span>
                <span className="text-red-500">- {fmtCurrency(adiantamentosTotal)}</span>
              </div>
              <div className="flex justify-between font-black text-black border-t border-slate-200 pt-2 text-base">
                <span>A pagar</span>
                <span>{fmtCurrency(liquido)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Forma de Pagamento</label>
              <select
                value={pagarMethod}
                onChange={e => setPagarMethod(e.target.value)}
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-black outline-none focus:border-orange-500"
              >
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Observações <span className="text-slate-300">(opcional)</span></label>
              <textarea
                value={pagarNotes}
                onChange={e => setPagarNotes(e.target.value)}
                rows={3}
                placeholder="Observação sobre o pagamento..."
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-orange-500 resize-none"
              />
            </div>

            <p className="text-[10px] font-bold text-slate-400 text-center">
              O profissional receberá uma confirmação via WhatsApp.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowPagarModal(false)}
                className="flex-1 py-4 rounded-2xl font-black text-sm uppercase border-2 border-slate-200 hover:bg-slate-50 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handlePagar}
                disabled={paying}
                className="flex-1 py-4 rounded-2xl font-black text-sm uppercase bg-orange-500 text-white hover:bg-orange-400 disabled:opacity-50 transition-all"
              >
                {paying ? 'Confirmando...' : 'Confirmar Pagamento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FolhaPagamentoView;
