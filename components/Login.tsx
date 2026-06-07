
import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import type { ResellerProfile } from '../types';

interface LoginProps {
  onLogin: (role: 'SUPERADMIN' | 'TENANT' | 'PROFESSIONAL', userSlug?: string, userEmail?: string, userPassword?: string, professionalData?: any) => Promise<void> | void;
  onRegister?: (storeName: string, email: string, pass: string, phone: string) => Promise<void>;
  initialSignUp?: boolean;
  referralName?: string;
  resellerProfile?: ResellerProfile | null;
}

const inputStyle = { background: 'linear-gradient(180deg, #f4f4fc 0%, #eaeaf4 100%)', border: '2px solid #c8c8d8', color: '#1a1a2e', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 2px rgba(160,160,190,0.12)' };
const inputCls = 'w-full p-4 sm:p-5 rounded-xl sm:rounded-[24px] outline-none focus:border-orange-500 transition-all font-bold';

const Login: React.FC<LoginProps> = ({ onLogin, onRegister, initialSignUp, referralName, resellerProfile }) => {
  const [mode, setMode] = useState<'admin' | 'pro'>('admin');
  const [isSignUp, setIsSignUp] = useState(initialSignUp || false);

  // Admin fields
  const [storeName, setStoreName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');

  // Professional fields
  const [proPhone, setProPhone] = useState('');
  const [proPin, setProPin] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!email || !password || (isSignUp && (!storeName || !phone))) {
        setError('Preencha todos os campos.');
        return;
      }
      const cleanEmail = email.trim();
      const cleanPassword = password.trim();
      if (isSignUp) {
        if (onRegister) await onRegister(storeName, cleanEmail, cleanPassword, phone.trim());
        return;
      }
      const parts = cleanEmail.split('@');
      if (parts.length < 2) { setError('Informe um e-mail válido'); return; }
      const domain = parts[1].toLowerCase().trim();
      const slug = parts[0].toLowerCase().trim();
      if (domain === 'super.com') {
        await onLogin('SUPERADMIN', undefined, cleanEmail, cleanPassword);
      } else {
        await onLogin('TENANT', slug, cleanEmail, cleanPassword);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao processar acesso.');
    } finally {
      setLoading(false);
    }
  };

  const handleProSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!proPhone || !proPin) { setError('Informe o WhatsApp e o PIN.'); return; }
      const cleanPhone = proPhone.replace(/\D/g, '');
      const { data, error: rpcErr } = await supabase.rpc('professional_login', {
        p_phone: cleanPhone,
        p_pin: proPin.trim(),
      });
      if (rpcErr) throw new Error(rpcErr.message);
      if (!data || data.error) throw new Error(data?.error || 'Credenciais inválidas');
      await onLogin('PROFESSIONAL', undefined, undefined, undefined, data);
    } catch (err: any) {
      setError(err.message || 'Erro ao autenticar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden" style={{ background: 'linear-gradient(160deg, #d8d8e2 0%, #c8c8d6 20%, #d4d4e0 40%, #c0c0d0 60%, #d0d0dc 80%, #ccccd8 100%)' }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.12) 45%, rgba(255,255,255,0.20) 50%, rgba(255,255,255,0.12) 55%, transparent 70%)', backgroundSize: '200% 100%' }}></div>
      <div className="absolute inset-0 opacity-[0.015] pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'4\' viewBox=\'0 0 4 4\'%3E%3Cpath fill=\'%23000000\' fill-opacity=\'1\' d=\'M1 3h1v1H1V3zm2-2h1v1H2V1z\'%3E%3C/path%3E%3C/svg%3E")' }}></div>

      <div className="w-full max-w-[420px] space-y-8 sm:space-y-10 animate-scaleUp z-10 p-6 sm:p-10 rounded-[40px] sm:rounded-[60px] border-2 shadow-2xl" style={{ background: 'linear-gradient(145deg, rgba(255,255,255,0.7) 0%, rgba(245,245,252,0.6) 30%, rgba(255,255,255,0.65) 50%, rgba(240,240,250,0.6) 70%, rgba(250,250,255,0.65) 100%)', backdropFilter: 'blur(16px)', borderColor: '#b8b8cc', boxShadow: '0 25px 50px -12px rgba(80,80,110,0.22), inset 0 1px 0 rgba(255,255,255,0.8), inset 0 -1px 0 rgba(160,160,190,0.15), 0 0 0 1px rgba(255,255,255,0.3)' }}>
        <div className="text-center space-y-4">
          {resellerProfile ? (
            resellerProfile.logo_url
              ? <img src={resellerProfile.logo_url} alt={resellerProfile.brand_name || 'Logo'} className="h-16 sm:h-20 max-w-[220px] object-contain mx-auto" />
              : resellerProfile.brand_name
                ? <h1 className="text-3xl sm:text-5xl font-black italic tracking-tighter uppercase" style={{ color: '#1a1a2e' }}>{resellerProfile.brand_name}</h1>
                : null
          ) : (
            <>
              <div className="w-16 h-16 sm:w-20 sm:h-20 bg-orange-500 rounded-[20px] sm:rounded-[30px] flex items-center justify-center text-3xl sm:text-4xl mx-auto shadow-xl shadow-orange-100 animate-bounce transition-all">
                ✂️
              </div>
              <h1 className="text-3xl sm:text-5xl font-black italic tracking-tighter uppercase" style={{ color: '#1a1a2e' }}>AgendeZap</h1>
            </>
          )}
          <p className="text-[9px] font-black uppercase tracking-[0.4em]" style={{ color: '#787890' }}>
            {mode === 'pro' ? 'Portal do Profissional' : isSignUp ? 'Crie sua conta' : 'Gestão de Agendamentos Inteligente'}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-2xl overflow-hidden border-2 border-slate-200">
          <button type="button" onClick={() => { setMode('admin'); setError(''); }}
            className={`flex-1 py-3 font-black text-xs uppercase tracking-widest transition-all ${mode === 'admin' ? 'bg-black text-white' : 'bg-white text-slate-400 hover:text-slate-600'}`}>
            👑 Admin
          </button>
          <button type="button" onClick={() => { setMode('pro'); setError(''); setIsSignUp(false); }}
            className={`flex-1 py-3 font-black text-xs uppercase tracking-widest transition-all ${mode === 'pro' ? 'bg-orange-500 text-white' : 'bg-white text-slate-400 hover:text-slate-600'}`}>
            💈 Profissional
          </button>
        </div>

        {mode === 'pro' ? (
          /* ── Professional login ── */
          <form onSubmit={handleProSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest ml-4" style={{ color: '#1a1a2e' }}>WhatsApp (com DDD)</label>
              <input type="tel" value={proPhone} onChange={e => setProPhone(e.target.value)}
                placeholder="5544999999999" className={inputCls} style={inputStyle} autoComplete="tel" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest ml-4" style={{ color: '#1a1a2e' }}>PIN de Acesso</label>
              <input type="password" inputMode="numeric" value={proPin} onChange={e => setProPin(e.target.value.replace(/\D/g,'').slice(0,6))}
                placeholder="••••" maxLength={6} className={`${inputCls} tracking-[0.5em] text-center`} style={inputStyle} autoComplete="one-time-code" />
            </div>
            {error && <p className="text-[10px] font-black text-center uppercase tracking-widest p-3 rounded-xl animate-pulse" style={{ color: '#ef4444', background: '#fef2f2', border: '1px solid #fee2e2' }}>{error}</p>}
            <button type="submit" disabled={loading}
              className={`w-full py-6 rounded-[24px] font-black uppercase tracking-[0.2em] shadow-2xl hover:bg-orange-600 transition-all active:scale-[0.98] ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              style={{ background: 'linear-gradient(180deg, #f97316 0%, #ea6c0f 100%)', color: '#fff', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2), 0 25px 50px -12px rgba(249,115,22,0.35)' }}>
              {loading ? 'Verificando...' : 'Entrar na Agenda'}
            </button>
          </form>
        ) : (
          /* ── Admin login ── */
          <form onSubmit={handleAdminSubmit} className="space-y-5">
            {isSignUp && referralName && (
              <div className="p-4 rounded-2xl text-center animate-fadeIn" style={{ background: 'linear-gradient(135deg, #f3e8ff 0%, #ede9fe 100%)', border: '1px solid #d8b4fe' }}>
                <p className="text-xs font-black text-purple-700">Indicado por <span className="text-purple-900">{referralName}</span></p>
                <p className="text-[10px] text-purple-500 mt-1">Cadastre-se e comece a usar o AgendeZap!</p>
              </div>
            )}
            {isSignUp && (
              <>
                <div className="space-y-2 animate-fadeIn">
                  <label className="text-[10px] font-black uppercase tracking-widest ml-4" style={{ color: '#1a1a2e' }}>Nome do Estabelecimento</label>
                  <input type="text" value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="Ex: Meu Estabelecimento" className={inputCls} style={inputStyle} />
                </div>
                <div className="space-y-2 animate-fadeIn">
                  <label className="text-[10px] font-black uppercase tracking-widest ml-4" style={{ color: '#1a1a2e' }}>WhatsApp do Responsável</label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(11) 99999-9999" className={inputCls} style={inputStyle} />
                </div>
              </>
            )}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest ml-4" style={{ color: '#1a1a2e' }}>E-mail de Acesso</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" className={inputCls} style={inputStyle} autoComplete="username" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest ml-4" style={{ color: '#1a1a2e' }}>Senha</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className={inputCls} style={inputStyle} autoComplete="current-password" />
            </div>
            {error && (error.includes('bloqueada') ? (
              <div className="rounded-2xl p-5 text-center space-y-2 animate-fadeIn" style={{ background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)', border: '2px solid #fca5a5' }}>
                <p className="text-lg">🔒</p>
                <p className="text-xs font-black uppercase tracking-widest text-red-700">Acesso Bloqueado</p>
                <p className="text-[11px] font-bold text-red-600 leading-relaxed">Entre em contato com o setor comercial para regularizar o acesso.</p>
              </div>
            ) : (
              <p className="text-[10px] font-black text-center uppercase tracking-widest p-3 rounded-xl animate-pulse" style={{ color: '#ef4444', background: '#fef2f2', border: '1px solid #fee2e2' }}>{error}</p>
            ))}
            <button type="submit" disabled={loading}
              className={`w-full py-6 rounded-[24px] font-black uppercase tracking-[0.2em] shadow-2xl hover:bg-orange-500 transition-all active:scale-[0.98] ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              style={{ background: 'linear-gradient(180deg, #38384e 0%, #2a2a40 20%, #1a1a2e 60%, #222238 100%)', color: '#fff', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.3), 0 25px 50px -12px rgba(30,30,50,0.35)' }}>
              {loading ? 'Processando...' : isSignUp ? 'Criar Cadastro' : 'Acessar Painel'}
            </button>
          </form>
        )}

        {mode === 'admin' && !resellerProfile && (
          <div className="text-center space-y-4">
            <button onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
              className="text-[10px] font-black uppercase tracking-widest hover:text-orange-600 transition-colors" style={{ color: isSignUp ? '#787890' : '#f97316' }}>
              {isSignUp ? 'Já possui uma conta? Entre aqui' : 'Ainda não é cliente? Clique aqui para criar seu cadastro'}
            </button>
            <p className="text-[8px] font-bold uppercase tracking-widest" style={{ color: '#a0a0b0' }}>
              Infraestrutura em Nuvem • SaaS Multi-Tenant © 2026
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
