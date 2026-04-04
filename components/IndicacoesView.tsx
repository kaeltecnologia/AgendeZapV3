import React, { useState, useEffect } from 'react';
import { db } from '../services/mockDb';

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ReferralItem {
  id: string; name: string; status: string; plan: string; monthlyFee: number; createdAt: string;
}

interface ReferralData {
  activeReferrals: number; totalReferralRevenue: number;
  discountPercent: number; pixBonus: number;
  referrals: ReferralItem[];
}

const IndicacoesView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [data, setData] = useState<ReferralData | null>(null);
  const [slug, setSlug] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [rd, tenant] = await Promise.all([
          db.getReferralData(tenantId),
          db.getTenant(tenantId),
        ]);
        setData(rd);
        if (tenant?.slug) setSlug(tenant.slug);
      } catch (e) {
        console.error('Error loading referral data:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [tenantId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(`https://www.agendezap.com/?ref=${slug}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full" />
      </div>
    );
  }

  const d = data || { activeReferrals: 0, totalReferralRevenue: 0, discountPercent: 0, pixBonus: 0, referrals: [] };
  const totalReferrals = d.referrals.length;
  const activeCount = d.activeReferrals;
  const pendingCount = d.referrals.filter(r => r.status !== 'ATIVA' && r.status !== 'BLOQUEADA' && r.status !== 'CANCELADA').length;
  const inactiveCount = totalReferrals - activeCount - pendingCount;

  const statusBadge = (s: string) => {
    if (s === 'ATIVA') return 'bg-green-100 text-green-700';
    if (s === 'PAGAMENTO PENDENTE' || s === 'TRIAL') return 'bg-yellow-100 text-yellow-700';
    return 'bg-red-100 text-red-600';
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-black uppercase tracking-tight">Programa de Indicações</h2>
        <p className="text-xs text-slate-400 font-bold">Indique parceiros, ganhe descontos e bônus PIX</p>
      </div>

      {/* How it works */}
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-2xl border border-purple-100 p-5">
        <h3 className="font-black text-sm text-purple-700 mb-3">Como funciona</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="bg-white/70 rounded-xl p-4">
            <p className="text-2xl mb-1">🔗</p>
            <p className="font-black text-purple-700">1. Compartilhe seu link</p>
            <p className="text-purple-500 mt-1">Envie para colegas, parceiros e amigos que têm negócio</p>
          </div>
          <div className="bg-white/70 rounded-xl p-4">
            <p className="text-2xl mb-1">💸</p>
            <p className="font-black text-purple-700">2. Ganhe 20% de desconto</p>
            <p className="text-purple-500 mt-1">Para cada indicação que contratar um plano, enquanto mantiver ativa</p>
          </div>
          <div className="bg-white/70 rounded-xl p-4">
            <p className="text-2xl mb-1">🤑</p>
            <p className="font-black text-purple-700">3. Bônus PIX (5+ indicações)</p>
            <p className="text-purple-500 mt-1">Receba 10% do valor de cada assinatura dos indicados via PIX todo mês</p>
          </div>
        </div>
      </div>

      {/* Referral link */}
      {slug && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h3 className="font-black text-sm text-black mb-3">Seu link exclusivo</h3>
          <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
            <code className="text-sm font-mono text-purple-600 truncate flex-1">
              https://www.agendezap.com/?ref={slug}
            </code>
            <button
              onClick={handleCopy}
              className={`shrink-0 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                copied ? 'bg-green-600 text-white' : 'bg-purple-600 text-white hover:bg-purple-700'
              }`}
            >
              {copied ? 'Copiado!' : 'Copiar Link'}
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mt-2">
            Compartilhe este link com qualquer pessoa. Quando se cadastrarem e contratarem, seu desconto é aplicado automaticamente.
          </p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-4 text-center">
          <p className="text-3xl font-black text-purple-600">{totalReferrals}</p>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-1">Total Indicações</p>
        </div>
        <div className="bg-white rounded-2xl border border-green-100 p-4 text-center">
          <p className="text-3xl font-black text-green-600">{activeCount}</p>
          <p className="text-[9px] font-black text-green-500 uppercase tracking-wider mt-1">Ativas (Contrataram)</p>
        </div>
        <div className="bg-white rounded-2xl border border-purple-100 p-4 text-center">
          <p className="text-3xl font-black text-purple-600">{d.discountPercent}%</p>
          <p className="text-[9px] font-black text-purple-400 uppercase tracking-wider mt-1">Seu Desconto</p>
        </div>
        <div className="bg-white rounded-2xl border border-indigo-100 p-4 text-center">
          <p className="text-2xl font-black text-indigo-600">
            {d.pixBonus > 0 ? `R$${fmtBRL(d.pixBonus)}` : '--'}
          </p>
          <p className="text-[9px] font-black text-indigo-400 uppercase tracking-wider mt-1">Bônus PIX/mês</p>
        </div>
      </div>

      {/* Progress to 5 */}
      {activeCount < 5 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-black text-slate-600">Progresso para Bônus PIX</p>
            <p className="text-xs font-black text-purple-600">{activeCount}/5 indicações ativas</p>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-purple-500 to-indigo-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min((activeCount / 5) * 100, 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-400 mt-2">
            Faltam <strong>{5 - activeCount}</strong> indicações ativas para desbloquear o bônus de <strong>10% via PIX</strong> das assinaturas dos seus indicados!
          </p>
        </div>
      )}

      {/* Earnings summary (if has active referrals) */}
      {activeCount > 0 && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl border border-green-100 p-5">
          <h3 className="font-black text-sm text-green-700 mb-3">Seus Ganhos</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-green-600 font-bold mb-1">Desconto na assinatura</p>
              <p className="text-2xl font-black text-green-700">{d.discountPercent}%</p>
              <p className="text-[10px] text-green-500">{activeCount} indicação(ões) × 20% = {d.discountPercent}% (máx 100%)</p>
            </div>
            {d.pixBonus > 0 && (
              <div>
                <p className="text-xs text-green-600 font-bold mb-1">Bônus PIX mensal</p>
                <p className="text-2xl font-black text-green-700">R${fmtBRL(d.pixBonus)}</p>
                <p className="text-[10px] text-green-500">10% de R${fmtBRL(d.totalReferralRevenue)} (soma das assinaturas ativas)</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Referrals table */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h3 className="font-black text-sm text-black">Suas Indicações</h3>
          <p className="text-[10px] text-slate-400 font-bold mt-0.5">
            {activeCount} ativas · {pendingCount} pendentes · {inactiveCount} inativas
          </p>
        </div>
        {d.referrals.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-4xl mb-3">💜</p>
            <p className="font-black text-slate-500 text-sm">Nenhuma indicação ainda</p>
            <p className="text-xs text-slate-400 mt-1">Compartilhe seu link e comece a ganhar descontos!</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Nome</th>
                <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Plano</th>
                <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Mensalidade</th>
                <th className="text-left p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Data</th>
              </tr>
            </thead>
            <tbody>
              {d.referrals.map(r => (
                <tr key={r.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="p-4 font-bold">{r.name}</td>
                  <td className="p-4">
                    <span className={`text-[8px] font-black px-2 py-1 rounded-full uppercase ${statusBadge(r.status)}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="p-4 text-xs">{r.plan}</td>
                  <td className="p-4 text-xs font-mono">
                    {r.status === 'ATIVA' ? `R$${fmtBRL(r.monthlyFee)}` : '--'}
                  </td>
                  <td className="p-4 text-xs text-slate-400">{new Date(r.createdAt).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default IndicacoesView;
