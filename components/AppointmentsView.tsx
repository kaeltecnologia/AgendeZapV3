
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { supabase } from '../services/supabase';
import { Appointment, AppointmentStatus, BookingSource, PaymentMethod, Professional, Service, Customer, BreakPeriod } from '../types';
import { sendProfessionalNotification, sendClientArrivedNotification } from '../services/notificationService';
import { notifyWaitlistLeads } from '../services/waitlistService';

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// ── Visual calendar range picker ─────────────────────────────────────────────
const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function MiniCalendar({ startDate, endDate, disabled, onChange }: {
  startDate: string; endDate: string; disabled?: boolean;
  onChange: (start: string, end: string) => void;
}) {
  const [view, setView] = useState(() => {
    const d = startDate ? new Date(startDate + 'T12:00:00') : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [picking, setPicking] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const today = new Date().toISOString().split('T')[0];

  const toISO = (y: number, m: number, d: number) =>
    `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const prevMonth = () => setView(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 });
  const nextMonth = () => setView(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 });

  const handleClick = (iso: string) => {
    if (disabled) return;
    if (!picking) {
      setPicking(iso);
      onChange(iso, iso);
    } else {
      const [a, b] = iso < picking ? [iso, picking] : [picking, iso];
      onChange(a, b);
      setPicking(null);
      setHover(null);
    }
  };

  const eStart = picking && hover ? (hover < picking ? hover : picking) : startDate;
  const eEnd   = picking && hover ? (hover < picking ? picking : hover) : endDate;
  const isSingle = eStart === eEnd;

  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const firstDay    = new Date(view.year, view.month, 1).getDay();

  return (
    <div className={disabled ? 'opacity-30 pointer-events-none select-none' : ''}>
      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
          <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="text-[11px] font-black text-black uppercase tracking-widest">
          {MONTH_NAMES[view.month]} {view.year}
        </span>
        <button onClick={nextMonth} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
          <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {['D','S','T','Q','Q','S','S'].map((d, i) => (
          <div key={i} className="text-center text-[9px] font-black text-slate-300 py-1">{d}</div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7">
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const iso = toISO(view.year, view.month, day);
          const isStart   = iso === eStart;
          const isEnd     = iso === eEnd;
          const inRange   = !isSingle && eStart && eEnd && iso > eStart && iso < eEnd;
          const isToday   = iso === today;
          const isEdge    = isStart || isEnd;
          return (
            <div
              key={iso}
              onClick={() => handleClick(iso)}
              onMouseEnter={() => picking && setHover(iso)}
              onMouseLeave={() => picking && setHover(null)}
              className={`relative h-8 flex items-center justify-center cursor-pointer transition-all
                ${inRange ? 'bg-orange-50' : ''}
                ${inRange && isStart ? 'rounded-l-full' : ''}
                ${inRange && isEnd   ? 'rounded-r-full' : ''}
                ${!isSingle && isStart ? 'bg-orange-50 rounded-l-full' : ''}
                ${!isSingle && isEnd   ? 'bg-orange-50 rounded-r-full' : ''}
              `}
            >
              <span className={`w-7 h-7 flex items-center justify-center rounded-full text-[11px] font-bold transition-all
                ${isEdge ? 'bg-black text-white font-black shadow-md' : ''}
                ${isToday && !isEdge ? 'ring-2 ring-orange-400 text-orange-500 font-black' : ''}
                ${!isEdge ? 'hover:bg-slate-100 text-slate-700' : ''}
              `}>
                {day}
              </span>
            </div>
          );
        })}
      </div>

      {/* Status line */}
      <div className="mt-3 text-center min-h-[16px]">
        {picking ? (
          <p className="text-[9px] font-black text-orange-500 uppercase tracking-widest animate-pulse">
            Clique para definir o fim do período
          </p>
        ) : startDate && startDate !== endDate ? (
          <p className="text-[9px] font-bold text-slate-400">
            {startDate.split('-').reverse().join('/')} → {endDate.split('-').reverse().join('/')}
          </p>
        ) : startDate ? (
          <p className="text-[9px] font-bold text-slate-400">{startDate.split('-').reverse().join('/')}</p>
        ) : null}
      </div>
    </div>
  );
}

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 11);
}

const AppointmentsView: React.FC<{ tenantId: string; onOpenComandas?: () => void }> = ({ tenantId, onOpenComandas }) => {
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState<{
    id: string; basePrice: number; extraValue?: number; extraNote?: string;
    method?: PaymentMethod; status?: AppointmentStatus;
    professional_id?: string; service_id?: string; customer_id?: string;
    startTime?: string; source?: BookingSource; isPlan?: boolean;
  } | null>(null);
  const [showBreakModal, setShowBreakModal] = useState(false);

  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [presetPeriod, setPresetPeriod] = useState<string>('today');
  const [filterProfId, setFilterProfId] = useState<string>('');

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [breaks, setBreaks] = useState<BreakPeriod[]>([]);

  // new booking form
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [profId, setProfId] = useState('');
  const [svcId, setSvcId] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualTime, setManualTime] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [bookingSlots, setBookingSlots] = useState<string[]>([]);
  const [bookingSlotsLoading, setBookingSlotsLoading] = useState(false);

  // inline new-customer creation (inside booking modal)
  const [showNewCustForm, setShowNewCustForm] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [creatingCust, setCreatingCust] = useState(false);

  // finish modal
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.PIX);
  const [extraValue, setExtraValue] = useState<number>(0);
  const [extraNote, setExtraNote] = useState('');
  const [editStatus, setEditStatus] = useState<AppointmentStatus>(AppointmentStatus.FINISHED);

  // search
  const [searchTerm, setSearchTerm] = useState('');

  // inline status editing
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);

  // delete confirmation
  const [deleteApptId, setDeleteApptId] = useState<string | null>(null);
  const [deletingAppt, setDeletingAppt] = useState(false);

  // edit appointment (reschedule)
  const [editAppt, setEditAppt] = useState<Appointment | null>(null);
  const [editProfId, setEditProfId] = useState('');
  const [editSvcId, setEditSvcId] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editSlots, setEditSlots] = useState<string[]>([]);
  const [editSlotsLoading, setEditSlotsLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // break modal form
  const [brkLabel, setBrkLabel] = useState('');
  const [brkProfId, setBrkProfId] = useState('');
  const [brkType, setBrkType] = useState<'specific' | 'recurring'>('recurring');
  const [brkDate, setBrkDate] = useState('');
  const [brkDayOfWeek, setBrkDayOfWeek] = useState<number>(1);
  const [brkStart, setBrkStart] = useState('12:00');
  const [brkEnd, setBrkEnd] = useState('13:00');

  const refreshData = useCallback(async () => {
    const [apps, svcs, pros, custs, loadedBreaks] = await Promise.all([
      db.getAppointments(tenantId),
      db.getServices(tenantId),
      db.getProfessionals(tenantId),
      db.getCustomers(tenantId),
      db.getBreaks(tenantId)
    ]);
    setServices(svcs);
    setProfessionals(pros);
    setCustomers(custs);
    setBreaks(loadedBreaks);

    let data = apps.filter(a => {
      const appDate = new Date(a.startTime).toISOString().split('T')[0];
      if (presetPeriod === 'all') return true;
      return appDate >= startDate && appDate <= endDate;
    });

    if (filterProfId) data = data.filter(a => a.professional_id === filterProfId);

    setAppointments(data.sort((a, b) => a.startTime.localeCompare(b.startTime)));
  }, [tenantId, startDate, endDate, presetPeriod, filterProfId]);

  useEffect(() => { refreshData(); }, [refreshData]);

  // Auto-refresh a cada 30s para mostrar agendamentos criados pela IA
  useEffect(() => {
    const interval = setInterval(() => { refreshData(); }, 30_000);
    return () => clearInterval(interval);
  }, [refreshData]);

  const applyPreset = (period: string) => {
    setPresetPeriod(period);
    const now = new Date();
    let start = new Date();
    let end = new Date();
    switch (period) {
      case 'today': start = new Date(); end = new Date(); break;
      case '7d': end = new Date(); end.setDate(now.getDate() + 7); break;
      case '14d': end = new Date(); end.setDate(now.getDate() + 14); break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'all': return;
    }
    if (period !== 'all') {
      setStartDate(start.toISOString().split('T')[0]);
      setEndDate(end.toISOString().split('T')[0]);
    }
  };

  const handleCreateAndSelectCustomer = async () => {
    if (!newCustName.trim() || !newCustPhone.trim()) return;
    setCreatingCust(true);
    try {
      const created = await db.addCustomer({ tenant_id: tenantId, name: newCustName.trim(), phone: newCustPhone.trim(), active: true });
      await refreshData();
      setCustomerId(created.id);
      setCustomerSearch('');
      setShowNewCustForm(false);
      setNewCustName('');
      setNewCustPhone('');
    } catch (e: any) {
      alert('Erro ao cadastrar: ' + (e.message || 'tente novamente.'));
    } finally {
      setCreatingCust(false);
    }
  };

  const openBookingModal = () => {
    setErrorMsg(''); setCustomerId(''); setCustomerSearch(''); setProfId(''); setSvcId('');
    setManualDate(new Date().toISOString().split('T')[0]); setManualTime('');
    setShowNewCustForm(false); setNewCustName(''); setNewCustPhone('');
    setBookingSlots([]); setBookingSlotsLoading(false);
    setShowBookingModal(true);
  };

  const handleCreateBooking = async () => {
    if (!customerId || !profId || !svcId || !manualDate || !manualTime) {
      setErrorMsg('Por favor, preencha todos os campos.'); return;
    }
    const svc = services.find(s => s.id === svcId);
    if (!svc) return;
    const requestedDate = new Date(`${manualDate}T${manualTime}:00`);
    if (isNaN(requestedDate.getTime())) { setErrorMsg('Data ou hora inválida.'); return; }

    // If the time was verified by the slot picker, skip the isSlotAvailable check
    // (it already checked operating hours + conflicts). Only check conflicts for manual types.
    const verifiedByPicker = bookingSlots.includes(manualTime);
    if (!verifiedByPicker) {
      const check = await db.isSlotAvailable(tenantId, profId, requestedDate, svc.durationMinutes);
      if (!check.available) {
        setErrorMsg(check.reason || 'Este horário não está disponível.');
        return;
      }
    }

    try {
      // Pass local time string directly — never go through toISOString (avoids UTC+3h shift)
      const newApp = await db.addAppointment({
        tenant_id: tenantId, customer_id: customerId, professional_id: profId,
        service_id: svcId, startTime: `${manualDate}T${manualTime}:00`,
        durationMinutes: svc.durationMinutes, status: AppointmentStatus.CONFIRMED,
        source: BookingSource.MANUAL
      });
      sendProfessionalNotification(newApp);
      setShowBookingModal(false); setErrorMsg(''); refreshData();
    } catch (e: any) {
      setErrorMsg(e.message || 'Erro ao criar agendamento. Tente novamente.');
    }
  };

  const handleFinish = async () => {
    if (!showFinishModal) return;
    try {
      await db.updateAppointmentStatus(showFinishModal.id, editStatus, {
        paymentMethod, amountPaid: showFinishModal.basePrice + extraValue, extraNote, extraValue
      });
    } catch (err) {
      console.error('Erro ao atualizar status:', err);
    }

    // When client arrives: notify + create comanda (best-effort, independent)
    if (editStatus === AppointmentStatus.ARRIVED) {
      // Notificar sempre, independente da comanda
      const fullApp = appointments.find(a => a.id === showFinishModal.id);
      if (fullApp) sendClientArrivedNotification(fullApp).catch(err =>
        console.warn('Notificação ARRIVED falhou:', err)
      );
      // Criar comanda
      try {
        const svc = services.find(s => s.id === showFinishModal.service_id);
        await db.createComanda({
          tenant_id: tenantId,
          appointment_id: showFinishModal.id,
          professional_id: showFinishModal.professional_id!,
          customer_id: showFinishModal.customer_id!,
          items: svc ? [{
            id: generateId(), type: 'service', itemId: svc.id,
            name: svc.name, qty: 1, unitPrice: svc.price,
            discountType: 'value' as const, discount: 0,
            professionalId: showFinishModal.professional_id,
          }] : [],
          status: 'open',
        });
      } catch (err) {
        console.error('Erro ao criar comanda:', err);
      }
    }

    setShowFinishModal(null);
    if (editStatus === AppointmentStatus.ARRIVED) {
      onOpenComandas?.();
    } else {
      refreshData();
    }
  };

  const handleDeleteAppointment = async () => {
    if (!deleteApptId) return;
    setDeletingAppt(true);
    try {
      await db.deleteAppointment(deleteApptId);
      setDeleteApptId(null);
      refreshData();
    } catch (e) {
      console.error('Erro ao excluir agendamento:', e);
    } finally {
      setDeletingAppt(false);
    }
  };

  const openEditModal = (a: Appointment) => {
    const d = new Date(a.startTime);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    setEditAppt(a);
    setEditProfId(a.professional_id);
    setEditSvcId(a.service_id);
    setEditDate(a.startTime.split('T')[0]);
    setEditTime(`${hh}:${mm}`);
    setEditSlots([]);
    setEditError('');
  };

  // Fetch available slots for the edit modal (called when prof+date change)
  const loadEditSlots = useCallback(async (pId: string, date: string, sId: string) => {
    if (!pId || !date) { setEditSlots([]); return; }
    setEditSlotsLoading(true);
    try {
      const svc = services.find(s => s.id === sId);
      const dur = svc?.durationMinutes || 30;
      const settings = await db.getSettings(tenantId);
      const dateObj = new Date(date + 'T12:00:00');
      const dayIndex = dateObj.getDay();
      const dayConfig = settings.operatingHours?.[dayIndex];
      if (!dayConfig?.active) { setEditSlots([]); return; }

      const [startRange, endRange] = dayConfig.range.split('-');
      const [sh, sm] = startRange.split(':').map(Number);
      const [eh, em] = endRange.split(':').map(Number);

      // Use appointments from already-loaded state (fast, no extra fetch)
      const dayAppts = appointments.filter(a => {
        if (a.status === AppointmentStatus.CANCELLED || (a.status as string) === 'cancelado') return false;
        if (a.id === editAppt?.id) return false; // exclude self
        const aDate = new Date(a.startTime).toISOString().split('T')[0];
        return aDate === date && a.professional_id === pId;
      });

      const breaks: BreakPeriod[] = settings.breaks || [];
      const pad = (n: number) => String(n).padStart(2, '0');
      const INTERVAL = 30;
      const slots: string[] = [];
      let cursor = sh * 60 + sm;
      const endCursor = eh * 60 + em;
      const loopLimit = dayConfig.acceptLastSlot ? endCursor : endCursor - dur;

      while (cursor <= loopLimit) {
        const h = Math.floor(cursor / 60);
        const m = cursor % 60;
        const label = `${pad(h)}:${pad(m)}`;
        const slotStart = new Date(`${date}T${label}:00`);
        const slotEnd = new Date(slotStart.getTime() + dur * 60000);
        const slotEndLabel = `${pad(slotEnd.getHours())}:${pad(slotEnd.getMinutes())}`;

        const BUFFER = 11 * 60 * 1000;
        const conflict = dayAppts.some(a => {
          const aStart = new Date(a.startTime);
          const aEnd = new Date(aStart.getTime() + a.durationMinutes * 60000);
          if (!(aStart < slotEnd && aEnd > slotStart)) return false;
          return slotStart.getTime() < aEnd.getTime() - BUFFER;
        });

        const brkConflict = breaks.some(brk => {
          if (brk.professionalId && brk.professionalId !== pId) return false;
          if ((brk as any).type === 'vacation') {
            const vacStart = brk.date || '';
            const vacEnd = (brk as any).vacationEndDate || brk.date || '';
            return !!vacStart && date >= vacStart && date <= vacEnd;
          }
          const matchDate = !brk.date || brk.date === date;
          const matchDay = brk.dayOfWeek == null || brk.dayOfWeek === dayIndex;
          if (!matchDate || !matchDay) return false;
          return label < brk.endTime && slotEndLabel > brk.startTime;
        });

        if (!conflict && !brkConflict) slots.push(label);
        cursor += INTERVAL;
      }
      setEditSlots(slots);
    } catch (e) {
      console.error('loadEditSlots error:', e);
      setEditSlots([]);
    } finally {
      setEditSlotsLoading(false);
    }
  }, [tenantId, services, appointments, editAppt]);

  useEffect(() => {
    if (editAppt) loadEditSlots(editProfId, editDate, editSvcId);
  }, [editProfId, editDate, editSvcId, editAppt, loadEditSlots]);

  // Load available slots for the NEW booking modal
  const loadBookingSlots = useCallback(async (pId: string, date: string, sId: string) => {
    if (!pId || !date || !sId) { setBookingSlots([]); return; }
    setBookingSlotsLoading(true);
    setManualTime('');
    try {
      const svc = services.find(s => s.id === sId);
      const dur = svc?.durationMinutes || 30;
      const settings = await db.getSettings(tenantId);
      const dateObj = new Date(date + 'T12:00:00');
      const dayIndex = dateObj.getDay();
      const dayConfig = settings.operatingHours?.[dayIndex];
      if (!dayConfig?.active) { setBookingSlots([]); return; }

      // Fetch appointments from DB for this professional/date (no state filter issues)
      const { data: dbAppts } = await supabase
        .from('appointments').select('inicio, fim, status')
        .eq('tenant_id', tenantId).eq('professional_id', pId)
        .neq('status', 'CANCELLED').neq('status', 'cancelado')
        .gte('inicio', `${date}T00:00:00`).lte('inicio', `${date}T23:59:59`);

      // If day is inactive per settings but already has appointments, allow booking
      // (admin override — e.g., Sunday closed by default but shop is actually working)
      const hasExistingAppts = (dbAppts || []).length > 0;
      if (!dayConfig?.active && !hasExistingAppts) { setBookingSlots([]); return; }

      // Use stored range or fall back to 08:00-20:00 for override days
      const effectiveRange = dayConfig?.range || '08:00-20:00';
      const [startRange, endRange] = effectiveRange.split('-');
      const [sh, sm] = startRange.split(':').map(Number);
      const [eh, em] = endRange.split(':').map(Number);

      const breaks: BreakPeriod[] = settings.breaks || [];
      const pad = (n: number) => String(n).padStart(2, '0');
      const INTERVAL = 30;
      const BUFFER = 11 * 60 * 1000;
      const slots: string[] = [];
      let cursor = sh * 60 + sm;
      const endCursor = eh * 60 + em;
      const loopLimit = dayConfig?.acceptLastSlot ? endCursor : endCursor - dur;

      while (cursor <= loopLimit) {
        const h = Math.floor(cursor / 60);
        const m = cursor % 60;
        const label = `${pad(h)}:${pad(m)}`;
        const slotStart = new Date(`${date}T${label}:00`);
        const slotEnd = new Date(slotStart.getTime() + dur * 60000);
        const slotEndLabel = `${pad(slotEnd.getHours())}:${pad(slotEnd.getMinutes())}`;

        const conflict = (dbAppts || []).some((a: any) => {
          const aStart = new Date(a.inicio);
          const aEnd = new Date(a.fim);
          // Overlap duration = max(0, min(slotEnd, aEnd) - max(slotStart, aStart))
          const overlapMs = Math.max(0,
            Math.min(slotEnd.getTime(), aEnd.getTime()) - Math.max(slotStart.getTime(), aStart.getTime())
          );
          return overlapMs > BUFFER; // conflict if overlap > 11 min
        });

        const brkConflict = breaks.some(brk => {
          if (brk.professionalId && brk.professionalId !== pId) return false;
          if ((brk as any).type === 'vacation') {
            const vacStart = brk.date || '';
            const vacEnd = (brk as any).vacationEndDate || brk.date || '';
            return !!vacStart && date >= vacStart && date <= vacEnd;
          }
          const matchDate = !brk.date || brk.date === date;
          const matchDay = brk.dayOfWeek == null || brk.dayOfWeek === dayIndex;
          if (!matchDate || !matchDay) return false;
          return label < brk.endTime && slotEndLabel > brk.startTime;
        });

        if (!conflict && !brkConflict) slots.push(label);
        cursor += INTERVAL;
      }
      setBookingSlots(slots);
    } catch (e) {
      console.error('loadBookingSlots error:', e);
      setBookingSlots([]);
    } finally {
      setBookingSlotsLoading(false);
    }
  }, [tenantId, services]);

  useEffect(() => {
    if (showBookingModal && profId && manualDate && svcId) {
      loadBookingSlots(profId, manualDate, svcId);
    } else {
      setBookingSlots([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profId, manualDate, svcId, showBookingModal]);

  const handleSaveEdit = async () => {
    if (!editAppt || !editProfId || !editSvcId || !editDate || !editTime) {
      setEditError('Preencha todos os campos.'); return;
    }
    const svc = services.find(s => s.id === editSvcId);
    if (!svc) return;
    const startTime = new Date(`${editDate}T${editTime}:00`);
    if (isNaN(startTime.getTime())) { setEditError('Data ou hora inválida.'); return; }
    setSavingEdit(true);
    setEditError('');
    try {
      await db.updateAppointmentSchedule(editAppt.id, editProfId, editSvcId, startTime, svc.durationMinutes);
      setEditAppt(null);
      refreshData();
    } catch (e: any) {
      setEditError(e.message || 'Erro ao salvar. Tente novamente.');
    } finally {
      setSavingEdit(false);
    }
  };

  const openBreakModal = () => {
    setBrkLabel(''); setBrkProfId(''); setBrkType('recurring');
    setBrkDate(''); setBrkDayOfWeek(1); setBrkStart('12:00'); setBrkEnd('13:00');
    setShowBreakModal(true);
  };

  const handleCreateBreak = async () => {
    if (!brkLabel || !brkStart || !brkEnd) return;
    const newBreak: BreakPeriod = {
      id: generateId(),
      label: brkLabel,
      professionalId: brkProfId || null,
      date: brkType === 'specific' ? (brkDate || null) : null,
      dayOfWeek: brkType === 'recurring' ? brkDayOfWeek : null,
      startTime: brkStart,
      endTime: brkEnd
    };
    const updated = [...breaks, newBreak];
    await db.saveBreaks(tenantId, updated);
    setBreaks(updated);
    setShowBreakModal(false);
  };

  const handleDeleteBreak = async (id: string) => {
    const updated = breaks.filter(b => b.id !== id);
    await db.saveBreaks(tenantId, updated);
    setBreaks(updated);
  };

  const breakLabel = (b: BreakPeriod) => {
    const profName = b.professionalId
      ? professionals.find(p => p.id === b.professionalId)?.name || '?'
      : 'Todos';
    const when = b.date
      ? new Date(b.date + 'T12:00:00').toLocaleDateString('pt-BR')
      : b.dayOfWeek != null
        ? DAY_NAMES[b.dayOfWeek]
        : 'Diário';
    return `${b.startTime}–${b.endTime} · ${when} · ${profName}`;
  };

  const filteredForDisplay = searchTerm.trim()
    ? appointments.filter(a => {
        const c = customers.find(cu => cu.id === a.customer_id);
        const term = searchTerm.toLowerCase().trim();
        return (
          c?.name.toLowerCase().includes(term) ||
          c?.phone.includes(term)
        );
      })
    : appointments;

  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-black">AGENDA OPERACIONAL</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Gestão de horários e períodos</p>
        </div>
        <button onClick={openBookingModal} className="bg-orange-500 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-100 hover:scale-105 active:scale-95 transition-all">
          + Novo Horário
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-10">
        {/* ─── Sidebar ─────────────────────────────── */}
        <div className="w-full lg:w-80 shrink-0 space-y-6">

          {/* Barbeiro Filter */}
          <div className="bg-white p-6 rounded-[30px] border-2 border-slate-100 shadow-lg space-y-4">
            <h3 className="font-black text-black text-xs uppercase tracking-widest">Filtrar por Barbeiro</h3>
            <select
              value={filterProfId}
              onChange={e => setFilterProfId(e.target.value)}
              className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl outline-none font-bold text-xs focus:border-orange-500 transition-colors"
            >
              <option value="">Todos os barbeiros</option>
              {professionals.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {filterProfId && (
              <button onClick={() => setFilterProfId('')} className="text-[9px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest transition-colors">
                ✕ Limpar filtro
              </button>
            )}
          </div>

          {/* Period Filter */}
          <div className="bg-white p-8 rounded-[35px] border-2 border-slate-100 shadow-lg">
            <h3 className="font-black text-black mb-6 text-xs uppercase tracking-widest">Filtros de Período</h3>
            <div className="grid grid-cols-2 gap-2 mb-6">
              <PresetBtn active={presetPeriod === 'today'} onClick={() => applyPreset('today')} label="Hoje" />
              <PresetBtn active={presetPeriod === '7d'} onClick={() => applyPreset('7d')} label="7 Dias" />
              <PresetBtn active={presetPeriod === '14d'} onClick={() => applyPreset('14d')} label="14 Dias" />
              <PresetBtn active={presetPeriod === 'month'} onClick={() => applyPreset('month')} label="Este Mês" />
              <PresetBtn active={presetPeriod === 'all'} onClick={() => applyPreset('all')} label="Tudo" />
            </div>
            <div className="pt-4 border-t border-slate-50">
              <MiniCalendar
                startDate={startDate}
                endDate={endDate}
                disabled={presetPeriod === 'all'}
                onChange={(start, end) => { setStartDate(start); setEndDate(end); setPresetPeriod('custom'); }}
              />
            </div>
            <div className="mt-10 pt-6 border-t border-slate-100 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No Período</span>
                <span className="text-xl font-black text-black">{filteredForDisplay.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Concluídos</span>
                <span className="text-xl font-black text-orange-500">{filteredForDisplay.filter(a => a.status === AppointmentStatus.FINISHED).length}</span>
              </div>
            </div>
          </div>

          {/* Break Periods */}
          <div className="bg-white p-6 rounded-[30px] border-2 border-slate-100 shadow-lg space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-black text-black text-xs uppercase tracking-widest">Intervalos</h3>
              <button
                onClick={openBreakModal}
                className="text-[9px] font-black uppercase px-3 py-1.5 rounded-xl border-2 border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white transition-all"
              >
                + Gerar
              </button>
            </div>
            {breaks.length === 0 ? (
              <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest text-center py-4">Nenhum intervalo cadastrado</p>
            ) : (
              <div className="space-y-2">
                {breaks
                  .filter(b => !filterProfId || !b.professionalId || b.professionalId === filterProfId)
                  .map(b => (
                    <div key={b.id} className="flex items-start justify-between bg-slate-50 rounded-2xl p-3 gap-2">
                      <div>
                        <p className="text-[10px] font-black text-black uppercase">{b.label}</p>
                        <p className="text-[9px] font-bold text-slate-400 mt-0.5">{breakLabel(b)}</p>
                      </div>
                      <button onClick={() => handleDeleteBreak(b.id)} className="text-slate-300 hover:text-red-500 text-xs font-black transition-colors shrink-0">✕</button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── Appointments Table ────────────────── */}
        <div className="flex-1 space-y-4">
          {/* Search bar */}
          <div className="bg-white rounded-[24px] border-2 border-slate-100 px-6 py-4 flex items-center gap-3 shadow-sm">
            <svg className="w-4 h-4 text-slate-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Pesquisar por nome ou telefone..."
              className="flex-1 bg-transparent outline-none text-xs font-black uppercase tracking-widest text-black placeholder:text-slate-300"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="text-slate-300 hover:text-red-400 font-black text-xs transition-colors">✕</button>
            )}
          </div>

          <div className="bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b-2 border-slate-100">
                  <th className="px-8 py-6">DATA / HORA</th>
                  <th className="px-8 py-6">CLIENTE</th>
                  <th className="px-8 py-6">SERVIÇO</th>
                  <th className="px-8 py-6">PROFISSIONAL</th>
                  <th className="px-8 py-6">STATUS</th>
                  <th className="px-8 py-6 text-right">AÇÕES</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-slate-50">
                {filteredForDisplay.length === 0 ? (
                  <tr><td colSpan={6} className="p-20 text-center text-slate-300 font-black uppercase tracking-widest italic">Nenhum agendamento encontrado para este intervalo.</td></tr>
                ) : (
                  filteredForDisplay.map(a => {
                    const c = customers.find(cu => cu.id === a.customer_id);
                    const p = professionals.find(pr => pr.id === a.professional_id);
                    const svc = services.find(s => s.id === a.service_id);
                    const appDate = new Date(a.startTime);
                    const isAI = a.source === BookingSource.AI;
                    const isPlan = a.isPlan || a.source === BookingSource.PLAN;
                    return (
                      <tr key={a.id} className="group hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                        <td className="px-8 py-6">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-black text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300 uppercase transition-colors">{appDate.toLocaleDateString('pt-BR')}</span>
                            <span className="text-lg font-black text-orange-500">{appDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                            <span className={`text-[8px] font-black px-2 py-0.5 rounded-full w-fit uppercase tracking-widest ${isAI ? 'bg-orange-100 text-orange-600' : isPlan ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                              {isAI ? '⚡ Agente IA' : isPlan ? '📦 Plano' : '✏️ Manual'}
                            </span>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <span className="font-black text-black group-hover:text-slate-700 dark:text-slate-100 dark:group-hover:text-slate-200 uppercase tracking-tight text-sm transition-colors">{c?.name || '—'}</span>
                        </td>
                        <td className="px-8 py-6">
                          <span className="font-black text-black group-hover:text-slate-700 dark:text-slate-100 dark:group-hover:text-slate-200 text-sm transition-colors">{svc?.name || '—'}</span>
                          {svc && !isPlan && <p className="text-[10px] text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300 font-bold uppercase transition-colors">R$ {svc.price.toFixed(2)} · {svc.durationMinutes}min</p>}
                          {svc && isPlan && <p className="text-[10px] text-blue-500 font-bold uppercase">Plano · {svc.durationMinutes}min</p>}
                        </td>
                        <td className="px-8 py-6 font-bold text-slate-500 group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-200 uppercase text-xs tracking-wider transition-colors">{p?.name || '—'}</td>
                        <td className="px-8 py-6">
                          {editingStatusId === a.id ? (
                            <select
                              autoFocus
                              defaultValue={a.status}
                              onChange={async e => {
                                const newStatus = e.target.value as AppointmentStatus;
                                setEditingStatusId(null);
                                if (newStatus === AppointmentStatus.FINISHED) {
                                  setShowFinishModal({ id: a.id, basePrice: svc?.price || 0, ...a });
                                  setEditStatus(AppointmentStatus.FINISHED);
                                  setPaymentMethod(a.paymentMethod || PaymentMethod.PIX);
                                  setExtraValue(a.extraValue || 0);
                                  setExtraNote(a.extraNote || '');
                                } else if (newStatus === AppointmentStatus.ARRIVED) {
                                  // 1. Atualizar status
                                  try {
                                    await db.updateAppointmentStatus(a.id, newStatus, {});
                                  } catch (err) {
                                    console.error('Erro ao atualizar status ARRIVED:', err);
                                  }
                                  // 2. Notificar profissional (independente da comanda)
                                  sendClientArrivedNotification(a).catch(err =>
                                    console.warn('Notificação ARRIVED falhou:', err)
                                  );
                                  // 3. Criar comanda (best-effort)
                                  try {
                                    const svcObj = services.find(s => s.id === a.service_id);
                                    const existingComandas = await db.getComandas(tenantId);
                                    const alreadyHasComanda = existingComandas.some(c => c.appointment_id === a.id);
                                    if (!alreadyHasComanda) {
                                      await db.createComanda({
                                        tenant_id: tenantId,
                                        appointment_id: a.id,
                                        professional_id: a.professional_id,
                                        customer_id: a.customer_id,
                                        items: svcObj ? [{
                                          id: generateId(), type: 'service' as const, itemId: svcObj.id,
                                          name: svcObj.name, qty: 1, unitPrice: svcObj.price,
                                          discountType: 'value' as const, discount: 0,
                                          professionalId: a.professional_id,
                                        }] : [],
                                        status: 'open',
                                      });
                                    }
                                  } catch (err) {
                                    console.error('Erro ao criar comanda:', err);
                                  }
                                  // 4. Navegar para Comandas
                                  onOpenComandas ? onOpenComandas() : refreshData();
                                } else {
                                  try {
                                    await db.updateAppointmentStatus(a.id, newStatus, {});
                                  } catch (err) {
                                    console.error('Erro ao atualizar status:', err);
                                  }
                                  if (newStatus === AppointmentStatus.CANCELLED) {
                                    const prof = professionals.find(p => p.id === a.professional_id);
                                    const dateStr = a.startTime ? a.startTime.substring(0, 10) : undefined;
                                    const timeStr = a.startTime ? a.startTime.substring(11, 16) : undefined;
                                    notifyWaitlistLeads(tenantId, { professionalName: prof?.name, date: dateStr, time: timeStr }).catch(console.error);
                                  }
                                  refreshData();
                                }
                              }}
                              onBlur={() => setEditingStatusId(null)}
                              className="text-[10px] font-black rounded-xl border-2 border-orange-400 bg-white dark:bg-gray-800 dark:text-white outline-none cursor-pointer px-2 py-1"
                            >
                              <option value={AppointmentStatus.PENDING}>Pendente</option>
                              <option value={AppointmentStatus.CONFIRMED}>Confirmado</option>
                              <option value={AppointmentStatus.ARRIVED}>Cliente Chegou</option>
                              <option value={AppointmentStatus.FINISHED}>Finalizado</option>
                              <option value={AppointmentStatus.NO_SHOW}>Faltou</option>
                              <option value={AppointmentStatus.CANCELLED}>Cancelado</option>
                            </select>
                          ) : (
                            <span
                              onClick={() => setEditingStatusId(a.id)}
                              title="Clique para alterar status"
                              className={`text-[10px] font-black px-4 py-1.5 rounded-full tracking-widest cursor-pointer hover:opacity-75 transition-opacity ${
                                a.status === AppointmentStatus.FINISHED  ? 'bg-black text-white dark:bg-white dark:text-black' :
                                a.status === AppointmentStatus.ARRIVED   ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                                a.status === AppointmentStatus.NO_SHOW   ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                                a.status === AppointmentStatus.CANCELLED ? 'bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400' :
                                a.status === AppointmentStatus.CONFIRMED ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
                              }`}>{
                                a.status === AppointmentStatus.ARRIVED  ? 'CHEGOU' :
                                a.status === AppointmentStatus.NO_SHOW  ? 'FALTOU' :
                                a.status
                              }</span>
                          )}
                        </td>
                        <td className="px-8 py-6 text-right">
                          <div className="flex items-center justify-end gap-3">
                            {a.status === AppointmentStatus.FINISHED && (
                              <button
                                onClick={() => {
                                  setShowFinishModal({ id: a.id, basePrice: svc?.price || 0, ...a });
                                  setEditStatus(a.status);
                                  setPaymentMethod(a.paymentMethod || PaymentMethod.PIX);
                                  setExtraValue(a.extraValue || 0);
                                  setExtraNote(a.extraNote || '');
                                }}
                                className="text-black dark:text-slate-200 font-black text-[10px] uppercase hover:text-orange-500 dark:hover:text-orange-400 transition-colors"
                              >
                                DETALHES
                              </button>
                            )}
                            <button
                              onClick={() => openEditModal(a)}
                              title="Editar horário"
                              className="text-slate-400 hover:text-orange-500 dark:text-slate-500 dark:hover:text-orange-400 transition-colors"
                            >
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </button>
                            <button
                              onClick={() => setDeleteApptId(a.id)}
                              title="Excluir agendamento"
                              className="text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400 transition-colors"
                            >
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          </div>
        </div>
      </div>

      {/* ─── Edit Appointment Modal ─────────────────── */}
      {editAppt && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex justify-center items-start min-h-full p-6 pt-10 pb-10">
            <div className="bg-white dark:bg-slate-900 rounded-[40px] w-full max-w-md p-10 space-y-6 animate-scaleUp border-4 border-black dark:border-slate-700">
              <h2 className="text-2xl font-black text-black dark:text-white uppercase tracking-tight">Editar Agendamento</h2>
              {editError && (
                <div className="bg-red-50 border-2 border-red-200 p-3 rounded-2xl text-red-600 text-xs font-black uppercase tracking-widest">⚠️ {editError}</div>
              )}
              <div className="space-y-4">
                {/* Professional */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Profissional</label>
                  <select
                    value={editProfId}
                    onChange={e => { setEditProfId(e.target.value); setEditTime(''); }}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl text-xs font-bold text-black dark:text-white outline-none focus:border-orange-500 transition-colors"
                  >
                    <option value="">Selecione...</option>
                    {professionals.filter(p => p.active).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                {/* Service */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Serviço</label>
                  <select
                    value={editSvcId}
                    onChange={e => { setEditSvcId(e.target.value); setEditTime(''); }}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl text-xs font-bold text-black dark:text-white outline-none focus:border-orange-500 transition-colors"
                  >
                    <option value="">Selecione...</option>
                    {services.filter(s => s.active).map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.durationMinutes}min)</option>
                    ))}
                  </select>
                </div>
                {/* Date */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Data</label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={e => { setEditDate(e.target.value); setEditTime(''); }}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl text-xs font-bold text-black dark:text-white outline-none focus:border-orange-500 transition-colors"
                  />
                </div>
                {/* Time */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Horário {editSlotsLoading && <span className="text-orange-400">carregando...</span>}
                  </label>
                  {editSlots.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {editSlots.map(s => (
                        <button
                          key={s}
                          onClick={() => setEditTime(s)}
                          className={`px-4 py-2 rounded-2xl text-xs font-black border-2 transition-all ${
                            editTime === s
                              ? 'bg-orange-500 border-orange-500 text-white'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-black dark:text-white hover:border-orange-400'
                          }`}
                        >{s}</button>
                      ))}
                    </div>
                  ) : !editSlotsLoading && editProfId && editDate ? (
                    <p className="text-xs text-slate-400 font-bold ml-1">Nenhum horário disponível neste dia.</p>
                  ) : null}
                  {/* Manual time fallback */}
                  <input
                    type="time"
                    value={editTime}
                    onChange={e => setEditTime(e.target.value)}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl text-xs font-bold text-black dark:text-white outline-none focus:border-orange-500 transition-colors mt-2"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setEditAppt(null)}
                  className="flex-1 py-3 rounded-2xl border-2 border-slate-200 dark:border-slate-700 text-sm font-black text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >CANCELAR</button>
                <button
                  onClick={handleSaveEdit}
                  disabled={savingEdit || !editTime}
                  className="flex-1 py-3 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-black uppercase tracking-widest transition-colors disabled:opacity-50"
                >{savingEdit ? '...' : 'SALVAR'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Delete Appointment Confirm Modal ──────── */}
      {deleteApptId && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
          <div className="bg-white dark:bg-slate-900 rounded-[32px] w-full max-w-sm p-10 space-y-6 border-4 border-red-500 animate-scaleUp">
            <h2 className="text-2xl font-black text-black dark:text-white uppercase tracking-tight">Excluir Agendamento?</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Esta ação é permanente e não pode ser desfeita.</p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setDeleteApptId(null)}
                className="flex-1 py-3 rounded-2xl border-2 border-slate-200 dark:border-slate-700 text-sm font-black text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                CANCELAR
              </button>
              <button
                onClick={handleDeleteAppointment}
                disabled={deletingAppt}
                className="flex-1 py-3 rounded-2xl bg-red-500 hover:bg-red-600 text-white text-sm font-black uppercase tracking-widest transition-colors disabled:opacity-50"
              >
                {deletingAppt ? '...' : 'EXCLUIR'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── New Booking Modal ─────────────────────── */}
      {showBookingModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex justify-center items-start min-h-full p-6 pt-10 pb-10">
          <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp border-4 border-black">
            <h2 className="text-3xl font-black text-black tracking-tight uppercase">Novo Horário</h2>
            {errorMsg && (
              <div className="bg-red-50 border-2 border-red-200 p-4 rounded-2xl text-red-600 text-xs font-black uppercase tracking-widest animate-pulse">⚠️ {errorMsg}</div>
            )}
            <div className="space-y-4">
              {/* ── Customer searchable picker ── */}
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Cliente</label>
                <div className="relative">
                  <div className="flex items-center gap-2 p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus-within:border-orange-500 transition-colors">
                    <svg className="w-3.5 h-3.5 text-slate-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input
                      value={customerSearch}
                      onChange={e => { setCustomerSearch(e.target.value); setCustomerId(''); }}
                      placeholder={customerId ? customers.find(c => c.id === customerId)?.name : 'Pesquisar por nome ou telefone...'}
                      className="flex-1 bg-transparent outline-none text-xs font-bold text-black placeholder:text-slate-400"
                    />
                    {(customerSearch || customerId) && (
                      <button onClick={() => { setCustomerSearch(''); setCustomerId(''); }} className="text-slate-300 hover:text-red-400 text-xs font-black">✕</button>
                    )}
                  </div>
                  {/* Dropdown list */}
                  {customerSearch.trim().length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border-2 border-slate-100 rounded-2xl shadow-xl z-10 max-h-52 overflow-y-auto">
                      {[...customers]
                        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
                        .filter(c =>
                          c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
                          c.phone.includes(customerSearch)
                        )
                        .slice(0, 50)
                        .map(c => (
                          <button
                            key={c.id}
                            onClick={() => { setCustomerId(c.id); setCustomerSearch(''); }}
                            className="w-full text-left px-4 py-3 hover:bg-slate-100 transition-colors border-b border-slate-50 last:border-0"
                          >
                            <span className="text-xs font-black text-black uppercase">{c.name}</span>
                            <span className="text-[10px] text-slate-400 font-bold ml-2">{c.phone}</span>
                          </button>
                        ))
                      }
                      {[...customers].filter(c =>
                        c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
                        c.phone.includes(customerSearch)
                      ).length === 0 && (
                        <button
                          onClick={() => { setShowNewCustForm(true); setNewCustName(customerSearch); setCustomerSearch(''); }}
                          className="w-full flex items-center gap-2 px-4 py-3 hover:bg-orange-50 transition-colors text-left"
                        >
                          <span className="text-xs font-black text-orange-500">+ Cadastrar "{customerSearch}"</span>
                        </button>
                      )}
                    </div>
                  )}
                  {/* Show sorted list when empty search but no selection */}
                  {customerSearch.trim().length === 0 && !customerId && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border-2 border-slate-100 rounded-2xl shadow-xl z-10 max-h-52 overflow-y-auto">
                      {[...customers]
                        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
                        .map(c => (
                          <button
                            key={c.id}
                            onClick={() => { setCustomerId(c.id); setCustomerSearch(''); }}
                            className="w-full text-left px-4 py-3 hover:bg-slate-100 transition-colors border-b border-slate-50 last:border-0"
                          >
                            <span className="text-xs font-black text-black uppercase">{c.name}</span>
                            <span className="text-[10px] text-slate-400 font-bold ml-2">{c.phone}</span>
                          </button>
                        ))
                      }
                    </div>
                  )}
                </div>
                {customerId && (
                  <p className="text-[10px] font-black text-orange-500 ml-4 mt-1">
                    ✓ {customers.find(c => c.id === customerId)?.name}
                  </p>
                )}
              </div>

              {/* Inline new-customer mini-form */}
              {showNewCustForm && !customerId && (
                <div className="bg-orange-50 border-2 border-orange-200 rounded-2xl p-4 space-y-3">
                  <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Novo Cliente</p>
                  <div className="space-y-2">
                    <input
                      value={newCustName}
                      onChange={e => setNewCustName(e.target.value)}
                      placeholder="Nome completo"
                      className="w-full p-3 bg-white border-2 border-orange-100 rounded-xl font-bold text-xs outline-none focus:border-orange-500 transition-colors"
                    />
                    <input
                      value={newCustPhone}
                      onChange={e => setNewCustPhone(e.target.value)}
                      placeholder="Telefone (ex: 11999999999)"
                      className="w-full p-3 bg-white border-2 border-orange-100 rounded-xl font-bold text-xs outline-none focus:border-orange-500 transition-colors"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowNewCustForm(false); setNewCustName(''); setNewCustPhone(''); }}
                      className="flex-1 py-2 font-black text-slate-400 uppercase text-[10px] border-2 border-slate-100 rounded-xl hover:border-slate-300 transition-all"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleCreateAndSelectCustomer}
                      disabled={creatingCust || !newCustName.trim() || !newCustPhone.trim()}
                      className="flex-1 py-2 bg-orange-500 text-white rounded-xl font-black uppercase text-[10px] hover:bg-black transition-all disabled:opacity-40"
                    >
                      {creatingCust ? 'Criando...' : 'Criar e Selecionar'}
                    </button>
                  </div>
                </div>
              )}

              <ModalSelect label="Profissional" value={profId} onChange={setProfId} placeholder="Selecionar Profissional">
                {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </ModalSelect>
              <ModalSelect label="Serviço" value={svcId} onChange={setSvcId} placeholder="Selecionar Serviço">
                {services.map(s => <option key={s.id} value={s.id}>{s.name} - R${s.price}</option>)}
              </ModalSelect>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Data</label>
                <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs uppercase" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                  Horário {bookingSlotsLoading && <span className="text-orange-400">carregando...</span>}
                </label>
                {bookingSlots.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {bookingSlots.map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setManualTime(s)}
                        className={`px-4 py-2 rounded-2xl text-xs font-black border-2 transition-all ${
                          manualTime === s
                            ? 'bg-orange-500 border-orange-500 text-white'
                            : 'bg-white border-slate-200 text-black hover:border-orange-400'
                        }`}
                      >{s}</button>
                    ))}
                  </div>
                ) : !bookingSlotsLoading && profId && manualDate && svcId ? (
                  <p className="text-xs text-slate-400 font-bold ml-1">Nenhum horário disponível neste dia.</p>
                ) : null}
                <input
                  type="time"
                  value={manualTime}
                  onChange={e => setManualTime(e.target.value)}
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs"
                  placeholder="ou digite manualmente"
                />
              </div>
            </div>
            <div className="flex gap-4 pt-4">
              <button onClick={() => setShowBookingModal(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs">Voltar</button>
              <button onClick={handleCreateBooking} className="flex-1 py-4 bg-orange-500 text-white rounded-2xl font-black uppercase text-xs shadow-xl shadow-orange-100 hover:bg-black transition-all">Agendar</button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* ─── Finish / Manage Modal ────────────────── */}
      {showFinishModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex justify-center items-start min-h-full p-6 pt-10 pb-10">
          <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp border-4 border-orange-500">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black text-black uppercase">Gerenciar Agendamento</h2>
              <span className={`text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${
                showFinishModal.source === BookingSource.AI ? 'bg-orange-100 text-orange-600' :
                (showFinishModal.isPlan || showFinishModal.source === BookingSource.PLAN) ? 'bg-blue-100 text-blue-600' :
                'bg-slate-100 text-slate-500'
              }`}>
                {showFinishModal.source === BookingSource.AI ? '⚡ Agente IA' :
                 (showFinishModal.isPlan || showFinishModal.source === BookingSource.PLAN) ? '📦 Plano' :
                 '✏️ Manual'}
              </span>
            </div>

            <div className="bg-slate-50 rounded-3xl p-6 space-y-3">
              {showFinishModal.startTime && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Data / Hora</span>
                  <span className="text-sm font-black text-orange-500">
                    {new Date(showFinishModal.startTime).toLocaleDateString('pt-BR')} às{' '}
                    {new Date(showFinishModal.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}
              {showFinishModal.service_id && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Serviço</span>
                  <span className="text-sm font-black text-black">{services.find(s => s.id === showFinishModal.service_id)?.name || '—'}</span>
                </div>
              )}
              {showFinishModal.professional_id && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Profissional</span>
                  <span className="text-sm font-black text-black">{professionals.find(p => p.id === showFinishModal.professional_id)?.name || '—'}</span>
                </div>
              )}
              {showFinishModal.customer_id && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cliente</span>
                  <span className="text-sm font-black text-black">{customers.find(c => c.id === showFinishModal.customer_id)?.name || '—'}</span>
                </div>
              )}
            </div>

            <div className="space-y-5">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Status</label>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value as AppointmentStatus)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black">
                  <option value={AppointmentStatus.PENDING}>PENDENTE</option>
                  <option value={AppointmentStatus.CONFIRMED}>CONFIRMADO</option>
                  <option value={AppointmentStatus.ARRIVED}>CLIENTE CHEGOU</option>
                  <option value={AppointmentStatus.FINISHED}>FINALIZADO</option>
                  <option value={AppointmentStatus.NO_SHOW}>FALTOU</option>
                  <option value={AppointmentStatus.CANCELLED}>CANCELADO</option>
                </select>
              </div>

              {!(showFinishModal.isPlan || showFinishModal.source === BookingSource.PLAN) && (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Forma de Pagamento</label>
                    <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black">
                      {Object.values(PaymentMethod).map(pm => <option key={pm} value={pm}>{pm}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Acréscimo (Opcional)</label>
                    <input type="number" value={extraValue} onChange={e => setExtraValue(Number(e.target.value))} placeholder="Valor Extra" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black" />
                  </div>
                  <div className="bg-black p-8 rounded-[30px] text-center">
                    <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Total do Atendimento</p>
                    <p className="text-4xl font-black text-white">R$ {(showFinishModal.basePrice + (extraValue || 0)).toFixed(2)}</p>
                  </div>
                </>
              )}

              {(showFinishModal.isPlan || showFinishModal.source === BookingSource.PLAN) && (
                <div className="bg-blue-50 border-2 border-blue-100 p-6 rounded-[24px] text-center">
                  <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Cobertura do Plano</p>
                  <p className="text-lg font-black text-blue-600">Atendimento incluso no plano do cliente</p>
                  <p className="text-[9px] font-bold text-blue-400 mt-1 uppercase">Sem cobrança — não somado ao financeiro</p>
                </div>
              )}
            </div>

            <div className="flex gap-4">
              <button onClick={() => setShowFinishModal(null)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs">Sair</button>
              <button onClick={handleFinish} className="flex-1 py-4 bg-orange-500 text-white rounded-2xl font-black uppercase text-xs">Gravar Alterações</button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* ─── Break Period Modal ───────────────────── */}
      {showBreakModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex justify-center items-start min-h-full p-6 pt-10 pb-10">
          <div className="bg-white rounded-[40px] w-full max-w-md p-10 space-y-6 animate-scaleUp border-4 border-black">
            <h2 className="text-2xl font-black text-black uppercase tracking-tight">Gerar Intervalo</h2>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Nome do Intervalo</label>
                <input value={brkLabel} onChange={e => setBrkLabel(e.target.value)} placeholder="Ex: Almoço, Intervalo" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500" />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Barbeiro (opcional)</label>
                <select value={brkProfId} onChange={e => setBrkProfId(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
                  <option value="">Todos os profissionais</option>
                  {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Tipo</label>
                <div className="flex gap-3">
                  <button onClick={() => setBrkType('recurring')} className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase transition-all ${brkType === 'recurring' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-400'}`}>
                    Semanal
                  </button>
                  <button onClick={() => setBrkType('specific')} className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase transition-all ${brkType === 'specific' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-400'}`}>
                    Dia Específico
                  </button>
                </div>
              </div>

              {brkType === 'recurring' && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Dia da Semana</label>
                  <select value={brkDayOfWeek} onChange={e => setBrkDayOfWeek(Number(e.target.value))} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
                    {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
              )}

              {brkType === 'specific' && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Data</label>
                  <input type="date" value={brkDate} onChange={e => setBrkDate(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs" />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Início</label>
                  <input type="time" value={brkStart} onChange={e => setBrkStart(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Fim</label>
                  <input type="time" value={brkEnd} onChange={e => setBrkEnd(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs" />
                </div>
              </div>
            </div>

            <div className="flex gap-4 pt-2">
              <button onClick={() => setShowBreakModal(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs">Cancelar</button>
              <button onClick={handleCreateBreak} className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all">Salvar Intervalo</button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
};

const PresetBtn = ({ active, onClick, label }: any) => (
  <button onClick={onClick} className={`px-3 py-2 text-[9px] font-black uppercase tracking-tighter rounded-xl transition-all ${active ? 'bg-orange-500 text-white shadow-md' : 'bg-slate-50 text-slate-400 hover:text-black'}`}>
    {label}
  </button>
);

const ModalSelect = ({ label, value, onChange, placeholder, children }: any) => (
  <div className="space-y-1">
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">{label}</label>
    <select value={value} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
      <option value="">{placeholder}</option>
      {children}
    </select>
  </div>
);

export default AppointmentsView;
