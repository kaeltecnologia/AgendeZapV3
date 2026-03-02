
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { AppointmentStatus, BookingSource } from '../types';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const PIE_COLORS = ['#0f172a', '#f97316', '#64748b', '#94a3b8'];

const SOURCE_LABELS: Record<BookingSource, string> = {
  [BookingSource.AI]: 'Agente IA',
  [BookingSource.MANUAL]: 'Manual',
  [BookingSource.WEB]: 'Link Web',
  [BookingSource.PLAN]: 'Plano',
};

const SOURCE_ICONS: Record<BookingSource, string> = {
  [BookingSource.AI]: '🤖',
  [BookingSource.MANUAL]: '✏️',
  [BookingSource.WEB]: '🌐',
  [BookingSource.PLAN]: '📦',
};

type Period = '7d' | '30d' | 'this_month' | '90d';

function getPeriodRange(p: Period): { start: string; end: string; label: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = iso(now);

  if (p === '7d') {
    const d = new Date(now); d.setDate(d.getDate() - 7);
    return { start: iso(d), end: today, label: 'Últimos 7 dias' };
  }
  if (p === 'this_month') {
    return { start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, end: today, label: 'Este mês' };
  }
  if (p === '90d') {
    const d = new Date(now); d.setDate(d.getDate() - 90);
    return { start: iso(d), end: today, label: 'Últimos 90 dias' };
  }
  const d = new Date(now); d.setDate(d.getDate() - 30);
  return { start: iso(d), end: today, label: 'Últimos 30 dias' };
}

const MarketingView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [period, setPeriod] = useState<Period>('this_month');
  const [prevPeriod] = useState<Period>('30d');
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const apps = await db.getAppointments(tenantId);
      setAppointments(apps);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const range = getPeriodRange(period);

  const inRange = (a: any, r: { start: string; end: string }) => {
    const d = a.startTime?.split('T')[0] || '';
    return d >= r.start && d <= r.end;
  };

  const curAppts = appointments.filter(a => inRange(a, range));

  // Previous period for growth comparison
  const now = new Date();
  const prevEnd = new Date(range.start); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  const daysInRange = Math.round((new Date(range.end).getTime() - new Date(range.start).getTime()) / 86400000) + 1;
  prevStart.setDate(prevStart.getDate() - daysInRange);
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const prevRange = { start: iso(prevStart), end: iso(prevEnd) };
  const prevAppts = appointments.filter(a => inRange(a, prevRange));

  const sources = [BookingSource.AI, BookingSource.MANUAL, BookingSource.WEB, BookingSource.PLAN];

  const stats = sources.map((src, i) => {
    const cur = curAppts.filter(a => a.source === src);
    const prev = prevAppts.filter(a => a.source === src);
    const finished = cur.filter(a => a.status === AppointmentStatus.FINISHED);
    const convRate = cur.length > 0 ? Math.round(finished.length / cur.length * 100) : 0;
    const growth = prev.length > 0 ? Math.round((cur.length - prev.length) / prev.length * 100) : null;
    return { source: src, count: cur.length, finished: finished.length, convRate, growth, color: PIE_COLORS[i] };
  });

  const total = stats.reduce((s, x) => s + x.count, 0);
  const pieData = stats
    .filter(s => s.count > 0)
    .map(s => ({ name: SOURCE_LABELS[s.source], value: s.count }));

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20">
        <div className="w-8 h-8 border-4 border-slate-100 border-t-black rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-black">Marketing</h1>
          <p className="text-xs text-slate-400 mt-0.5">Origem dos agendamentos e conversão por canal.</p>
        </div>
        <div className="flex bg-slate-100 rounded-xl p-1 gap-0.5">
          {([
            { v: '7d', l: '7d' },
            { v: 'this_month', l: 'Mês' },
            { v: '30d', l: '30d' },
            { v: '90d', l: '90d' },
          ] as { v: Period; l: string }[]).map(o => (
            <button key={o.v} onClick={() => setPeriod(o.v)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${period === o.v ? 'bg-black text-white shadow-sm' : 'text-slate-500 hover:text-black'}`}>
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.source} className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">{SOURCE_ICONS[s.source]}</span>
              <span className="text-xs font-black text-slate-400 uppercase tracking-widest">{SOURCE_LABELS[s.source]}</span>
            </div>
            <p className="text-3xl font-black text-black leading-none">{s.count}</p>
            <p className="text-[10px] text-slate-400 mt-1">agendamentos</p>
            {s.growth !== null && (
              <p className={`text-[10px] font-bold mt-2 ${s.growth >= 0 ? 'text-green-500' : 'text-red-400'}`}>
                {s.growth >= 0 ? '↑' : '↓'} {Math.abs(s.growth)}% vs anterior
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Pie + Table */}
      <div className="grid grid-cols-5 gap-4">
        {/* Pie chart */}
        <div className="col-span-2 bg-white rounded-2xl border border-slate-100 p-6">
          <h3 className="font-black text-sm text-black mb-1">Distribuição por Canal</h3>
          <p className="text-xs text-slate-400 mb-4">{range.label} · {total} total</p>
          {total > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%" cy="50%"
                  innerRadius={55} outerRadius={80}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: any, n: any) => [`${v} (${total > 0 ? Math.round(v / total * 100) : 0}%)`, n]}
                  contentStyle={{ borderRadius: 10, border: '1px solid #f1f5f9', fontSize: 11, background: '#fff', color: '#0f172a' }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[200px]">
              <p className="text-xs text-slate-400">Sem dados no período</p>
            </div>
          )}
        </div>

        {/* Stats table */}
        <div className="col-span-3 bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="font-black text-sm text-black">Análise por Canal</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-[0.15em]">
              <tr>
                <th className="px-6 py-3 text-left">Canal</th>
                <th className="px-6 py-3 text-right">Agend.</th>
                <th className="px-6 py-3 text-right">%</th>
                <th className="px-6 py-3 text-right">Finalizados</th>
                <th className="px-6 py-3 text-right">Conversão</th>
                <th className="px-6 py-3 text-right">Crescimento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {stats.sort((a, b) => b.count - a.count).map(s => (
                <tr key={s.source} className="hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                      <span className="font-bold text-black">{SOURCE_ICONS[s.source]} {SOURCE_LABELS[s.source]}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right font-bold text-black">{s.count}</td>
                  <td className="px-6 py-4 text-right text-slate-500">
                    {total > 0 ? `${Math.round(s.count / total * 100)}%` : '—'}
                  </td>
                  <td className="px-6 py-4 text-right text-slate-500">{s.finished}</td>
                  <td className="px-6 py-4 text-right">
                    <span className={`font-bold ${s.convRate >= 70 ? 'text-green-600' : s.convRate >= 40 ? 'text-orange-500' : 'text-red-400'}`}>
                      {s.count > 0 ? `${s.convRate}%` : '—'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {s.growth !== null ? (
                      <span className={`text-xs font-bold ${s.growth >= 0 ? 'text-green-500' : 'text-red-400'}`}>
                        {s.growth >= 0 ? '+' : ''}{s.growth}%
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info note */}
      <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
        <p className="text-xs text-slate-500">
          <strong>Taxa de Conversão:</strong> % de agendamentos que chegaram ao status Finalizado.
          {' '}O canal com maior taxa indica melhor qualidade de intenção do cliente.
        </p>
      </div>
    </div>
  );
};

export default MarketingView;
