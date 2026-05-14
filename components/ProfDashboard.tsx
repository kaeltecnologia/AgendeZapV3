import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { AppointmentStatus } from '../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// ── Frases motivacionais (mesmo banco do Dashboard) ─────────────────────────
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
];

const DICAS_SAUDE = [
  'Beba pelo menos 2 litros de água hoje. Seu corpo e sua mente funcionam melhor hidratados.',
  'Levante e alongue o corpo a cada 2 horas. Sua coluna agradece no final do expediente.',
  'Respire fundo por 1 minuto antes de começar o dia. Reduz ansiedade e melhora o foco.',
  'Cuide das suas mãos — são sua ferramenta de trabalho. Hidrate e descanse elas.',
  'Faça exercícios de respiração entre um atendimento e outro. Três respirações profundas bastam.',
  'Reserve um momento do dia só para você. Autocuidado não é luxo, é necessidade.',
  'Ria mais. O humor reduz cortisol e fortalece o sistema imunológico.',
  'Pratique gratidão: pense em 3 coisas boas que aconteceram hoje antes de dormir.',
  'Caminhe pelo menos 30 minutos hoje. Movimento é remédio para o corpo e para a mente.',
  'Celebre suas pequenas vitórias. Reconhecer seu progresso alimenta a motivação.',
];

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DAY_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const greetingOf = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
};

interface ProfDashboardProps {
  tenantId: string;
  professionalId: string;
  professionalName: string;
  canViewRevenue?: boolean;
}

