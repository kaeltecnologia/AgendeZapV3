import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { TenantSettings, ConversationLog } from '../types';

interface Props {
  tenantId: string;
  tenantName: string;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export default function OtimizacaoView({ tenantId }: Props) {
  const [logs, setLogs] = useState<ConversationLog[]>([]);
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [sinceDays, setSinceDays] = useState(7);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, s] = await Promise.all([
        db.getConversationLogs(tenantId, sinceDays),
        db.getSettings(tenantId),
      ]);
      setLogs(data);
      setSettings(s);
    } finally {
      setLoading(false);
    }
  }, [tenantId, sinceDays]);

  useEffect(() => { load(); }, [load]);

  const booked = logs.filter(l => l.outcome === 'booked').length;
  const abandoned = logs.filter(l => l.outcome === 'abandoned').length;
  const total = logs.length;
  const conversionRate = total > 0 ? Math.round((booked / total) * 100) : 0;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-black tracking-tight">IA Otimização</h1>
          <p className="text-xs font-bold text-slate-400 mt-0.5">Desempenho da IA e otimizações aplicadas pelo suporte</p>
        </div>
        <span className="bg-violet-100 text-violet-700 text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest">
          GPT-4o Mini
        </span>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Período:</p>
        {[7, 14, 30].map(d => (
          <button key={d} onClick={() => setSinceDays(d)}
            className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              sinceDays === d ? 'bg-black text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}>
            {d}d
          </button>
        ))}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Conversas', value: total,             color: 'text-slate-800',  bg: 'bg-slate-50',  emoji: '💬' },
          { label: 'Agendados', value: booked,            color: 'text-green-700',  bg: 'bg-green-50',  emoji: '✅' },
          { label: 'Abandonados', value: abandoned,       color: 'text-red-600',    bg: 'bg-red-50',    emoji: '❌' },
          { label: 'Conversão',  value: `${conversionRate}%`, color: 'text-orange-600', bg: 'bg-orange-50', emoji: '🎯' },
        ].map(card => (
          <div key={card.label} className={`${card.bg} rounded-2xl p-4 space-y-1 border border-slate-100`}>
            <p className="text-xl">{card.emoji}</p>
            <p className={`text-2xl font-black ${card.color}`}>{loading ? '—' : card.value}</p>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Last optimization */}
      <div className="bg-white rounded-[24px] border-2 border-slate-100 p-6 space-y-2">
        <p className="font-black text-black text-sm">Última Otimização pelo Suporte</p>
        {settings?.lastOptimizedAt ? (
          <>
            <p className="text-xs font-bold text-slate-500">{fmtDate(settings.lastOptimizedAt)}</p>
            {settings.lastOptimizationSummary && (
              <p className="text-xs text-slate-600 leading-relaxed">{settings.lastOptimizationSummary}</p>
            )}
            <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wider mt-1">
              O relatório completo foi enviado para o chat de Suporte.
            </p>
          </>
        ) : (
          <p className="text-xs font-bold text-slate-400">
            Nenhuma otimização aplicada ainda. O suporte realizará otimizações com base nas conversas da sua IA.
          </p>
        )}
      </div>

      {/* Current prompt (readonly) */}
      <div className="bg-white rounded-[24px] border-2 border-slate-100 p-6 space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-black text-black text-sm">Prompt Atual do Agente</p>
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Editável em Configurações &gt; IA</span>
        </div>
        <textarea
          readOnly
          value={settings?.systemPrompt || '(sem prompt personalizado — usando padrão do sistema)'}
          className="w-full h-28 resize-none rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-mono text-slate-700 focus:outline-none"
        />
      </div>
    </div>
  );
}
