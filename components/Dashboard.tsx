
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { AppointmentStatus, Professional, Service, Customer } from '../types';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, CartesianGrid
} from 'recharts';

const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Read accent color from CSS variable (supports per-niche themes)
function useAccent() {
  const [accent, setAccent] = React.useState('#f97316');
  React.useEffect(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    if (v) setAccent(v);
  }, []);
  return accent;
}
const DONUT_COLORS_ORANGE = ['#f97316', '#fb923c', '#fdba74', '#fed7aa', '#ffedd5'];
const DONUT_COLORS_PINK = ['#ec4899', '#f472b6', '#f9a8d4', '#fbcfe8', '#fce7f3'];
const DAY_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Animated counter
const AnimatedNumber: React.FC<{ value: number; prefix?: string; suffix?: string }> = ({ value, prefix = '', suffix = '' }) => {
  const [display, setDisplay] = React.useState(0);
  React.useEffect(() => {
    if (value === 0) { setDisplay(0); return; }
    let start = 0;
    const step = Math.ceil(value / 20);
    const t = setInterval(() => {
      start = Math.min(start + step, value);
      setDisplay(start);
      if (start >= value) clearInterval(t);
    }, 30);
    return () => clearInterval(t);
  }, [value]);
  return <span className="animate-countUp">{prefix}{display}{suffix}</span>;
};

const QUOTES = [
  'Cada cliente é uma oportunidade de fazer a diferença.',
  'O sucesso é a soma de pequenos esforços repetidos dia após dia.',
  'Seu talento é o seu maior investimento.',
  'Hoje é o dia perfeito para superar suas metas.',
  'Grandes resultados começam com pequenas atitudes.',
  'A excelência não é um ato, é um hábito.',
  'Faça do seu trabalho a sua obra-prima.',
  'Cada atendimento é uma chance de fidelizar.',
  'O profissionalismo é o que transforma clientes em fãs.',
  'Sua dedicação de hoje constrói o sucesso de amanhã.',
  'Quem ama o que faz, faz com excelência.',
  'A consistência vence o talento quando o talento não é consistente.',
  'Construa sua reputação um cliente de cada vez.',
  'O melhor marketing é um cliente satisfeito.',
  'Acredite no seu potencial — seus resultados provam.',
  'Disciplina é a ponte entre metas e conquistas.',
  'Seu diferencial é a forma como você trata cada pessoa.',
  'Não espere oportunidades, crie-as.',
  'A qualidade do seu serviço define o tamanho do seu futuro.',
  'Mais um dia para brilhar. Vamos com tudo!',
  'Trabalhe em silêncio, deixe os resultados falarem.',
  'O segredo do sucesso? Nunca parar de melhorar.',
  'Transforme cada desafio em combustível para crescer.',
  'A atitude certa abre portas que o talento sozinho não abre.',
  'Clientes voltam por causa de experiências, não só serviços.',
  'Você não precisa ser perfeito, precisa ser comprometido.',
  'Pequenos detalhes fazem grandes profissionais.',
  'Seu melhor concorrente é quem você era ontem.',
  'Comece cada dia com propósito e termine com orgulho.',
  'A persistência é o caminho mais curto para o sucesso.',
  'Faça hoje o que outros não querem, conquiste amanhã o que outros não podem.',
];

