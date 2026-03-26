/**
 * CustomerDashboard.tsx
 *
 * Self-contained customer account page — accessible at #/minha-conta
 * Handles its own auth (login/register) via localStorage('agz_customer').
 * Shows booking history, favorites, cashback balance, and profile.
 */

import React, { useState, useEffect } from 'react';
import { db } from '../services/mockDb';
import { Tenant, CustomerAccount } from '../types';

// ── Session helpers ──────────────────────────────────────────────────
const SESSION_KEY = 'agz_customer';

function getSession(): CustomerAccount | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveSession(account: CustomerAccount) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(account));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// ── Tabs ─────────────────────────────────────────────────────────────
type Tab = 'HISTORICO' | 'FAVORITOS' | 'CASHBACK' | 'PERFIL';

const CustomerDashboard: React.FC = () => {
  const [session, setSession] = useState<CustomerAccount | null>(getSession);
  const [tab, setTab] = useState<Tab>('HISTORICO');

  // Auth form
  const [isRegister, setIsRegister] = useState(false);
  const [authName, setAuthName] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authCity, setAuthCity] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // Dashboard data
  const [history, setHistory] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<Tenant[]>([]);
  const [cashback, setCashback] = useState<{ balance: number; totalEarned: number; totalUsed: number; bookingsCount: number } | null>(null);
  const [loading, setLoading] = useState(false);

  // Profile edit
  const [editName, setEditName] = useState('');
  const [editCity, setEditCity] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  const loadData = async (account: CustomerAccount) => {
    setLoading(true);
    try {
      const [hist, favs, cb] = await Promise.all([
        db.getCustomerBookingHistory(account.phone),
        db.getCustomerFavorites(account.phone),
        db.getCashbackBalance(account.phone).catch(() => null),
      ]);
      setHistory(hist);

      // Enrich favorites with tenant data
      if (favs.length > 0) {
        const allTenants = await db.getMarketplaceTenants();
        const favTenants = favs.map(f => allTenants.find(t => t.id === f.tenantId)).filter(Boolean) as Tenant[];
        setFavorites(favTenants);
      } else {
        setFavorites([]);
      }

      setCashback(cb);
      setEditName(account.name);
      setEditCity(account.city || '');
    } catch (e) {
      console.error('[CustomerDashboard] Load error:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (session) loadData(session);
  }, [session]);

  const handleAuth = async () => {
    const phone = authPhone.replace(/\D/g, '');
    if (!phone || phone.length < 10) { setAuthError('Número de telefone inválido.'); return; }
    if (!authPass || authPass.length < 4) { setAuthError('Senha deve ter no mínimo 4 caracteres.'); return; }

    setAuthLoading(true);
    setAuthError('');

    try {
      if (isRegister) {
        if (!authName.trim()) { setAuthError('Preencha seu nome.'); setAuthLoading(false); return; }
        const result = await db.customerRegister(phone, authName.trim(), authPass, authCity.trim() || undefined);
        if ('error' in result) { setAuthError(result.error); setAuthLoading(false); return; }
        saveSession(result);
        setSession(result);
      } else {
        const result = await db.customerLogin(phone, authPass);
        if ('error' in result) { setAuthError(result.error); setAuthLoading(false); return; }
        saveSession(result);
        setSession(result);
      }
    } catch (e: any) {
      setAuthError('Erro de conexão. Tente novamente.');
      console.error('[CustomerDashboard] Auth error:', e);
    }
    setAuthLoading(false);
  };

  const handleLogout = () => {
    clearSession();
    setSession(null);
    setHistory([]);
    setFavorites([]);
    setCashback(null);
  };

  const handleProfileSave = async () => {
    if (!session) return;
    setProfileSaving(true);
    try {
      await db.updateCustomerAccount(session.phone, { name: editName.trim(), city: editCity.trim() });
      const updated = { ...session, name: editName.trim(), city: editCity.trim() };
      saveSession(updated);
      setSession(updated);
    } catch (e) {
      console.error('[CustomerDashboard] Profile save error:', e);
    }
    setProfileSaving(false);
  };

  const removeFavorite = async (tenantId: string) => {
    if (!session) return;
    setFavorites(prev => prev.filter(t => t.id !== tenantId));
    await db.removeCustomerFavorite(session.phone, tenantId).catch(() => {});
  };

  const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const formatDate = (d: string) => {
    try {
      const [y, m, day] = d.split('-');
      return `${day}/${m}/${y}`;
    } catch { return d; }
  };

  const statusLabel = (s: string) => {
    const map: Record<string, { label: string; color: string }> = {
      CONFIRMED: { label: 'Confirmado', color: 'bg-blue-100 text-blue-700' },
      CONFIRMADO: { label: 'Confirmado', color: 'bg-blue-100 text-blue-700' },
      FINISHED: { label: 'Finalizado', color: 'bg-green-100 text-green-700' },
      FINALIZADO: { label: 'Finalizado', color: 'bg-green-100 text-green-700' },
      CONCLUIDO: { label: 'Concluído', color: 'bg-green-100 text-green-700' },
      CANCELLED: { label: 'Cancelado', color: 'bg-red-100 text-red-600' },
      CANCELADO: { label: 'Cancelado', color: 'bg-red-100 text-red-600' },
      NO_SHOW: { label: 'Não compareceu', color: 'bg-slate-100 text-slate-500' },
    };
    return map[s] || { label: s, color: 'bg-slate-100 text-slate-500' };
  };

  // ── Auth Screen ────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-[40px] w-full max-w-md p-10 space-y-6 border-4 border-black">
          <div className="text-center">
            <p className="text-4xl mb-3">👤</p>
            <h2 className="text-2xl font-black uppercase tracking-tight">
              {isRegister ? 'Criar Conta' : 'Entrar'}
            </h2>
            <p className="text-xs font-bold text-slate-400 mt-2">
              {isRegister ? 'Crie sua conta no AgendeZap' : 'Acesse sua conta no AgendeZap'}
            </p>
          </div>

          <div className="space-y-3">
            {isRegister && (
              <input type="text" value={authName} onChange={e => setAuthName(e.target.value)} placeholder="Seu nome"
                className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-orange-400" />
            )}
            <input type="tel" value={authPhone} onChange={e => setAuthPhone(e.target.value)} placeholder="WhatsApp (ex: 44999999999)"
              className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-orange-400" />
            {isRegister && (
              <input type="text" value={authCity} onChange={e => setAuthCity(e.target.value)} placeholder="Sua cidade (opcional)"
                className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-orange-400" />
            )}
            <input type="password" value={authPass} onChange={e => setAuthPass(e.target.value)} placeholder="Senha"
              className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-orange-400" />
          </div>

          {authError && <p className="text-xs font-black text-red-500 text-center">{authError}</p>}

          <button onClick={handleAuth} disabled={authLoading}
            className="w-full bg-orange-500 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-black transition-all disabled:opacity-40">
            {authLoading ? 'Aguarde...' : isRegister ? 'Criar Conta' : 'Entrar'}
          </button>

          <p className="text-center text-xs font-bold text-slate-400">
            {isRegister ? 'Já tem conta?' : 'Não tem conta?'}{' '}
            <button onClick={() => { setIsRegister(!isRegister); setAuthError(''); }} className="text-orange-500 font-black underline">
              {isRegister ? 'Entrar' : 'Criar conta'}
            </button>
          </p>

          <a href="#/marketplace" className="block text-center text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-orange-500 transition-all">
            Voltar ao Marketplace
          </a>
        </div>
      </div>
    );
  }

  // ── Dashboard ──────────────────────────────────────────────────────
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'HISTORICO', label: 'Histórico' },
    { key: 'FAVORITOS', label: 'Favoritos' },
    { key: 'CASHBACK', label: 'Cashback' },
    { key: 'PERFIL', label: 'Perfil' },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="bg-black text-white">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-orange-500 mb-1">Minha Conta</p>
            <h1 className="text-xl font-black uppercase tracking-tight">Olá, {session.name.split(' ')[0]}</h1>
          </div>
          <div className="flex items-center gap-3">
            <a href="#/marketplace" className="px-4 py-2 rounded-xl bg-slate-800 text-white font-black text-[9px] uppercase tracking-widest hover:bg-orange-500 transition-all">
              Marketplace
            </a>
          </div>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 -mt-3">
        <div className="bg-white rounded-2xl shadow-xl p-1.5 flex gap-1">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
                tab === t.key ? 'bg-black text-white' : 'text-slate-400 hover:bg-slate-50'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="text-center py-20">
            <div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto mb-4" />
          </div>
        ) : (
          <>
            {/* ── HISTÓRICO ─────────────────────────────────── */}
            {tab === 'HISTORICO' && (
              <div className="space-y-4">
                <h2 className="font-black text-black uppercase tracking-widest text-sm">Meus Procedimentos</h2>
                {history.length === 0 ? (
                  <div className="bg-white rounded-[30px] border-2 border-slate-100 p-10 text-center">
                    <p className="text-4xl mb-3">📋</p>
                    <p className="text-sm font-black text-slate-400">Nenhum procedimento registrado</p>
                    <p className="text-[10px] text-slate-300 font-bold mt-1">Seus agendamentos aparecerão aqui</p>
                    <a href="#/marketplace" className="inline-block mt-4 px-6 py-3 bg-orange-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">
                      Agendar Agora
                    </a>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {history.map((h: any) => {
                      const st = statusLabel(h.status);
                      return (
                        <div key={h.id} className="bg-white rounded-2xl border-2 border-slate-100 p-5 flex items-center gap-4 hover:border-orange-200 transition-all">
                          <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-xl shrink-0">💈</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-black text-black truncate">{h.tenantName}</p>
                            <p className="text-[10px] font-bold text-slate-400">{h.serviceName} — {h.professionalName}</p>
                            <p className="text-[10px] font-bold text-slate-300 mt-0.5">{formatDate(h.date)} às {h.time}</p>
                          </div>
                          <div className="text-right shrink-0">
                            {h.price > 0 && <p className="text-sm font-black text-orange-500">R$ {fmtBRL(h.price)}</p>}
                            <span className={`inline-block mt-1 text-[8px] font-black px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── FAVORITOS ─────────────────────────────────── */}
            {tab === 'FAVORITOS' && (
              <div className="space-y-4">
                <h2 className="font-black text-black uppercase tracking-widest text-sm">Estabelecimentos Favoritos</h2>
                {favorites.length === 0 ? (
                  <div className="bg-white rounded-[30px] border-2 border-slate-100 p-10 text-center">
                    <p className="text-4xl mb-3">❤️</p>
                    <p className="text-sm font-black text-slate-400">Nenhum favorito ainda</p>
                    <p className="text-[10px] text-slate-300 font-bold mt-1">Favorite estabelecimentos no marketplace</p>
                    <a href="#/marketplace" className="inline-block mt-4 px-6 py-3 bg-orange-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">
                      Explorar Marketplace
                    </a>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {favorites.map(t => (
                      <div key={t.id} className="bg-white rounded-3xl border-2 border-slate-100 p-5 space-y-3 hover:border-orange-400 transition-all">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="text-sm font-black uppercase tracking-tight">{t.name}</h3>
                            {t.nicho && <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 uppercase tracking-widest">{t.nicho}</span>}
                          </div>
                          <button onClick={() => removeFavorite(t.id)} className="text-red-400 hover:text-red-600 text-lg transition-all" title="Remover">❤️</button>
                        </div>
                        {t.endereco && <p className="text-[10px] text-slate-400 font-bold">📍 {t.endereco}{t.cidade ? `, ${t.cidade}` : ''}</p>}
                        <a href={`/agendar/${t.slug}`}
                          className="block text-center bg-orange-500 text-white py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">
                          Agendar
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── CASHBACK ──────────────────────────────────── */}
            {tab === 'CASHBACK' && (
              <div className="space-y-4">
                <h2 className="font-black text-black uppercase tracking-widest text-sm">Cashback</h2>
                {!cashback ? (
                  <div className="bg-white rounded-[30px] border-2 border-slate-100 p-10 text-center">
                    <p className="text-4xl mb-3">💰</p>
                    <p className="text-sm font-black text-slate-400">Sem cashback ainda</p>
                    <p className="text-[10px] text-slate-300 font-bold mt-1">Agende pelo marketplace e ganhe cashback!</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="bg-white rounded-2xl border-2 border-slate-100 p-5 text-center">
                      <p className="text-2xl font-black text-orange-500">R$ {fmtBRL(cashback.balance)}</p>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Saldo</p>
                    </div>
                    <div className="bg-white rounded-2xl border-2 border-slate-100 p-5 text-center">
                      <p className="text-2xl font-black text-green-500">R$ {fmtBRL(cashback.totalEarned)}</p>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Total Ganho</p>
                    </div>
                    <div className="bg-white rounded-2xl border-2 border-slate-100 p-5 text-center">
                      <p className="text-2xl font-black text-black">R$ {fmtBRL(cashback.totalUsed)}</p>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Total Usado</p>
                    </div>
                    <div className="bg-white rounded-2xl border-2 border-slate-100 p-5 text-center">
                      <p className="text-2xl font-black text-black">{cashback.bookingsCount}</p>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Agendamentos</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── PERFIL ───────────────────────────────────── */}
            {tab === 'PERFIL' && (
              <div className="space-y-6">
                <h2 className="font-black text-black uppercase tracking-widest text-sm">Meu Perfil</h2>
                <div className="bg-white rounded-[30px] border-2 border-slate-100 p-6 sm:p-8 space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Telefone</label>
                    <input type="text" readOnly value={session.phone} className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold text-slate-400 bg-slate-50" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Nome</label>
                    <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                      className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Cidade</label>
                    <input type="text" value={editCity} onChange={e => setEditCity(e.target.value)}
                      className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
                  </div>
                  <button onClick={handleProfileSave} disabled={profileSaving}
                    className="w-full bg-orange-500 text-white py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all disabled:opacity-50">
                    {profileSaving ? 'Salvando...' : 'Salvar Alterações'}
                  </button>
                </div>

                <button onClick={handleLogout}
                  className="w-full bg-red-50 text-red-500 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-red-100 transition-all border-2 border-red-100">
                  Sair da Conta
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <div className="bg-black text-white py-6">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500">Powered by AgendeZap</p>
        </div>
      </div>
    </div>
  );
};

export default CustomerDashboard;
