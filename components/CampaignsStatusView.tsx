import React, { useState, useEffect, useCallback } from 'react';
import { BulkCampaign, getCampaigns, stopCampaign, deleteCampaign, triggerTick } from '../services/campaignService';

const formatSeconds = (s: number) => {
  if (s <= 0) return '0s';
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}h ${m > 0 ? m + 'm' : ''}`.trim();
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
};

const STATUS_CONFIG = {
  running: { label: 'Em andamento', dot: 'bg-orange-500 animate-pulse', bg: 'bg-orange-50 border-orange-200', text: 'text-orange-700' },
  pending: { label: 'Aguardando', dot: 'bg-blue-400', bg: 'bg-blue-50 border-blue-100', text: 'text-blue-600' },
  done:    { label: 'Concluído', dot: 'bg-green-500', bg: 'bg-green-50 border-green-100', text: 'text-green-700' },
  stopped: { label: 'Interrompido', dot: 'bg-red-400', bg: 'bg-red-50 border-red-100', text: 'text-red-600' },
};

const CampaignsStatusView: React.FC = () => {
  const [campaigns, setCampaigns] = useState<BulkCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await getCampaigns();
      setCampaigns(rows);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh every 3s + trigger tick so messages flow while this tab is visible
  useEffect(() => {
    load();
    const interval = setInterval(() => {
      load();
      triggerTick(); // keep the Edge Function processing while this tab is open
    }, 3_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleStop = async (id: string) => {
    setStopping(id);
    try { await stopCampaign(id); await load(); } finally { setStopping(null); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover esta campanha do histórico?')) return;
    await deleteCampaign(id);
    await load();
  };

  const active   = campaigns.filter(c => c.status === 'running' || c.status === 'pending');
  const finished = campaigns.filter(c => c.status === 'done' || c.status === 'stopped');

  if (loading) return (
    <div className="p-20 text-center font-black text-slate-300 animate-pulse uppercase tracking-widest text-sm">
      Carregando campanhas...
    </div>
  );

  const renderCard = (c: BulkCampaign) => {
    const cfg = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.pending;
    const total = c.contacts?.length ?? 0;
    const pct = total > 0 ? Math.round((c.sent_count / total) * 100) : 0;
    const nextName = c.contacts?.[c.current_index]?.name ?? '';
    const secsToNext = c.status === 'running'
      ? Math.max(0, Math.round((new Date(c.next_send_at).getTime() - Date.now()) / 1000))
      : 0;

    return (
      <div key={c.id} className={`bg-white rounded-[28px] border-2 p-6 space-y-4 ${c.status === 'running' ? 'border-orange-200 shadow-lg shadow-orange-50' : 'border-slate-100'}`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1 ${cfg.dot}`} />
            <div>
              <p className="font-black text-sm text-black leading-tight">{c.name}</p>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                {new Date(c.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                {' · '}{c.admin_instance}
              </p>
            </div>
          </div>
          <span className={`text-[9px] font-black px-2.5 py-1 rounded-full ${cfg.bg} ${cfg.text} border whitespace-nowrap`}>
            {cfg.label}
          </span>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black text-slate-500 uppercase">{c.sent_count} / {total} enviados</span>
            <span className="text-[10px] font-black text-slate-400">{pct}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                c.status === 'done' ? 'bg-green-500' :
                c.status === 'stopped' ? 'bg-red-400' :
                'bg-orange-500'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Stats row */}
        <div className="flex gap-4 text-center">
          <div className="flex-1 bg-slate-50 rounded-2xl py-2">
            <p className="text-lg font-black text-black">{c.sent_count}</p>
            <p className="text-[9px] font-black text-slate-400 uppercase">Enviados</p>
          </div>
          <div className="flex-1 bg-slate-50 rounded-2xl py-2">
            <p className="text-lg font-black text-black">{total - c.current_index}</p>
            <p className="text-[9px] font-black text-slate-400 uppercase">Pendentes</p>
          </div>
          {c.error_count > 0 && (
            <div className="flex-1 bg-red-50 rounded-2xl py-2">
              <p className="text-lg font-black text-red-500">{c.error_count}</p>
              <p className="text-[9px] font-black text-red-400 uppercase">Erros</p>
            </div>
          )}
        </div>

        {/* Running status line */}
        {c.status === 'running' && nextName && (
          <div className="bg-orange-50 border border-orange-100 rounded-2xl px-4 py-2.5">
            {secsToNext > 2 ? (
              <p className="text-[10px] font-bold text-orange-600">
                ⏱ Próximo envio para <strong>{nextName}</strong> em {formatSeconds(secsToNext)}
              </p>
            ) : (
              <p className="text-[10px] font-bold text-orange-600 animate-pulse">
                📤 Enviando para <strong>{nextName}</strong>...
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {c.status === 'running' && (
            <button
              onClick={() => handleStop(c.id)}
              disabled={stopping === c.id}
              className="flex-1 py-2.5 bg-red-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-red-600 transition-all disabled:opacity-50"
            >
              {stopping === c.id ? '...' : '⛔ Parar'}
            </button>
          )}
          {(c.status === 'done' || c.status === 'stopped') && (
            <button
              onClick={() => handleDelete(c.id)}
              className="flex-1 py-2.5 border-2 border-slate-100 text-slate-400 rounded-xl font-black text-[10px] uppercase tracking-widest hover:border-red-300 hover:text-red-400 transition-all"
            >
              🗑 Remover
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Campanhas</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            Acompanhe todos os disparos em tempo real — {active.length > 0 ? `${active.length} ativo${active.length !== 1 ? 's' : ''}` : 'nenhum ativo'}
          </p>
        </div>
        {/* Live indicator */}
        {active.length > 0 && (
          <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-2xl px-4 py-2">
            <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
            <span className="text-[10px] font-black text-orange-600 uppercase tracking-widest">
              Atualizando a cada 3s
            </span>
          </div>
        )}
      </div>

      {/* Empty state */}
      {campaigns.length === 0 && (
        <div className="bg-white rounded-[40px] border-2 border-dashed border-slate-200 p-20 text-center">
          <p className="text-4xl mb-4">📤</p>
          <p className="font-black text-slate-300 uppercase tracking-widest text-sm">Nenhuma campanha ainda</p>
          <p className="text-xs font-bold text-slate-300 mt-2">Crie um disparo na aba Disparador</p>
        </div>
      )}

      {/* Active campaigns */}
      {active.length > 0 && (
        <div className="space-y-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Em andamento</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {active.map(renderCard)}
          </div>
        </div>
      )}

      {/* Finished campaigns */}
      {finished.length > 0 && (
        <div className="space-y-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Histórico</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {finished.map(renderCard)}
          </div>
        </div>
      )}

      {/* Info box */}
      <div className="bg-blue-50 border-2 border-blue-100 rounded-[24px] p-6 flex items-start gap-4">
        <span className="text-2xl">🌐</span>
        <div>
          <p className="text-xs font-black text-blue-700 uppercase tracking-widest mb-1">Disparo contínuo 24/7</p>
          <p className="text-[10px] font-bold text-blue-500 leading-relaxed">
            Os disparos rodam no servidor Supabase. Mesmo que você feche o navegador ou o computador hibernar, os envios continuam automaticamente.
            Enquanto esta tela estiver aberta, o polling é feito a cada <strong>3 segundos</strong>.
            O servidor verifica a fila a cada <strong>1 minuto</strong> via pg_cron (requer ativação — veja o arquivo SQL em supabase/migrations/).
          </p>
        </div>
      </div>
    </div>
  );
};

export default CampaignsStatusView;