const DICAS_SAUDE = [
  'Beba pelo menos 2 litros de água hoje. Seu corpo e sua mente funcionam melhor hidratados.',
  'Levante e alongue o corpo a cada 2 horas. Sua coluna agradece no final do expediente.',
  'Durma de 7 a 8 horas por noite. Sono de qualidade é o melhor investimento em produtividade.',
  'Respire fundo por 1 minuto antes de começar o dia. Reduz ansiedade e melhora o foco.',
  'Cuide da sua postura enquanto trabalha. Ombros para trás, coluna reta.',
  'Faça uma pausa de 10 minutos para um lanche saudável. Frutas e castanhas são ótimas opções.',
  'Evite o celular 30 minutos antes de dormir. A luz azul prejudica a qualidade do sono.',
  'Caminhe pelo menos 30 minutos hoje. Movimento é remédio para o corpo e para a mente.',
  'Pratique gratidão: pense em 3 coisas boas que aconteceram hoje antes de dormir.',
  'Reduza o açúcar refinado. Energia constante vale mais que picos de disposição.',
  'Reserve um momento do dia só para você. Autocuidado não é luxo, é necessidade.',
  'Proteja seus ouvidos em ambientes barulhentos. Audição perdida não volta.',
  'Cuide das suas mãos — são sua ferramenta de trabalho. Hidrate e descanse elas.',
  'Ria mais. O humor reduz cortisol e fortalece o sistema imunológico.',
  'Não pule refeições. Seu cérebro precisa de combustível para tomar boas decisões.',
  'Tome sol por 15 minutos pela manhã. Vitamina D melhora humor e imunidade.',
  'Reduza a cafeína depois das 14h. Seu sono à noite será muito melhor.',
  'Faça exercícios de respiração entre um atendimento e outro. Três respirações profundas bastam.',
  'Mantenha um hobby fora do trabalho. Equilíbrio mental melhora tudo na vida.',
  'Cuide da saúde mental tanto quanto da física. Terapia é manutenção, não conserto.',
  'Troque o elevador pela escada quando puder. Pequenos hábitos geram grandes resultados.',
  'Evite comparações nas redes sociais. Cuide do seu progresso no seu ritmo.',
  'Alongue o pescoço e os ombros agora. Tensão acumulada causa dores de cabeça.',
  'Planeje suas refeições da semana. Alimentação organizada é alimentação saudável.',
  'Sorria para o espelho toda manhã. Parece bobo, mas muda o tom do seu dia.',
  'Desconecte-se por pelo menos 1 hora por dia. Silêncio digital é saúde mental.',
  'Pratique alguma atividade que te dê prazer fora do trabalho. Corpo ativo, mente leve.',
  'Não deixe de fazer check-ups anuais. Prevenção é sempre mais fácil que tratamento.',
  'Mantenha seu ambiente de trabalho limpo e organizado. Espaço limpo, mente clara.',
  'Celebre suas pequenas vitórias. Reconhecer seu progresso alimenta a motivação.',
];

const weatherLabel = (code: number): string => {
  if (code === 0) return 'Ceu limpo';
  if (code <= 3) return 'Nublado';
  if (code <= 48) return 'Nevoeiro';
  if (code <= 57) return 'Garoa';
  if (code <= 67) return 'Chuva';
  if (code <= 77) return 'Neve';
  if (code <= 82) return 'Pancadas';
  if (code <= 86) return 'Neve forte';
  return 'Tempestade';
};

