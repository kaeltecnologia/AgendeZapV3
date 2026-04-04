import React, { useState, useRef } from 'react';

interface Props {
  referralName?: string;
  isCustomerReferral?: boolean;
  onRegister: (storeName: string, email: string, pass: string, phone: string) => Promise<void>;
}

const ReferralLandingPage: React.FC<Props> = ({ referralName, isCustomerReferral, onRegister }) => {
  const [storeName, setStoreName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!storeName || !email || !password || !phone) {
      setError('Preencha todos os campos.');
      return;
    }
    setLoading(true);
    try {
      await onRegister(storeName, email.trim(), password.trim(), phone.trim());
    } catch (err: any) {
      setError(err.message || 'Erro ao criar conta.');
    } finally {
      setLoading(false);
    }
  };

  const subtitle = referralName
    ? `*${referralName}* te indicou para conhecer o melhor sistema de agendamentos do Brasil.`
    : isCustomerReferral
      ? 'Um cliente satisfeito indicou você para conhecer o melhor sistema de agendamentos do Brasil.'
      : 'Você foi indicado para conhecer o melhor sistema de agendamentos do Brasil.';

  return (
    <div className="min-h-screen bg-white">
      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden" style={{ background: 'linear-gradient(160deg, #4c1d95 0%, #6d28d9 30%, #7c3aed 60%, #8b5cf6 100%)' }}>
        {/* Decorative circles */}
        <div className="absolute top-[-80px] right-[-80px] w-64 h-64 rounded-full bg-white/5 blur-2xl" />
        <div className="absolute bottom-[-60px] left-[-60px] w-48 h-48 rounded-full bg-indigo-400/10 blur-2xl" />

        <div className="relative max-w-4xl mx-auto px-6 py-16 sm:py-24 text-center">
          <div className="w-20 h-20 bg-white/10 backdrop-blur-sm rounded-3xl flex items-center justify-center text-4xl mx-auto mb-8 shadow-2xl border border-white/20">
            ✂️
          </div>

          <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight mb-4">
            Você foi convidado para o<br />
            <span className="italic" style={{ background: 'linear-gradient(90deg, #fbbf24, #f59e0b)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              AgendeZap
            </span>
          </h1>

          {referralName && (
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-5 py-2 mb-4 border border-white/20">
              <span className="text-sm text-purple-200">Indicado por</span>
              <span className="text-sm font-black text-white">{referralName}</span>
            </div>
          )}

          <p className="text-base sm:text-lg text-purple-100 max-w-xl mx-auto mb-10 leading-relaxed">
            {subtitle.replace(/\*/g, '')}
          </p>

          <button
            onClick={scrollToForm}
            className="px-10 py-5 bg-white text-purple-700 font-black uppercase tracking-wider rounded-2xl text-sm shadow-2xl hover:shadow-3xl hover:scale-[1.02] transition-all active:scale-[0.98]"
          >
            Criar Minha Conta Grátis
          </button>

          <p className="text-[10px] text-purple-300 mt-4 font-bold">7 dias grátis • Sem cartão de crédito</p>
        </div>
      </section>

      {/* ── BENEFÍCIOS ───────────────────────────────────────── */}
      <section className="py-16 sm:py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-center text-slate-800 mb-3">
            Tudo que você precisa em um só lugar
          </h2>
          <p className="text-sm text-slate-400 text-center mb-12 max-w-lg mx-auto">
            O sistema completo para transformar seu negócio com inteligência artificial
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {[
              { icon: '🤖', title: 'Agendamento com IA', desc: 'Seus clientes agendam pelo WhatsApp com inteligência artificial. 24h por dia, sem precisar atender.' },
              { icon: '📊', title: 'Dashboard Inteligente', desc: 'Relatórios, métricas e insights em tempo real sobre seu negócio. Tudo num painel visual.' },
              { icon: '💰', title: 'Gestão Financeira', desc: 'Controle de caixa, comandas, folha de pagamento e notas fiscais integradas.' },
              { icon: '📱', title: 'Marketplace Integrado', desc: 'Sua página de agendamento online pronta para compartilhar. Seus clientes agendam de qualquer lugar.' },
            ].map((b, i) => (
              <div key={i} className="bg-slate-50 rounded-2xl p-6 border border-slate-100 hover:border-purple-200 hover:shadow-lg transition-all">
                <p className="text-3xl mb-3">{b.icon}</p>
                <h3 className="font-black text-slate-800 mb-2">{b.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SOCIAL PROOF ─────────────────────────────────────── */}
      <section className="py-12 border-y border-slate-100" style={{ background: 'linear-gradient(180deg, #faf5ff 0%, #f5f3ff 100%)' }}>
        <div className="max-w-4xl mx-auto px-6">
          <div className="grid grid-cols-3 gap-4 text-center">
            {[
              { value: '500+', label: 'Estabelecimentos' },
              { value: '50.000+', label: 'Agendamentos' },
              { value: '4.9 ★', label: 'Avaliação Média' },
            ].map((s, i) => (
              <div key={i}>
                <p className="text-2xl sm:text-4xl font-black text-purple-600">{s.value}</p>
                <p className="text-[9px] sm:text-[10px] font-black text-purple-400 uppercase tracking-widest mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PLANOS ───────────────────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-black text-slate-800 mb-3">Planos a partir de</h2>
          <div className="flex items-baseline justify-center gap-1 mb-2">
            <span className="text-lg text-slate-400 font-bold">R$</span>
            <span className="text-5xl sm:text-6xl font-black text-purple-600">39</span>
            <span className="text-lg text-slate-400 font-bold">,90/mês</span>
          </div>
          <p className="text-sm text-slate-400 mb-8">Comece com o plano Start e evolua conforme cresce</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
            {[
              { name: 'Start', price: '39,90', features: '1 profissional • IA agendamento' },
              { name: 'Profissional', price: '89,90', features: '3 profissionais • Relatórios' },
              { name: 'Elite', price: '149,90', features: 'Ilimitado • Assistente Admin' },
            ].map((p, i) => (
              <div key={i} className={`rounded-2xl p-5 border ${i === 1 ? 'border-purple-300 bg-purple-50 shadow-lg scale-105' : 'border-slate-100 bg-white'}`}>
                <p className={`font-black text-sm uppercase tracking-wider ${i === 1 ? 'text-purple-600' : 'text-slate-600'}`}>{p.name}</p>
                <p className="text-2xl font-black text-slate-800 mt-1">R${p.price}</p>
                <p className="text-[10px] text-slate-400 mt-2">{p.features}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FORM DE CADASTRO ─────────────────────────────────── */}
      <section ref={formRef} className="py-16 sm:py-20 px-6" style={{ background: 'linear-gradient(160deg, #4c1d95 0%, #6d28d9 30%, #7c3aed 60%, #8b5cf6 100%)' }}>
        <div className="max-w-md mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-white text-center mb-2">
            Crie sua conta agora
          </h2>
          <p className="text-sm text-purple-200 text-center mb-8">7 dias grátis para testar todas as funcionalidades</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-purple-200 ml-1">Nome do Estabelecimento</label>
              <input
                type="text"
                value={storeName}
                onChange={e => setStoreName(e.target.value)}
                placeholder="Ex: Barbearia do João"
                className="w-full mt-1 p-4 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-white placeholder-purple-300 font-bold outline-none focus:border-white/50 transition-all"
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-purple-200 ml-1">WhatsApp do Responsável</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="(11) 99999-9999"
                className="w-full mt-1 p-4 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-white placeholder-purple-300 font-bold outline-none focus:border-white/50 transition-all"
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-purple-200 ml-1">E-mail de Acesso</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full mt-1 p-4 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-white placeholder-purple-300 font-bold outline-none focus:border-white/50 transition-all"
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-purple-200 ml-1">Senha</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full mt-1 p-4 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-white placeholder-purple-300 font-bold outline-none focus:border-white/50 transition-all"
              />
            </div>

            {error && (
              <p className="text-[10px] font-black text-center uppercase tracking-widest p-3 rounded-xl bg-red-500/20 text-red-200 border border-red-400/30">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full py-5 rounded-2xl font-black uppercase tracking-widest text-sm shadow-2xl transition-all active:scale-[0.98] ${
                loading ? 'opacity-50 cursor-not-allowed bg-white/50 text-purple-400' : 'bg-white text-purple-700 hover:bg-purple-50 hover:scale-[1.01]'
              }`}
            >
              {loading ? 'Criando sua conta...' : 'Começar Grátis por 7 Dias'}
            </button>
          </form>

          <p className="text-[9px] text-purple-300 text-center mt-4">
            Ao criar sua conta, você concorda com os Termos de Uso e Política de Privacidade.
          </p>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer className="py-8 px-6 text-center bg-slate-50 border-t border-slate-100">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          AgendeZap © 2026 • Infraestrutura em Nuvem • SaaS Multi-Tenant
        </p>
      </footer>
    </div>
  );
};

export default ReferralLandingPage;
