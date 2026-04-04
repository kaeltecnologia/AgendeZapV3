import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../services/mockDb';
import { supabase } from '../services/supabase';
import { evolutionService } from '../services/evolutionService';
import { AppointmentStatus, BookingSource, MarketplacePost } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────
const _pad = (n: number) => String(n).padStart(2, '0');

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
}

function isoOffset(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
}

function formatDatePT(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long',
  });
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length >= 10) return `55${digits}`;
  return digits;
}

function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length <= 2) return d;
  if (d.length <= 4) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 9) return `(${d.slice(0, 2)}) ${d.slice(2, 5)}-${d.slice(5)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
}

const PERIODS = [
  { id: 'manha', label: 'Manhã', emoji: '🌅', start: 6, end: 12 },
  { id: 'tarde', label: 'Tarde', emoji: '☀️', start: 12, end: 18 },
  { id: 'noite', label: 'Noite', emoji: '🌙', start: 18, end: 24 },
];

const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DAY_NAMES = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

type Step = 'SERVICE' | 'DATE' | 'BARBER' | 'PERIOD' | 'TIME' | 'INFO' | 'SUCCESS';

// ── Mini Calendar ─────────────────────────────────────────────────────
const MiniCalendar: React.FC<{
  value: string;
  onChange: (d: string) => void;
  activeDays: Set<number>; // 0–6 days that have operating hours
  accent?: { sel: string; today: string; hov: string };
}> = ({ value, onChange, activeDays, accent }) => {
  const today = todayISO();
  const maxDate = isoOffset(60);
  const [view, setView] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const prevMonth = () => setView(v => {
    const d = new Date(v.year, v.month - 1, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const nextMonth = () => setView(v => {
    const d = new Date(v.year, v.month + 1, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const firstDow = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();

  const cells: (string | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${view.year}-${_pad(view.month + 1)}-${_pad(d)}`);
  }

  const canGoPrev = view.year > new Date().getFullYear() || view.month > new Date().getMonth();

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} disabled={!canGoPrev} className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 disabled:opacity-30 transition-all font-black">‹</button>
        <span className="font-black text-sm text-black uppercase tracking-wide">{MONTH_NAMES[view.month]} {view.year}</span>
        <button onClick={nextMonth} className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-all font-black">›</button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {DAY_NAMES.map(d => (
          <div key={d} className="text-center text-[9px] font-black text-slate-400 uppercase py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((iso, i) => {
          if (!iso) return <div key={i} />;
          const dow = new Date(iso + 'T12:00:00').getDay();
          const isPast = iso < today;
          const isTooFar = iso > maxDate;
          const isClosed = !activeDays.has(dow);
          const isDisabled = isPast || isTooFar || isClosed;
          const isSelected = iso === value;
          const isToday = iso === today;

          return (
            <button
              key={iso}
              onClick={() => !isDisabled && onChange(iso)}
              disabled={isDisabled}
              className={`h-9 w-full rounded-xl text-xs font-black transition-all ${
                isSelected
                  ? (accent?.sel || 'bg-orange-500 text-white shadow-lg shadow-orange-200')
                  : isToday && !isDisabled
                  ? (accent?.today || 'bg-orange-50 text-orange-500 border border-orange-200')
                  : isDisabled
                  ? 'text-slate-200 cursor-not-allowed'
                  : (accent?.hov || 'text-black hover:bg-orange-50 hover:text-orange-500')
              }`}
            >
              {parseInt(iso.split('-')[2])}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────
const BookingPage: React.FC<{ slug: string }> = ({ slug }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tenant, setTenant] = useState<any>(null);
  const [services, setServices] = useState<any[]>([]);
  const [professionals, setProfessionals] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({});

  // Booking state
  const [step, setStep] = useState<Step>('SERVICE');
  const [selectedService, setSelectedService] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedBarber, setSelectedBarber] = useState<any>(null);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [rawPhone, setRawPhone] = useState(() => {
    try {
      const cust = JSON.parse(localStorage.getItem('agz_customer') || '');
      return cust?.phone?.replace(/^55/, '') || '';
    } catch { return ''; }
  });
  const [customerName, setCustomerName] = useState(() => {
    try {
      const cust = JSON.parse(localStorage.getItem('agz_customer') || '');
      return cust?.name || '';
    } catch { return ''; }
  });
  const [submitting, setSubmitting] = useState(false);
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [tenantRating, setTenantRating] = useState<{ average: number; count: number } | null>(null);
  const [rankPosition, setRankPosition] = useState<number | null>(null);

  // Portfolio
  const [portfolioPosts, setPortfolioPosts] = useState<MarketplacePost[]>([]);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [portfolioIdx, setPortfolioIdx] = useState(0);
  const touchStartX = useRef<number>(0);

  const topRef = useRef<HTMLDivElement>(null);
  const servicosRef = useRef<HTMLDivElement>(null);

  // Load tenant data
  useEffect(() => {
    (async () => {
      try {
        const t = await db.getTenantBySlug(slug || '');
        if (!t) { setError('Estabelecimento não encontrado.'); setLoading(false); return; }
        setTenant(t);
        const [svcs, profs, sett] = await Promise.all([
          db.getServices(t.id),
          db.getProfessionals(t.id),
          db.getSettings(t.id),
        ]);
        setServices(svcs.filter((s: any) => s.active));
        setProfessionals(profs.filter((p: any) => p.active !== false));
        setSettings(sett);
        // Load average rating + ranking (batch — no N+1)
        db.getAverageRating(t.id).then(r => { if (r.count > 0) setTenantRating(r); }).catch(() => {});
        db.getMarketplaceRankings().then(rankings => {
          const me = rankings.find(r => r.tenantId === t.id);
          if (me && me.position <= 10) setRankPosition(me.position);
        }).catch(() => {});
        // Track marketplace page view
        db.incrementTenantView(t.id).catch(() => {});
        // Load portfolio posts
        db.getPostsByTenant(t.id).then(posts => { if (posts.length > 0) setPortfolioPosts(posts); }).catch(() => {});
      } catch {
        setError('Erro ao carregar dados do estabelecimento.');
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  // Load slots when date + barber + service are all set
  useEffect(() => {
    if (!selectedDate || !selectedBarber || !selectedService || !tenant) return;
    (async () => {
      setLoadingSlots(true);
      setSlots([]);
      try {
        const dateObj = new Date(selectedDate + 'T12:00:00');
        const dayIndex = dateObj.getDay();
        const dayConfig = settings.operatingHours?.[dayIndex];
        if (!dayConfig?.active) { setSlots([]); return; }

        const [startRange, endRange] = dayConfig.range.split('-');
        const [startH, startM] = startRange.split(':').map(Number);
        const [endH, endM] = endRange.split(':').map(Number);

        const { data: appts } = await supabase
          .from('appointments')
          .select('inicio, fim')
          .eq('tenant_id', tenant.id)
          .eq('professional_id', selectedBarber.id)
          .neq('status', 'cancelled')
          .gte('inicio', `${selectedDate}T00:00:00`)
          .lte('inicio', `${selectedDate}T23:59:59`);

        const now = new Date();
        const isToday = selectedDate === todayISO();
        const duration = selectedService.durationMinutes;
        const result: string[] = [];
        let cursor = startH * 60 + startM;
        const endCursor = endH * 60 + endM;

        while (cursor + duration <= endCursor) {
          const h = Math.floor(cursor / 60);
          const m = cursor % 60;
          const label = `${_pad(h)}:${_pad(m)}`;
          const slotStart = new Date(`${selectedDate}T${label}:00`);
          const slotEnd = new Date(slotStart.getTime() + duration * 60000);

          if (isToday && slotStart <= now) { cursor += 30; continue; }

          const conflict = (appts || []).some((a: any) =>
            new Date(a.inicio) < slotEnd && new Date(a.fim) > slotStart
          );
          if (!conflict) result.push(label);
          cursor += 30;
        }
        setSlots(result);
      } finally {
        setLoadingSlots(false);
      }
    })();
  }, [selectedDate, selectedBarber, selectedService, tenant, settings]);

  const activeDays = React.useMemo(() => {
    const s = new Set<number>();
    if (settings.operatingHours) {
      Object.entries(settings.operatingHours).forEach(([k, v]: any) => {
        if (v?.active) s.add(Number(k));
      });
    }
    return s;
  }, [settings]);

  const filteredSlots = slots.filter(t => {
    if (!selectedPeriod) return true;
    const h = parseInt(t.split(':')[0]);
    const p = PERIODS.find(x => x.id === selectedPeriod);
    return p ? h >= p.start && h < p.end : true;
  });

  const slotsInPeriod = (pid: string) => {
    const p = PERIODS.find(x => x.id === pid);
    return p ? slots.filter(t => { const h = parseInt(t.split(':')[0]); return h >= p.start && h < p.end; }).length : 0;
  };

  const scrollTop = () => topRef.current?.scrollIntoView({ behavior: 'smooth' });

  const goTo = (s: Step) => { setStep(s); setTimeout(scrollTop, 50); };

  const handleSubmit = async () => {
    if (!customerName.trim() || !rawPhone.trim()) {
      alert('Preencha seu nome e WhatsApp.');
      return;
    }
    const phone = formatPhone(rawPhone);
    if (phone.length < 12) {
      alert('Número de WhatsApp inválido.\nUse: (DDD) + número. Ex: (44) 99999-9999');
      return;
    }

    setSubmitting(true);
    try {
      const startTimeStr = `${selectedDate}T${selectedTime}:00`;
      const customer = await db.findOrCreateCustomer(tenant.id, phone, customerName.trim());

      await db.addAppointment({
        tenant_id: tenant.id,
        customer_id: customer.id,
        professional_id: selectedBarber.id,
        service_id: selectedService.id,
        startTime: startTimeStr,
        durationMinutes: selectedService.durationMinutes,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WEB,
      });

      const dateLabel = formatDatePT(selectedDate);
      const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);

      // Confirmation to customer
      await evolutionService.sendMessage(instanceName, phone,
        `✅ *Agendamento Confirmado!*\n\n` +
        `💈 *${tenant.name}*\n\n` +
        `📅 *Dia:* ${dateLabel}\n` +
        `⏰ *Horário:* ${selectedTime}\n` +
        `✂️ *Serviço:* ${selectedService.name}\n` +
        `👤 *Profissional:* ${selectedBarber.name}\n\n` +
        `_Em caso de imprevisto entre em contato. Aguardamos você! ✂️_`
      );

      // Individual appointment notifications are disabled.
      // Professionals receive a daily agenda summary at 00:01 instead.

      goTo('SUCCESS');
    } catch (e: any) {
      alert('Erro ao confirmar agendamento. Tente novamente.\n' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading / Error screens ───────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto"></div>
          <p className="text-xs font-black uppercase tracking-widest text-slate-400">Carregando...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4 p-8">
          <div className="text-5xl">💈</div>
          <p className="text-xl font-black text-black uppercase">{error}</p>
          <p className="text-xs font-bold text-slate-400">Verifique o link e tente novamente.</p>
        </div>
      </div>
    );
  }

  // Step labels for breadcrumb
  const stepOrder: Step[] = ['SERVICE', 'DATE', 'BARBER', 'PERIOD', 'TIME', 'INFO'];
  const stepIdx = stepOrder.indexOf(step);

  // ── Theme by niche ───────────────────────────────────────────────
  const isManicure = (tenant?.nicho || '') === 'Manicure/Pedicure';
  const $ = isManicure ? {
    pageBg: 'from-pink-600 via-pink-500 to-pink-400',
    deco: 'bg-pink-500/10',
    headBg: 'bg-pink-500', headBarBg: 'bg-pink-600', headBarFill: 'bg-pink-500',
    headLabel: 'text-pink-400',
    t9: 'text-pink-900', t7: 'text-pink-700', t6: 'text-pink-600',
    t5: 'text-pink-500', t4: 'text-pink-400', t3: 'text-pink-300',
    ght6: 'group-hover:text-pink-600',
    b1: 'border-pink-100', b2: 'border-pink-200', b3: 'border-pink-300', b5: 'border-pink-500',
    hb4: 'hover:border-pink-400', hb5: 'hover:border-pink-500',
    bg5: 'bg-pink-500', bg6: 'bg-pink-600', bg50: 'bg-pink-50', bg1: 'bg-pink-100', bg2: 'bg-pink-200',
    hbg2: 'hover:bg-pink-200', hbg5: 'hover:bg-pink-500', hbg6: 'hover:bg-pink-600', hbg50: 'hover:bg-pink-50',
    hFooter: 'hover:bg-pink-700',
    s2: 'shadow-pink-200/30', s3: 'shadow-pink-300', s9: 'shadow-pink-900/30',
    hs2: 'hover:shadow-pink-200/50', hs3: 'hover:shadow-pink-300/30',
    fb5: 'focus:border-pink-500', ph: 'placeholder-pink-300',
    avGrad: 'from-pink-400 to-pink-600',
    spinB: 'border-pink-200', spinT: 'border-t-pink-500',
    rkMed: 'bg-pink-500/20 text-pink-700', rkDef: 'bg-pink-500/10 text-pink-600',
    starLit: 'text-pink-400', starDim: 'text-pink-900',
    calSel: 'bg-pink-500 text-white shadow-lg shadow-pink-200',
    calToday: 'bg-pink-50 text-pink-500 border border-pink-200',
    calHov: 'hover:bg-pink-50 hover:text-pink-500',
    svcHov: 'hover:border-pink-400 hover:shadow-lg hover:shadow-pink-300/30',
    wizCard: 'border-pink-200 shadow-lg shadow-pink-200/30',
  } : {
    pageBg: 'from-blue-900 via-blue-700 to-blue-600',
    deco: 'bg-blue-500/10',
    headBg: 'bg-blue-800', headBarBg: 'bg-blue-900', headBarFill: 'bg-orange-500',
    headLabel: 'text-blue-300',
    t9: 'text-gray-900', t7: 'text-gray-700', t6: 'text-orange-600',
    t5: 'text-orange-500', t4: 'text-gray-500', t3: 'text-gray-400',
    ght6: 'group-hover:text-orange-600',
    b1: 'border-slate-100', b2: 'border-slate-200', b3: 'border-slate-300', b5: 'border-orange-500',
    hb4: 'hover:border-orange-400', hb5: 'hover:border-orange-500',
    bg5: 'bg-orange-500', bg6: 'bg-orange-600', bg50: 'bg-orange-50', bg1: 'bg-orange-100', bg2: 'bg-slate-200',
    hbg2: 'hover:bg-orange-200', hbg5: 'hover:bg-orange-500', hbg6: 'hover:bg-orange-600', hbg50: 'hover:bg-orange-50',
    hFooter: 'hover:bg-blue-800',
    s2: 'shadow-slate-200/30', s3: 'shadow-orange-300', s9: 'shadow-slate-900/30',
    hs2: 'hover:shadow-orange-200/50', hs3: 'hover:shadow-orange-300/30',
    fb5: 'focus:border-orange-500', ph: 'placeholder-slate-400',
    avGrad: 'from-orange-400 to-orange-600',
    spinB: 'border-slate-200', spinT: 'border-t-orange-500',
    rkMed: 'bg-orange-500/20 text-orange-700', rkDef: 'bg-orange-500/10 text-orange-600',
    starLit: 'text-orange-400', starDim: 'text-slate-300',
    calSel: 'bg-orange-500 text-white shadow-lg shadow-orange-200',
    calToday: 'bg-orange-50 text-orange-500 border border-orange-200',
    calHov: 'hover:bg-orange-50 hover:text-orange-500',
    svcHov: 'hover:border-orange-400 hover:shadow-lg hover:shadow-orange-300/30',
    wizCard: 'border-slate-200 shadow-lg shadow-slate-200/30',
  };

  // Metallic text styles (themed)
  const copperText: React.CSSProperties = isManicure ? {
    background: 'linear-gradient(180deg, #ec4899 0%, #f9a8d4 20%, #db2777 40%, #f472b6 60%, #ec4899 80%, #f9a8d4 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    filter: 'drop-shadow(0 2px 1px rgba(190,24,93,0.3))',
  } : {
    background: 'linear-gradient(180deg, #f97316 0%, #fdba74 20%, #ea580c 40%, #fb923c 60%, #f97316 80%, #fdba74 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    filter: 'drop-shadow(0 2px 1px rgba(0,0,0,0.3))',
  };
  const text3d: React.CSSProperties = isManicure ? {
    textShadow: '0 1px 0 #be185d, 0 2px 0 #9d174d, 0 3px 0 #831843, 0 4px 6px rgba(131,24,67,0.3)',
  } : {
    textShadow: '0 1px 0 #c2410c, 0 2px 0 #9a3412, 0 3px 0 #7c2d12, 0 4px 6px rgba(0,0,0,0.3)',
  };
  const btn3d: React.CSSProperties = isManicure ? {
    background: 'linear-gradient(180deg, #d63384 0%, #c2185b 40%, #ad1457 60%, #880e4f 100%)',
    boxShadow: '0 4px 0 #6a0032, 0 6px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
    transform: 'translateY(-2px)', transition: 'all 0.15s',
  } : {
    background: 'linear-gradient(180deg, #fb923c 0%, #f97316 40%, #ea580c 60%, #c2410c 100%)',
    boxShadow: '0 4px 0 #9a3412, 0 6px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
    transform: 'translateY(-2px)', transition: 'all 0.15s',
  };
  const bronzeRing: React.CSSProperties = isManicure ? {
    background: 'linear-gradient(135deg, #be185d, #ec4899, #f9a8d4, #ec4899, #be185d, #f9a8d4, #be185d)',
    padding: '5px',
    borderRadius: '9999px',
    boxShadow: '0 4px 12px rgba(190,24,93,0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
  } : {
    background: 'linear-gradient(135deg, #c2410c, #f97316, #fdba74, #f97316, #c2410c, #fdba74, #c2410c)',
    padding: '5px',
    borderRadius: '9999px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
  };
  const dividerColor = isManicure ? '#ec4899' : '#f97316';

  return (
    <div className={`min-h-screen bg-gradient-to-b ${$.pageBg} relative`} ref={topRef}>
      {/* Leather texture overlay */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-[0.03]" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
      }} />

      {/* ── STICKY HEADER (wizard steps only) ───────────────────── */}
      {step !== 'SERVICE' && (
        <div className={`${$.headBg} text-white sticky top-0 z-50`}>
          <div className="max-w-lg mx-auto px-6 py-4 flex items-center justify-between">
            <div>
              <p className={`text-[9px] font-black uppercase tracking-[0.3em] ${$.headLabel}`}>{tenant?.name}</p>
            </div>
          </div>
          {step !== 'SUCCESS' && (
            <div className={`h-1 ${$.headBarBg}`}>
              <div className={`h-full ${$.headBarFill} transition-all duration-500`} style={{ width: `${((stepIdx + 1) / stepOrder.length) * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* LANDING PAGE (step === SERVICE)                              */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {step === 'SERVICE' && (
        <div className="animate-fadeIn relative z-10">

          {/* ── HERO ──────────────────────────────────────────────── */}
          <div className="relative min-h-[70vh] flex items-center justify-center overflow-hidden">
            {/* Decorative elements */}
            <div className="absolute top-[-20%] right-[-10%] w-[60vw] h-[60vw] bg-white/10 rounded-full blur-3xl" />
            <div className={`absolute bottom-[-30%] left-[-15%] w-[50vw] h-[50vw] ${$.deco} rounded-full blur-3xl`} />
            <div className="absolute top-10 left-10 w-2 h-2 bg-white/30 rounded-full" />
            <div className="absolute top-20 right-16 w-1.5 h-1.5 bg-white/20 rounded-full" />
            <div className="absolute bottom-32 left-20 w-1 h-1 bg-white/20 rounded-full" />

            <div className="relative z-10 text-center px-6 max-w-lg mx-auto">
              {/* Avatar with bronze frame */}
              <div className={`w-40 h-40 mx-auto mb-6 shadow-2xl ${$.s9}`} style={bronzeRing}>
                <div className={`w-full h-full rounded-full bg-gradient-to-br ${$.avGrad} flex items-center justify-center text-white text-5xl font-black overflow-hidden`}>
                  {((settings as any)?.logoImage || (settings as any)?.heroImage)
                    ? <img src={(settings as any).logoImage || (settings as any).heroImage} alt="" className="w-full h-full object-cover" />
                    : (tenant?.name || 'E').charAt(0).toUpperCase()
                  }
                </div>
              </div>

              {(() => {
                const name = tenant?.name || 'Estabelecimento';
                const lower = name.toLowerCase();
                // Split at common keywords to create two lines
                const splitWords = ['designer', 'barbearia', 'studio', 'estúdio', 'salão', 'espaço', 'ateliê', 'atelier'];
                let line1 = name;
                let line2 = '';
                for (const word of splitWords) {
                  const idx = lower.indexOf(word);
                  if (idx > 0) {
                    line1 = name.slice(0, idx).trim();
                    line2 = name.slice(idx).trim();
                    break;
                  }
                }
                return (
                  <div className="relative">
                    <h1 className="text-4xl sm:text-6xl font-black uppercase tracking-tight leading-none" style={isManicure ? {
                      background: 'linear-gradient(180deg, #fce7f3 0%, #f9a8d4 20%, #f472b6 40%, #f9a8d4 55%, #fce7f3 70%, rgba(255,255,255,0.8) 80%, #fce7f3 85%, #f9a8d4 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text',
                      textShadow: 'none',
                      filter: 'drop-shadow(0 2px 2px rgba(190,24,93,0.5))',
                    } : {
                      background: 'linear-gradient(180deg, #ffffff 0%, #e0e7ff 20%, #bfdbfe 40%, #e0e7ff 55%, #ffffff 70%, rgba(255,255,255,0.8) 80%, #ffffff 85%, #e0e7ff 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text',
                      textShadow: 'none',
                      filter: 'drop-shadow(0 2px 2px rgba(30,58,138,0.5))',
                    }}>
                      {line1}
                    </h1>
                    {line2 && (
                      <p className="text-xl sm:text-2xl font-black uppercase tracking-[0.15em] mt-2" style={isManicure ? {
                        background: 'linear-gradient(180deg, #fce7f3 0%, #f9a8d4 20%, #f472b6 40%, #f9a8d4 55%, #fce7f3 70%, rgba(255,255,255,0.7) 80%, #fce7f3 85%, #f9a8d4 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        filter: 'drop-shadow(0 2px 1px rgba(190,24,93,0.4))',
                      } : {
                        background: 'linear-gradient(180deg, #ffffff 0%, #e0e7ff 20%, #bfdbfe 40%, #e0e7ff 55%, #ffffff 70%, rgba(255,255,255,0.7) 80%, #ffffff 85%, #e0e7ff 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        filter: 'drop-shadow(0 2px 1px rgba(30,58,138,0.4))',
                      }}>
                        {line2}
                      </p>
                    )}
                  </div>
                );
              })()}

              {tenant?.nicho && (
                <p className="text-xs font-bold uppercase tracking-[0.3em] mt-3 text-white/70">{tenant.nicho}</p>
              )}

              {tenantRating && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <div className="flex gap-0.5">
                    {[1,2,3,4,5].map(i => (
                      <span key={i} className={`text-lg ${i <= Math.round(tenantRating.average / 2) ? $.starLit : $.starDim}`}>★</span>
                    ))}
                  </div>
                  <span className={`text-xs font-bold ${$.t7}`}>{tenantRating.average}/10 · {tenantRating.count} avaliações</span>
                </div>
              )}


              {/* Buttons - stacked, same size, 3D */}
              <div className="mt-8 flex flex-col items-center gap-4 w-full max-w-[280px] mx-auto" style={{ perspective: '600px' }}>
                {/* Agendar Agora */}
                <button
                  onClick={() => servicosRef.current?.scrollIntoView({ behavior: 'smooth' })}
                  className="w-full py-4 text-white rounded-full font-black text-sm uppercase tracking-widest transition-all hover:brightness-110 active:translate-y-0 active:shadow-none"
                  style={{...btn3d, transform: 'translateY(-2px) rotateX(2deg)'}}
                >
                  Agendar Agora
                </button>

                {/* Instagram */}
                {(settings as any)?.instagramUsername && (
                  <a
                    href={`https://www.instagram.com/${(settings as any).instagramUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-4 text-white rounded-full font-black text-sm uppercase tracking-widest transition-all hover:brightness-110 flex items-center justify-center gap-2"
                    style={{
                      background: 'linear-gradient(180deg, #e1306c 0%, #c13584 40%, #833ab4 70%, #5851db 100%)',
                      boxShadow: '0 4px 0 #4a2d7a, 0 6px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
                      transform: 'translateY(-2px) rotateX(2deg)',
                    }}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                    Instagram
                  </a>
                )}

                {/* Portfólio */}
                {portfolioPosts.length > 0 && (
                  <button
                    onClick={() => { setPortfolioIdx(0); setPortfolioOpen(true); }}
                    className="w-full py-4 text-white rounded-full font-black text-sm uppercase tracking-widest transition-all hover:brightness-110 flex items-center justify-center gap-2"
                    style={isManicure ? {
                      background: 'linear-gradient(180deg, #ec4899 0%, #db2777 40%, #be185d 70%, #9d174d 100%)',
                      boxShadow: '0 4px 0 #831843, 0 6px 12px rgba(131,24,67,0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
                      transform: 'translateY(-2px) rotateX(2deg)',
                    } : {
                      background: 'linear-gradient(180deg, #3b82f6 0%, #2563eb 40%, #1d4ed8 70%, #1e40af 100%)',
                      boxShadow: '0 4px 0 #1e3a8a, 0 6px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.15)',
                      transform: 'translateY(-2px) rotateX(2deg)',
                    }}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                    Portfólio
                  </button>
                )}

                {/* WhatsApp - smaller, below */}
                {tenant?.phone && (
                  <a
                    href={`https://wa.me/${tenant.phone.replace(/\D/g, '').replace(/^(\d{10,})$/, '55$1')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 px-6 py-2.5 text-white rounded-full text-xs font-black uppercase tracking-wider transition-all hover:brightness-110"
                    style={{
                      background: 'linear-gradient(180deg, #25d366 0%, #1da851 50%, #128c3e 100%)',
                      boxShadow: '0 3px 0 #0d6b2e, 0 5px 10px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.15)',
                      transform: 'translateY(-1px)',
                    }}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.75.75 0 00.917.918l4.458-1.495A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.37 0-4.567-.818-6.303-2.186l-.44-.362-3.102 1.04 1.04-3.102-.362-.44A9.96 9.96 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/></svg>
                    WhatsApp
                  </a>
                )}
              </div>
            </div>

          </div>


          {/* ── PORTFÓLIO ─────────────────────────────────────────── */}
          {portfolioPosts.length > 0 && (
            <div className="py-16">
              <div className="max-w-lg mx-auto px-4">
              <div className="text-center mb-8">
                <p className="text-sm font-black uppercase tracking-[0.3em] text-white/60">Portfólio</p>
                <h2 className="text-3xl font-black uppercase tracking-tight mt-1 text-white" style={text3d}>Nossos Trabalhos</h2>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-[20px] overflow-hidden">
                {portfolioPosts.slice(0, 3).map((post, i) => (
                  <button
                    key={post.id}
                    onClick={() => { setPortfolioIdx(i); setPortfolioOpen(true); }}
                    className={`aspect-square overflow-hidden relative group ${$.bg2} focus:outline-none`}
                  >
                    <img
                      src={post.imageUrl}
                      alt={post.caption || `Post ${i + 1}`}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 flex items-center justify-center">
                      <span className="text-white text-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300">+</span>
                    </div>
                  </button>
                ))}
              </div>

              {portfolioPosts.length > 3 && (
                <button
                  onClick={() => { setPortfolioIdx(0); setPortfolioOpen(true); }}
                  className="mt-4 mx-auto block text-xs font-black text-white/60 uppercase tracking-widest hover:text-white/80 transition-colors"
                >
                  Ver todos ({portfolioPosts.length})
                </button>
              )}
              </div>
            </div>
          )}


          {/* ── SERVIÇOS ──────────────────────────────────────────── */}
          <div ref={servicosRef} className="py-16">
            <div className="max-w-lg mx-auto px-4">
              <div className="text-center mb-8">
                <p className="text-sm font-black uppercase tracking-[0.3em] text-white/60">Agendamento</p>
                <h2 className="text-3xl font-black uppercase tracking-tight mt-1 text-white" style={text3d}>Nossos Serviços</h2>
              </div>

              {services.length === 0 && (
                <p className={`text-center py-10 ${$.t4} text-sm font-bold`}>Nenhum serviço disponível.</p>
              )}

              <div className="space-y-3">
                {services.map(svc => (
                  <button
                    key={svc.id}
                    onClick={() => { setSelectedService(svc); goTo('DATE'); }}
                    className={`w-full bg-white/80 backdrop-blur-sm rounded-2xl p-5 border-2 border-white/40 ${$.svcHov} transition-all text-left group`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className={`font-black ${$.t9} text-sm ${$.ght6} transition-all truncate`}>{svc.name}</p>
                        <p className={`text-[11px] font-bold ${$.t4} mt-1`}>⏱ {svc.durationMinutes} min</p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-4">
                        <p className="text-lg font-black" style={copperText}>R$ {svc.price.toFixed(2)}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>


          {/* ── PROFISSIONAIS ──────────────────────────────────────── */}
          {professionals.length > 1 && (
            <div className="py-16">
              <div className="max-w-lg mx-auto px-4">
                <div className="text-center mb-8">
                  <p className="text-sm font-black uppercase tracking-[0.3em] text-white/60">Equipe</p>
                  <h2 className="text-3xl font-black uppercase tracking-tight mt-1 text-white" style={text3d}>Nossos Profissionais</h2>
                </div>
                <div className="flex flex-wrap justify-center gap-6">
                  {professionals.map(prof => (
                    <div key={prof.id} className="text-center">
                      <div className={`w-16 h-16 mx-auto rounded-full bg-gradient-to-br ${$.avGrad} flex items-center justify-center text-2xl font-black text-white shadow-lg ${$.s3}`}>
                        {prof.name.charAt(0).toUpperCase()}
                      </div>
                      <p className={`text-xs font-black ${$.t9} mt-2`}>{prof.name}</p>
                      {prof.specialty && <p className={`text-[10px] ${$.t5} font-bold`}>{prof.specialty}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}


          {/* ── FOOTER ────────────────────────────────────────────── */}
          <div className="py-10">
            <div className="max-w-lg mx-auto px-4 text-center space-y-4">
              <p className="text-sm font-black uppercase tracking-widest text-white" style={text3d}>{tenant?.name}</p>

              <div className="flex items-center justify-center gap-3">
                {tenant?.phone && (
                  <a
                    href={`https://wa.me/${tenant.phone.replace(/\D/g, '').replace(/^(\d{10,})$/, '55$1')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-9 h-9 rounded-full bg-white/20 hover:bg-green-500 flex items-center justify-center transition-all"
                  >
                    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.75.75 0 00.917.918l4.458-1.495A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.37 0-4.567-.818-6.303-2.186l-.44-.362-3.102 1.04 1.04-3.102-.362-.44A9.96 9.96 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/></svg>
                  </a>
                )}
                {(settings as any)?.instagramUsername && (
                  <a
                    href={`https://www.instagram.com/${(settings as any).instagramUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`w-9 h-9 rounded-full bg-white/20 ${$.hFooter} flex items-center justify-center transition-all`}
                  >
                    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                  </a>
                )}
              </div>

              <div className="pt-4 border-t border-white/15 space-y-3">
                <p className="text-[10px] font-bold text-white/60">
                  Você também é profissional? Conheça o <span className="text-white/90">AgendeZap</span> — o sistema de agendamentos com IA que automatiza seu negócio!
                </p>
                <a
                  href="https://www.agendezap.com.br"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95"
                  style={{ background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)', color: '#fff', boxShadow: '0 4px 15px rgba(249,115,22,0.4)' }}
                >
                  Conhecer o AgendeZap
                </a>
                <p className="text-[8px] font-bold text-white/30 uppercase tracking-widest mt-2">
                  Powered by AgendeZap
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* WIZARD STEPS (DATE, BARBER, PERIOD, TIME, INFO, SUCCESS)     */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <div className="max-w-lg mx-auto px-4 py-8 space-y-6 relative z-10">

        {/* ── SUCCESS ─────────────────────────────────────────────── */}
        {step === 'SUCCESS' && (
          <div className="text-center space-y-8 py-8 animate-fadeIn">
            <div className="text-7xl">✅</div>
            <div>
              <h2 className={`text-2xl font-black ${$.t9} uppercase tracking-tight`}>Agendado!</h2>
              <p className={`text-sm font-bold ${$.t5} mt-2`}>Enviamos a confirmação para o seu WhatsApp.</p>
            </div>
            <div className={`bg-white rounded-[28px] p-8 border-2 ${$.b2} text-left space-y-4 ${$.wizCard}`}>
              <SummaryRow icon="✂️" label="Serviço" value={selectedService?.name} t4={$.t4} t9={$.t9} />
              <SummaryRow icon="📅" label="Dia" value={formatDatePT(selectedDate)} t4={$.t4} t9={$.t9} />
              <SummaryRow icon="⏰" label="Horário" value={selectedTime} t4={$.t4} t9={$.t9} />
              <SummaryRow icon="💈" label="Profissional" value={selectedBarber?.name} t4={$.t4} t9={$.t9} />
            </div>
            <button
              onClick={() => {
                setStep('SERVICE');
                setSelectedService(null); setSelectedDate(''); setSelectedBarber(null);
                setSelectedPeriod(''); setSelectedTime(''); setCustomerName(''); setRawPhone('');
              }}
              className={`w-full py-4 border-2 ${$.b5} ${$.t6} rounded-2xl font-black text-xs uppercase tracking-widest ${$.hbg5} hover:text-white transition-all`}
            >
              Novo Agendamento
            </button>
          </div>
        )}

        {/* ── DATE ────────────────────────────────────────────────── */}
        {step === 'DATE' && (
          <div className="space-y-6 animate-fadeIn">
            <StepHeader step={2} total={6} title="Escolha o Dia" onBack={() => goTo('SERVICE')} th={$} />
            <div className={`bg-white rounded-[28px] p-8 border-2 ${$.wizCard}`}>
              <MiniCalendar value={selectedDate} onChange={d => { setSelectedDate(d); goTo('BARBER'); }} activeDays={activeDays} accent={{ sel: $.calSel, today: $.calToday, hov: $.calHov }} />
            </div>
            {activeDays.size === 0 && (
              <p className={`text-center text-xs font-bold ${$.t4}`}>Horários de funcionamento não configurados.</p>
            )}
          </div>
        )}

        {/* ── BARBER ──────────────────────────────────────────────── */}
        {step === 'BARBER' && (
          <div className="space-y-6 animate-fadeIn">
            <StepHeader step={3} total={6} title="Escolha o Profissional" onBack={() => goTo('DATE')} th={$} />
            <p className={`text-xs font-bold ${$.t5} text-center`}>{formatDatePT(selectedDate)}</p>
            <div className="space-y-3">
              {professionals.map(prof => (
                <button
                  key={prof.id}
                  onClick={() => { setSelectedBarber(prof); goTo('PERIOD'); }}
                  className={`w-full bg-white rounded-[24px] p-6 border-2 ${$.b2} ${$.hb4} hover:shadow-lg ${$.hs2} transition-all flex items-center gap-5 group`}
                >
                  <div className={`w-14 h-14 ${$.bg1} rounded-2xl flex items-center justify-center text-3xl ${$.hbg2} transition-all flex-shrink-0`}>💈</div>
                  <div className="text-left">
                    <p className={`font-black ${$.t9} text-lg ${$.ght6} transition-all`}>{prof.name}</p>
                    {prof.specialty && <p className={`text-xs font-bold ${$.t4}`}>{prof.specialty}</p>}
                  </div>
                  <div className={`ml-auto ${$.t5} font-black text-xl`}>›</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── PERIOD ──────────────────────────────────────────────── */}
        {step === 'PERIOD' && (
          <div className="space-y-6 animate-fadeIn">
            <StepHeader step={4} total={6} title="Escolha o Período" onBack={() => goTo('BARBER')} th={$} />
            <p className={`text-xs font-bold ${$.t5} text-center`}>
              {formatDatePT(selectedDate)} · {selectedBarber?.name}
            </p>

            {loadingSlots && (
              <div className="text-center py-8">
                <div className={`w-8 h-8 border-4 ${$.spinB} ${$.spinT} rounded-full animate-spin mx-auto`}></div>
                <p className={`text-xs font-bold ${$.t4} mt-3 uppercase`}>Verificando horários...</p>
              </div>
            )}

            {!loadingSlots && slots.length === 0 && (
              <div className={`bg-white rounded-[28px] p-8 text-center border-2 ${$.b2}`}>
                <p className="text-3xl mb-3">😕</p>
                <p className={`font-black ${$.t9}`}>Sem horários disponíveis</p>
                <p className={`text-xs font-bold ${$.t4} mt-1`}>Escolha outro dia ou profissional.</p>
                <button onClick={() => goTo('DATE')} className={`mt-5 px-6 py-3 ${$.bg5} text-white rounded-2xl font-black text-xs uppercase tracking-widest ${$.hbg6} transition-all`}>
                  Trocar Dia
                </button>
              </div>
            )}

            {!loadingSlots && slots.length > 0 && (
              <div className="space-y-3">
                {PERIODS.map(p => {
                  const count = slotsInPeriod(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedPeriod(p.id); goTo('TIME'); }}
                      disabled={count === 0}
                      className={`w-full bg-white rounded-[24px] p-6 border-2 transition-all text-left ${
                        count > 0
                          ? `${$.b2} ${$.hb4} hover:shadow-lg ${$.hs2}`
                          : `${$.b1} opacity-40 cursor-not-allowed`
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <span className="text-3xl">{p.emoji}</span>
                          <div>
                            <p className={`font-black ${$.t9} text-lg`}>{p.label}</p>
                            <p className={`text-xs font-bold ${$.t4}`}>{count > 0 ? `${count} horário${count !== 1 ? 's' : ''} disponível` : 'Sem horários'}</p>
                          </div>
                        </div>
                        {count > 0 && <div className={`${$.t5} font-black text-xl`}>›</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── TIME ────────────────────────────────────────────────── */}
        {step === 'TIME' && (
          <div className="space-y-6 animate-fadeIn">
            <StepHeader step={5} total={6} title="Escolha o Horário" onBack={() => goTo('PERIOD')} th={$} />
            <p className={`text-xs font-bold ${$.t5} text-center`}>
              {formatDatePT(selectedDate)} · {selectedBarber?.name} · {PERIODS.find(p => p.id === selectedPeriod)?.label}
            </p>

            <div className="grid grid-cols-3 gap-3">
              {filteredSlots.map(time => (
                <button
                  key={time}
                  onClick={() => { setSelectedTime(time); goTo('INFO'); }}
                  className={`bg-white border-2 ${$.b2} rounded-2xl py-4 font-black text-sm ${$.t9} ${$.hb4} ${$.hbg50} ${$.ht6} hover:shadow-lg ${$.hs2} transition-all`}
                >
                  {time}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── INFO ────────────────────────────────────────────────── */}
        {step === 'INFO' && (
          <div className="space-y-6 animate-fadeIn">
            <StepHeader step={6} total={6} title="Seus Dados" onBack={() => goTo('TIME')} th={$} />

            {/* Summary card */}
            <div className={`${$.bg50} rounded-[24px] p-6 border-2 ${$.b2} space-y-2`}>
              <SummaryRow icon="✂️" label="Serviço" value={selectedService?.name} small t4={$.t4} t9={$.t9} />
              <SummaryRow icon="📅" label="Dia" value={formatDatePT(selectedDate)} small t4={$.t4} t9={$.t9} />
              <SummaryRow icon="⏰" label="Horário" value={selectedTime} small t4={$.t4} t9={$.t9} />
              <SummaryRow icon="💈" label="Profissional" value={selectedBarber?.name} small t4={$.t4} t9={$.t9} />
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className={`text-[10px] font-black ${$.t5} uppercase tracking-widest ml-2`}>Seu Nome</label>
                <input
                  type="text"
                  placeholder="Nome completo"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  className={`w-full px-5 py-4 bg-white border-2 ${$.b2} rounded-2xl font-bold ${$.t9} ${$.ph} outline-none ${$.fb5} transition-all`}
                />
              </div>

              <div className="space-y-2">
                <label className={`text-[10px] font-black ${$.t5} uppercase tracking-widest ml-2`}>WhatsApp</label>
                <input
                  type="tel"
                  placeholder="(DDD) 99999-9999"
                  value={maskPhone(rawPhone)}
                  onChange={e => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 11);
                    setRawPhone(digits);
                  }}
                  className={`w-full px-5 py-4 bg-white border-2 ${$.b2} rounded-2xl font-bold ${$.t9} ${$.ph} outline-none ${$.fb5} transition-all`}
                />
                <p className={`text-[9px] font-bold ${$.t4} ml-2`}>A confirmação será enviada neste número.</p>
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting || !customerName.trim() || rawPhone.replace(/\D/g,'').length < 10}
              className={`w-full py-5 ${$.bg5} text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl ${$.s3} ${$.hbg6} hover:scale-[1.02] transition-all disabled:opacity-40 disabled:scale-100 disabled:shadow-none`}
            >
              {submitting ? 'Confirmando...' : '✅ Confirmar Agendamento'}
            </button>
          </div>
        )}
      </div>


      {/* ── LIGHTBOX ──────────────────────────────────────────── */}
      {portfolioOpen && portfolioPosts.length > 0 && (
        <div
          className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center"
          onClick={() => setPortfolioOpen(false)}
          onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }}
          onTouchEnd={e => {
            const delta = e.changedTouches[0].clientX - touchStartX.current;
            if (delta > 50 && portfolioIdx > 0) setPortfolioIdx(i => i - 1);
            if (delta < -50 && portfolioIdx < portfolioPosts.length - 1) setPortfolioIdx(i => i + 1);
          }}
        >
          <button
            onClick={() => setPortfolioOpen(false)}
            className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full text-white text-xl flex items-center justify-center transition-all z-10"
          >
            &times;
          </button>

          {portfolioIdx > 0 && (
            <button
              onClick={e => { e.stopPropagation(); setPortfolioIdx(i => i - 1); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full text-white text-xl flex items-center justify-center transition-all z-10"
            >
              ‹
            </button>
          )}

          {portfolioIdx < portfolioPosts.length - 1 && (
            <button
              onClick={e => { e.stopPropagation(); setPortfolioIdx(i => i + 1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full text-white text-xl flex items-center justify-center transition-all z-10"
            >
              ›
            </button>
          )}

          <div className="max-w-sm w-full mx-4 animate-scaleUp" onClick={e => e.stopPropagation()}>
            <img
              src={portfolioPosts[portfolioIdx].imageUrl}
              alt={portfolioPosts[portfolioIdx].caption || ''}
              className="w-full max-h-[70vh] object-contain rounded-2xl"
            />
            {portfolioPosts[portfolioIdx].caption && (
              <p className="text-white text-sm font-bold mt-3 text-center px-4 leading-relaxed">
                {portfolioPosts[portfolioIdx].caption}
              </p>
            )}
            {portfolioPosts.length > 1 && (
              <p className="text-white/50 text-xs text-center mt-3 font-bold">
                {portfolioIdx + 1} / {portfolioPosts.length}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Helper sub-components ─────────────────────────────────────────────
const StepHeader: React.FC<{ step: number; total: number; title: string; onBack?: () => void; th?: { t4: string; t5: string; t9: string; b3: string; hb5: string; ht6?: string } }> = ({ step, total, title, onBack, th }) => (
  <div className="flex items-center gap-4">
    {onBack && (
      <button onClick={onBack} className={`w-10 h-10 rounded-2xl border-2 ${th?.b3 || 'border-pink-300'} flex items-center justify-center ${th?.t5 || 'text-pink-500'} ${th?.hb5 || 'hover:border-pink-500'} hover:text-pink-600 transition-all font-black text-lg flex-shrink-0`}>
        ‹
      </button>
    )}
    <div className="flex-1">
      <p className={`text-[9px] font-black ${th?.t4 || 'text-pink-400'} uppercase tracking-widest`}>Passo {step} de {total}</p>
      <h2 className={`text-2xl font-black ${th?.t9 || 'text-pink-900'} uppercase tracking-tight leading-tight`}>{title}</h2>
    </div>
  </div>
);

const SummaryRow: React.FC<{ icon: string; label: string; value: string; small?: boolean; t4?: string; t9?: string }> = ({ icon, label, value, small, t4, t9 }) => (
  <div className="flex items-center gap-3">
    <span className={small ? 'text-base' : 'text-xl'}>{icon}</span>
    <div className="flex-1 min-w-0">
      <span className={`font-black ${t4 || 'text-pink-400'} uppercase tracking-widest ${small ? 'text-[9px]' : 'text-[10px]'}`}>{label}: </span>
      <span className={`font-black ${t9 || 'text-pink-900'} ${small ? 'text-xs' : 'text-sm'}`}>{value}</span>
    </div>
  </div>
);

export default BookingPage;
