
import React, { useState, useEffect } from 'react';
import { db } from '../services/mockDb';
import { AffiliateLink } from '../types';

interface Props {
  affiliate: AffiliateLink;
  onLogout: () => void;
}

// Bonus rules (fixed for all affiliates)
const BONUS_THRESHOLD = 10; // new active clients needed in current month
const BONUS_PERCENT = 30;   // bonus commission rate
const AffiliateDashboard: React.FC<Props> = ({ affiliate, onLogout }) => {
  const BASE_PERCENT = affiliate.commissionPercent || 10; // base from affiliate's negotiated rate
  const INDIRECT_PERCENT = affiliate.indirectCommissionPercent ?? 5; // 2o nível — por afiliado
  const [tenants, setTenants] = useState<any[]>([]);
  const [indirectTenants, setIndirectTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { supabase } = await import('../services/supabase');
        // 1o nível — clientes diretos
        const { data } = await supabase
          .from('tenants')
          .select('id, nome, status, plan, mensalidade, created_at')
          .eq('affiliate_link_id', affiliate.id)
          .order('created_at', { ascending: false });
        const direct = data || [];
        setTenants(direct);
        // 2o nível — indicados pelos clientes diretos
        const directIds = direct.map(t => t.id);
        if (directIds.length > 0) {
          const { data: indirect } = await supabase
            .from('tenants')
            .select('id, nome, status, plan, mensalidade, created_at, referred_by')
            .in('referred_by', directIds)
            .order('created_at', { ascending: false });
          setIndirectTenants(indirect || []);
        }
      } catch {}
      setLoading(false);
    })();
  }, [affiliate.id]);

  const active = tenants.filter(t => t.status === 'ATIVA');
  const pending = tenants.filter(t => t.status !== 'ATIVA' && t.status !== 'CANCELADA' && t.status !== 'BLOQUEADA');
  const cancelled = tenants.filter(t => t.status === 'CANCELADA' || t.status === 'BLOQUEADA');

  // Bonus calculation: new active clients this month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const newActiveThisMonth = active.filter(t => new Date(t.created_at) >= monthStart);
  const oldActive = active.filter(t => new Date(t.created_at) < monthStart);
  const bonusActive = newActiveThisMonth.length >= BONUS_THRESHOLD;

  const mrrNew = newActiveThisMonth.reduce((s, t) => s + Number(t.mensalidade || 0), 0);
  const mrrOld = oldActive.reduce((s, t) => s + Number(t.mensalidade || 0), 0);
  const totalMRR = mrrNew + mrrOld;

  const commissionNew = bonusActive ? mrrNew * (BONUS_PERCENT / 100) : mrrNew * (BASE_PERCENT / 100);
  const commissionOld = mrrOld * (BASE_PERCENT / 100);
  const directCommission = commissionNew + commissionOld;

  // 2o nível — comissão indireta
  const indirectActive = indirectTenants.filter(t => t.status === 'ATIVA');
  const indirectMRR = indirectActive.reduce((s, t) => s + Number(t.mensalidade || 0), 0);
  const indirectCommission = indirectMRR * (INDIRECT_PERCENT / 100);

  const myCommission = directCommission + indirectCommission;

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)' }}>
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center text-xl">🤝</div>
          <div>
            <h1 className="text-white font-black text-lg">Painel do Afiliado</h1>
            <p className="text-slate-400 text-xs font-bold">{affiliate.name}</p>
          </div>
        </div>
        <button onClick={onLogout}
          className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-slate-400 hover:text-white hover:bg-white/10 transition-all">
          Sair
        </button>
      </header>

      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Link info */}
        <div className="bg-white/5 rounded-2xl border border-white/10 p-5">
          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Seu Link de Afiliado</p>
          <div className="flex items-center gap-3">
            <code className="text-orange-400 font-bold text-sm flex-1">https://www.agendezap.com/?aff={affiliate.slug}</code>
            <button onClick={() => { navigator.clipboard.writeText(`https://www.agendezap.com/?aff=${affiliate.slug}`); }}
              className="px-4 py-2 bg-orange-500 text-white text-[10px] font-black uppercase tracking-wider rounded-lg hover:bg-orange-600 transition-all">
              Copiar
            </button>
          </div>
          <p className="text-slate-500 text-xs mt-2">Comissao base: <span className="text-orange-400 font-black">{BASE_PERCENT}%</span> • Meta bonus: <span className="text-green-400 font-black">{BONUS_PERCENT}%</span> (ao trazer {BONUS_THRESHOLD} novos ativos/mes) • 2o nivel: <span className="text-purple-400 font-black">{INDIRECT_PERCENT}%</span></p>
        </div>

        {/* Bonus progress */}
        <div className={`rounded-2xl border p-5 ${bonusActive ? 'bg-green-500/10 border-green-500/30' : 'bg-white/5 border-white/10'}`}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: bonusActive ? '#4ade80' : '#94a3b8' }}>
                {bonusActive ? 'Bonus Ativo!' : 'Meta do Mes'}
              </p>
              <p className="text-white font-bold text-sm mt-1">
                {bonusActive
                  ? `Parabens! Voce trouxe ${newActiveThisMonth.length} novos clientes ativos — ${BONUS_PERCENT}% sobre os novos!`
                  : `Traga ${BONUS_THRESHOLD} novos clientes ativos este mes para ganhar ${BONUS_PERCENT}% de comissao sobre eles`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-black" style={{ color: bonusActive ? '#4ade80' : '#f97316' }}>{newActiveThisMonth.length}/{BONUS_THRESHOLD}</p>
              <p className="text-[9px] text-slate-500 font-bold">novos ativos</p>
            </div>
          </div>
          <div className="w-full bg-white/10 rounded-full h-3 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${Math.min(100, (newActiveThisMonth.length / BONUS_THRESHOLD) * 100)}%`,
              background: bonusActive ? 'linear-gradient(90deg, #22c55e, #4ade80)' : 'linear-gradient(90deg, #f97316, #fb923c)',
            }} />
          </div>
          {bonusActive && (
            <p className="text-green-400/70 text-[10px] font-bold mt-2">
              {BONUS_PERCENT}% sobre R${mrrNew.toFixed(2)} (novos) + {BASE_PERCENT}% sobre R${mrrOld.toFixed(2)} (antigos) = R${myCommission.toFixed(2)}
            </p>
          )}
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-white/5 rounded-2xl border border-white/10 p-4">
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Diretos</p>
            <p className="text-3xl font-black text-white mt-1">{tenants.length}</p>
            <p className="text-[10px] text-slate-500 mt-1">{active.length} ativos • {pending.length} pendentes • {cancelled.length} cancelados</p>
          </div>
          <div className="bg-white/5 rounded-2xl border border-purple-500/30 p-4">
            <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest">2o Nivel</p>
            <p className="text-3xl font-black text-purple-400 mt-1">{indirectTenants.length}</p>
            <p className="text-[10px] text-slate-500 mt-1">{indirectActive.length} ativos • {INDIRECT_PERCENT}% de R${indirectMRR.toFixed(2)}</p>
          </div>
          <div className="bg-white/5 rounded-2xl border border-orange-500/30 p-4">
            <p className="text-[9px] font-black text-orange-400 uppercase tracking-widest">Comissao Total</p>
            <p className="text-3xl font-black text-orange-400 mt-1">R${myCommission.toFixed(2)}</p>
            <p className="text-[10px] text-slate-500 mt-1">
              Direta: R${directCommission.toFixed(2)}
              {indirectCommission > 0 && ` + Indireta: R$${indirectCommission.toFixed(2)}`}
            </p>
          </div>
        </div>

        {/* Tenants table */}
        {loading ? (
          <p className="text-slate-400 font-bold text-sm">Carregando...</p>
        ) : (
          <div className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Estabelecimento</th>
                  <th className="text-left p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                  <th className="text-left p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Plano</th>
                  <th className="text-left p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Mensalidade</th>
                  <th className="text-left p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Sua Comissao</th>
                  <th className="text-left p-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Data</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(t => {
                  const fee = Number(t.mensalidade || 0);
                  const isNewThisMonth = new Date(t.created_at) >= monthStart;
                  const rate = t.status === 'ATIVA' ? (bonusActive && isNewThisMonth ? BONUS_PERCENT : BASE_PERCENT) : 0;
                  const comm = fee * (rate / 100);
                  const statusColor = t.status === 'ATIVA' ? 'bg-green-500/20 text-green-400'
                    : (t.status === 'CANCELADA' || t.status === 'BLOQUEADA') ? 'bg-red-500/20 text-red-400'
                    : 'bg-yellow-500/20 text-yellow-400';
                  return (
                    <tr key={t.id} className="border-t border-white/5 hover:bg-white/5">
                      <td className="p-4 font-bold text-white">{t.nome}</td>
                      <td className="p-4">
                        <span className={`text-[8px] font-black px-2 py-1 rounded-full uppercase ${statusColor}`}>{t.status}</span>
                      </td>
                      <td className="p-4 text-slate-400">{t.plan || 'START'}</td>
                      <td className="p-4 text-slate-300 font-mono">R${fee.toFixed(2)}</td>
                      <td className="p-4 font-mono font-bold">
                        <span className={bonusActive && isNewThisMonth && t.status === 'ATIVA' ? 'text-green-400' : 'text-orange-400'}>R${comm.toFixed(2)}</span>
                        {bonusActive && isNewThisMonth && t.status === 'ATIVA' && (
                          <span className="ml-1 text-[7px] font-black px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 uppercase">bonus</span>
                        )}
                      </td>
                      <td className="p-4 text-slate-500 text-xs">{new Date(t.created_at).toLocaleDateString('pt-BR')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {tenants.length === 0 && (
              <p className="p-8 text-center text-slate-500 font-bold text-sm">Nenhum cadastro ainda. Compartilhe seu link para comecar!</p>
            )}
          </div>
        )}

        {/* Relatório de Sub-Afiliados (2o nível agrupado por cliente direto) */}
        {(() => {
          // Agrupar indiretos por referrer
          const grouped: Record<string, { referrer: any; referrals: any[] }> = {};
          for (const t of indirectTenants) {
            const rId = t.referred_by || 'unknown';
            if (!grouped[rId]) grouped[rId] = { referrer: tenants.find(d => d.id === rId), referrals: [] };
            grouped[rId].referrals.push(t);
          }
          const subAffiliates = Object.values(grouped)
            .map(g => {
              const activeRefs = g.referrals.filter(r => r.status === 'ATIVA');
              const mrr = activeRefs.reduce((s, r) => s + Number(r.mensalidade || 0), 0);
              return { ...g, activeCount: activeRefs.length, mrr, commission: mrr * (INDIRECT_PERCENT / 100) };
            })
            .sort((a, b) => b.activeCount - a.activeCount);

          if (subAffiliates.length === 0) return null;

          return (
            <div className="bg-white/5 rounded-2xl border border-purple-500/20 overflow-hidden">
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
                <div>
                  <p className="text-sm font-black text-purple-400 uppercase tracking-tight">Relatorio de Sub-Afiliados</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{subAffiliates.length} clientes seus indicaram novos parceiros • Voce ganha {INDIRECT_PERCENT}% sobre cada um</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-black text-purple-400">R${indirectCommission.toFixed(2)}</p>
                  <p className="text-[9px] text-slate-500 font-bold">comissao indireta</p>
                </div>
              </div>

              {/* Ranking de sub-afiliados */}
              <div className="divide-y divide-white/5">
                {subAffiliates.map((sa, idx) => (
                  <div key={sa.referrer?.id || idx}>
                    {/* Sub-afiliado header */}
                    <div className="px-5 py-3 flex items-center justify-between bg-white/[0.02]">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400 font-black text-sm">
                          #{idx + 1}
                        </div>
                        <div>
                          <p className="text-white font-bold text-sm">{sa.referrer?.nome || 'Desconhecido'}</p>
                          <p className="text-[9px] text-slate-500 font-bold">
                            {sa.referrals.length} indicacoes • {sa.activeCount} ativos • MRR R${sa.mrr.toFixed(2)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-black text-purple-400">R${sa.commission.toFixed(2)}</p>
                        <p className="text-[8px] text-slate-500 font-bold">{INDIRECT_PERCENT}%</p>
                      </div>
                    </div>
                    {/* Indicados deste sub-afiliado */}
                    {sa.referrals.map(t => {
                      const fee = Number(t.mensalidade || 0);
                      const comm = t.status === 'ATIVA' ? fee * (INDIRECT_PERCENT / 100) : 0;
                      const statusColor = t.status === 'ATIVA' ? 'text-green-400' : (t.status === 'CANCELADA' || t.status === 'BLOQUEADA') ? 'text-red-400' : 'text-yellow-400';
                      return (
                        <div key={t.id} className="px-5 py-2 pl-16 flex items-center justify-between text-xs hover:bg-white/5">
                          <div className="flex items-center gap-2">
                            <span className={`text-[7px] font-black px-1.5 py-0.5 rounded-full uppercase ${t.status === 'ATIVA' ? 'bg-green-500/20 text-green-400' : t.status === 'CANCELADA' || t.status === 'BLOQUEADA' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{t.status}</span>
                            <span className="text-white font-bold">{t.nome}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-slate-400 font-mono">R${fee.toFixed(2)}</span>
                            <span className="text-purple-400 font-mono font-bold w-20 text-right">R${comm.toFixed(2)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Total footer */}
              <div className="px-5 py-3 border-t border-purple-500/20 flex items-center justify-between bg-purple-500/5">
                <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest">Total 2o Nivel</p>
                <div className="flex items-center gap-6 text-xs">
                  <span className="text-slate-400">{indirectTenants.length} indicacoes</span>
                  <span className="text-slate-400">{indirectActive.length} ativos</span>
                  <span className="text-slate-400 font-mono">MRR R${indirectMRR.toFixed(2)}</span>
                  <span className="text-purple-400 font-black font-mono">R${indirectCommission.toFixed(2)}</span>
                </div>
              </div>
            </div>
          );
        })()}

        <p className="text-center text-[10px] text-slate-600 font-bold uppercase tracking-widest">
          Powered by AgendeZap • Painel de Afiliado
        </p>
      </div>
    </div>
  );
};

export default AffiliateDashboard;
