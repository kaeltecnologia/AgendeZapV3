
import React, { useState, useEffect } from 'react';
import { db } from '../services/mockDb';
import { AffiliateLink } from '../types';

interface Props {
  affiliate: AffiliateLink;
  onLogout: () => void;
}

const AffiliateDashboard: React.FC<Props> = ({ affiliate, onLogout }) => {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await (await import('../services/supabase')).supabase
          .from('tenants')
          .select('id, nome, status, plan, mensalidade, created_at')
          .eq('affiliate_link_id', affiliate.id)
          .order('created_at', { ascending: false });
        setTenants(data || []);
      } catch {}
      setLoading(false);
    })();
  }, [affiliate.id]);

  const active = tenants.filter(t => t.status === 'ATIVA');
  const pending = tenants.filter(t => t.status !== 'ATIVA' && t.status !== 'CANCELADA' && t.status !== 'BLOQUEADA');
  const cancelled = tenants.filter(t => t.status === 'CANCELADA' || t.status === 'BLOQUEADA');
  const totalMRR = active.reduce((s, t) => s + Number(t.mensalidade || 0), 0);
  const myCommission = totalMRR * (affiliate.commissionPercent / 100);

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
          <p className="text-slate-500 text-xs mt-2">Comissão: <span className="text-orange-400 font-black">{affiliate.commissionPercent}%</span> por assinatura ativa</p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-white/5 rounded-2xl border border-white/10 p-4">
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Total Cadastros</p>
            <p className="text-3xl font-black text-white mt-1">{tenants.length}</p>
          </div>
          <div className="bg-white/5 rounded-2xl border border-white/10 p-4">
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Ativos</p>
            <p className="text-3xl font-black text-green-400 mt-1">{active.length}</p>
          </div>
          <div className="bg-white/5 rounded-2xl border border-white/10 p-4">
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Pendentes</p>
            <p className="text-3xl font-black text-yellow-400 mt-1">{pending.length}</p>
          </div>
          <div className="bg-white/5 rounded-2xl border border-white/10 p-4">
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Cancelados</p>
            <p className="text-3xl font-black text-red-400 mt-1">{cancelled.length}</p>
          </div>
          <div className="bg-white/5 rounded-2xl border border-orange-500/30 p-4">
            <p className="text-[9px] font-black text-orange-400 uppercase tracking-widest">Sua Comissao</p>
            <p className="text-3xl font-black text-orange-400 mt-1">R${myCommission.toFixed(2)}</p>
            <p className="text-[10px] text-slate-500 mt-1">de R${totalMRR.toFixed(2)} MRR</p>
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
                  const comm = t.status === 'ATIVA' ? fee * (affiliate.commissionPercent / 100) : 0;
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
                      <td className="p-4 text-orange-400 font-mono font-bold">R${comm.toFixed(2)}</td>
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

        <p className="text-center text-[10px] text-slate-600 font-bold uppercase tracking-widest">
          Powered by AgendeZap • Painel de Afiliado
        </p>
      </div>
    </div>
  );
};

export default AffiliateDashboard;
