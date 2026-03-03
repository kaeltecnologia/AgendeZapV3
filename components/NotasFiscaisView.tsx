import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { emitirNfse } from '../services/focusNfeService';
import {
  Comanda, ComandaItem, NotaFiscal,
  Professional, Customer, FocusNfeConfig
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

function comandaTotal(c: Comanda): number {
  return c.items.reduce((s, i) => s + itemTotal(i), 0);
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

// ── component ──────────────────────────────────────────────────────────────

interface Props {
  tenantId: string;
}

type FilterStatus = 'todas' | 'nao_emitida' | 'emitida' | 'pendente' | 'erro';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  nao_emitida: { label: 'Não emitida', color: 'bg-slate-100 text-slate-500' },
  pendente:    { label: 'Pendente',    color: 'bg-yellow-100 text-yellow-700' },
  emitida:     { label: 'Emitida',     color: 'bg-green-100 text-green-700' },
  erro:        { label: 'Erro',        color: 'bg-red-100 text-red-600' },
};

const NotasFiscaisView: React.FC<Props> = ({ tenantId }) => {
  const [comandas, setComandas]           = useState<Comanda[]>([]);
  const [notas, setNotas]                 = useState<NotaFiscal[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [customers, setCustomers]         = useState<Customer[]>([]);
  const [focusNfeConfig, setFocusNfeConfig] = useState<FocusNfeConfig | null>(null);
  const [commissionMap, setCommissionMap] = useState<Record<string, number>>({});
  const [loading, setLoading]             = useState(true);
  const [emitting, setEmitting]           = useState(false);

  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('todas');
  const [search, setSearch]             = useState('');

  // emit modal state
  const [showEmitModal, setShowEmitModal]       = useState(false);
  const [emitTomadorNome, setEmitTomadorNome]   = useState('');
  const [emitTomadorCpf, setEmitTomadorCpf]     = useState('');

  const calcDeclaravel = useCallback((c: Comanda): number =>
    c.items.reduce((acc, item) => {
      const profId = item.professionalId ?? c.professional_id;
      const rate   = commissionMap[profId] ?? 0;
      return acc + itemTotal(item) * (1 - rate / 100);
    }, 0),
    [commissionMap]
  );

  // ── load data ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    const [rawComandas, rawNotas, profs, custs, cfg, settings] = await Promise.all([
      db.getComandas(tenantId),
      db.getNotasFiscais(tenantId),
      db.getProfessionals(tenantId),
      db.getCustomers(tenantId),
      db.getFocusNfeConfig(tenantId),
      db.getSettings(tenantId),
    ]);
    setComandas(rawComandas.filter(c => c.status === 'closed'));
    setNotas(rawNotas);
    setProfessionals(profs);
    setCustomers(custs);
    setFocusNfeConfig(cfg);
    const cMap: Record<string, number> = {};
    if (settings.professionalMeta) {
      for (const [id, meta] of Object.entries(settings.professionalMeta)) {
        cMap[id] = meta.commissionRate ?? 0;
      }
    }
    setCommissionMap(cMap);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  // ── helpers for UI ───────────────────────────────────────────────────────

  const getNotaForComanda = (comandaId: string): NotaFiscal | undefined =>
    notas.find(n => n.comandaIds.includes(comandaId));

  const getCustomer = (id: string) => customers.find(c => c.id === id);
  const getProfessional = (id: string) => professionals.find(p => p.id === id);

  const getCommRate = (c: Comanda): number => {
    // If all items have same professional, use that rate; else weighted avg
    const rates = c.items.map(i => commissionMap[i.professionalId ?? c.professional_id] ?? 0);
    const total = c.items.reduce((a, i) => a + itemTotal(i), 0);
    if (total === 0) return 0;
    const weighted = c.items.reduce((a, i) => {
      const rate = commissionMap[i.professionalId ?? c.professional_id] ?? 0;
      return a + itemTotal(i) * rate;
    }, 0) / total;
    return Math.round(weighted * 10) / 10;
  };

  // ── filter ───────────────────────────────────────────────────────────────

  const filteredComandas = comandas.filter(c => {
    const nota = getNotaForComanda(c.id);
    const status: string = nota?.status ?? 'nao_emitida';
    if (filterStatus !== 'todas' && status !== filterStatus) return false;
    if (search) {
      const cust = getCustomer(c.customer_id);
      const name = cust?.name ?? '';
      if (!name.toLowerCase().includes(search.toLowerCase()) && !c.number?.toString().includes(search)) return false;
    }
    return true;
  });

  // ── selection ────────────────────────────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filteredComandas.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredComandas.map(c => c.id)));
    }
  };

  const selectedComandas = filteredComandas.filter(c => selected.has(c.id));
  const selectedBruto    = selectedComandas.reduce((a, c) => a + comandaTotal(c), 0);
  const selectedDeclaravel = selectedComandas.reduce((a, c) => a + calcDeclaravel(c), 0);

  // ── open emit modal ──────────────────────────────────────────────────────

  const handleOpenEmitModal = () => {
    if (selected.size === 0) return;
    // Pre-fill tomador from first selected comanda's customer
    const first = selectedComandas[0];
    const cust = first ? getCustomer(first.customer_id) : null;
    setEmitTomadorNome(cust?.name ?? '');
    setEmitTomadorCpf('');
    setShowEmitModal(true);
  };

  // ── emit NFS-e ────────────────────────────────────────────────────────────

  const handleEmitir = async () => {
    if (!focusNfeConfig?.cnpj) {
      alert('Configure as credenciais FocusNFe em Configurações → Fiscal primeiro.');
      return;
    }
    setEmitting(true);
    try {
      const referencia = generateId();
      const discriminacao = selectedComandas
        .map(c => `Comanda #${c.number ?? c.id.slice(0, 6)}`)
        .join(', ');

      const nota: NotaFiscal = {
        id: referencia,
        comandaIds: selectedComandas.map(c => c.id),
        status: 'pendente',
        valorBruto: selectedBruto,
        valorDeclaravel: selectedDeclaravel,
        tomadorNome: emitTomadorNome,
        tomadorCpfCnpj: emitTomadorCpf || undefined,
        createdAt: new Date().toISOString(),
      };
      await db.saveNotaFiscal(tenantId, nota);

      const res = await emitirNfse({
        config: focusNfeConfig,
        dataEmissao: new Date().toISOString().slice(0, 10),
        tomadorNome: emitTomadorNome || 'Consumidor',
        tomadorCpfCnpj: emitTomadorCpf || undefined,
        discriminacao: `Serviços de estética — ${discriminacao}`,
        valorServicos: selectedBruto,
        valorDeclaravel: selectedDeclaravel,
        referencia,
      });

      const updated: NotaFiscal = {
        ...nota,
        status: res.success ? 'emitida' : 'erro',
        focusNfeRef: res.ref,
        nfseNumero: res.nfseNumero,
        nfseLink: res.link,
        errorMsg: res.error,
        emitedAt: res.success ? new Date().toISOString() : undefined,
      };
      await db.saveNotaFiscal(tenantId, updated);

      if (res.success) {
        alert(`NFS-e emitida com sucesso!${res.nfseNumero ? ` Número: ${res.nfseNumero}` : ''}`);
      } else {
        alert(`Erro ao emitir NFS-e: ${res.error}`);
      }

      setSelected(new Set());
      setShowEmitModal(false);
      await load();
    } catch (e: unknown) {
      alert('Erro inesperado: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setEmitting(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO...</div>;

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fadeIn">

      {/* Header */}
      <div>
        <h1 className="text-3xl font-black text-black uppercase tracking-tight">Notas Fiscais de Serviço (NFS-e)</h1>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Emissão via FocusNFe</p>
      </div>

      {/* Info banner — Lei do Salão-Parceiro */}
      <div className="bg-blue-50 border-2 border-blue-100 rounded-3xl px-6 py-4 flex items-start gap-3">
        <span className="text-xl mt-0.5">ℹ️</span>
        <div>
          <p className="text-xs font-black text-blue-800 uppercase tracking-wide">Lei do Salão-Parceiro (Lei 13.352/2016)</p>
          <p className="text-xs text-blue-700 mt-1">
            Você declara o <strong>valor bruto</strong> da comanda, mas o ISS incide somente sobre a sua
            <strong> cota-parte</strong> (receita própria = bruto × (1 − % comissão do profissional)).
          </p>
        </div>
      </div>

      {/* Config warning */}
      {!focusNfeConfig?.cnpj && (
        <div className="bg-orange-50 border-2 border-orange-200 rounded-3xl px-6 py-4 text-xs font-bold text-orange-700">
          ⚠️ Credenciais FocusNFe não configuradas. Acesse <strong>Configurações → Fiscal (NFS-e)</strong> para configurar antes de emitir.
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {(['todas', 'nao_emitida', 'emitida', 'pendente', 'erro'] as FilterStatus[]).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-4 py-2 rounded-2xl text-[11px] font-black uppercase transition-all ${
              filterStatus === s ? 'bg-black text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {s === 'todas' ? 'Todas' : (STATUS_LABELS[s]?.label ?? s)}
          </button>
        ))}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar cliente ou #comanda..."
          className="flex-1 min-w-[220px] px-5 py-2.5 bg-slate-50 border-2 border-slate-100 rounded-2xl text-xs font-bold outline-none focus:border-orange-500 transition-all"
        />
      </div>

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div className="bg-black text-white rounded-3xl px-6 py-4 flex flex-wrap items-center gap-4 justify-between">
          <div className="flex flex-wrap gap-6 text-sm font-black">
            <span>{selected.size} comanda{selected.size !== 1 ? 's' : ''} selecionada{selected.size !== 1 ? 's' : ''}</span>
            <span>Bruto: {fmtCurrency(selectedBruto)}</span>
            <span>Declarável: {fmtCurrency(selectedDeclaravel)}</span>
          </div>
          <button
            onClick={handleOpenEmitModal}
            disabled={!focusNfeConfig?.cnpj}
            className="bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white px-6 py-2.5 rounded-2xl text-xs font-black uppercase transition-all"
          >
            Emitir NFS-e
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-slate-50">
                <th className="p-5 text-left">
                  <input
                    type="checkbox"
                    checked={filteredComandas.length > 0 && selected.size === filteredComandas.length}
                    onChange={toggleAll}
                    className="accent-orange-500 w-4 h-4"
                  />
                </th>
                {['#', 'Data Fechamento', 'Cliente', 'Profissional', 'Valor Bruto', 'Cota%', 'Valor Declarável', 'Status NFS-e', 'Ações'].map(h => (
                  <th key={h} className="p-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-50">
              {filteredComandas.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-16 text-center text-xs font-bold text-slate-300 uppercase">
                    Nenhuma comanda encontrada
                  </td>
                </tr>
              )}
              {filteredComandas.map(c => {
                const nota     = getNotaForComanda(c.id);
                const status   = nota?.status ?? 'nao_emitida';
                const bruto    = comandaTotal(c);
                const declarav = calcDeclaravel(c);
                const cotaRate = getCommRate(c);
                const cust     = getCustomer(c.customer_id);
                const prof     = getProfessional(c.professional_id);
                const badge    = STATUS_LABELS[status] ?? { label: status, color: 'bg-slate-100 text-slate-500' };

                return (
                  <tr key={c.id} className={`hover:bg-slate-50/50 transition-colors ${selected.has(c.id) ? 'bg-orange-50/30' : ''}`}>
                    <td className="p-5">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        className="accent-orange-500 w-4 h-4"
                      />
                    </td>
                    <td className="p-5 font-black text-sm text-slate-600">#{c.number ?? c.id.slice(0, 6)}</td>
                    <td className="p-5 text-xs font-bold text-slate-500 whitespace-nowrap">{c.closedAt ? fmtDate(c.closedAt) : '—'}</td>
                    <td className="p-5 font-black text-sm">{cust?.name ?? '—'}</td>
                    <td className="p-5 text-xs font-bold text-slate-600">{prof?.name ?? '—'}</td>
                    <td className="p-5 font-black text-sm text-green-700">{fmtCurrency(bruto)}</td>
                    <td className="p-5 text-xs font-bold text-slate-500">{cotaRate > 0 ? `${100 - cotaRate}% est. / ${cotaRate}% pro` : '100%'}</td>
                    <td className="p-5 font-black text-sm text-blue-700">{fmtCurrency(declarav)}</td>
                    <td className="p-5">
                      <span className={`text-[10px] font-black px-3 py-1.5 rounded-xl uppercase ${badge.color}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="p-5">
                      {nota?.nfseLink && (
                        <a
                          href={nota.nfseLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] font-black text-blue-600 hover:text-blue-800 underline uppercase"
                        >
                          Ver NF
                        </a>
                      )}
                      {nota?.nfseNumero && !nota.nfseLink && (
                        <span className="text-[10px] font-bold text-slate-500">#{nota.nfseNumero}</span>
                      )}
                      {nota?.errorMsg && (
                        <span className="text-[10px] font-bold text-red-500" title={nota.errorMsg}>Erro ⚠</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer legend */}
        <div className="border-t-2 border-slate-50 px-6 py-4 flex flex-wrap gap-6 text-[10px] font-bold text-slate-400 uppercase">
          <span>Valor Declarável = parcela que fica para o estabelecimento (receita própria)</span>
          <span>•</span>
          <span>ISS incide somente sobre o Valor Declarável</span>
        </div>
      </div>

      {/* Emit modal */}
      {showEmitModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[40px] shadow-2xl p-10 w-full max-w-lg space-y-6">
            <h2 className="text-xl font-black uppercase tracking-tight">Emitir NFS-e</h2>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Nome do Tomador</label>
                <input
                  value={emitTomadorNome}
                  onChange={e => setEmitTomadorNome(e.target.value)}
                  placeholder="Nome do cliente"
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-orange-500 transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">CPF/CNPJ do Tomador <span className="text-slate-300">(opcional)</span></label>
                <input
                  value={emitTomadorCpf}
                  onChange={e => setEmitTomadorCpf(e.target.value)}
                  placeholder="000.000.000-00"
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-orange-500 transition-all"
                />
              </div>
            </div>

            {/* Summary */}
            <div className="bg-slate-50 rounded-2xl p-5 space-y-2 text-sm">
              <div className="flex justify-between font-bold text-slate-600">
                <span>Valor Bruto</span>
                <span>{fmtCurrency(selectedBruto)}</span>
              </div>
              <div className="flex justify-between font-bold text-slate-400">
                <span>(-) Deduções (cota-parte parceiros)</span>
                <span>- {fmtCurrency(selectedBruto - selectedDeclaravel)}</span>
              </div>
              <div className="flex justify-between font-black text-blue-700 border-t border-slate-200 pt-2 mt-2">
                <span>Valor Declarável (base ISS)</span>
                <span>{fmtCurrency(selectedDeclaravel)}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowEmitModal(false)}
                className="flex-1 py-4 rounded-2xl font-black text-sm uppercase border-2 border-slate-200 hover:bg-slate-50 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleEmitir}
                disabled={emitting}
                className="flex-1 py-4 rounded-2xl font-black text-sm uppercase bg-orange-500 text-white hover:bg-orange-400 disabled:opacity-50 transition-all"
              >
                {emitting ? 'Emitindo...' : 'Emitir via FocusNFe'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotasFiscaisView;