const ProfDashboard: React.FC<ProfDashboardProps> = ({
  tenantId, professionalId, professionalName, canViewRevenue = true,
}) => {
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({});

  const quote  = QUOTES[Math.floor(Date.now() / 86_400_000) % QUOTES.length];
  const health = DICAS_SAUDE[Math.floor(Date.now() / 86_400_000) % DICAS_SAUDE.length];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, s, c, st] = await Promise.all([
        db.getAppointments(tenantId),
        db.getServices(tenantId),
        db.getCustomers(tenantId),
        db.getSettings(tenantId),
      ]);
      setAppointments(a.filter(ap => ap.professional_id === professionalId));
      setServices(s);
      setCustomers(c);
      setSettings(st);
    } finally {
      setLoading(false);
    }
  }, [tenantId, professionalId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin" />
    </div>
  );

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Today
  const todayAppts = appointments
    .filter(a => a.startTime?.startsWith(todayStr))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const todayPending = todayAppts.filter(a => a.status === AppointmentStatus.PENDING).length;
  const todayFinished = todayAppts.filter(a => a.status === AppointmentStatus.FINISHED).length;

  // This month
  const monthAppts = appointments.filter(a => new Date(a.startTime) >= monthStart && new Date(a.startTime) <= now);
  const monthFinished = monthAppts.filter(a => a.status === AppointmentStatus.FINISHED);
  const monthRevenue = monthFinished.filter(a => !a.isPlan).reduce((s, a) => s + (a.amountPaid || 0), 0);

  // Personal monthly goal (from professionalMeta)
  const myGoal: number = settings.professionalMeta?.[professionalId]?.monthlyGoal || 0;
  const goalPct = myGoal > 0 ? Math.min(100, Math.round((monthRevenue / myGoal) * 100)) : 0;

  // Commission
  const commRate: number = settings.professionalMeta?.[professionalId]?.commissionRate || 0;
  const myCommission = monthRevenue * (commRate / 100);

  // Next appointment today
  const nextAppt = todayAppts.find(a => a.status === AppointmentStatus.PENDING && a.startTime > now.toISOString());

  // Last 7 days bar chart
  const barData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    const ds = d.toISOString().split('T')[0];
    const dayAppts = appointments.filter(a => a.startTime?.startsWith(ds) && a.status === AppointmentStatus.FINISHED);
    return {
      day: DAY_PT[d.getDay()],
      atend: dayAppts.length,
      receita: dayAppts.filter(a => !a.isPlan).reduce((s, a) => s + (a.amountPaid || 0), 0),
    };
  });

  // Services breakdown this month
  const svcCount: Record<string, number> = {};
  monthFinished.forEach(a => {
    const svcName = services.find(s => s.id === a.service_id)?.name || 'Outro';
    svcCount[svcName] = (svcCount[svcName] || 0) + 1;
  });
  const topSvcs = Object.entries(svcCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Unique clients this month
  const uniqueClients = new Set(monthFinished.map(a => a.customer_id)).size;

  return (
    <div className="space-y-5 animate-fadeIn p-4 sm:p-6">

      {/* ── Greeting card ── */}
      <div className="relative bg-gradient-to-br from-orange-500 to-orange-600 rounded-[28px] p-6 text-white overflow-hidden shadow-xl shadow-orange-200">
        <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/10 rounded-full" />
        <div className="absolute -bottom-6 -left-6 w-24 h-24 bg-black/10 rounded-full" />
        <p className="text-[10px] font-black uppercase tracking-[0.25em] opacity-70 mb-1 relative z-10">
          {greetingOf()}, {professionalName.split(' ')[0]}! 👋
        </p>
        <p className="text-lg font-black leading-snug relative z-10">{quote}</p>
        <p className="text-[10px] opacity-60 mt-3 font-medium relative z-10 italic">💚 {health}</p>
      </div>

      {/* ── Today's summary ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Hoje', value: todayAppts.length, sub: 'total', color: 'text-slate-800' },
          { label: 'Pendentes', value: todayPending, sub: 'aguardando', color: 'text-amber-600' },
          { label: 'Concluídos', value: todayFinished, sub: 'hoje', color: 'text-emerald-600' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-[20px] border-2 border-slate-100 p-4 text-center shadow-sm">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
            <p className={`text-3xl font-black ${color} mt-1`}>{value}</p>
            <p className="text-[9px] font-semibold text-slate-300 uppercase tracking-wider">{sub}</p>
          </div>
        ))}
      </div>

      {/* Next appointment */}
      {nextAppt && (() => {
        const dt = new Date(nextAppt.startTime);
        const cust = customers.find(c => c.id === nextAppt.customer_id);
        const svc  = services.find(s => s.id === nextAppt.service_id);
        return (
          <div className="bg-white rounded-[20px] border-2 border-orange-100 p-4 flex items-center gap-4 shadow-sm">
            <div className="w-10 h-10 bg-orange-100 rounded-[14px] flex items-center justify-center text-lg shrink-0">⏰</div>
            <div className="min-w-0">
              <p className="text-[9px] font-black text-orange-500 uppercase tracking-widest">Próximo atendimento</p>
              <p className="text-sm font-black text-slate-800 truncate">{cust?.name || '—'}</p>
              {svc && <p className="text-[10px] font-semibold text-slate-400 truncate">{svc.name}</p>}
            </div>
            <div className="ml-auto shrink-0 text-right">
              <p className="text-xl font-black text-slate-800">{dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
              <p className="text-[9px] font-bold text-slate-400">hoje</p>
            </div>
          </div>
        );
      })()}

      {/* ── Month KPIs ── */}
      <div className="bg-white rounded-[24px] border-2 border-slate-100 p-5 space-y-4 shadow-sm">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Meu mês</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Atendimentos</p>
            <p className="text-3xl font-black text-slate-800 mt-0.5">{monthFinished.length}</p>
            <p className="text-[9px] font-semibold text-slate-300">concluídos</p>
          </div>
          <div>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Clientes únicos</p>
            <p className="text-3xl font-black text-slate-800 mt-0.5">{uniqueClients}</p>
            <p className="text-[9px] font-semibold text-slate-300">este mês</p>
          </div>
        </div>

        {canViewRevenue && (
          <>
            <div className="border-t-2 border-slate-50 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Receita gerada</p>
                  <p className="text-2xl font-black text-emerald-600">R$ {fmtBRL(monthRevenue)}</p>
                </div>
                {commRate > 0 && (
                  <div className="text-right">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Minha comissão ({commRate}%)</p>
                    <p className="text-xl font-black text-orange-600">R$ {fmtBRL(myCommission)}</p>
                  </div>
                )}
              </div>

              {myGoal > 0 && (
                <div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Meta pessoal</span>
                    <span className="text-[9px] font-black text-orange-500">{goalPct}% de R$ {fmtBRL(myGoal)}</span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-orange-400 to-orange-500 rounded-full transition-all duration-700"
                      style={{ width: `${goalPct}%` }} />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Last 7 days chart ── */}
      <div className="bg-white rounded-[24px] border-2 border-slate-100 p-5 shadow-sm">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">
          {canViewRevenue ? 'Receita — últimos 7 dias' : 'Atendimentos — últimos 7 dias'}
        </p>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={barData} barSize={24}>
            <XAxis dataKey="day" tick={{ fontSize: 10, fontWeight: 700, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip
              formatter={(v: number) => canViewRevenue ? [`R$ ${fmtBRL(v)}`, 'Receita'] : [`${v}`, 'Atendimentos']}
              contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 11 }}
            />
            <Bar
              dataKey={canViewRevenue ? 'receita' : 'atend'}
              fill="#f97316"
              radius={[6, 6, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Top services ── */}
      {topSvcs.length > 0 && (
        <div className="bg-white rounded-[24px] border-2 border-slate-100 p-5 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Meus serviços mais realizados</p>
          <div className="space-y-2.5">
            {topSvcs.map(([name, count], i) => {
              const maxCount = topSvcs[0][1];
              return (
                <div key={name} className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-slate-300 w-4 shrink-0">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-bold text-slate-700 truncate">{name}</p>
                      <p className="text-[10px] font-black text-orange-500 shrink-0 ml-2">{count}x</p>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full bg-orange-400 rounded-full transition-all duration-500"
                        style={{ width: `${Math.round((count / maxCount) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
};

export default ProfDashboard;
