import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { evolutionService } from '../services/evolutionService';
import {
  Professional, Comanda, ComandaItem,
  Adiantamento, PagamentoPro, Customer, Service
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

function toDateISO(s: string): string {
  // Ensure YYYY-MM-DD
  return s;
}

// ── interfaces ─────────────────────────────────────────────────────────────

interface ProcedimentoRow {
  comandaId: string;
  comandaNumber?: number;
  closedAt: string;
  customerId: string;
  item: ComandaItem;
  valor: number;
  comissao: number;
}

interface Props {
  tenantId: string;
}

// ── component ──────────────────────────────────────────────────────────────

const PAYMENT_METHODS = ['Dinheiro', 'PIX', 'Transferência/TED', 'Débito', 'Crédito', 'Outro'];

const FolhaPagamentoView: React.FC<Props> = ({ tenantId }) => {
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [comandas, setComandas]           = useState<Comanda[]>([]);
  const [customers, setCustomers]         = useState<Customer[]>([]);
  const [services, setServices]           = useState<Service[]>([]);
  const [adiantamentos, setAdiantamentos] = useState<Adiantamento[]>([]);
  const [pagamentos, setPagamentos]       = useState<PagamentoPro[]>([]);
  const [commissionMap, setCommissionMap] = useState<Record<string, number>>({});
  const [loading, setLoading]             = useState(true);

  const [selectedProfId, setSelectedProfId] = useState('');

  // Period defaults: current month
  const today = new Date();
  const firstDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay  = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    .toISOString().slice(0, 10);

  const [periodoInicio, setPeriodoInicio] = useState(firstDay);
  const [periodoFim, setPeriodoFim]       = useState(lastDay);

  // Add adiantamento form
  const [showAddAdiant, setShowAddAdiant] = useState(false);
  const [addAdiantValue, setAddAdiantValue] = useState('');
  const [addAdiantDesc, setAddAdiantDesc]   = useState('');
  const [addAdiantDate, setAddAdiantDate]   = useState(today.toISOString().slice(0, 10));
  const [savingAdiant, setSavingAdiant]     = useState(false);

  // Pagar modal
  const [showPagarModal, setShowPagarModal] = useState(false);
  const [pagarMethod, setPagarMethod]       = useState(PAYMENT_METHODS[0]);
  const [pagarNotes, setPagarNotes]         = useState('');
  const [paying, setPaying]                 = useState(false);

  // commission rate for selected professional
  const commRate = selectedProfId ? (commissionMap[selectedProfId] ?? 0) : 0;

  // ── load ─────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    const [profs, cmds, custs, svcs, adis, pgtos, settings] = await Promise.all([
      db.getProfessionals(tenantId),
      db.getComandas(tenantId),
      db.getCustomers(tenantId),
      db.getServices(tenantId),
      db.getAdiantamentos(tenantId),
      db.getPagamentosPro(tenantId),
      db.getSettings(tenantId),
    ]);
    setProfessionals(profs.filter(p => p.active));
    setComandas(cmds.filter(c => c.status === 'closed'));
    setCustomers(custs);
    setServices(svcs);
    setAdiantamentos(adis);
    setPagamentos(pgtos);
    const cMap: Record<string, number> = {};
    if (settings.professionalMeta) {
      for (const [id, meta] of Object.entries(settings.professionalMeta)) {
        cMap[id] = meta.commissionRate ?? 0;
      }
    }
    setCommissionMap(cMap);
    if (!selectedProfId && profs.length > 0) setSelectedProfId(profs[0].id);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  // ── derived data ──────────────────────────────────────────────────────────

  const procedimentos: ProcedimentoRow[] = comandas
    .filter(c => {
      if (!c.closedAt) return false;
      const d = c.closedAt.slice(0, 10);
      return d >= toDateISO(periodoInicio) && d <= toDateISO(periodoFim);
    })
    .flatMap(c =>
      c.items
        .filter(i => (i.professionalId ?? c.professional_id) === selectedProfId)
        .map(i => {
          const val  = itemTotal(i);
          return {
            comandaId: c.id,
            comandaNumber: c.number,
            closedAt: c.closedAt!,
            customerId: c.customer_id,
            item: i,
            valor: val,
            comissao: val * commRate / 100,
          };
        })
    )
    .sort((a, b) => a.closedAt.localeCompare(b.closedAt));

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

  const getCustomer  = (id: string) => customers.find(c => c.id === id);
  const getServiceName = (itemId: string) => {
    const svc = services.find(s => s.id === itemId);
    return svc?.name ?? itemId;
  };

  const selectedProf = professionals.find(p => p.id === selectedProfId);

  // ── add adiantamento ─────────────────────────────────────────────────────

  const handleAddAdiantamento = async () => {
    const amount = parseFloat(addAdiantValue.replace(',', '.'));
    if (!amount || amount <= 0) { alert('Informe um valor válido.'); return; }
    if (!selectedProfId) return;
    setSavingAdiant(true);
    try {
      await db.addAdiantamento(tenantId, {
        professionalId: selectedProfId,
        amount,
        date: addAdiantDate,
        description: addAdiantDesc || undefined,
      });
      setAddAdiantValue('');
      setAddAdiantDesc('');
      setAddAdiantDate(today.toISOString().slice(0, 10));
      setShowAddAdiant(false);
      await load();
    } finally {
      setSavingAdiant(false);
    }
  };

  const handleDeleteAdiantamento = async (id: string) => {
    if (!window.confirm('Remover adiantamento?')) return;
    await db.deleteAdiantamento(tenantId, id);
    await load();
  };

  // ── marcar pago ───────────────────────────────────────────────────────────

  const handlePagar = async () => {
    if (!selectedProfId || !selectedProf) return;
    setPaying(true);
    try {
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
      });

      // Send WhatsApp to professional
      try {
        const tenant = await db.getTenant(tenantId);
        const instance = tenant?.evolution_instance;
        if (instance && selectedProf.phone) {
          const msg =
            `✅ *Pagamento Confirmado!*\n\n` +
            `Olá, ${selectedProf.name}! Seu pagamento foi processado com sucesso.\n\n` +
            `📅 *Período:* ${fmtDateShort(periodoInicio)} a ${fmtDateShort(periodoFim)}\n` +
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

      {/* Procedimentos */}
      <div className="bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 overflow-hidden">
        <div className="px-8 py-5 border-b-2 border-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-black text-white rounded-xl flex items-center justify-center text-sm">📋</div>
            <h3 className="font-black text-black uppercase tracking-widest text-sm">Procedimentos no Período</h3>
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
                    Nenhum procedimento no período
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
                    <td className="px-6 py-4 font-black text-sm text-green-700">{fmtCurrency(row.valor)}</td>
                    <td className="px-6 py-4 font-black text-sm text-orange-600">{fmtCurrency(row.comissao)}</td>
                    <td className="px-6 py-4 text-xs font-bold text-slate-400">#{row.comandaNumber ?? row.comandaId.slice(0, 6)}</td>
                  </tr>
                );
              })}
            </tbody>
            {procedimentos.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-100 bg-slate-50/50">
                  <td colSpan={3} className="px-6 py-4 text-xs font-black text-slate-500 uppercase">Total Comissão Bruta</td>
                  <td className="px-6 py-4 font-black text-base text-green-700">{fmtCurrency(procedimentos.reduce((a, p) => a + p.valor, 0))}</td>
                  <td className="px-6 py-4 font-black text-base text-orange-600">{fmtCurrency(comissaoTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Adiantamentos */}
      <div className="bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 overflow-hidden">
        <div className="px-8 py-5 border-b-2 border-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-orange-500 text-white rounded-xl flex items-center justify-center text-sm">💸</div>
            <h3 className="font-black text-black uppercase tracking-widest text-sm">Adiantamentos</h3>
          </div>
          <button
            onClick={() => setShowAddAdiant(v => !v)}
            className="bg-black text-white text-xs font-black uppercase px-5 py-2.5 rounded-2xl hover:bg-orange-500 transition-all"
          >
            + Registrar
          </button>
        </div>

        {showAddAdiant && (
          <div className="px-8 py-6 border-b-2 border-slate-50 bg-slate-50/50 flex flex-wrap gap-4 items-end">
            <div className="space-y-1 flex-1 min-w-[120px]">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Valor (R$)</label>
              <input
                type="number"
                step="0.01"
                value={addAdiantValue}
                onChange={e => setAddAdiantValue(e.target.value)}
                placeholder="0,00"
                className="w-full p-3 bg-white border-2 border-slate-200 rounded-2xl text-sm font-black outline-none focus:border-orange-500"
              />
            </div>
            <div className="space-y-1 flex-1 min-w-[200px]">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Descrição <span className="text-slate-300">(opcional)</span></label>
              <input
                value={addAdiantDesc}
                onChange={e => setAddAdiantDesc(e.target.value)}
                placeholder="Ex: adiantamento semana 1"
                className="w-full p-3 bg-white border-2 border-slate-200 rounded-2xl text-sm font-bold outline-none focus:border-orange-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Data</label>
              <input
                type="date"
                value={addAdiantDate}
                onChange={e => setAddAdiantDate(e.target.value)}
                className="p-3 bg-white border-2 border-slate-200 rounded-2xl text-sm font-black outline-none focus:border-orange-500"
              />
            </div>
            <button
              onClick={handleAddAdiantamento}
              disabled={savingAdiant}
              className="bg-orange-500 text-white text-xs font-black uppercase px-6 py-3 rounded-2xl hover:bg-orange-400 disabled:opacity-50 transition-all"
            >
              {savingAdiant ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-slate-50">
                {['Data', 'Descrição', 'Valor', ''].map(h => (
                  <th key={h} className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-50">
              {profAdiantamentos.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-xs font-bold text-slate-300 uppercase">
                    Nenhum adiantamento no período
                  </td>
                </tr>
              )}
              {profAdiantamentos.map(a => (
                <tr key={a.id} className="hover:bg-slate-50/40 transition-colors">
                  <td className="px-6 py-4 text-xs font-bold text-slate-500">{fmtDateShort(a.date)}</td>
                  <td className="px-6 py-4 text-sm font-bold text-slate-700">{a.description || '—'}</td>
                  <td className="px-6 py-4 font-black text-sm text-red-600">- {fmtCurrency(a.amount)}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleDeleteAdiantamento(a.id)}
                      className="text-red-400 hover:text-red-600 text-xs font-black uppercase transition-colors"
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {profAdiantamentos.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-100 bg-slate-50/50">
                  <td colSpan={2} className="px-6 py-4 text-xs font-black text-slate-500 uppercase">Total Adiantamentos</td>
                  <td className="px-6 py-4 font-black text-base text-red-600">- {fmtCurrency(adiantamentosTotal)}</td>
                  <td />
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
          disabled={liquido <= 0 || !selectedProf}
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
                {['Data Pgto', 'Período', 'Comissão', 'Adiant.', 'Líquido', 'Forma', 'Status'].map(h => (
                  <th key={h} className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-50">
              {profHistorico.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-xs font-bold text-slate-300 uppercase">
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

            {/* Summary card */}
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