const Dashboard: React.FC<{ tenantId: string; tenantName?: string; onNavigate?: (view: string) => void }> = ({ tenantId, tenantName, onNavigate }) => {
  const accent = useAccent();
  const isPink = accent.includes('ec4899') || accent.includes('pink');
  const DONUT_COLORS = isPink ? DONUT_COLORS_PINK : DONUT_COLORS_ORANGE;
  const [loading, setLoading] = useState(true);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({});
  const [selectedProfId, setSelectedProfId] = useState<string>('');
  const [period, setPeriod] = useState(30);
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null);
  const [weatherCity, setWeatherCity] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [p, a, s, c, e, st, tenant] = await Promise.all([
          db.getProfessionals(tenantId),
          db.getAppointments(tenantId),
          db.getServices(tenantId),
          db.getCustomers(tenantId),
          db.getExpenses(tenantId),
          db.getSettings(tenantId),
          db.getTenant(tenantId),
        ]);
        setProfessionals(p);
        setAppointments(a);
        setServices(s);
        setCustomers(c);
        setExpenses(e);
        setSettings(st);

        // Fetch weather if tenant has coordinates
        if (tenant?.latitude && tenant?.longitude) {
          setWeatherCity(tenant.cidade || '');
          try {
            const wr = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${tenant.latitude}&longitude=${tenant.longitude}&current=temperature_2m,weather_code&timezone=America/Sao_Paulo`);
            const wd = await wr.json();
            if (wd?.current) {
              setWeather({ temp: Math.round(wd.current.temperature_2m), code: wd.current.weather_code });
            }
          } catch { /* weather is optional */ }
        }
      } catch (err) {
        console.error('Erro ao carregar dashboard:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [tenantId]);

  const now = new Date();
  const periodStart = new Date(now);
  periodStart.setDate(periodStart.getDate() - period);
  const prevStart = new Date(periodStart);
  prevStart.setDate(prevStart.getDate() - period);

  const inRange = (a: any, s: Date, e: Date) => {
    const d = new Date(a.startTime);
    return d >= s && d <= e;
  };
  const byProf = (a: any) => !selectedProfId || a.professional_id === selectedProfId;

  const curAppts = appointments.filter(a => inRange(a, periodStart, now) && byProf(a));
  const prevAppts = appointments.filter(a => inRange(a, prevStart, periodStart) && byProf(a));

  const curRevenue = curAppts
    .filter(a => a.status === AppointmentStatus.FINISHED && !a.isPlan)
    .reduce((s, a) => s + (a.amountPaid || 0), 0);
  const prevRevenue = prevAppts
    .filter(a => a.status === AppointmentStatus.FINISHED && !a.isPlan)
    .reduce((s, a) => s + (a.amountPaid || 0), 0);

  const revTrend = prevRevenue > 0 ? ((curRevenue - prevRevenue) / prevRevenue * 100) : 0;
  const apptTrend = prevAppts.length > 0 ? ((curAppts.length - prevAppts.length) / prevAppts.length * 100) : 0;

  // ── New strategic KPIs ────────────────────────────────────────────────────

  // Meta mensal da barbearia
  const monthlyGoal: number = settings.monthlyRevenueGoal || 0;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthRevenue = appointments
    .filter(a => new Date(a.startTime) >= monthStart && new Date(a.startTime) <= now && byProf(a) && a.status === AppointmentStatus.FINISHED && !a.isPlan)
    .reduce((s, a) => s + (a.amountPaid || 0), 0);
  const goalPct = monthlyGoal > 0 ? Math.min(100, Math.round((thisMonthRevenue / monthlyGoal) * 100)) : 0;

  // Projeção de faturamento (média diária × dias do mês)
  const daysPassed = Math.max(1, now.getDate());
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dailyAvg = thisMonthRevenue / daysPassed;
  const projection = dailyAvg * daysInMonth;

  // Margem real do mês
  const thisMonthExpenses = expenses
    .filter(e => {
      const d = (e.date || '').split('T')[0];
      return d >= monthStart.toISOString().split('T')[0] && d <= now.toISOString().split('T')[0];
    })
    .reduce((s, e) => s + (e.amount || 0), 0);
  const margin = thisMonthRevenue > 0 ? ((thisMonthRevenue - thisMonthExpenses) / thisMonthRevenue * 100) : 0;

  // Dia mais forte da semana (last 30 days, FINISHED)
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const revByDay: Record<number, number> = {};
  appointments
    .filter(a => new Date(a.startTime) >= thirtyDaysAgo && a.status === AppointmentStatus.FINISHED && !a.isPlan && byProf(a))
    .forEach(a => {
      const dow = new Date(a.startTime).getDay();
      revByDay[dow] = (revByDay[dow] || 0) + (a.amountPaid || 0);
    });
  const strongestDay = Object.entries(revByDay).sort((a, b) => b[1] - a[1])[0];
  const strongestDayName = strongestDay ? DAY_PT[Number(strongestDay[0])] : '—';

  // Alerta de queda: últimos 7 dias vs 7 dias anteriores
  const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fourteenDaysAgo = new Date(now); fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const last7Rev = appointments
    .filter(a => new Date(a.startTime) >= sevenDaysAgo && new Date(a.startTime) <= now && a.status === AppointmentStatus.FINISHED && !a.isPlan && byProf(a))
    .reduce((s, a) => s + (a.amountPaid || 0), 0);
  const prev7Rev = appointments
    .filter(a => new Date(a.startTime) >= fourteenDaysAgo && new Date(a.startTime) < sevenDaysAgo && a.status === AppointmentStatus.FINISHED && !a.isPlan && byProf(a))
    .reduce((s, a) => s + (a.amountPaid || 0), 0);
  const showFallAlert = prev7Rev > 0 && last7Rev < prev7Rev * 0.8;
  const fallPct = prev7Rev > 0 ? Math.round((1 - last7Rev / prev7Rev) * 100) : 0;

  // ── Monthly summary KPIs (CLARIS-style) ──────────────────────────────────
  const monthlyAppts = appointments.filter(a => new Date(a.startTime) >= monthStart && new Date(a.startTime) <= now && byProf(a));
  const monthlyFinished = monthlyAppts.filter(a => a.status === AppointmentStatus.FINISHED).length;
  const monthlyCancelled = monthlyAppts.filter(a => a.status === AppointmentStatus.CANCELLED).length;
  const totalClients = customers.length;

  // Today
  const todayStr = now.toISOString().split('T')[0];
  const todayAppts = appointments
    .filter(a => a.startTime?.startsWith(todayStr))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const pendingCount = todayAppts.filter(a => a.status === AppointmentStatus.PENDING).length;
  const todayFinished = todayAppts.filter(a => a.status === AppointmentStatus.FINISHED).length;

  // Bar chart — last 7 days
  const barData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    const str = d.toISOString().split('T')[0];
    const rev = appointments
      .filter(a => a.startTime?.startsWith(str) && a.status === AppointmentStatus.FINISHED && !a.isPlan && byProf(a))
      .reduce((s, a) => s + (a.amountPaid || 0), 0);
    return { name: DAY_PT[d.getDay()], value: rev };
  });
  const barTotal = barData.reduce((s, d) => s + d.value, 0);

  // Donut — service distribution
  const svcMap: Record<string, number> = {};
  curAppts.forEach(a => {
    const svc = services.find(s => s.id === a.service_id);
    const name = svc?.name || 'Outros';
    svcMap[name] = (svcMap[name] || 0) + 1;
  });
  const totalSvc = Object.values(svcMap).reduce((s, v) => s + v, 0);
  const donutData = Object.entries(svcMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({
      name, value: count,
      pct: totalSvc > 0 ? Math.round((count / totalSvc) * 100) : 0,
    }));

  // Weekly trend — last 4 weeks
  const weeklyData = Array.from({ length: 4 }, (_, i) => {
    const wEnd = new Date(now);
    wEnd.setDate(wEnd.getDate() - i * 7);
    const wStart = new Date(wEnd);
    wStart.setDate(wStart.getDate() - 7);
    const wAppts = appointments.filter(a => inRange(a, wStart, wEnd) && byProf(a));
    const wRev = wAppts.filter(a => a.status === AppointmentStatus.FINISHED && !a.isPlan).reduce((s, a) => s + (a.amountPaid || 0), 0);
    return { name: `Sem ${4 - i}`, receita: wRev, agendamentos: wAppts.length };
  }).reverse();

  // Top professionals
  const topProfs = professionals
    .map(p => {
      const pa = curAppts.filter(a => a.professional_id === p.id);
      const rev = pa.filter(a => a.status === AppointmentStatus.FINISHED && !a.isPlan).reduce((s, a) => s + (a.amountPaid || 0), 0);
      return { ...p, count: pa.length, revenue: rev };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3);
  const maxRev = topProfs[0]?.revenue || 1;

  // Greeting + carousel
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const dayOfYear = Math.floor((Date.now() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);

  // 2 slides: frase motivacional + dica de saúde
  const carouselSlides = React.useMemo(() => [
    { label: 'FRASE DO DIA', text: QUOTES[dayOfYear % QUOTES.length] },
    { label: 'SAUDE E BEM-ESTAR', text: DICAS_SAUDE[dayOfYear % DICAS_SAUDE.length] },
  ], [dayOfYear]);

  const [carouselIdx, setCarouselIdx] = useState(0);
  const [carouselFade, setCarouselFade] = useState(true);

  const goToSlide = useCallback((idx: number) => {
    setCarouselFade(false);
    setTimeout(() => {
      setCarouselIdx(idx);
      setCarouselFade(true);
    }, 300);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      goToSlide((carouselIdx + 1) % carouselSlides.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [carouselIdx, carouselSlides.length, goToSlide]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20">
        <div className="w-8 h-8 border-4 border-slate-100 border-t-black rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Filters */}
      <div className="flex items-center justify-end gap-2 sm:gap-3 flex-wrap">
        <select
          value={selectedProfId}
          onChange={e => setSelectedProfId(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold bg-white text-slate-600 outline-none cursor-pointer min-w-0 max-w-[160px]"
        >
          <option value="">Todos Prof.</option>
          {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="flex bg-slate-100 rounded-xl p-1 gap-0.5">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setPeriod(d)}
              className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${period === d ? 'bg-black text-white shadow-sm' : 'text-slate-500 hover:text-black'}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Alerta de queda de movimento */}
      {showFallAlert && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl px-5 py-4 flex items-center gap-3">
          <span className="text-orange-500 text-xl">⚠️</span>
          <div>
            <p className="text-sm font-black text-orange-700">Queda de movimento detectada</p>
            <p className="text-xs text-orange-600">Faturamento dos últimos 7 dias caiu <strong>{fallPct}%</strong> em relação à semana anterior.</p>
          </div>
        </div>
      )}

      {/* IA Otimização card */}
      {settings?.lastOptimizedAt && (
        <div
          onClick={() => onNavigate?.('OTIMIZACAO')}
          className="cursor-pointer bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-100 rounded-2xl px-4 sm:px-5 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 hover:border-violet-300 transition-all"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">🤖</span>
            <div>
              <p className="text-[10px] font-black text-violet-700 uppercase tracking-widest">IA Otimizada</p>
              <p className="text-xs font-bold text-violet-500 truncate max-w-xs">
                {settings.lastOptimizationSummary
                  ? settings.lastOptimizationSummary.slice(0, 80) + (settings.lastOptimizationSummary.length > 80 ? '…' : '')
                  : 'Otimização aplicada com sucesso.'}
              </p>
            </div>
          </div>
          <span className="text-[9px] font-black text-violet-400 shrink-0 ml-4">
            {new Date(settings.lastOptimizedAt).toLocaleDateString('pt-BR')}
          </span>
        </div>
      )}

      {/* Motivational card with carousel */}
      <div className="bg-white dark:bg-[#1a1a2c] rounded-2xl border border-slate-100 dark:border-[#2a2a3c] p-5 sm:p-7">
        {/* Header — greeting + weather */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-sm font-black text-orange-500 uppercase tracking-[0.25em]">{greeting},</p>
            <h2 className="text-3xl sm:text-4xl font-black text-slate-800 dark:text-[#e0e0f0] leading-tight mt-1">{tenantName || 'Meu Negócio'}</h2>
          </div>
          {weather ? (
            <div className="text-right shrink-0">
              <p className="text-3xl sm:text-4xl font-black text-slate-800 dark:text-[#e0e0f0] leading-none">{weather.temp}°</p>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mt-1">{weatherLabel(weather.code)}</p>
              {weatherCity && <p className="text-[9px] font-bold text-slate-300 dark:text-[#484860] uppercase tracking-wider mt-0.5">{weatherCity}</p>}
            </div>
          ) : (
            <p className="text-[9px] font-bold text-slate-300 dark:text-[#484860] uppercase tracking-wider shrink-0">Configure sua cidade<br/>em Ajustes</p>
          )}
        </div>

        {/* Carousel — frase / dica */}
        <div className="min-h-[90px]">
          <div
            className="transition-all duration-500 ease-in-out"
            style={{ opacity: carouselFade ? 1 : 0, transform: carouselFade ? 'translateY(0)' : 'translateY(12px)' }}
          >
            <p className="text-xs font-black text-orange-500 uppercase tracking-[0.3em] mb-3">
              {carouselSlides[carouselIdx].label}
            </p>
            <p className="text-xl sm:text-3xl font-bold text-slate-700 dark:text-[#c8c8dc] leading-relaxed italic">
              "{carouselSlides[carouselIdx].text}"
            </p>
          </div>
        </div>

        {/* Dots */}
        <div className="flex items-center gap-2 mt-4">
          {carouselSlides.map((_, i) => (
            <button
              key={i}
              onClick={() => goToSlide(i)}
              className={`rounded-full transition-all duration-300 ${
                i === carouselIdx
                  ? 'w-8 h-2 bg-orange-500'
                  : 'w-2 h-2 bg-slate-200 dark:bg-[#2a2a3c] hover:bg-slate-300 dark:hover:bg-[#3a3a4c]'
              }`}
            />
          ))}
        </div>
      </div>

      {/* CLARIS-style monthly KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-5 sm:p-6 cursor-pointer hover:border-orange-300 hover:shadow-md hover:-translate-y-0.5 transition-all" onClick={() => onNavigate?.('AGENDAMENTOS')}>
          <p className="text-xs font-bold text-orange-500 uppercase tracking-wider">Agendados / Atendidos</p>
          <p className="text-3xl sm:text-4xl font-black text-black leading-none mt-3">
            <AnimatedNumber value={monthlyAppts.length} />
          </p>
          <p className="text-xs text-slate-400 mt-2">para o mês · <span className="text-green-600 font-bold">{monthlyFinished} concluídos</span></p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5 sm:p-6 cursor-pointer hover:border-orange-300 hover:shadow-md hover:-translate-y-0.5 transition-all" onClick={() => onNavigate?.('CLIENTES')}>
          <p className="text-xs font-bold text-orange-500 uppercase tracking-wider">Clientes</p>
          <p className="text-3xl sm:text-4xl font-black text-black leading-none mt-3">
            <AnimatedNumber value={totalClients} />
          </p>
          <p className="text-xs text-slate-400 mt-2">cadastrados</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5 sm:p-6">
          <p className="text-xs font-bold text-red-400 uppercase tracking-wider">Cancelados</p>
          <p className={`text-3xl sm:text-4xl font-black leading-none mt-3 ${monthlyCancelled > 0 ? 'text-red-500' : 'text-slate-300'}`}>
            <AnimatedNumber value={monthlyCancelled} />
          </p>
          <p className="text-xs text-slate-400 mt-2">para o mês</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5 sm:p-6">
          <p className="text-xs font-bold text-orange-500 uppercase tracking-wider">Hoje</p>
          <p className="text-3xl sm:text-4xl font-black text-black leading-none mt-3">
            <AnimatedNumber value={todayAppts.length} />
          </p>
          <p className="text-xs text-slate-400 mt-2">{pendingCount > 0 ? <span className="text-orange-500 font-bold">{pendingCount} pendentes</span> : <span>{todayFinished} concluídos</span>}</p>
        </div>
      </div>

      {/* Meta + Projeção + Margem + Dia forte */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5 col-span-2 cursor-pointer hover:border-orange-300 hover:shadow-md transition-all" onClick={() => onNavigate?.('FINANCEIRO')}>
          <div className="flex items-start justify-between mb-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-orange-500 uppercase tracking-wider">Faturamento do Mês</p>
              <p className="text-2xl sm:text-3xl font-black text-black leading-none mt-2 truncate">R$ {fmtBRL(thisMonthRevenue)}</p>
              {monthlyGoal > 0
                ? <p className="text-xs text-slate-400 mt-1">Meta: R$ {fmtBRL(monthlyGoal)}</p>
                : <p className="text-xs text-slate-400 mt-1">Meta não configurada</p>
              }
            </div>
            {monthlyGoal > 0 && (
              <span className={`text-sm font-black px-3 py-1 rounded-full ${goalPct >= 100 ? 'bg-green-50 text-green-600' : goalPct >= 70 ? 'bg-orange-50 text-orange-500' : 'bg-red-50 text-red-500'}`}>
                {goalPct}%
              </span>
            )}
          </div>
          {monthlyGoal > 0 && (
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${goalPct >= 100 ? 'bg-green-500' : goalPct >= 70 ? 'bg-orange-500' : 'bg-red-400'}`}
                style={{ width: `${goalPct}%` }}
              />
            </div>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Projeção</p>
          <p className="text-xl sm:text-2xl font-black text-black leading-none mt-2 truncate">R$ {fmtBRL(projection)}</p>
          <p className="text-[10px] text-slate-400 mt-1">Média: R$ {fmtBRL(dailyAvg)}/dia</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Margem Real</p>
          <p className={`text-xl sm:text-2xl font-black leading-none mt-2 ${margin >= 50 ? 'text-green-600' : margin >= 20 ? 'text-orange-500' : 'text-red-500'}`}>
            {margin.toFixed(1)}%
          </p>
          <p className="text-[10px] text-slate-400 mt-1">Despesas: R$ {fmtBRL(thisMonthExpenses)}</p>
        </div>
      </div>

      {/* Bar chart + Total Financeiro (CLARIS-style) */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="md:col-span-3 bg-white rounded-2xl border border-slate-100 p-4 sm:p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="font-black text-sm text-black">Estatísticas de Receita</h3>
              <p className="text-xs text-slate-400">Faturamento dos últimos 7 dias</p>
            </div>
            <span className="text-xs font-bold text-slate-500">R$ {fmtBRL(barTotal)}</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData} barSize={30} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }} />
              <YAxis hide />
              <Tooltip
                formatter={(v: any) => [`R$ ${fmtBRL(v)}`, 'Receita']}
                contentStyle={{ borderRadius: 10, border: '1px solid #f1f5f9', fontSize: 11, background: '#fff', color: '#0f172a', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}
                cursor={{ fill: '#f8fafc' }}
              />
              <Bar dataKey="value" fill={accent} radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-100 p-4 sm:p-6 flex flex-col items-center justify-center">
          <div className="w-full mb-3">
            <h3 className="font-black text-sm text-black">Total Financeiro</h3>
            <p className="text-xs text-slate-400">Receita vs despesas do mês</p>
          </div>
          <div className="relative">
            <PieChart width={180} height={180}>
              <Pie
                data={[
                  { name: 'Receita', value: Math.max(thisMonthRevenue, 1) },
                  { name: 'Despesas', value: Math.max(thisMonthExpenses, 0.01) },
                ]}
                cx={85} cy={85}
                innerRadius={55} outerRadius={80}
                dataKey="value"
                strokeWidth={2}
                stroke="#fff"
              >
                <Cell fill="#22c55e" />
                <Cell fill="#ef4444" />
              </Pie>
            </PieChart>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-lg font-black text-black leading-none">R$ {fmtBRL(thisMonthRevenue)}</span>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Total</span>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
              <span className="text-[11px] text-slate-600">Receita</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <span className="text-[11px] text-slate-600">Despesas</span>
            </div>
          </div>
        </div>
      </div>

      {/* Serviços Populares + Dia Forte */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="md:col-span-3 bg-white rounded-2xl border border-slate-100 p-4 sm:p-6">
          <div className="mb-4">
            <h3 className="font-black text-sm text-black">Serviços Populares</h3>
            <p className="text-xs text-slate-400">Distribuição por categoria</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <PieChart width={110} height={110}>
                <Pie
                  data={donutData.length ? donutData : [{ name: '', value: 1, pct: 0 }]}
                  cx={50} cy={50}
                  innerRadius={34} outerRadius={52}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {(donutData.length ? donutData : [{ name: '', value: 1, pct: 0 }]).map((_, i) => (
                    <Cell key={i} fill={donutData.length ? DONUT_COLORS[i % DONUT_COLORS.length] : '#f1f5f9'} />
                  ))}
                </Pie>
              </PieChart>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-base font-black text-black leading-none">{donutData[0]?.pct || 0}%</span>
                <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest mt-0.5">top serv.</span>
              </div>
            </div>
            <div className="flex-1 space-y-2.5 min-w-0">
              {(donutData.length ? donutData : []).slice(0, 5).map((d, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: DONUT_COLORS[i] }} />
                    <span className="text-[11px] text-slate-600 font-medium truncate">{d.name}</span>
                  </div>
                  <span className="text-[11px] font-bold text-slate-700 shrink-0">{d.pct}%</span>
                </div>
              ))}
              {donutData.length === 0 && <p className="text-[11px] text-slate-400">Sem dados</p>}
            </div>
          </div>
        </div>
        <div className="md:col-span-2 grid grid-cols-1 gap-4">
          <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
            <p className="text-xs font-bold text-orange-500 uppercase tracking-wider">Dia Mais Forte</p>
            <p className="text-3xl font-black text-black leading-none mt-2">{strongestDayName}</p>
            <p className="text-[10px] text-slate-400 mt-1">Últimos 30 dias</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
            <p className="text-xs font-bold text-orange-500 uppercase tracking-wider">Profissionais Ativos</p>
            <p className="text-3xl font-black text-black leading-none mt-2">
              <AnimatedNumber value={professionals.length} />
            </p>
            <p className="text-[10px] text-slate-400 mt-1">no sistema</p>
          </div>
        </div>
      </div>

      {/* Weekly trend */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-6">
        <div className="mb-4">
          <h3 className="font-black text-sm text-black">Tendência Semanal</h3>
          <p className="text-xs text-slate-400">Receita das últimas 4 semanas</p>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={weeklyData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradReceita" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.3} />
                <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }} />
            <YAxis hide />
            <Tooltip
              formatter={(v: any) => [`R$ ${fmtBRL(v)}`, 'Receita']}
              contentStyle={{ borderRadius: 12, border: '1px solid #f1f5f9', fontSize: 11, background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}
            />
            <Area type="monotone" dataKey="receita" name="Receita" stroke={accent} strokeWidth={2.5} fill="url(#gradReceita)" dot={{ r: 4, fill: accent, strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6, fill: accent, stroke: '#fff', strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Top profs + Today */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="font-black text-sm text-black">Top Profissionais</h3>
              <p className="text-xs text-slate-400">Ranking por faturamento</p>
            </div>
          </div>
          <div className="space-y-5">
            {topProfs.map(p => (
              <div key={p.id} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center text-xs font-black shrink-0">
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-bold text-black truncate">{p.name}</p>
                    <p className="text-sm font-black text-black ml-2 shrink-0">R$ {p.revenue.toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-slate-900 rounded-full transition-all" style={{ width: `${Math.max(4, (p.revenue / maxRev) * 100)}%` }} />
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium shrink-0">{p.count} atend.</span>
                  </div>
                </div>
              </div>
            ))}
            {topProfs.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Sem dados no período</p>}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="font-black text-sm text-black">Agendamentos de Hoje</h3>
              <p className="text-xs text-slate-400">Próximos atendimentos</p>
            </div>
            {pendingCount > 0 && (
              <span className="text-[10px] font-bold bg-orange-50 text-orange-500 border border-orange-100 px-3 py-1 rounded-full shrink-0">
                {pendingCount} pendentes
              </span>
            )}
          </div>
          <div className="space-y-1 overflow-y-auto max-h-[260px] custom-scrollbar">
            {todayAppts.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">Nenhum agendamento hoje</p>
            ) : todayAppts.map(a => {
              const cust = customers.find(c => c.id === a.customer_id);
              const svc = services.find(s => s.id === a.service_id);
              const prof = professionals.find(p => p.id === a.professional_id);
              const done = a.status === AppointmentStatus.CONFIRMED || a.status === AppointmentStatus.FINISHED;
              return (
                <div key={a.id} className="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0">
                  <span className="text-sm font-black text-black w-12 shrink-0 tabular-nums">
                    {new Date(a.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-black truncate">{cust?.name || 'Cliente'}</p>
                    <p className="text-[10px] text-slate-400 uppercase font-medium truncate">
                      {svc?.name || 'Serviço'}{prof ? ` · ${prof.name.toUpperCase()}` : ''}
                    </p>
                  </div>
                  <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full shrink-0 ${done ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-500'}`}>
                    {done ? 'CONFIRMADO' : 'PENDENTE'}
                  </span>
                  <span className="text-xs font-bold text-slate-600 shrink-0 tabular-nums">
                    R$ {(a.amountPaid || 0).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// (no sub-components needed — all inline now)

export default Dashboard;
