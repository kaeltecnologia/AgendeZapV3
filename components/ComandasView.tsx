import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../services/mockDb';
import { emitirNfse } from '../services/focusNfeService';
import {
  Comanda, ComandaItem, PaymentMethod, PaymentSplit, AppointmentStatus,
  Professional, Customer, Service, Product, Appointment,
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

const ComandasView: React.FC<{ tenantId: string; initialApptId?: string; onApptOpened?: () => void; refreshTicker?: number }> = ({ tenantId, initialApptId, onApptOpened, refreshTicker = 0 }) => {
  const [activeTab, setActiveTab] = useState<'abertas' | 'finalizadas'>('abertas');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [groupByCustomerFin, setGroupByCustomerFin] = useState(false);
  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [commissionMap, setCommissionMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const firstLoad = useRef(true);

  // ── Customer unified popup ────────────────────────────────────────
  const [customerPopupId, setCustomerPopupId] = useState<string | null>(null);
  const [selectedInPopup, setSelectedInPopup] = useState<Set<string>>(new Set());
  const [highlightComandaId, setHighlightComandaId] = useState<string | undefined>(undefined);

  // ── Batch close modal ─────────────────────────────────────────────
  const [batchCloseItems, setBatchCloseItems] = useState<Comanda[] | null>(null);
  const [batchClosePayment, setBatchClosePayment] = useState<PaymentMethod>(PaymentMethod.PIX);
  const [batchCloseNotes, setBatchCloseNotes] = useState('');
  const [batchClosing, setBatchClosing] = useState(false);

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

  // ── Close single comanda modal ────────────────────────────────────
  const [closeComanda, setCloseComanda] = useState<Comanda | null>(null);
  const [closeSplits, setCloseSplits] = useState<{ method: PaymentMethod; amount: string }[]>([{ method: PaymentMethod.PIX, amount: '' }]);
  const [closeNotes, setCloseNotes] = useState('');
  const [closing, setClosing] = useState(false);
  const [closeSelectedItems, setCloseSelectedItems] = useState<Set<string>>(new Set());

  // ── NFS-e on close ────────────────────────────────────────────────
  const [focusNfeConfig, setFocusNfeConfig] = useState<FocusNfeConfig | null>(null);
  const [emitNfseOnClose, setEmitNfseOnClose] = useState(false);
  const [nfseTomadorCpf, setNfseTomadorCpf] = useState('');

  // ── Edit closed comanda modal ─────────────────────────────────────
  const [editClosedId, setEditClosedId] = useState<string | null>(null);
  const [editClosedPayment, setEditClosedPayment] = useState<PaymentMethod>(PaymentMethod.PIX);
  const [editClosedNotes, setEditClosedNotes] = useState('');
  const [editClosedSaving, setEditClosedSaving] = useState(false);
  const [editCommissions, setEditCommissions] = useState<Record<string, string>>({});
  const editClosedObj = editClosedId ? comandas.find(c => c.id === editClosedId) ?? null : null;

  // ── Orphan FINISHED appointments (no comanda) ─────────────────────
  const [orphanAppts, setOrphanAppts] = useState<Appointment[]>([]);

  // ── Estorno modal ─────────────────────────────────────────────────
  const [estornoComanda, setEstornoComanda] = useState<Comanda | null>(null);
  const [estornoValor, setEstornoValor] = useState('');
  const [estornoPagamento, setEstornoPagamento] = useState<PaymentMethod>(PaymentMethod.PIX);
  const [estornoObs, setEstornoObs] = useState('');
  const [estornoSaving, setEstornoSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      if (firstLoad.current) setLoading(true);
      const [c, pros, custs, svcs, prods, settings, nfeCfg, appts] = await Promise.all([
        db.getComandas(tenantId),
        db.getProfessionals(tenantId),
        db.getCustomers(tenantId),
        db.getServices(tenantId),
        db.getProducts(tenantId),
        db.getSettings(tenantId),
        db.getFocusNfeConfig(tenantId),
        db.getAppointments(tenantId),
      ]);
      setFocusNfeConfig(nfeCfg);
      setComandas(c);
      setProfessionals(pros);
      setCustomers(custs);
      setServices(svcs);
      setProducts(prods);
      const cMap: Record<string, number> = {};
      if (settings.professionalMeta) {
        for (const [profId, meta] of Object.entries(settings.professionalMeta)) {
          cMap[profId] = (meta as any).commissionRate ?? 0;
        }
      }
      setCommissionMap(cMap);
      const cmdApptIds = new Set(c.map((cmd: Comanda) => cmd.appointment_id));
      setOrphanAppts(
        appts
          .filter((a: Appointment) => a.status === AppointmentStatus.FINISHED && !cmdApptIds.has(a.id))
          .sort((a: Appointment, b: Appointment) => b.startTime.localeCompare(a.startTime))
      );
    } finally {
      firstLoad.current = false;
      setLoading(false);
    }
  }, [tenantId, refreshTicker]);

  useEffect(() => { load(); }, [load]);

  // Initialize all items as selected when opening the close modal
  useEffect(() => {
    if (closeComanda) {
      setCloseSelectedItems(new Set(closeComanda.items.map(i => i.id)));
      setCloseSplits([{ method: PaymentMethod.PIX, amount: '' }]);
    }
  }, [closeComanda?.id]);

  // Auto-open customer popup when arriving via appointment alert
  useEffect(() => {
    if (!initialApptId || loading) return;
    const target = comandas.find(c => c.appointment_id === initialApptId && c.status === 'open');
    if (target) {
      setActiveTab('abertas');
      setCustomerPopupId(target.customer_id);
      setHighlightComandaId(target.id);
      setSelectedInPopup(new Set());
      onApptOpened?.();
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
    await db.updateComanda(addProductComanda.id, { items: [...addProductComanda.items, newItem] });
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
    await db.updateComanda(addServiceComanda.id, { items: [...addServiceComanda.items, newItem] });
    setAddServiceComanda(null);
    setAddServiceSvcId(''); setAddServicePrice(0);
    setAddServiceDiscount(0); setAddServiceDiscountType('value');
    setAddServiceProfId('');
    load();
  };

  // ── Remove item ───────────────────────────────────────────────────
  const handleRemoveItem = async (comanda: Comanda, itemId: string) => {
    await db.updateComanda(comanda.id, { items: comanda.items.filter(i => i.id !== itemId) });
    load();
  };

  // ── Close single comanda ──────────────────────────────────────────
  const handleClose = async () => {
    if (!closeComanda) return;
    setClosing(true);
    try {
      const itemsToClose = closeComanda.items.filter(i => closeSelectedItems.has(i.id));
      const itemsToKeep = closeComanda.items.filter(i => !closeSelectedItems.has(i.id));
      const isFullClose = itemsToKeep.length === 0;
      const total = itemsToClose.reduce((s, i) => s + itemTotal(i), 0);
      const closedAt = new Date().toISOString();

      // Build payment splits
      const isSingleEmpty = closeSplits.length === 1 && closeSplits[0].amount === '';
      const splits: PaymentSplit[] = isSingleEmpty
        ? [{ method: closeSplits[0].method, amount: total }]
        : closeSplits.map(s => ({ method: s.method, amount: parseFloat(s.amount.replace(',', '.')) || 0 }));

      if (!isSingleEmpty && closeSplits.length > 1) {
        const splitSum = splits.reduce((s, sp) => s + sp.amount, 0);
        if (Math.abs(splitSum - total) > 0.02) {
          alert(`Os valores informados somam ${fmt(splitSum)}, mas o total é ${fmt(total)}. Ajuste os valores.`);
          setClosing(false);
          return;
        }
      }

      const primaryMethod = splits.reduce((a, b) => a.amount >= b.amount ? a : b).method;
      const hasMultipleSplits = splits.length > 1;

      for (const item of itemsToClose) {
        if (item.type === 'product') await db.decrementProduct(tenantId, item.itemId, item.qty);
      }
      if (isFullClose) {
        await db.updateComanda(closeComanda.id, {
          status: 'closed', paymentMethod: primaryMethod,
          paymentSplits: hasMultipleSplits ? splits : undefined,
          notes: closeNotes || undefined, closedAt,
        });
        await db.updateAppointmentStatus(closeComanda.appointment_id, AppointmentStatus.FINISHED, {
          paymentMethod: primaryMethod, amountPaid: total,
        });
      } else {
        await db.updateComanda(closeComanda.id, { items: itemsToKeep });
      }

      if (isFullClose && emitNfseOnClose && focusNfeConfig?.token) {
        const declaravel = calcDeclaravel(closeComanda);
        const notaId = generateId();
        const nota: NotaFiscal = {
          id: notaId, comandaIds: [closeComanda.id], status: 'pendente',
          valorBruto: total, valorDeclaravel: declaravel,
          tomadorCpfCnpj: nfseTomadorCpf || undefined, createdAt: closedAt,
        };
        await db.saveNotaFiscal(tenantId, nota);
        emitirNfse({
          config: focusNfeConfig, dataEmissao: closedAt.slice(0, 10),
          tomadorNome: 'Consumidor', tomadorCpfCnpj: nfseTomadorCpf || undefined,
          discriminacao: `Serviços — Comanda #${closeComanda.number ?? closeComanda.id.slice(0, 6)}`,
          valorServicos: total, valorDeclaravel: declaravel, referencia: notaId,
        }).then(res => {
          db.saveNotaFiscal(tenantId, {
            ...nota, status: res.success ? 'emitida' : 'erro',
            focusNfeRef: res.ref, nfseNumero: res.nfseNumero, nfseLink: res.link,
            errorMsg: res.error, emitedAt: res.success ? new Date().toISOString() : undefined,
          });
        }).catch(err => console.error('NFS-e background emit error:', err));
      }

      setCloseComanda(null); setCloseNotes('');
      setEmitNfseOnClose(false); setNfseTomadorCpf('');
      load();
    } finally { setClosing(false); }
  };

  // ── Batch close (all selected or all for customer) ────────────────
  const handleBatchClose = async () => {
    if (!batchCloseItems || batchCloseItems.length === 0) return;
    setBatchClosing(true);
    try {
      const closedAt = new Date().toISOString();
      for (const cmd of batchCloseItems) {
        for (const item of cmd.items) {
          if (item.type === 'product') await db.decrementProduct(tenantId, item.itemId, item.qty);
        }
        await db.updateComanda(cmd.id, {
          status: 'closed', paymentMethod: batchClosePayment,
          notes: batchCloseNotes || undefined, closedAt,
        });
        await db.updateAppointmentStatus(cmd.appointment_id, AppointmentStatus.FINISHED, {
          paymentMethod: batchClosePayment, amountPaid: comandaTotal(cmd),
        });
      }
      setBatchCloseItems(null); setBatchCloseNotes('');
      setCustomerPopupId(null); setSelectedInPopup(new Set());
      load();
    } finally { setBatchClosing(false); }
  };

  // ── Per-professional revenue breakdown ────────────────────────────
  const buildProRevenue = (c: Comanda) =>
    c.items.reduce((acc, item) => {
      const profId = item.professionalId ?? c.professional_id;
      acc[profId] = (acc[profId] ?? 0) + itemTotal(item);
      return acc;
    }, {} as Record<string, number>);

  // ── Comissão total de uma comanda ─────────────────────────────────
  const comandaCommission = (c: Comanda) =>
    c.items.filter(i => i.type === 'service').reduce((s, i) => {
      if (i.commissionOverride !== undefined) return s + i.commissionOverride;
      const profId = i.professionalId ?? c.professional_id;
      const rate = commissionMap[profId] ?? 0;
      const grossBase = i.qty * i.unitPrice;
      const svc = services.find(sv => sv.id === i.itemId);
      const matPct = (svc as any)?.materialCostPercent ?? 0;
      return s + (grossBase * rate / 100) - (grossBase * matPct / 100);
    }, 0);

  // ── Lei do Salão-Parceiro: valor declarável ───────────────────────
  const calcDeclaravel = (c: Comanda): number =>
    c.items.reduce((acc, item) => {
      const profId = item.professionalId ?? c.professional_id;
      const rate = commissionMap[profId] ?? 0;
      return acc + itemTotal(item) * (1 - rate / 100);
    }, 0);

  // ── Estorno ───────────────────────────────────────────────────────
  const handleEstorno = async () => {
    if (!estornoComanda) return;
    setEstornoSaving(true);
    try {
      const rawVal = estornoValor !== '' ? parseFloat(estornoValor.replace(',', '.')) : 0;
      const newAmount = isNaN(rawVal) ? 0 : Math.max(0, rawVal);
      const zeroedItems = estornoComanda.items.map(item =>
        item.type === 'service' ? { ...item, commissionOverride: 0 } : item
      );
      await db.updateComanda(estornoComanda.id, {
        paymentMethod: estornoPagamento,
        notes: estornoObs || estornoComanda.notes,
        items: zeroedItems,
        finalAmount: newAmount,
      });
      if (estornoComanda.appointment_id) {
        await db.updateAppointmentStatus(estornoComanda.appointment_id, AppointmentStatus.FINISHED, {
          paymentMethod: estornoPagamento,
          amountPaid: newAmount,
        });
      }
      setEstornoComanda(null); setEstornoValor(''); setEstornoObs('');
      load();
    } catch (e: any) {
      alert(`Erro ao salvar estorno: ${e?.message || 'Tente novamente.'}`);
    } finally { setEstornoSaving(false); }
  };

  const effectiveTotal = (c: Comanda) => c.finalAmount ?? comandaTotal(c);

  // ── Save edits on closed comanda ──────────────────────────────────
  const handleSaveEditClosed = async () => {
    if (!editClosedObj) return;
    setEditClosedSaving(true);
    try {
      const updatedItems = editClosedObj.items.map(item => {
        if (item.type !== 'service' || editCommissions[item.id] === undefined) return item;
        const newComm = parseFloat(editCommissions[item.id]);
        if (isNaN(newComm)) return item;
        const profId = item.professionalId ?? editClosedObj.professional_id;
        const rate = commissionMap[profId] ?? 0;
        const grossBase = item.qty * item.unitPrice;
        const svc = services.find(s => s.id === item.itemId);
        const matPct = (svc as any)?.materialCostPercent ?? 0;
        const calcComm = (grossBase * rate / 100) - (grossBase * matPct / 100);
        const override = Math.abs(newComm - calcComm) > 0.005 ? newComm : undefined;
        return { ...item, commissionOverride: override };
      });
      await db.updateComanda(editClosedObj.id, {
        items: updatedItems, paymentMethod: editClosedPayment,
        notes: editClosedNotes || undefined,
      });
      await db.updateAppointmentStatus(editClosedObj.appointment_id, AppointmentStatus.FINISHED, {
        paymentMethod: editClosedPayment, amountPaid: effectiveTotal(editClosedObj),
      });
      setEditClosedId(null);
      load();
    } finally { setEditClosedSaving(false); }
  };

  const matchSearch = (c: Comanda) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return custName(c.customer_id).toLowerCase().includes(q) ||
           profName(c.professional_id).toLowerCase().includes(q);
  };

  const open = comandas
    .filter(c => c.status === 'open')
    .filter(matchSearch)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Group open comandas by customer
  const openGrouped = new Map<string, Comanda[]>();
  open.forEach(c => {
    if (!openGrouped.has(c.customer_id)) openGrouped.set(c.customer_id, []);
    openGrouped.get(c.customer_id)!.push(c);
  });

  const finished = comandas
    .filter(c => c.status === 'closed')
    .filter(matchSearch)
    .filter(c => {
      const dt = (c.closedAt || c.createdAt).slice(0, 10);
      if (filterStart && dt < filterStart) return false;
      if (filterEnd && dt > filterEnd) return false;
      return true;
    })
    .sort((a, b) => new Date(b.closedAt || b.createdAt).getTime() - new Date(a.closedAt || a.createdAt).getTime());

  const nowMs = Date.now();
  const newComandaIds = new Set(open
    .filter(c => nowMs - new Date(c.createdAt).getTime() < 90_000)
    .map(c => c.id)
  );

  // Customer popup data
  const customerPopupComandas = customerPopupId ? (openGrouped.get(customerPopupId) ?? []) : [];
  const popupTotal = customerPopupComandas.reduce((s, c) => s + comandaTotal(c), 0);

  if (loading) return (
    <div className="p-20 text-center font-black text-slate-300 animate-pulse uppercase tracking-widest text-sm">
      Carregando comandas...
    </div>
  );

  const renderItemRow = (item: ComandaItem, comanda: Comanda, canRemove: boolean) => {
    const discountDisplay = item.discount > 0
      ? item.discountType === 'percent' ? `-${item.discount}%` : `-${fmt(item.discount)}`
      : null;
    const itemProf = item.professionalId ? professionals.find(p => p.id === item.professionalId) : null;
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

  // ── Unified customer card ─────────────────────────────────────────
  const renderCustomerCard = (customerId: string, customerComandas: Comanda[]) => {
    const total = customerComandas.reduce((s, c) => s + comandaTotal(c), 0);
    const hasNew = customerComandas.some(c => newComandaIds.has(c.id));
    const itemCount = customerComandas.reduce((s, c) => s + c.items.length, 0);
    return (
      <div
        key={customerId}
        className={`bg-white rounded-[28px] border-2 p-6 space-y-4 transition-all cursor-pointer ${
          hasNew
            ? 'border-emerald-400 shadow-xl shadow-emerald-100 ring-2 ring-emerald-300 ring-offset-2'
            : 'border-emerald-100 shadow-lg shadow-emerald-50 hover:border-emerald-300 hover:shadow-xl'
        }`}
        onClick={() => { setCustomerPopupId(customerId); setSelectedInPopup(new Set()); }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-black text-base text-black leading-tight">{custName(customerId)}</p>
              {hasNew && (
                <span className="text-[8px] font-black bg-emerald-500 text-white px-2 py-0.5 rounded-full uppercase tracking-widest animate-pulse">
                  Nova
                </span>
              )}
            </div>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
              {customerComandas.length} comanda{customerComandas.length !== 1 ? 's' : ''} · {itemCount} item{itemCount !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[9px] font-black text-emerald-700 uppercase tracking-widest">Aberta</span>
          </div>
        </div>

        {/* Quick list of comandas */}
        <div className="space-y-1.5">
          {customerComandas.map(c => (
            <div key={c.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-xl px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                {c.number && (
                  <span className="text-[9px] font-black text-slate-400 bg-white px-1.5 py-0.5 rounded-lg border border-slate-200">
                    #{String(c.number).padStart(3, '0')}
                  </span>
                )}
                <span className="font-bold text-slate-600 truncate">{profName(c.professional_id)}</span>
                <span className="text-[10px] text-slate-400 whitespace-nowrap">
                  {new Date(c.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <span className="font-black text-slate-700 whitespace-nowrap ml-2">{fmt(comandaTotal(c))}</span>
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center pt-1 border-t border-slate-100">
          <span className="text-[10px] font-black text-slate-400 uppercase">Total</span>
          <span className="text-xl font-black text-black">{fmt(total)}</span>
        </div>

        <button
          onClick={e => { e.stopPropagation(); setCustomerPopupId(customerId); setSelectedInPopup(new Set()); }}
          className="w-full py-2.5 bg-black text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-all"
        >
          📋 Abrir Comanda
        </button>
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
    <>
    <div className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Comandas</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            {openGrouped.size > 0
              ? `${openGrouped.size} cliente${openGrouped.size !== 1 ? 's' : ''} em atendimento · ${open.length} comanda${open.length !== 1 ? 's' : ''}`
              : 'Nenhuma comanda aberta'}
          </p>
        </div>
        {openGrouped.size > 0 && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">
              {openGrouped.size} cliente{openGrouped.size !== 1 ? 's' : ''} ativos
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
            {tab === 'abertas'
              ? `Abertas (${openGrouped.size})`
              : `Finalizadas (${finished.length})`}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
        <input
          type="text"
          placeholder="Buscar por cliente ou profissional..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold text-black placeholder-slate-300 outline-none focus:border-orange-400 transition-all"
        />
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-black text-xs font-black"
          >✕</button>
        )}
      </div>

      {/* ── Abertas ───────────────────────────────────────────────────── */}
      {activeTab === 'abertas' && (
        <>
          {openGrouped.size === 0 ? (
            <div className="bg-white rounded-[40px] border-2 border-dashed border-slate-200 p-20 text-center">
              <p className="text-4xl mb-4">🧾</p>
              {searchTerm ? (
                <p className="font-black text-slate-300 uppercase tracking-widest text-sm">Nenhum resultado para "{searchTerm}"</p>
              ) : (
                <>
                  <p className="font-black text-slate-300 uppercase tracking-widest text-sm">Nenhuma comanda aberta</p>
                  <p className="text-xs font-bold text-slate-300 mt-2">
                    Marque um agendamento como "Cliente Chegou" para abrir uma comanda
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {Array.from(openGrouped.entries()).map(([custId, cmds]) => renderCustomerCard(custId, cmds))}
            </div>
          )}
        </>
      )}

      {/* ── Finalizadas ───────────────────────────────────────────────── */}
      {activeTab === 'finalizadas' && (
        <>
          {/* Period filter */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Período:</span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filterStart}
                onChange={e => setFilterStart(e.target.value)}
                className="p-2.5 bg-slate-50 border-2 border-slate-100 rounded-xl text-xs font-bold text-black outline-none focus:border-orange-400 transition-all"
              />
              <span className="text-slate-400 font-bold text-xs">até</span>
              <input
                type="date"
                value={filterEnd}
                onChange={e => setFilterEnd(e.target.value)}
                className="p-2.5 bg-slate-50 border-2 border-slate-100 rounded-xl text-xs font-bold text-black outline-none focus:border-orange-400 transition-all"
              />
            </div>
            {(filterStart || filterEnd) && (
              <button
                onClick={() => { setFilterStart(''); setFilterEnd(''); }}
                className="text-[10px] font-black text-red-400 uppercase hover:text-red-600 transition-all"
              >
                ✕ Limpar
              </button>
            )}
            <button
              onClick={() => setGroupByCustomerFin(v => !v)}
              className={`ml-auto px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${
                groupByCustomerFin
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
              }`}
            >
              👤 {groupByCustomerFin ? 'Agrupado por Cliente' : 'Agrupar por Cliente'}
            </button>
          </div>

          {finished.length === 0 ? (
            <div className="bg-white rounded-[40px] border-2 border-dashed border-slate-200 p-20 text-center">
              <p className="text-4xl mb-4">✅</p>
              <p className="font-black text-slate-300 uppercase tracking-widest text-sm">
                {searchTerm || filterStart || filterEnd
                  ? 'Nenhum resultado para os filtros aplicados'
                  : 'Nenhuma comanda finalizada'}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-[28px] border-2 border-slate-100 overflow-hidden">
              <div className="overflow-x-auto">
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
                      <th className="px-6 py-4 text-right text-[9px] font-black text-slate-400 uppercase tracking-widest">Comissão</th>
                      <th className="px-6 py-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const renderRow = (c: Comanda) => (
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
                            <span className="text-[10px] font-black text-slate-400 uppercase">
                              {c.paymentSplits && c.paymentSplits.length > 1
                                ? c.paymentSplits.map(s => s.method).join(' + ')
                                : c.paymentMethod ?? '—'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="text-sm font-black text-black">{fmt(effectiveTotal(c))}</span>
                            {c.finalAmount !== undefined && (
                              <span className="block text-[9px] font-black text-amber-500 uppercase tracking-widest">ajustado</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="text-sm font-black text-orange-600">{fmt(comandaCommission(c))}</span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-3">
                              <button
                                onClick={() => {
                                  setEditClosedId(c.id);
                                  setEditClosedPayment(c.paymentMethod ?? PaymentMethod.PIX);
                                  setEditClosedNotes(c.notes ?? '');
                                  const initComm: Record<string, string> = {};
                                  c.items.filter(i => i.type === 'service').forEach(item => {
                                    if (item.commissionOverride !== undefined) {
                                      initComm[item.id] = item.commissionOverride.toFixed(2);
                                    } else {
                                      const profId = item.professionalId ?? c.professional_id;
                                      const rate = commissionMap[profId] ?? 0;
                                      const grossBase = item.qty * item.unitPrice;
                                      const svc = services.find(s => s.id === item.itemId);
                                      const matPct = (svc as any)?.materialCostPercent ?? 0;
                                      initComm[item.id] = ((grossBase * rate / 100) - (grossBase * matPct / 100)).toFixed(2);
                                    }
                                  });
                                  setEditCommissions(initComm);
                                }}
                                className="text-[10px] font-black text-orange-500 uppercase hover:text-orange-700 transition-all"
                              >✏️ Editar</button>
                              <button
                                onClick={() => {
                                  setEstornoComanda(c);
                                  setEstornoPagamento(c.paymentMethod ?? PaymentMethod.PIX);
                                  setEstornoValor('0');
                                  setEstornoObs(c.notes ?? '');
                                }}
                                className="text-[10px] font-black text-red-400 uppercase hover:text-red-600 transition-all"
                              >Estornar</button>
                            </div>
                          </td>
                        </tr>
                      );

                      if (!groupByCustomerFin) return finished.map(renderRow);

                      // Grouped by customer
                      const groups = new Map<string, Comanda[]>();
                      finished.forEach(c => {
                        if (!groups.has(c.customer_id)) groups.set(c.customer_id, []);
                        groups.get(c.customer_id)!.push(c);
                      });
                      const sorted = Array.from(groups.entries()).sort(([a], [b]) =>
                        custName(a).localeCompare(custName(b), 'pt-BR')
                      );
                      return sorted.map(([custId, cmds]) => {
                        const groupTotal = cmds.reduce((s, c) => s + effectiveTotal(c), 0);
                        const groupComm = cmds.reduce((s, c) => s + comandaCommission(c), 0);
                        return (
                          <React.Fragment key={custId}>
                            <tr className="bg-slate-100 border-y-2 border-slate-200">
                              <td colSpan={6} className="px-6 py-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-black text-black">{custName(custId)}</span>
                                  <span className="text-[9px] font-black text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                                    {cmds.length} comanda{cmds.length !== 1 ? 's' : ''}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-3 text-right">
                                <span className="text-sm font-black text-black">{fmt(groupTotal)}</span>
                              </td>
                              <td className="px-6 py-3 text-right">
                                <span className="text-sm font-black text-orange-600">{fmt(groupComm)}</span>
                              </td>
                              <td />
                            </tr>
                            {cmds.map(renderRow)}
                          </React.Fragment>
                        );
                      });
                    })()}
                  </tbody>
                </table>
                {orphanAppts.length > 0 && (
                  <>
                    <div className="px-6 py-2 border-t border-amber-100 bg-amber-50/40">
                      <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">
                        Atendimentos sem comanda ({orphanAppts.length})
                      </p>
                    </div>
                    <table className="w-full">
                      <tbody>
                        {orphanAppts.map(a => {
                          const svcName = services.find(s => s.id === a.service_id)?.name ?? '—';
                          return (
                            <tr key={a.id} className="border-b border-amber-50 bg-amber-50/20 hover:bg-amber-50/40 transition-all">
                              <td className="px-6 py-3 text-[10px] font-black text-amber-400">—</td>
                              <td className="px-6 py-3 text-xs font-bold text-slate-500">
                                {new Date(a.startTime).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="px-6 py-3 text-xs font-black">{custName(a.customer_id)}</td>
                              <td className="px-6 py-3 text-xs text-slate-500">{profName(a.professional_id)}</td>
                              <td className="px-6 py-3 text-xs text-slate-500">{svcName}</td>
                              <td className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase">{a.paymentMethod ?? '—'}</td>
                              <td className="px-6 py-3 text-right font-black text-sm">{fmt(a.amountPaid || 0)}</td>
                              <td className="px-6 py-3 text-right">—</td>
                              <td className="px-6 py-3">
                                <span className="text-[8px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-black uppercase">Sem Comanda</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

    </div>
      {/* ── Customer detail popup ─────────────────────────────────────── */}
      {customerPopupId && customerPopupComandas.length > 0 && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-lg max-h-[90vh] overflow-y-auto p-8 space-y-5 animate-scaleUp border-4 border-black">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-black uppercase tracking-tight">{custName(customerPopupId)}</h2>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                  {customerPopupComandas.length} comanda{customerPopupComandas.length !== 1 ? 's' : ''} em aberto
                </p>
              </div>
              <button
                onClick={() => { setCustomerPopupId(null); setSelectedInPopup(new Set()); }}
                className="text-slate-400 hover:text-black font-black text-lg"
              >✕</button>
            </div>

            {/* Select all (only when > 1 comanda) */}
            {customerPopupComandas.length > 1 && (
              <div className="flex items-center justify-between bg-slate-50 rounded-2xl px-4 py-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedInPopup.size === customerPopupComandas.length}
                    onChange={e => setSelectedInPopup(
                      e.target.checked ? new Set(customerPopupComandas.map(c => c.id)) : new Set()
                    )}
                    className="accent-black w-4 h-4"
                  />
                  <span className="text-xs font-black text-black">Selecionar todas ({customerPopupComandas.length})</span>
                </label>
                {selectedInPopup.size > 0 && (
                  <button
                    onClick={() => {
                      setBatchClosePayment(PaymentMethod.PIX);
                      setBatchCloseNotes('');
                      setBatchCloseItems(customerPopupComandas.filter(c => selectedInPopup.has(c.id)));
                    }}
                    className="px-4 py-1.5 bg-emerald-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-all"
                  >
                    ✅ Fechar {selectedInPopup.size}
                  </button>
                )}
              </div>
            )}

            {/* Individual comanda sections */}
            <div className="space-y-4">
              {customerPopupComandas.map(c => {
                const total = comandaTotal(c);
                const isHighlighted = c.id === highlightComandaId;
                const isNew = newComandaIds.has(c.id);
                const isSelected = selectedInPopup.has(c.id);
                return (
                  <div key={c.id} className={`rounded-2xl border-2 p-4 space-y-3 transition-all ${
                    isHighlighted ? 'border-orange-400 bg-orange-50/20'
                    : isNew ? 'border-emerald-300 bg-emerald-50/20'
                    : isSelected ? 'border-black bg-slate-50'
                    : 'border-slate-100'
                  }`}>
                    {/* Row header */}
                    <div className="flex items-center gap-3">
                      {customerPopupComandas.length > 1 && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => setSelectedInPopup(prev => {
                            const s = new Set(prev);
                            e.target.checked ? s.add(c.id) : s.delete(c.id);
                            return s;
                          })}
                          className="accent-black w-4 h-4 flex-shrink-0"
                          onClick={e => e.stopPropagation()}
                        />
                      )}
                      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                        {c.number && (
                          <span className="text-[9px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg tracking-widest">
                            #{String(c.number).padStart(3, '0')}
                          </span>
                        )}
                        <span className="text-xs font-black text-black">{profName(c.professional_id)}</span>
                        <span className="text-[10px] font-bold text-slate-400">
                          {new Date(c.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isNew && (
                          <span className="text-[8px] font-black bg-emerald-500 text-white px-2 py-0.5 rounded-full uppercase tracking-widest animate-pulse">Nova</span>
                        )}
                      </div>
                      <span className="text-sm font-black text-black whitespace-nowrap">{fmt(total)}</span>
                    </div>

                    {/* Items */}
                    <div className="bg-slate-50 rounded-xl px-3 py-2">
                      {c.items.length === 0 ? (
                        <p className="text-[10px] font-bold text-slate-300 text-center py-1">Nenhum item</p>
                      ) : (
                        c.items.map(item => renderItemRow(item, c, true))
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setAddProductItemId(''); setAddProductQty(1);
                          setAddProductDiscount(0); setAddProductDiscountType('value');
                          setAddProductComanda(c);
                        }}
                        className="flex-1 py-2 bg-blue-50 text-blue-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-100 transition-all"
                      >➕ Produto</button>
                      <button
                        onClick={() => {
                          setAddServiceSvcId(''); setAddServicePrice(0);
                          setAddServiceDiscount(0); setAddServiceDiscountType('value');
                          setAddServiceProfId(c.professional_id);
                          setAddServiceComanda(c);
                        }}
                        className="flex-1 py-2 bg-orange-50 text-orange-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-100 transition-all"
                      >✂️ Serviço</button>
                      <button
                        onClick={() => { setClosePayment(PaymentMethod.PIX); setCloseNotes(''); setCloseComanda(c); }}
                        className="flex-1 py-2 bg-black text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-all"
                      >✅ Fechar</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-100 pt-4 flex items-center gap-3">
              <div className="bg-black rounded-2xl px-5 py-3 text-center flex-1">
                <p className="text-[9px] font-black text-slate-500 uppercase">Total Geral</p>
                <p className="text-2xl font-black text-white">{fmt(popupTotal)}</p>
              </div>
              <button
                onClick={() => {
                  setBatchClosePayment(PaymentMethod.PIX);
                  setBatchCloseNotes('');
                  setBatchCloseItems(customerPopupComandas);
                }}
                className="flex-1 py-4 bg-emerald-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-600 transition-all"
              >
                ✅ Fechar Todas ({customerPopupComandas.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Batch close ────────────────────────────────────────── */}
      {batchCloseItems && batchCloseItems.length > 0 && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md max-h-[90vh] overflow-y-auto p-8 space-y-5 animate-scaleUp border-4 border-black">
            <h2 className="text-xl font-black text-black uppercase tracking-tight">
              Fechar {batchCloseItems.length} Comanda{batchCloseItems.length !== 1 ? 's' : ''}
            </h2>
            <p className="text-xs font-bold text-slate-400">{custName(batchCloseItems[0].customer_id)}</p>

            <div className="bg-slate-50 rounded-2xl px-4 py-3 space-y-2">
              {batchCloseItems.map(c => (
                <div key={c.id} className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black text-black">
                      {profName(c.professional_id)}
                      {c.number && <span className="ml-2 text-[9px] font-bold text-slate-400">#{String(c.number).padStart(3, '0')}</span>}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">{c.items.map(i => i.name).join(', ') || 'Sem itens'}</p>
                  </div>
                  <span className="text-sm font-black text-black whitespace-nowrap">{fmt(comandaTotal(c))}</span>
                </div>
              ))}
            </div>

            <div className="bg-black rounded-2xl px-6 py-5 text-center">
              <p className="text-[9px] font-black text-slate-500 uppercase mb-1">Total a Cobrar</p>
              <p className="text-3xl font-black text-white">
                {fmt(batchCloseItems.reduce((s, c) => s + comandaTotal(c), 0))}
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Forma de Pagamento</label>
              <select
                value={batchClosePayment}
                onChange={e => setBatchClosePayment(e.target.value as PaymentMethod)}
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black"
              >
                {Object.values(PaymentMethod).map(pm => <option key={pm} value={pm}>{pm}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Observações (Opcional)</label>
              <input
                value={batchCloseNotes}
                onChange={e => setBatchCloseNotes(e.target.value)}
                placeholder="Ex: pagamento único para todos os serviços..."
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none focus:border-orange-500"
              />
            </div>

            <div className="flex gap-3">
              <button onClick={() => setBatchCloseItems(null)} className="flex-1 py-3 text-slate-400 font-black text-xs uppercase">Cancelar</button>
              <button
                onClick={handleBatchClose}
                disabled={batchClosing}
                className="flex-1 py-3 bg-emerald-500 text-white rounded-2xl font-black text-xs uppercase disabled:opacity-50 hover:bg-emerald-600 transition-all"
              >
                {batchClosing ? 'Fechando...' : '✅ Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Adicionar Produto ──────────────────────────────────── */}
      {addProductComanda && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
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
              <input type="number" min={1} value={addProductQty}
                onChange={e => setAddProductQty(Number(e.target.value))}
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Desconto</label>
              <div className="flex gap-2">
                <div className="flex rounded-2xl border-2 border-slate-100 overflow-hidden">
                  <button onClick={() => setAddProductDiscountType('value')}
                    className={`px-4 py-2 text-xs font-black uppercase transition-all ${addProductDiscountType === 'value' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-400'}`}
                  >R$</button>
                  <button onClick={() => setAddProductDiscountType('percent')}
                    className={`px-4 py-2 text-xs font-black uppercase transition-all ${addProductDiscountType === 'percent' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-400'}`}
                  >%</button>
                </div>
                <input type="number" min={0} value={addProductDiscount}
                  onChange={e => setAddProductDiscount(Number(e.target.value))}
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
              >Adicionar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Adicionar Serviço Extra ────────────────────────────── */}
      {addServiceComanda && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md max-h-[90vh] overflow-y-auto p-8 space-y-5 animate-scaleUp border-4 border-black">
            <h2 className="text-xl font-black text-black uppercase tracking-tight">Serviço Extra</h2>
            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Serviço</label>
              <select value={addServiceSvcId}
                onChange={e => { const svc = services.find(s => s.id === e.target.value); setAddServiceSvcId(e.target.value); setAddServicePrice(svc?.price ?? 0); }}
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
              <select value={addServiceProfId} onChange={e => setAddServiceProfId(e.target.value)}
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm"
              >
                {professionals.filter(p => p.active).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Preço (R$)</label>
              <input type="number" min={0} value={addServicePrice}
                onChange={e => setAddServicePrice(Number(e.target.value))}
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Desconto</label>
              <div className="flex gap-2">
                <div className="flex rounded-2xl border-2 border-slate-100 overflow-hidden">
                  <button onClick={() => setAddServiceDiscountType('value')}
                    className={`px-4 py-2 text-xs font-black uppercase transition-all ${addServiceDiscountType === 'value' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-400'}`}
                  >R$</button>
                  <button onClick={() => setAddServiceDiscountType('percent')}
                    className={`px-4 py-2 text-xs font-black uppercase transition-all ${addServiceDiscountType === 'percent' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-400'}`}
                  >%</button>
                </div>
                <input type="number" min={0} value={addServiceDiscount}
                  onChange={e => setAddServiceDiscount(Number(e.target.value))}
                  className="flex-1 p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setAddServiceComanda(null)} className="flex-1 py-3 text-slate-400 font-black text-xs uppercase">Cancelar</button>
              <button onClick={handleAddService} disabled={!addServiceSvcId}
                className="flex-1 py-3 bg-orange-500 text-white rounded-2xl font-black text-xs uppercase disabled:opacity-40"
              >Adicionar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Fechar Comanda (individual) ───────────────────────── */}
      {closeComanda && (() => {
        const multiProf = new Set(closeComanda.items.map(i => i.professionalId).filter(Boolean)).size > 1;
        const selectedItems = closeComanda.items.filter(i => closeSelectedItems.has(i.id));
        const selectedTotal = selectedItems.reduce((s, i) => s + itemTotal(i), 0);
        const proRevenue = buildProRevenue({ ...closeComanda, items: selectedItems });
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
            <div className="bg-white rounded-[40px] w-full max-w-md max-h-[90vh] overflow-y-auto p-8 space-y-5 animate-scaleUp border-4 border-black">
              <h2 className="text-xl font-black text-black uppercase tracking-tight">Fechar Comanda</h2>
              <p className="text-xs font-bold text-slate-400">
                {custName(closeComanda.customer_id)} · {profName(closeComanda.professional_id)}
              </p>

              {multiProf && (
                <p className="text-[10px] font-black text-orange-500 uppercase tracking-wide">
                  Selecione os serviços finalizados para fechar agora
                </p>
              )}

              <div className="bg-slate-50 rounded-2xl px-4 py-3 space-y-0">
                {closeComanda.items.map(item => {
                  const discountDisplay = item.discount > 0
                    ? item.discountType === 'percent' ? `-${item.discount}%` : `-${fmt(item.discount)}`
                    : null;
                  const checked = closeSelectedItems.has(item.id);
                  return (
                    <div key={item.id}
                      className={`flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0 gap-2 ${multiProf ? 'cursor-pointer' : ''}`}
                      onClick={multiProf ? () => {
                        setCloseSelectedItems(prev => {
                          const next = new Set(prev);
                          next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                          return next;
                        });
                      } : undefined}
                    >
                      {multiProf && (
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {}}
                          className="accent-emerald-500 w-4 h-4 shrink-0 cursor-pointer"
                        />
                      )}
                      <div className="flex-1">
                        <span className={`text-xs font-bold ${checked || !multiProf ? 'text-black' : 'text-slate-400'}`}>{item.name}</span>
                        <span className="ml-2 text-[10px] text-slate-400">{item.qty}x {fmt(item.unitPrice)}</span>
                        {discountDisplay && <span className="ml-1 text-[10px] text-red-400">{discountDisplay}</span>}
                      </div>
                      <span className={`text-xs font-black ${checked || !multiProf ? 'text-black' : 'text-slate-300'}`}>{fmt(itemTotal(item))}</span>
                    </div>
                  );
                })}
              </div>

              <div className="bg-black rounded-2xl px-6 py-5 text-center">
                <p className="text-[9px] font-black text-slate-500 uppercase mb-1">
                  {multiProf && closeSelectedItems.size < closeComanda.items.length ? 'Total dos Itens Selecionados' : 'Total a Cobrar'}
                </p>
                <p className="text-3xl font-black text-white">{fmt(selectedTotal)}</p>
              </div>

              {Object.keys(proRevenue).length > 0 && (
                <div className="space-y-1">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Comissionamento por Profissional</p>
                  <div className="bg-orange-50 rounded-2xl px-4 py-3 space-y-1.5">
                    {Object.entries(proRevenue).map(([profId, rev]) => {
                      const prof = professionals.find(p => p.id === profId);
                      const commRate = commissionMap[profId] ?? 0;
                      return (
                        <div key={profId} className="flex justify-between text-xs">
                          <span className="font-bold text-slate-700">{prof?.name ?? '—'}</span>
                          <span className="text-slate-500">
                            {fmt(rev)}
                            {commRate > 0 && (
                              <span className="ml-1 text-orange-600 font-black">
                                → {commRate}% = {fmt(rev * commRate / 100)}
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Forma de Pagamento</label>
                  {closeSplits.length < 4 && (
                    <button
                      onClick={() => setCloseSplits(prev => [...prev, { method: PaymentMethod.PIX, amount: '' }])}
                      className="text-[9px] font-black text-orange-500 hover:text-orange-700 uppercase tracking-widest transition-colors">
                      + Dividir Pagamento
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {closeSplits.map((split, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select value={split.method}
                        onChange={e => setCloseSplits(prev => prev.map((s, i) => i === idx ? { ...s, method: e.target.value as PaymentMethod } : s))}
                        className="flex-1 p-3 bg-slate-50 border-2 border-slate-100 rounded-xl font-black text-xs outline-none focus:border-black">
                        {Object.values(PaymentMethod).map(pm => <option key={pm} value={pm}>{pm}</option>)}
                      </select>
                      <input type="text" inputMode="decimal"
                        value={split.amount}
                        onChange={e => setCloseSplits(prev => prev.map((s, i) => i === idx ? { ...s, amount: e.target.value.replace(/[^0-9.,]/g, '') } : s))}
                        placeholder={closeSplits.length === 1 ? 'Total completo' : 'Valor...'}
                        className="w-28 p-3 bg-slate-50 border-2 border-slate-100 rounded-xl font-black text-xs outline-none focus:border-black text-right"
                      />
                      {closeSplits.length > 1 && (
                        <button onClick={() => setCloseSplits(prev => prev.filter((_, i) => i !== idx))}
                          className="text-slate-300 hover:text-red-500 font-black text-sm transition-colors shrink-0">✕</button>
                      )}
                    </div>
                  ))}
                </div>
                {closeSplits.length > 1 && (() => {
                  const splitSum = closeSplits.reduce((s, sp) => s + (parseFloat(sp.amount.replace(',', '.')) || 0), 0);
                  const diff = selectedTotal - splitSum;
                  const ok = Math.abs(diff) < 0.02;
                  return (
                    <div className={`flex justify-between text-xs font-black px-1 ${ok ? 'text-emerald-600' : 'text-orange-500'}`}>
                      <span>Conferência</span>
                      <span>{fmt(splitSum)}&nbsp;{ok ? '✓ OK' : `— faltam ${fmt(Math.abs(diff))}`}</span>
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Observações (Opcional)</label>
                <input value={closeNotes} onChange={e => setCloseNotes(e.target.value)}
                  placeholder="Ex: cliente satisfeito, sem troco..."
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none focus:border-orange-500"
                />
              </div>

              {focusNfeConfig?.cnpj && (
                <div className="space-y-2">
                  <div className="bg-blue-50 border-2 border-blue-100 rounded-2xl px-4 py-3 flex items-center gap-3">
                    <input type="checkbox" id="emitNfse" checked={emitNfseOnClose}
                      onChange={e => setEmitNfseOnClose(e.target.checked)} className="accent-blue-500 w-4 h-4"
                    />
                    <label htmlFor="emitNfse" className="text-xs font-black text-blue-700 cursor-pointer">
                      Emitir NFS-e ao fechar
                    </label>
                  </div>
                  {emitNfseOnClose && (
                    <input value={nfseTomadorCpf} onChange={e => setNfseTomadorCpf(e.target.value)}
                      placeholder="CPF/CNPJ do tomador (opcional)"
                      className="w-full p-3.5 bg-blue-50 border-2 border-blue-100 rounded-2xl text-xs font-bold outline-none focus:border-blue-400 transition-all"
                    />
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => setCloseComanda(null)} className="flex-1 py-3 text-slate-400 font-black text-xs uppercase">Cancelar</button>
                <button onClick={handleClose} disabled={closing || closeSelectedItems.size === 0}
                  className="flex-1 py-3 bg-emerald-500 text-white rounded-2xl font-black text-xs uppercase disabled:opacity-50 hover:bg-emerald-600 transition-all"
                >
                  {closing ? 'Fechando...' : closeSelectedItems.size > 0 && closeSelectedItems.size < closeComanda.items.length ? '✅ Fechar Selecionados' : '✅ Confirmar Fechamento'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Modal: Editar Comanda Finalizada ─────────────────────────── */}
      {editClosedObj && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md max-h-[90vh] overflow-y-auto p-8 space-y-5 animate-scaleUp border-4 border-black">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-black uppercase tracking-tight">Editar Comanda</h2>
                <p className="text-xs font-bold text-slate-400 mt-0.5">
                  {custName(editClosedObj.customer_id)} · {profName(editClosedObj.professional_id)}
                  {editClosedObj.number ? ` · #${String(editClosedObj.number).padStart(3, '0')}` : ''}
                </p>
              </div>
              <button onClick={() => setEditClosedId(null)} className="text-slate-400 hover:text-black font-black text-lg">✕</button>
            </div>

            <div className="space-y-1">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Itens</p>
              <div className="bg-slate-50 rounded-2xl px-4 py-3">
                {editClosedObj.items.length === 0 ? (
                  <p className="text-[10px] font-bold text-slate-300 text-center py-2">Nenhum item</p>
                ) : (
                  editClosedObj.items.map(item => renderItemRow(item, editClosedObj, true))
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setAddProductItemId(''); setAddProductQty(1); setAddProductDiscount(0); setAddProductDiscountType('value'); setAddProductComanda(editClosedObj); }}
                className="flex-1 py-2 bg-blue-50 text-blue-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-100 transition-all"
              >➕ Produto</button>
              <button
                onClick={() => { setAddServiceSvcId(''); setAddServicePrice(0); setAddServiceDiscount(0); setAddServiceDiscountType('value'); setAddServiceProfId(editClosedObj.professional_id); setAddServiceComanda(editClosedObj); }}
                className="flex-1 py-2 bg-orange-50 text-orange-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-100 transition-all"
              >✂️ Serviço</button>
            </div>

            <div className="bg-black rounded-2xl px-6 py-4 text-center">
              <p className="text-[9px] font-black text-slate-500 uppercase mb-1">Total</p>
              <p className="text-2xl font-black text-white">{fmt(effectiveTotal(editClosedObj))}</p>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Forma de Pagamento</label>
              <select value={editClosedPayment} onChange={e => setEditClosedPayment(e.target.value as PaymentMethod)}
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black"
              >
                {Object.values(PaymentMethod).map(pm => <option key={pm} value={pm}>{pm}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Observações</label>
              <input value={editClosedNotes} onChange={e => setEditClosedNotes(e.target.value)}
                placeholder="Ex: desconto concedido, pagamento parcial..."
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none focus:border-orange-500 transition-all"
              />
            </div>

            {editClosedObj.items.some(i => i.type === 'service') && (
              <div className="space-y-1.5">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Comissões por Serviço</p>
                <div className="space-y-2">
                  {editClosedObj.items.filter(i => i.type === 'service').map(item => {
                    const profId = item.professionalId ?? editClosedObj.professional_id;
                    const rate = commissionMap[profId] ?? 0;
                    const grossBase = item.qty * item.unitPrice;
                    const svc = services.find(s => s.id === item.itemId);
                    const matPct = (svc as any)?.materialCostPercent ?? 0;
                    const calcComm = (grossBase * rate / 100) - (grossBase * matPct / 100);
                    const currentVal = editCommissions[item.id] ?? calcComm.toFixed(2);
                    const isOverridden = item.commissionOverride !== undefined && Math.abs(item.commissionOverride - calcComm) > 0.005;
                    return (
                      <div key={item.id} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-black truncate">{item.name}</p>
                          <p className="text-[10px] font-semibold text-slate-400">
                            {profName(profId)} · {rate}%{matPct > 0 ? ` (−${matPct}% mat.)` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-black text-slate-300">R$</span>
                          <input type="number" step="0.01" value={currentVal}
                            onChange={e => setEditCommissions(prev => ({ ...prev, [item.id]: e.target.value }))}
                            className={`w-24 p-2 rounded-xl border-2 text-xs font-black text-right outline-none transition-colors ${
                              isOverridden ? 'border-orange-300 bg-orange-50 text-orange-600' : 'border-slate-200 bg-white focus:border-orange-400'
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setEditClosedId(null)} className="flex-1 py-3 text-slate-400 font-black text-xs uppercase">Cancelar</button>
              <button onClick={handleSaveEditClosed} disabled={editClosedSaving}
                className="flex-1 py-3 bg-black text-white rounded-2xl font-black text-xs uppercase disabled:opacity-50 hover:bg-orange-500 transition-all"
              >
                {editClosedSaving ? 'Salvando...' : '✅ Salvar Alterações'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Estorno / Ajuste ────────────────────────────────────── */}
      {estornoComanda && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md max-h-[90vh] overflow-y-auto p-8 space-y-5 animate-scaleUp border-4 border-red-400">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-black uppercase tracking-tight">Estorno de Pagamento</h2>
                <p className="text-xs font-bold text-slate-400 mt-0.5">
                  {custName(estornoComanda.customer_id)} · {profName(estornoComanda.professional_id)}
                </p>
              </div>
              <button onClick={() => setEstornoComanda(null)} className="text-slate-400 hover:text-black font-black text-lg">✕</button>
            </div>

            <div className="bg-slate-50 rounded-2xl px-5 py-3 flex justify-between items-center">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total original dos itens</span>
              <span className="text-sm font-black text-slate-500">{fmt(comandaTotal(estornoComanda))}</span>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Valor Devolvido (R$) — 0 = estorno total</label>
              <input type="number" min={0} step="0.01" value={estornoValor}
                onChange={e => setEstornoValor(e.target.value)} placeholder="0,00"
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-lg outline-none focus:border-red-400 transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Forma de Pagamento</label>
              <select value={estornoPagamento} onChange={e => setEstornoPagamento(e.target.value as PaymentMethod)}
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black"
              >
                {Object.values(PaymentMethod).map(pm => <option key={pm} value={pm}>{pm}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Observações</label>
              <textarea value={estornoObs} onChange={e => setEstornoObs(e.target.value)}
                placeholder="Ex: desconto concedido, erro de cobrança, pagamento parcial..." rows={3}
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none focus:border-red-400 transition-all resize-none"
              />
            </div>

            {estornoValor !== '' && !isNaN(parseFloat(estornoValor)) && (
              <div className="bg-red-50 border-2 border-red-100 rounded-2xl px-6 py-4 text-center">
                <p className="text-[9px] font-black text-red-400 uppercase mb-1">Novo Total</p>
                <p className="text-3xl font-black text-red-600">{fmt(parseFloat(estornoValor.replace(',', '.')))}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setEstornoComanda(null)} className="flex-1 py-3 text-slate-400 font-black text-xs uppercase">Cancelar</button>
              <button onClick={handleEstorno} disabled={estornoSaving}
                className="flex-1 py-3 bg-red-500 text-white rounded-2xl font-black text-xs uppercase disabled:opacity-50 hover:bg-red-600 transition-all"
              >
                {estornoSaving ? 'Salvando...' : '✅ Confirmar Estorno'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ComandasView;
