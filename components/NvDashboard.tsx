import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../services/mockDb';
import { Appointment, AppointmentStatus, Customer, Professional, Service } from '../types';

// ── Painel inicial do NOVO VISUAL (só aparece com html.nv) ──────────────────
// Mesma regra de faturamento do Dashboard antigo: atendimentos FINALIZADOS,
// sem plano, somando amountPaid.

type Period = 'hoje' | '7d' | 'mes';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: v % 1 === 0 ? 0 : 2 });
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const STATUS: Record<string, [string, string, string]> = {
  PENDING:   ['Aguardando', '#FEF3C7', '#92400E'],
  CONFIRMED: ['Confirmado', '#DCFCE7', '#166534'],
  ARRIVED:   ['Chegou',     '#DBEAFE', '#1E40AF'],
  FINISHED:  ['Finalizado', '#F4F4F5', '#3F3F46'],
  NO_SHOW:   ['Faltou',     '#FEE2E2', '#991B1B'],
};

const isRevenue = (a: Appointment) => a.status === AppointmentStatus.FINISHED && !a.isPlan;
const revenueOf = (list: Appointment[]) => list.filter(isRevenue).reduce((s, a) => s + (a.amountPaid || 0), 0);

const NvDashboard: React.FC<{ tenantId: string; tenantName?: string; onNavigate?: (view: string) => void; refreshTicker?: number }> = ({
  tenantId, tenantName, onNavigate, refreshTicker = 0,
}) => {
  const [loading, setLoading] = useState(true);
  const firstLoad = useRef(true);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [monthlyGoal, setMonthlyGoal] = useState(0);
  const [period, setPeriod] = useState<Period>('mes');
  const [hoverBar, setHoverBar] = useState(13);

  useEffect(() => {
    (async () => {
      if (firstLoad.current) setLoading(true);
      try {
        const [a, c, s, p, st] = await Promise.all([
          db.getAppointments(tenantId),
          db.getCustomers(tenantId),
          db.getServices(tenantId),
          db.getProfessionals(tenantId),
          db.getSettings(tenantId),
        ]);
        setAppointments(a); setCustomers(c); setServices(s); setProfessionals(p);
        setMonthlyGoal(Number((st as any)?.monthlyRevenueGoal || 0));
      } catch (e) {
        console.error('[NvDashboard] erro ao carregar', e);
      } finally {
        firstLoad.current = false;
        setLoading(false);
      }
    })();
  }, [tenantId, refreshTicker]);

  const now = new Date();
  const today0 = startOfDay(now);
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  const data = useMemo(() => {
    const active = appointments.filter(a => a.startTime && a.status !== AppointmentStatus.CANCELLED);
    const between = (s: Date, e: Date) => active.filter(a => { const d = new Date(a.startTime); return d >= s && d < e; });

    // períodos: atual × anterior equivalente
    let curS: Date, curE: Date, prevS: Date, prevE: Date, prevLabel: string;
    if (period === 'hoje') {
      curS = today0; curE = addDays(today0, 1);
      prevS = addDays(today0, -7); prevE = addDays(today0, -6); prevLabel = 'mesmo dia da semana passada';
    } else if (period === '7d') {
      curS = addDays(today0, -6); curE = addDays(today0, 1);
      prevS = addDays(today0, -13); prevE = addDays(today0, -6); prevLabel = '7 dias anteriores';
    } else {
      curS = new Date(now.getFullYear(), now.getMonth(), 1); curE = addDays(today0, 1);
      prevS = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      prevE = addDays(prevS, Math.round((curE.getTime() - curS.getTime()) / 864e5));
      prevLabel = 'mesmo período do mês passado';
    }
    const cur = between(curS, curE), prev = between(prevS, prevE);
    const curRev = revenueOf(cur), prevRev = revenueOf(prev);
    const curDone = cur.filter(a => a.status === AppointmentStatus.FINISHED).length;
    const prevDone = prev.filter(a => a.status === AppointmentStatus.FINISHED).length;
    const paidCount = cur.filter(a => isRevenue(a) && (a.amountPaid || 0) > 0).length;
    const prevPaid = prev.filter(a => isRevenue(a) && (a.amountPaid || 0) > 0).length;
    const ticket = paidCount ? curRev / paidCount : 0;
    const prevTicket = prevPaid ? prevRev / prevPaid : 0;

    // clientes recorrentes: atendidos no período que já tinham vindo antes (dentro dos 90 dias carregados)
    const doneBefore = new Set(active.filter(a => a.status === AppointmentStatus.FINISHED && new Date(a.startTime) < curS).map(a => a.customer_id));
    const curCusts = [...new Set(cur.filter(a => a.status === AppointmentStatus.FINISHED).map(a => a.customer_id))];
    const returning = curCusts.length ? Math.round(curCusts.filter(id => doneBefore.has(id)).length / curCusts.length * 100) : 0;

    const delta = (c: number, p: number) => {
      if (!p) return { text: c ? 'sem base de comparação' : 'sem movimento ainda', tone: 'neutral' as const };
      const pct = Math.round((c - p) / p * 100);
      if (pct === 0) return { text: `igual ao ${prevLabel}`, tone: 'neutral' as const };
      return { text: `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs. ${prevLabel}`, tone: pct > 0 ? 'good' as const : 'bad' as const };
    };

    const goalPct = period === 'mes' && monthlyGoal > 0 ? Math.round(curRev / monthlyGoal * 100) : null;

    const kpis = [
      { label: period === 'hoje' ? 'Faturamento hoje' : period === '7d' ? 'Faturamento — 7 dias' : 'Faturamento do mês', value: brl(curRev),
        sub: goalPct !== null ? { text: `${goalPct}% da meta de ${brl(monthlyGoal)}`, tone: goalPct >= 100 ? 'good' as const : 'neutral' as const } : delta(curRev, prevRev) },
      { label: 'Atendimentos finalizados', value: String(curDone), sub: delta(curDone, prevDone) },
      { label: 'Ticket médio', value: brl(Math.round(ticket * 100) / 100), sub: delta(ticket, prevTicket) },
      { label: 'Clientes que voltaram', value: `${returning}%`, sub: { text: 'já tinham vindo antes', tone: 'neutral' as const } },
    ];

    // gráfico: faturamento por dia, últimos 14 dias
    const bars = Array.from({ length: 14 }, (_, i) => {
      const d = addDays(today0, i - 13);
      const v = revenueOf(between(d, addDays(d, 1)));
      return { d, v, label: pad(d.getDate()) };
    });
    const maxBar = Math.max(...bars.map(b => b.v), 1);
    const step = maxBar > 2000 ? 1000 : maxBar > 800 ? 400 : maxBar > 300 ? 100 : 50;
    const axisMax = Math.ceil(maxBar / step) * step;

    // hoje
    const todayList = between(today0, addDays(today0, 1)).sort((x, y) => x.startTime.localeCompare(y.startTime));
    const upcoming = todayList.filter(a => new Date(a.startTime).getTime() >= now.getTime() - 15 * 60000 && a.status !== AppointmentStatus.FINISHED && a.status !== AppointmentStatus.NO_SHOW);
    const todayShow = (upcoming.length ? upcoming : todayList).slice(0, 5);

    // alertas
    const alerts: { title: string; text: string; view: string; tone: 'amber' | 'blue' | 'red' }[] = [];
    const pendingToday = upcoming.filter(a => a.status === AppointmentStatus.PENDING);
    if (pendingToday.length) {
      const first = new Date(pendingToday[0].startTime), last = new Date(pendingToday[pendingToday.length - 1].startTime);
      alerts.push({ title: `${pendingToday.length} ${pendingToday.length === 1 ? 'agendamento aguardando' : 'agendamentos aguardando'} confirmação`,
        text: pendingToday.length === 1 ? `Hoje às ${hhmm(first)}` : `Hoje entre ${hhmm(first)} e ${hhmm(last)}`, view: 'AGENDAMENTOS', tone: 'amber' });
    }
    const lastVisit = new Map<string, number>();
    const hasFuture = new Set<string>();
    active.forEach(a => {
      const t = new Date(a.startTime).getTime();
      if (a.status === AppointmentStatus.FINISHED) lastVisit.set(a.customer_id, Math.max(lastVisit.get(a.customer_id) || 0, t));
      if (t > now.getTime()) hasFuture.add(a.customer_id);
    });
    const gone = [...lastVisit.entries()].filter(([id, t]) => !hasFuture.has(id) && (now.getTime() - t) / 864e5 >= 45).length;
    if (gone) alerts.push({ title: `${gone} ${gone === 1 ? 'cliente sem voltar' : 'clientes sem voltar'} há mais de 45 dias`, text: 'Envie uma mensagem de retorno', view: 'FOLLOW_UP', tone: 'blue' });
    const last7 = revenueOf(between(addDays(today0, -7), today0));
    const prev7 = revenueOf(between(addDays(today0, -14), addDays(today0, -7)));
    if (prev7 > 0 && last7 < prev7 * 0.8) {
      alerts.push({ title: 'Queda de movimento', text: `Faturamento dos últimos 7 dias caiu ${Math.round((1 - last7 / prev7) * 100)}% em relação à semana anterior`, view: 'FINANCEIRO', tone: 'red' });
    }

    // faturamento por profissional (período)
    const ranking = professionals
      .map(p => ({ name: p.name, rev: revenueOf(cur.filter(a => a.professional_id === p.id)) }))
      .filter(r => r.rev > 0)
      .sort((x, y) => y.rev - x.rev)
      .slice(0, 5);

    return { kpis, bars, axisMax, todayShow, alerts, ranking };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, professionals, period, monthlyGoal]);

  const custName = (id: string) => customers.find(c => c.id === id)?.name || '—';
  const svcName = (id: string) => services.find(s => s.id === id)?.name || '';
  const proName = (id: string) => professionals.find(p => p.id === id)?.name?.split(' ')[0] || '';
  const go = (view: string) => onNavigate?.(view);
  const toneColor = { good: '#166534', bad: '#991B1B', neutral: '#52525B' } as const;
  const alertTone = {
    amber: { bg: '#FEF3C7', fg: '#92400E', icon: 'M12 8v4l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z' },
    blue:  { bg: '#E0F2FE', fg: '#075985', icon: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15' },
    red:   { bg: '#FEE2E2', fg: '#991B1B', icon: 'M3 17l6-6 4 4 8-8M14 7h7v7' },
  } as const;
  const poppins = { fontFamily: 'Poppins, Inter, sans-serif' };
  const hb = data.bars[Math.min(hoverBar, data.bars.length - 1)];
  const maxRank = data.ranking[0]?.rev || 1;

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-14 w-72 rounded-xl bg-slate-100" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-slate-100" />)}</div>
        <div className="h-72 rounded-xl bg-slate-100" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500 first-letter:uppercase">{now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="text-2xl font-semibold text-black" style={poppins}>{greeting}{tenantName ? `, ${tenantName}` : ''}</h1>
        </div>
        <div role="group" aria-label="Período" className="flex bg-white border border-slate-200 rounded-xl p-1 gap-0.5">
          {([['hoje', 'Hoje'], ['7d', '7 dias'], ['mes', 'Este mês']] as [Period, string][]).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setPeriod(k)}
              className={`h-9 px-4 rounded-lg text-sm font-medium transition-colors ${period === k ? 'bg-black text-white' : 'text-slate-500 hover:text-black'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {data.kpis.map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-1.5">
            <span className="text-[13px] text-slate-500">{k.label}</span>
            <span className="text-2xl font-semibold text-black" style={poppins}>{k.value}</span>
            <span className="text-[13px] font-medium" style={{ color: toneColor[k.sub.tone] }}>{k.sub.text}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col xl:flex-row gap-4 items-stretch">
        {/* Gráfico */}
        <section aria-label="Faturamento por dia" className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-black">Faturamento por dia — últimos 14 dias</h2>
            <span className="text-[13px] text-slate-500">{pad(hb.d.getDate())}/{pad(hb.d.getMonth() + 1)} · {hb.v ? brl(hb.v) : 'sem faturamento'}</span>
          </div>
          <div className="flex gap-2.5">
            <div className="flex flex-col justify-between h-[200px] w-14 shrink-0 text-right text-xs text-slate-500">
              {[1, 2 / 3, 1 / 3, 0].map(f => <span key={f}>{brl(Math.round(data.axisMax * f))}</span>)}
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <div className="relative h-[200px] flex items-end gap-0.5"
                style={{ backgroundImage: 'linear-gradient(#F0EFED 1px, transparent 1px)', backgroundSize: '100% 66.66px' }}>
                {data.bars.map((b, i) => (
                  <button key={i} type="button" aria-label={`${pad(b.d.getDate())}/${pad(b.d.getMonth() + 1)}: ${b.v ? brl(b.v) : 'sem faturamento'}`}
                    onMouseEnter={() => setHoverBar(i)} onFocus={() => setHoverBar(i)}
                    className="flex-1 h-full flex items-end px-[3px] cursor-default">
                    <span className="block w-full max-w-[22px] mx-auto rounded-t"
                      style={{ height: `${b.v ? Math.max(2, b.v / data.axisMax * 100) : 0}%`, background: i === hoverBar ? '#9A3412' : '#EA580C' }} />
                  </button>
                ))}
              </div>
              <div className="flex gap-0.5">
                {data.bars.map((b, i) => <span key={i} className="flex-1 text-center text-[11px] text-slate-500">{b.label}</span>)}
              </div>
            </div>
          </div>
        </section>

        {/* Precisa da sua atenção */}
        <section className="w-full xl:w-[340px] shrink-0 bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold text-black">Precisa da sua atenção</h2>
          {data.alerts.length === 0 && <p className="text-[13px] text-slate-500">Tudo em dia por aqui.</p>}
          {data.alerts.map(al => {
            const t = alertTone[al.tone];
            return (
              <button key={al.title} type="button" onClick={() => go(al.view)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100 text-left hover:border-slate-300 transition-colors min-h-[44px]">
                <span className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center" style={{ background: t.bg, color: t.fg }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.icon} /></svg>
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-black">{al.title}</span>
                  <span className="block text-[13px] text-slate-500">{al.text}</span>
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#71717A" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            );
          })}
        </section>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-stretch">
        {/* Hoje */}
        <section className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-1">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-[15px] font-semibold text-black">Hoje</h2>
            <button type="button" onClick={() => go('AGENDAMENTOS')} className="text-sm font-medium text-orange-600 hover:underline">Ver agenda</button>
          </div>
          {data.todayShow.length === 0 && <p className="text-[13px] text-slate-500 py-2">Nenhum atendimento marcado para hoje.</p>}
          {data.todayShow.map(a => {
            const st = STATUS[a.status];
            return (
              <div key={a.id} className="flex items-center gap-3.5 py-2.5 border-t border-slate-100">
                <span className="w-12 shrink-0 text-[15px] font-semibold text-black" style={poppins}>{hhmm(new Date(a.startTime))}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-black truncate">{custName(a.customer_id)}</span>
                  <span className="block text-[13px] text-slate-500 truncate">{[svcName(a.service_id), proName(a.professional_id)].filter(Boolean).join(' · ')}</span>
                </span>
                {st && <span className="text-xs font-semibold px-2 py-0.5 rounded-md whitespace-nowrap" style={{ background: st[1], color: st[2] }}>{st[0]}</span>}
              </div>
            );
          })}
        </section>

        {/* Faturamento por profissional */}
        <section className="w-full lg:w-[380px] shrink-0 bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-3.5">
          <h2 className="text-[15px] font-semibold text-black">
            Faturamento por profissional — {period === 'hoje' ? 'hoje' : period === '7d' ? '7 dias' : 'mês'}
          </h2>
          {data.ranking.length === 0 && <p className="text-[13px] text-slate-500">Nenhum atendimento finalizado no período.</p>}
          {data.ranking.map(r => (
            <div key={r.name} className="flex flex-col gap-1.5">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-black">{r.name}</span>
                <span className="text-slate-600">{brl(r.rev)}</span>
              </div>
              <div className="h-2 rounded bg-slate-100">
                <div className="h-2 rounded" style={{ width: `${Math.max(3, r.rev / maxRank * 100)}%`, background: '#3F3F46' }} />
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
};

export default NvDashboard;
