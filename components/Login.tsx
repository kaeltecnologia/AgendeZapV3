
import React, { useState } from 'react';

interface LoginProps {
  onLogin: (role: 'SUPERADMIN' | 'TENANT', userSlug?: string, userEmail?: string, userPassword?: string) => Promise<void> | void;
  onRegister?: (storeName: string, email: string, pass: string, phone: string) => Promise<void>;
}

const Login: React.FC<LoginProps> = ({ onLogin, onRegister }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      if (!email || !password || (isSignUp && (!storeName || !phone))) {
        setError('Preencha todos os campos.');
        setLoading(false);
        return;
      }

      const cleanEmail = email.trim();
      const cleanPassword = password.trim();

      if (isSignUp) {
        if (onRegister) {
          await onRegister(storeName, cleanEmail, cleanPassword, phone.trim());
        }
        return;
      }

      // Determine role based on email domain — actual credential
      // validation is handled server-side by App.tsx handleLogin
      const parts = cleanEmail.split('@');
      if (parts.length < 2) {
        setError('Use o e-mail no formato barbearia@agendezap.com');
        setLoading(false);
        return;
      }

      const domain = parts[1].toLowerCase().trim();
      const slug = parts[0].toLowerCase().trim();

      if (domain === 'super.com') {
        // Superadmin login — credentials validated in handleLogin
        await onLogin('SUPERADMIN', undefined, cleanEmail, cleanPassword);
      } else if (domain === 'agendezap.com') {
        await onLogin('TENANT', slug, cleanEmail, cleanPassword);
      } else {
        setError('Por favor, use o e-mail corporativo: @agendezap.com');
        setLoading(false);
        return;
      }
    } catch (err: any) {
      console.error("Submit Error:", err);
      setError(err.message || 'Erro ao processar acesso.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden" style={{ background: '#ffffff' }}>
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'4\' viewBox=\'0 0 4 4\'%3E%3Cpath fill=\'%23000000\' fill-opacity=\'1\' d=\'M1 3h1v1H1V3zm2-2h1v1H2V1z\'%3E%3C/path%3E%3C/svg%3E")' }}></div>
      
      <div className="w-full max-w-[420px] space-y-8 sm:space-y-12 animate-scaleUp z-10 p-6 sm:p-10 rounded-[40px] sm:rounded-[60px] border-2 shadow-2xl" style={{ background: 'rgba(255,255,255,0.5)', backdropFilter: 'blur(8px)', borderColor: '#f8fafc', boxShadow: '0 25px 50px -12px rgba(148,163,184,0.25)' }}>
        <div className="text-center space-y-4">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-orange-500 rounded-[20px] sm:rounded-[30px] flex items-center justify-center text-3xl sm:text-4xl mx-auto shadow-xl shadow-orange-100 animate-bounce transition-all">
            ✂️
          </div>
          <h1 className="text-3xl sm:text-5xl font-black italic tracking-tighter uppercase" style={{ color: '#000' }}>AgendeZap</h1>
          <p className="text-[9px] font-black uppercase tracking-[0.4em]" style={{ color: '#94a3b8' }}>
            {isSignUp ? 'Crie sua conta multi-tenant' : 'Gestão de Barbearia Inteligente'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {isSignUp && (
            <>
              <div className="space-y-2 animate-fadeIn">
                <label className="text-[10px] font-black uppercase tracking-widest ml-4" style={{ color: '#000' }}>Nome do Estabelecimento</label>
                <input
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="Ex: Barbearia do Centro"
                  className="w-full p-4 sm:p-5 rounded-xl sm:rounded-[24px] outline-none focus:border-orange-500 transition-all font-bold" style={{ background: '#f8fafc', border: '2px solid #f1f5f9', color: '#000' }}
                />
              </div>
              <div className="space-y-2 animate-fadeIn">
                <label className="text-[10px] font-black uppercase tracking-widest ml-4" style={{ color: '#000' }}>WhatsApp do Responsável</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(11) 99999-9999"
                  className="w-full p-4 sm:p-5 rounded-xl sm:rounded-[24px] outline-none focus:border-orange-500 transition-all font-bold" style={{ background: '#f8fafc', border: '2px solid #f1f5f9', color: '#000' }}
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest ml-4" style={{ color: '#000' }}>E-mail de Acesso</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sua-barbearia@agendezap.com"
              className="w-full p-4 sm:p-5 rounded-xl sm:rounded-[24px] outline-none focus:border-orange-500 transition-all font-bold" style={{ background: '#f8fafc', border: '2px solid #f1f5f9', color: '#000' }}
              autoComplete="username"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest ml-4" style={{ color: '#000' }}>Senha</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full p-4 sm:p-5 rounded-xl sm:rounded-[24px] outline-none focus:border-orange-500 transition-all font-bold" style={{ background: '#f8fafc', border: '2px solid #f1f5f9', color: '#000' }}
              autoComplete="current-password"
            />
          </div>

          {error && <p className="text-[10px] font-black text-center uppercase tracking-widest p-3 rounded-xl animate-pulse" style={{ color: '#ef4444', background: '#fef2f2', border: '1px solid #fee2e2' }}>{error}</p>}

          <button 
            type="submit"
            disabled={loading}
            className={`w-full py-6 rounded-[24px] font-black uppercase tracking-[0.2em] shadow-2xl hover:bg-orange-500 transition-all active:scale-[0.98] ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            style={{ background: '#000', color: '#fff', boxShadow: '0 25px 50px -12px rgba(148,163,184,0.25)' }}
          >
            {loading ? 'Processando...' : isSignUp ? 'Criar Cadastro' : 'Acessar Painel'}
          </button>
        </form>

        <div className="text-center space-y-4">
          <button 
            onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
            className="text-[10px] font-black uppercase tracking-widest hover:text-orange-500 transition-colors" style={{ color: '#64748b' }}
          >
            {isSignUp ? 'Já possui uma conta? Entre aqui' : 'Ainda não é cliente? Cadastre sua barbearia'}
          </button>
          
          <p className="text-[8px] font-bold uppercase tracking-widest" style={{ color: '#cbd5e1' }}>
            Infraestrutura em Nuvem • SaaS Multi-Tenant © 2026
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
