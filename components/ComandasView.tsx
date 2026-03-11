import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { emitirNfse } from '../services/focusNfeService';
import {
  Comanda, ComandaItem, PaymentMethod, AppointmentStatus,
  Professional, Customer, Service, Product,
  FocusNfeConfig, NotaFiscal,
} from '../types';

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 11);
}

const fmt = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`;

const itemTotal = (item: ComandaItem) => {
  const gross = item.qty * item.unitPrice;
  if (item.discountType === 'percent') return gross * (1 - item.discount / 100);
  return gross - (item.discount ?? 0);
};

const comandaTotal = (c: Comanda) => c.items.reduce((s, i) => s + itemTotal(i), 0);

const ComandasView: React.FC<{ tenantId: string; initialApptId?: string; onApptOpened?: () => void }> = ({ tenantId, initialApptId, onApptOpened }) => {
  const [activeTab, setActiveTab] = useState<'abertas' | 'finalizadas'>('abertas');
  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [commissionMap, setCommissionMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // ── Add product modal ─────────────────────────────────────────────
  const [addProductComanda, setAddProductComanda] = useState<Comanda | null>(null);
  const [addProductItemId, setAddProductItemId] = useState('');
  const [addProductQty, setAddProductQty] = useState(1);
  const [addProductDiscount, setAddProductDiscount] = useState(0);
  const [addProductDiscountType, setAddProductDiscountType] = useState<'value' | 'percent'>('value');

  // ── Add service modal ─────────────────────────────────────────────
  const [addServiceComanda, setAddServiceComanda] = useState<Comanda | null>(null);
  const [addServiceSvcId, setAddServiceSvcId] = useState('');
  const [addServicePrice, setAddServicePrice] = useState(0);
  const [addServiceDiscount, setAddServiceDiscount] = useState(0);
  const [addServiceDiscountType, setAddServiceDiscountType] = useState<'value' | 'percent'>('value');
  const [addServiceProfId, setAddServiceProfId] = useState('');

  // ── Close comanda modal ───────────────────────────────────────────
  const [closeComanda, setCloseComanda] = useState<Comanda | null>(null);
  const [closePayment, setClosePayment] = useState<PaymentMethod>(PaymentMethod.PIX);
  const [closeNotes, setCloseNotes] = useState('');
  const [closing, setClosing] = useState(false);

  // ── NFS-e on close ────────────────────────────────────────────────
  const [focusNfeConfig, setFocusNfeConfig] = useState<FocusNfeConfig | null>(null);
  const [emitNfseOnClose, setEmitNfseOnClose] = useState(false);
  const [nfseTomadorCpf, setNfseTomadorCpf] = useState('');

  // ── Detail modal ──────────────────────────────────────────────────
  const [detailComanda, setDetailComanda] = useState<Comanda | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, pros, custs, svcs, prods, settings, nfeCfg] = await Promise.all([
        db.getComandas(tenantId),
        db.getProfessionals(tenantId),
        db.getCustomers(tenantId),
        db.getServices(tenantId),
        db.getProducts(tenantId),
        db.getSettings(tenantId),
        db.getFocusNfeConfig(tenantId),
      ]);
      setFocusNfeConfig(nfeCfg);
      setComandas(c);
      setProfessionals(pros);
      setCustomers(custs);
      setServices(svcs);
      setProducts(prods);
      // Build commission map
      const cMap: Record<string, number> = {};
      if (settings.professionalMeta) {
        for (const [profId, meta] of Object.entries(settings.professionalMeta)) {
          cMap[profId] = meta.commissionRate ?? 0;
        }
      }
      setCommissionMap(cMap);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const [highlightId, setHighlightId] = useState<string | undefined>(undefined);

  // Auto-open comanda when arriving via appointment alert
  useEffect(() => {
    if (!initialApptId || loading || comandas.length === 0) return;
    const target = comandas.find(c => c.appointment_id === initialApptId && c.status === 'open');
    if (target) {
      setActiveTab('abertas');
      setHighlightId(target.id);
      onApptOpened?.();
      // Scroll to comanda card after render
      setTimeout(() => {
        document.getElementById(`comanda-${target.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    }
  }, [initialApptId, loading, comandas, onApptOpened]);

  const profName = (id: string) => professionals.find(p => p.id === id)?.name ?? '—';
  const custName = (id: string) => customers.find(c => c.id === id)?.name ?? '—';

  // ── Add product ───────────────────────────────────────────────────
  const handleAddProduct = async () => {
    if (!addProductComanda || !addProductItemId || addProductQty <= 0) return;
    const prod = products.find(p => p.id === addProductItemId);
    if (!prod) return;
    const newItem: ComandaItem = {
      id: generateId(), type: 'product', itemId: prod.id,
      name: prod.name, qty: addProductQty,
      unitPrice: prod.salePrice,
      discountType: addProductDiscountType,
      discount: addProductDiscount,
    };
    const updated = [...addProductComanda.items, newItem];
    await db.updateComanda(addProductComanda.id, { items: updated });
    setAddProductComanda(null);
    setAddProductItemId(''); setAddProductQty(1);
    setAddProductDiscount(0); setAddProductDiscountType('value');
    load();
  };

  // ── Add extra service ─────────────────────────────────────────────
  const handleAddService = async () => {
    if (!addServiceComanda || !addServiceSvcId) return;
    const svc = services.find(s => s.id === addServiceSvcId);
    if (!svc) return;
    const newItem: ComandaItem = {
      id: generateId(), type: 'service', itemId: svc.id,
      name: svc.name, qty: 1,
      unitPrice: addServicePrice > 0 ? addServicePrice : svc.price,
      discountType: addServiceDiscountType,
      discount: addServiceDiscount,
      professionalId: addServiceProfId || addServiceComanda.professional_id,
    };
    const updated = [...addServiceComanda.items, newItem];
    await db.updateComanda(addServiceComanda.id, { items: updated });
    setAddServiceComanda(null);
    setAddServiceSvcId(''); setAddServicePrice(0);
    setAddServiceDiscount(0); setAddServiceDiscountType('value');
    setAddServiceProfId('');
    load();
  };

  // ── Remove item ───────────────────────────────────────────────────
  const handleRemoveItem = async (comanda: Comanda, itemId: string) => {
    const updated = comanda.items.filter(i => i.id !== itemId);
    await db.updateComanda(comanda.id, { items: updated });
    load();
  };

  // ── Close comanda ─────────────────────────────────────────────────
  const handleClose = async () => {
    if (!closeComanda) return;
    setClosing(true);
    try {
      const total = comandaTotal(closeComanda);
      const closedAt = new Date().toISOString();
      // Decrement product stock for each product item
      for (const item of closeComanda.items) {
        if (item.type === 'product') {
          await db.decrementProduct(tenantId, item.itemId, item.qty);
        }
      }
      await db.updateComanda(closeComanda.id, {
        status: 'closed',
        paymentMethod: closePayment,
        notes: closeNotes || undefined,
        closedAt,
      });
      await db.updateAppointmentStatus(closeComanda.appointment_id, AppointmentStatus.FINISHED, {
        paymentMethod: closePayment,
        amountPaid: total,
      });

      // ── NFS-e automática ao fechar ──────────────────────────────────
      if (emitNfseOnClose && focusNfeConfig?.token) {
        const declaravel = calcDeclaravel(closeComanda);
        const notaId = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : Math.random().toString(36).substring(2, 11);
        const nota: NotaFiscal = {
          id: notaId,
          comandaIds: [closeComanda.id],
          status: 'pendente',
          valorBruto: total,
          valorDeclaravel: declaravel,
          tomadorCpfCnpj: nfseTomadorCpf || undefined,
          createdAt: closedAt,
        };
        await db.saveNotaFiscal(tenantId, nota);
        // Fire-and-forget: emit and update status asynchronously
        emitirNfse({
          config: focusNfeConfig,
          dataEmissao: closedAt.slice(0, 10),
          tomadorNome: 'Consumidor',
          tomadorCpfCnpj: nfseTomadorCpf || undefined,
          discriminacao: `Serviços — Comanda #${closeComanda.number ?? closeComanda.id.slice(0, 6)}`,
          valorServicos: total,
          valorDeclaravel: declaravel,
          referencia: notaId,
        }).then(res => {
          db.saveNotaFiscal(tenantId, {
            ...nota,
            status: res.success ? 'emitida' : 'erro',
            focusNfeRef: res.ref,
            nfseNumero: res.nfseNumero,
            nfseLink: res.link,
            errorMsg: res.error,
            emitedAt: res.success ? new Date().toISOString() : undefined,
          });
        }).catch(err => console.error('NFS-e background emit error:', err));
      }

      setCloseComanda(null);
      setCloseNotes('');
      setEmitNfseOnClose(false);
      setNfseTomadorCpf('');
      load();
    } finally {
      setClosing(false);
    }
  };

  // ── Per-professional revenue breakdown (for close modal) ──────────
  const buildProRevenue = (c: Comanda) =>
    c.items.reduce((acc, item) => {
      const profId = item.professionalId ?? c.professional_id;
      acc[profId] = (acc[profId] ?? 0) + itemTotal(item);
      return acc;
    }, {} as Record<string, number>);

  // ── Lei do Salão-Parceiro: valor declarável (cota-parte estabelecimento) ──
  const calcDeclaravel = (c: Comanda): number =>
    c.items.reduce((acc, item) => {
      const profId = item.professionalId ?? c.professional_id;
      const rate = commissionMap[profId] ?? 0;
      return acc + itemTotal(item) * (1 - rate / 100);
    }, 0);

  const open = comandas
    .filter(c => c.status === 'open')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const finished = comandas
    .filter(c => c.status === 'closed')
    .sort((a, b) => new Date(b.closedAt || b.createdAt).getTime() - new Date(a.closedAt || a.createdAt).getTime());

  // Comanda criada nos últimos 90 segundos é marcada como "nova"
  const nowMs = Date.now();
  const newestOpenId = open.length > 0
    ? (nowMs - new Date(open[0].createdAt).getTime() < 90_000 ? open[0].id : null)
    : null;

  if (loading) return (
    <div className="p-20 text-center font-black text-slate-300 animate-pulse uppercase tracking-widest text-sm">
      Carregando comandas...
    </div>
  );

  const renderItemRow = (item: ComandaItem, comanda: Comanda, canRemove: boolean) => {
    const discountDisplay = item.discount > 0
      ? item.discountType === 'percent'
        ? `-${item.discount}%`
        : `-${fmt(item.discount)}`
      : null;
    const itemProf = item.professionalId
      ? professionals.find(p => p.id === item.professionalId)
      : null;
    return (
      <div key={item.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-50 last:border-0">
        <div className="flex-1 min-w-0">
          <span className="text-xs font-bold text-black">{item.name}</span>
          {item.type === 'product' && (
            <span className="ml-1.5 text-[9px] font-black text-blue-400 uppercase">produto</span>
          )}
          {itemProf && item.type === 'service' && (
            <span className="ml-1.5 text-[9px] font-black text-orange-400 uppercase">{itemProf.name}</span>
          )}
          <span className="ml-2 text-[10px] text-slate-400">{item.qty}x {fmt(item.unitPrice)}</span>
          {discountDisplay && <span className="ml-1 text-[10px] text-red-400">{discountDisplay}</span>}
        </div>
        <span className="text-xs font-black text-black whitespace-nowrap">{fmt(itemTotal(item))}</span>
        {canRemove && (
          <button
            onClick={() => handleRemoveItem(comanda, item.id)}
            className="text-slate-300 hover:text-red-400 text-[10px] font-black ml-1 transition-all"
          >✕</button>
        )}
      </div>
    );
  };

  const renderOpenCard = (c: Comanda) => {
    const total = comandaTotal(c);
    const isNew = c.id === newestOpenId;
    const isHighlighted = c.id === highlightId;
    return (
      <div id={`comanda-${c.id}`} key={c.id} className={`bg-white rounded-[28px] border-2 p-6 space-y-4 transition-all ${
        isHighlighted
          ? 'border-orange-400 shadow-xl shadow-orange-100 ring-2 ring-orange-300 ring-offset-2'
          : isNew
          ? 'border-emerald-400 shadow-xl shadow-emerald-100 ring-2 ring-emerald-300 ring-offset-2'
          : 'border-emerald-100 shadow-lg shadow-emerald-50'
      }`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              {c.number && (
                <span className="text-[9px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg tracking-widest">
                  #{String(c.number).padStart(3, '0')}
                </span>
              )}
              <p className="font-black text-sm text-black leading-tight">{custName(c.customer_id)}</p>
              {isNew && (
                <span className="text-[8px] font-black bg-emerald-500 text-white px-2 py-0.5 rounded-full uppercase tracking-widest animate-pulse">
                  Nova
                </span>
              )}
            </div>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
              {profName(c.professional_id)} · {new Date(c.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[9px] font-black text-emerald-700 uppercase tracking-widest">Aberta</span>
          </div>
        </div>

        {/* Items */}
        <div className="bg-slate-50 rounded-2xl px-4 py-3 space-y-0">
          {c.items.length === 0 ? (
            <p className="text-[10px] font-bold text-slate-300 text-center py-2">Nenhum item</p>
          ) : (
            c.items.map(item => renderItemRow(item, c, true))
          )}
        </div>

        {/* Total */}
        <div className="flex justify-between items-center px-2">
          <span className="text-[10px] font-black text-slate-400 uppercase">Total</span>
          <span className="text-xl font-black text-black">{fmt(total)}</span>
        </div>

        {/* Dica para comanda nova */}
        {isNew && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2.5 text-[10px] font-bold text-emerald-700 text-center">
            🎉 Cliente chegou! Adicione procedimentos ou produtos antes de fechar.
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => {
              setAddProductItemId(''); setAddProductQty(1);
              setAddProductDiscount(0); setAddProductDiscountType('value');
              setAddProductComanda(c);
            }}
            className="flex-1 py-2 bg-blue-50 text-blue-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-100 transition-all"
          >
            ➕ Produto
          </button>
          <button
            onClick={() => {
              setAddServiceSvcId(''); setAddServicePrice(0);
              setAddServiceDiscount(0); setAddServiceDiscountType('value');
              setAddServiceProfId(c.professional_id);
              setAddServiceComanda(c);
            }}
            className="flex-1 py-2 bg-orange-50 text-orange-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-100 transition-all"
          >
            ✂️ Serviço
          </button>
          <button
            onClick={() => {
              setClosePayment(PaymentMethod.PIX);
              setCloseNotes('');
              setCloseComanda(c);
            }}
            className="flex-1 py-2 bg-black text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-all"
          >
            ✅ Fechar
          </button>
        </div>
      </div>
    );
  };

  // Product preview helper
  const selectedProduct = products.find(p => p.id === addProductItemId);
  const productSubtotal = selectedProduct
    ? addProductDiscountType === 'percent'
      ? addProductQty * selectedProduct.salePrice * (1 - addProductDiscount / 100)
      : addProductQty * selectedProduct.salePrice - addProductDiscount
    : 0;

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Comandas</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            {open.length > 0 ? `${open.length} comanda${open.length !== 1 ? 's' : ''} aberta${open.length !== 1 ? 's' : ''}` : 'Nenhuma comanda aberta'}
          </p>
        </div>
        {open.length > 0 && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">
              {open.length} em atendimento
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-2xl p-1 w-fit">
        {(['abertas', 'finalizadas'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
              activeTab === tab ? 'bg-white text-black shadow-sm' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {tab === 'abertas' ? `Abertas (${open.length})` : `Finalizadas (${finished.length})`}
          </button>
        ))}
      </div>

      {/* ── Abertas ───────────────────────────────────────────────────── */}
      {activeTab === 'abertas' && (
        <>
          {open.length === 0 ? (
            <div className="bg-white rounded-[40px] border-2 border-dashed border-slate-200 p-20 text-center">
              <p className="text-4xl mb-4">🧾</p>
              <p className="font-black text-slate-300 uppercase tracking-widest text-sm">Nenhuma comanda aberta</p>
              <p className="text-xs font-bold text-slate-300 mt-2">
                Marque um agendamento como "Cliente Chegou" para abrir uma comanda
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {open.map(renderOpenCard)}
            </div>
          )}
        </>
      )}

      {/* ── Finalizadas ───────────────────────────────────────────────── */}
      {activeTab === 'finalizadas' && (
        <>
          {finished.length === 0 ? (
            <div className="bg-white rounded-[40px] border-2 border-dashed border-slate-200 p-20 text-center">
              <p className="text-4xl mb-4">✅</p>
              <p className="font-black text-slate-300 uppercase tracking-widest text-sm">Nenhuma comanda finalizada</p>
            </div>
          ) : (
            <div className="bg-white rounded-[28px] border-2 border-slate-100 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">#</th>
                    <th className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">Data/Hora</th>
                    <th className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">Cliente</th>
                    <th className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">Profissional</th>
                    <th className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">Itens</th>
                    <th className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">Pagamento</th>
                    <th className="px-6 py-4 text-right text-[9px] font-black text-slate-400 uppercase tracking-widest">Total</th>
                    <th className="px-6 py-4" />
                  </tr>
                </thead>
                <tbody>
                  {finished.map(c => (
                    <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50 transition-all">
                      <td className="px-6 py-4 text-[10px] font-black text-slate-400">
                        {c.number ? `#${String(c.number).padStart(3, '0')}` : '—'}
                      </td>
                      <td className="px-6 py-4 text-xs font-bold text-slate-500">
                        {c.closedAt
                          ? new Date(c.closedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </td>
                      <td className="px-6 py-4 text-xs font-black text-black">{custName(c.customer_id)}</td>
                      <td className="px-6 py-4 text-xs font-bold text-slate-500">{profName(c.professional_id)}</td>
                      <td className="px-6 py-4 text-xs font-bold text-slate-500">{c.items.length} item{c.items.length !== 1 ? 's' : ''}</td>
                      <td className="px-6 py-4">
                        <span className="text-[10px] font-black text-slate-400 uppercase">{c.paymentMethod ?? '—'}</span>
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-black text-black">{fmt(comandaTotal(c))}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => setDetailComanda(c)}
                          className="text-[10px] font-black text-slate-400 uppercase hover:text-orange-500 transition-all"
                        >
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Modal: Adicionar Produto ──────────────────────────────────── */}
      {addProductComanda && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md max-h-[90vh] overflow-y-auto p-8 space-y-5 animate-scaleUp border-4 border-black">
              <h2 className="text-xl font-black text-black uppercase tracking-tight">Adicionar Produto</h2>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Produto</label>
                <select
                  value={addProductItemId}
                  onChange={e => setAddProductItemId(e.target.value)}
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm"
                >
                  <option value="">Selecionar produto...</option>
                  {products.filter(p => p.active).map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {fmt(p.salePrice)}{p.quantity !== undefined ? ` (${p.quantity} ${p.unit || 'un'} em estoque)` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Quantidade</label>
                <input
                  type="number" min={1} value={addProductQty}
                  onChange={e => setAddProductQty(Number(e.target.value))}
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Desconto</label>
                <div className="flex gap-2">
                  <div className="flex rounded-2xl border-2 border-slate-100 overflow-hidden">
                    <button
                      onClick={() => setAddProductDiscountType('value')}
                      className={`px-4 py-2 text-xs font-black uppercase transition-all ${addProductDiscountType === 'value' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-400'}`}
                    >R$</button>
                    <button
                      onClick={() => setAddProductDiscountType('percent')}
                      className={`px-4 py-2 text-xs font-black uppercase transition-all ${addProductDiscountType === 'percent' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-400'}`}
                    >%</button>
                  </div>
                  <input
                    type="number" min={0} value={addProductDiscount}
                    onChange={e => setAddProductDiscount(Number(e.target.value))}
                    placeholder={addProductDiscountType === 'percent' ? '0%' : 'R$ 0'}
                    className="flex-1 p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black"
                  />
                </div>
              </div>
              {selectedProduct && (
                <div className="bg-black rounded-2xl px-6 py-4 text-center">
                  <p className="text-[9px] font-black text-slate-500 uppercase mb-1">Subtotal</p>
                  <p className="text-2xl font-black text-white">{fmt(Math.max(0, productSubtotal))}</p>
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={() => setAddProductComanda(null)} className="flex-1 py-3 text-slate-400 font-black text-xs uppercase">Cancelar</button>
                <button
                  onClick={handleAddProduct}
                  disabled={!addProductItemId || addProductQty <= 0}
                  className="flex-1 py-3 bg-blue-500 text-white rounded-2xl font-black text-xs uppercase disabled:opacity-40"
                >
                  Adicionar
                </button>
              </div>
            </div>
          </div>
      )}

      {/* ── Modal: Adicionar Serviço Extra ────────────────────────────── */}
      {addServiceComanda && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md max-h-[90vh] overflow-y-auto p-8 space-y-5 animate-scaleUp border-4 border-black">
              <h2 className="text-xl font-black text-black uppercase tracking-tight">Serviço Extra</h2>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Serviço</label>
                <select
                  value={addServiceSvcId}
                  onChange={e => {
                    const svc = services.find(s => s.id === e.target.value);
                    setAddServiceSvcId(e.target.value);
                    setAddServicePrice(svc?.price ?? 0);
                  }}
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm"
                >
                  <option value="">Selecionar serviço...</option>
                  {services.filter(s => s.active).map(s => (
                    <option key={s.id} value={s.id}>{s.name} — {fmt(s.price)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Profissional Responsável</label>
                <select
                  value={addServiceProfId}
                  onChange={e => setAddServiceProfId(e.target.value)}
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm"
                >
                  {professionals.filter(p => p.active).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Preço (R$)</label>
                <input
                  type="number" min={0} value={addServicePrice}
                  onChange={e => setAddServicePrice(Number(e.target.value))}
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Desconto</label>
                <div className="flex gap-2">
                  <div className="flex rounded-2xl border-2 border-slate-100 overflow-hidden">
                    <button
                      onClick={() => setAddServiceDiscountType('value')}
                      className={`px-4 py-2 text-xs font-black uppercase transition-all ${addServiceDiscountType === 'value' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-400'}`}
                    >R$</button>
                    <button
                      onClick={() => setAddServiceDiscountType('percent')}
                      className={`px-4 py-2 text-xs font-black uppercase transition-all ${addServiceDiscountType === 'percent' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-400'}`}
                    >%</button>
                  </div>
                  <input
                    type="number" min={0} value={addServiceDiscount}
                    onChange={e => setAddServiceDiscount(Number(e.target.value))}
                    className="flex-1 p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setAddServiceComanda(null)} className="flex-1 py-3 text-slate-400 font-black text-xs uppercase">Cancelar</button>
                <button
                  onClick={handleAddService}
                  disabled={!addServiceSvcId}
                  className="flex-1 py-3 bg-orange-500 text-white rounded-2xl font-black text-xs uppercase disabled:opacity-40"
                >
                  Adicionar
                </button>
              </div>
            </div>
          </div>
      )}

      {/* ── Modal: Fechar Comanda ─────────────────────────────────────── */}
      {closeComanda && (() => {
        const proRevenue = buildProRevenue(closeComanda);
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-white rounded-[40px] w-full max-w-md max-h-[90vh] overflow-y-auto p-8 space-y-5 animate-scaleUp border-4 border-black">
                <h2 className="text-xl font-black text-black uppercase tracking-tight">Fechar Comanda</h2>
                <p className="text-xs font-bold text-slate-400">
                  {custName(closeComanda.customer_id)} · {profName(closeComanda.professional_id)}
                </p>

                {/* Item summary */}
                <div className="bg-slate-50 rounded-2xl px-4 py-3 space-y-0">
                  {closeComanda.items.map(item => {
                    const discountDisplay = item.discount > 0
                      ? item.discountType === 'percent' ? `-${item.discount}%` : `-${fmt(item.discount)}`
                      : null;
                    return (
                      <div key={item.id} className="flex justify-between py-1.5 border-b border-slate-100 last:border-0">
                        <div>
                          <span className="text-xs font-bold text-black">{item.name}</span>
                          <span className="ml-2 text-[10px] text-slate-400">{item.qty}x {fmt(item.unitPrice)}</span>
                          {discountDisplay && <span className="ml-1 text-[10px] text-red-400">{discountDisplay}</span>}
                        </div>
                        <span className="text-xs font-black text-black">{fmt(itemTotal(item))}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Total */}
                <div className="bg-black rounded-2xl px-6 py-5 text-center">
                  <p className="text-[9px] font-black text-slate-500 uppercase mb-1">Total a Cobrar</p>
                  <p className="text-3xl font-black text-white">{fmt(comandaTotal(closeComanda))}</p>
                </div>

                {/* Multi-professional breakdown */}
                {Object.keys(proRevenue).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Comissionamento por Profissional</p>
                    <div className="bg-orange-50 rounded-2xl px-4 py-3 space-y-1.5">
                      {Object.entries(proRevenue).map(([profId, rev]) => {
                        const prof = professionals.find(p => p.id === profId);
                        const commRate = commissionMap[profId] ?? 0;
                        const commission = rev * commRate / 100;
                        return (
                          <div key={profId} className="flex justify-between text-xs">
                            <span className="font-bold text-slate-700">{prof?.name ?? '—'}</span>
                            <span className="text-slate-500">
                              {fmt(rev)}
                              {commRate > 0 && (
                                <span className="ml-1 text-orange-600 font-black">
                                  → {commRate}% = {fmt(commission)}
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Payment */}
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Forma de Pagamento</label>
                  <select
                    value={closePayment}
                    onChange={e => setClosePayment(e.target.value as PaymentMethod)}
                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black"
                  >
                    {Object.values(PaymentMethod).map(pm => <option key={pm} value={pm}>{pm}</option>)}
                  </select>
                </div>

                {/* Notes */}
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Observações (Opcional)</label>
                  <input
                    value={closeNotes}
                    onChange={e => setCloseNotes(e.target.value)}
                    placeholder="Ex: cliente satisfeito, sem troco..."
                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none focus:border-orange-500"
                  />
                </div>

                {/* NFS-e option (only shown if FocusNFe is configured) */}
                {focusNfeConfig?.cnpj && (
                  <div className="space-y-2">
                    <div className="bg-blue-50 border-2 border-blue-100 rounded-2xl px-4 py-3 flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="emitNfse"
                        checked={emitNfseOnClose}
                        onChange={e => setEmitNfseOnClose(e.target.checked)}
                        className="accent-blue-500 w-4 h-4"
                      />
                      <label htmlFor="emitNfse" className="text-xs font-black text-blue-700 cursor-pointer">
                        Emitir NFS-e ao fechar
                      </label>
                    </div>
                    {emitNfseOnClose && (
                      <input
                        value={nfseTomadorCpf}
                        onChange={e => setNfseTomadorCpf(e.target.value)}
                        placeholder="CPF/CNPJ do tomador (opcional)"
                        className="w-full p-3.5 bg-blue-50 border-2 border-blue-100 rounded-2xl text-xs font-bold outline-none focus:border-blue-400 transition-all"
                      />
                    )}
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={() => setCloseComanda(null)} className="flex-1 py-3 text-slate-400 font-black text-xs uppercase">Cancelar</button>
                  <button
                    onClick={handleClose}
                    disabled={closing}
                    className="flex-1 py-3 bg-emerald-500 text-white rounded-2xl font-black text-xs uppercase disabled:opacity-50 hover:bg-emerald-600 transition-all"
                  >
                    {closing ? 'Fechando...' : '✅ Confirmar Fechamento'}
                  </button>
                </div>
            </div>
          </div>
        );
      })()}

      {/* ── Modal: Detalhes da Comanda Finalizada ─────────────────────── */}
      {detailComanda && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md max-h-[90vh] overflow-y-auto p-8 space-y-5 animate-scaleUp border-4 border-black">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-black text-black uppercase tracking-tight">Detalhes</h2>
                <button onClick={() => setDetailComanda(null)} className="text-slate-400 hover:text-black font-black text-lg">✕</button>
              </div>
              <div className="space-y-1 text-xs font-bold text-slate-500">
                <p>👤 {custName(detailComanda.customer_id)}</p>
                <p>✂️ {profName(detailComanda.professional_id)}</p>
                <p>📅 Fechada em: {detailComanda.closedAt
                  ? new Date(detailComanda.closedAt).toLocaleString('pt-BR')
                  : '—'}</p>
                {detailComanda.notes && <p>📝 {detailComanda.notes}</p>}
              </div>
              <div className="bg-slate-50 rounded-2xl px-4 py-3 space-y-0">
                {detailComanda.items.map(item => {
                  const discountDisplay = item.discount > 0
                    ? item.discountType === 'percent' ? `-${item.discount}%` : `-${fmt(item.discount)}`
                    : null;
                  const itemProf = item.professionalId
                    ? professionals.find(p => p.id === item.professionalId)
                    : null;
                  return (
                    <div key={item.id} className="flex justify-between py-1.5 border-b border-slate-100 last:border-0">
                      <div>
                        <span className="text-xs font-bold text-black">{item.name}</span>
                        {item.type === 'product' && (
                          <span className="ml-1.5 text-[9px] font-black text-blue-400 uppercase">produto</span>
                        )}
                        {itemProf && item.type === 'service' && (
                          <span className="ml-1.5 text-[9px] font-black text-orange-400 uppercase">{itemProf.name}</span>
                        )}
                        <span className="ml-2 text-[10px] text-slate-400">{item.qty}x {fmt(item.unitPrice)}</span>
                        {discountDisplay && <span className="ml-1 text-[10px] text-red-400">{discountDisplay}</span>}
                      </div>
                      <span className="text-xs font-black text-black">{fmt(itemTotal(item))}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between items-center px-2">
                <span className="text-[10px] font-black text-slate-400 uppercase">
                  {detailComanda.paymentMethod ?? '—'}
                </span>
                <span className="text-xl font-black text-black">{fmt(comandaTotal(detailComanda))}</span>
              </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ComandasView;
