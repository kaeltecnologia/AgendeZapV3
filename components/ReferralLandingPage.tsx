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

  const inputClass = 'w-full mt-1.5 p-4 rounded-xl bg-gray-50 border-2 border-gray-200 text-gray-900 placeholder-gray-400 font-medium outline-none focus:border-orange-500 focus:bg-white transition-all';

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* ── NAVBAR ────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-black italic tracking-tight text-gray-900">AgendeZap</h1>
          <button
            onClick={scrollToForm}
            className="px-6 py-2.5 bg-orange-500 text-white font-bold rounded-full text-sm hover:bg-orange-600 transition-all shadow-lg shadow-orange-200"
          >
            Testar Grátis
          </button>
        </div>
      </nav>

      {/* ── REFERRAL BANNER ──────────────────────────────────── */}
      {(referralName || isCustomerReferral) && (
        <div className="bg-orange-50 border-b border-orange-100 py-3 px-6 text-center">
          <p className="text-sm text-orange-800">
            {referralName ? (
              <>Você foi indicado por <strong className="font-black">{referralName}</strong></>
            ) : (
              <>Um cliente satisfeito indicou você</>
            )}
            {' '} — crie sua conta e teste grátis por 7 dias!
          </p>
        </div>
      )}

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="py-16 sm:py-24 px-6">
        <div className="max-w-6xl mx-auto flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
          {/* Left — Text */}
          <div className="flex-1 text-center lg:text-left">
            <h2 className="text-4xl sm:text-5xl lg:text-[3.4rem] font-black text-gray-900 leading-[1.1] tracking-tight mb-6">
              Sistema de agendamento pelo WhatsApp para seu negócio
            </h2>
            <p className="text-lg text-gray-500 leading-relaxed mb-8 max-w-lg mx-auto lg:mx-0">
              AgendeZap: sistema completo para barbearias, salões de beleza, manicures, cabeleireiros e esteticistas. Agenda inteligente com IA, relatórios financeiros em tempo real e controle total do seu negócio.
            </p>
            <button
              onClick={scrollToForm}
              className="px-8 py-4 bg-orange-500 text-white font-black rounded-full text-base hover:bg-orange-600 transition-all shadow-xl shadow-orange-200 hover:shadow-orange-300 hover:scale-[1.02] active:scale-[0.98]"
            >
              Testar 7 Dias Grátis
            </button>
            <div className="flex items-center justify-center lg:justify-start gap-6 mt-6 text-sm text-gray-500">
              <span className="flex items-center gap-1.5"><span className="text-green-500">&#10003;</span> Sem complicação</span>
              <span className="flex items-center gap-1.5"><span className="text-green-500">&#10003;</span> Sem contrato</span>
              <span className="flex items-center gap-1.5"><span className="text-green-500">&#10003;</span> Tudo pelo WhatsApp</span>
            </div>
          </div>

          {/* Right — Mockup cards */}
          <div className="flex-1 max-w-md w-full space-y-4">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                  <span className="text-green-600 text-lg">&#9993;</span>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-green-600 uppercase tracking-wider">IA AgendeZap</p>
                  <p className="text-sm font-bold text-gray-800">Agendamento confirmado para Maria às 14:00!</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Faturamento Hoje</p>
                <span className="text-green-500 text-sm">&#8599;</span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 bg-orange-100 text-orange-600 text-[9px] font-black rounded-full uppercase">Popular</span>
              </div>
              <p className="text-3xl font-black text-gray-900">R$ 950,00</p>
              <p className="text-xs text-gray-400 mt-1">18 Atendimentos · 15 Clientes</p>
            </div>
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Fiscal</p>
                <p className="text-sm font-bold text-gray-700">NFS-e emitida</p>
              </div>
              <span className="text-xs font-black text-green-600 bg-green-50 px-3 py-1 rounded-full">Automático</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── RECURSOS ─────────────────────────────────────────── */}
      <section className="py-16 sm:py-20 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <h3 className="text-3xl sm:text-4xl font-black text-gray-900 text-center mb-4">
            Tudo que seu negócio precisa
          </h3>
          <p className="text-base text-gray-500 text-center mb-14 max-w-lg mx-auto">
            O sistema completo para transformar seu negócio com inteligência artificial
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: '🤖', title: 'Agendamento com IA', desc: 'Seus clientes agendam pelo WhatsApp com IA. 24h por dia, sem precisar atender.' },
              { icon: '📊', title: 'Dashboard Inteligente', desc: 'Visão geral do seu negócio em tempo real: faturamento, agendamentos e crescimento.' },
              { icon: '💰', title: 'Gestão Financeira', desc: 'Controle de caixa, comandas, folha de pagamento e notas fiscais integradas.' },
              { icon: '📱', title: 'Agenda Operacional', desc: 'Visualize todos os agendamentos do dia, filtre por profissional e acompanhe cada atendimento.' },
            ].map((b, i) => (
              <div key={i} className="bg-white rounded-2xl p-6 border border-gray-100 hover:border-orange-200 hover:shadow-lg transition-all">
                <p className="text-3xl mb-4">{b.icon}</p>
                <h4 className="font-black text-gray-900 mb-2 text-lg">{b.title}</h4>
                <p className="text-sm text-gray-500 leading-relaxed">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SOCIAL PROOF ─────────────────────────────────────── */}
      <section className="py-14 px-6 bg-white border-y border-gray-100">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-3 gap-4 text-center">
            {[
              { value: '500+', label: 'Estabelecimentos' },
              { value: '50.000+', label: 'Agendamentos' },
              { value: '4.9 ★', label: 'Avaliação Média' },
            ].map((s, i) => (
              <div key={i}>
                <p className="text-3xl sm:text-5xl font-black text-gray-900">{s.value}</p>
                <p className="text-[9px] sm:text-xs font-bold text-gray-400 uppercase tracking-widest mt-2">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PLANOS ───────────────────────────────────────────── */}
      <section className="py-16 sm:py-20 px-6 bg-gray-50">
        <div className="max-w-4xl mx-auto text-center">
          <h3 className="text-3xl sm:text-4xl font-black text-gray-900 mb-3">Planos a partir de</h3>
          <div className="flex items-baseline justify-center gap-1 mb-2">
            <span className="text-xl text-gray-400 font-bold">R$</span>
            <span className="text-6xl sm:text-7xl font-black text-orange-500">39</span>
            <span className="text-xl text-gray-400 font-bold">,90/mês</span>
          </div>
          <p className="text-base text-gray-500 mb-10">Comece com o plano Start e evolua conforme cresce</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-3xl mx-auto">
            {[
              { name: 'Start', price: '39,90', features: ['1 profissional', 'IA agendamento', 'WhatsApp integrado'] },
              { name: 'Profissional', price: '89,90', features: ['3 profissionais', 'Relatórios', 'Follow-up automático'] },
              { name: 'Elite', price: '149,90', features: ['Ilimitado', 'Assistente Admin', 'Todas as features'] },
            ].map((p, i) => (
              <div key={i} className={`rounded-2xl p-6 border-2 transition-all ${i === 1 ? 'border-orange-500 bg-white shadow-xl shadow-orange-100 scale-[1.03]' : 'border-gray-200 bg-white hover:border-orange-300'}`}>
                {i === 1 && <p className="text-[9px] font-black text-orange-500 uppercase tracking-widest mb-2">Mais Popular</p>}
                <p className="font-black text-lg uppercase tracking-wider text-gray-900">{p.name}</p>
                <p className="text-3xl font-black text-gray-900 mt-2 mb-4">R${p.price}<span className="text-sm text-gray-400 font-bold">/mês</span></p>
                <ul className="space-y-2">
                  {p.features.map((f, j) => (
                    <li key={j} className="text-sm text-gray-600 flex items-center gap-2">
                      <span className="text-green-500">&#10003;</span>{f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FORM DE CADASTRO ─────────────────────────────────── */}
      <section ref={formRef} className="py-16 sm:py-20 px-6 bg-white">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <h3 className="text-3xl sm:text-4xl font-black text-gray-900 mb-3">
              Crie sua conta agora
            </h3>
            <p className="text-base text-gray-500">7 dias grátis para testar todas as funcionalidades</p>
          </div>

          <div className="bg-white rounded-3xl border-2 border-gray-100 shadow-2xl shadow-gray-200/50 p-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="text-xs font-bold text-gray-700 ml-1">Nome do Estabelecimento</label>
                <input
                  type="text"
                  value={storeName}
                  onChange={e => setStoreName(e.target.value)}
                  placeholder="Ex: Barbearia do João"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700 ml-1">WhatsApp do Responsável</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="(11) 99999-9999"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700 ml-1">E-mail de Acesso</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700 ml-1">Senha</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputClass}
                />
              </div>

              {error && (
                <p className="text-xs font-bold text-center p-3 rounded-xl bg-red-50 text-red-600 border border-red-100">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className={`w-full py-4 rounded-full font-black uppercase tracking-wider text-base shadow-xl transition-all active:scale-[0.98] ${
                  loading ? 'opacity-50 cursor-not-allowed bg-orange-300 text-white' : 'bg-orange-500 text-white hover:bg-orange-600 shadow-orange-200 hover:shadow-orange-300 hover:scale-[1.01]'
                }`}
              >
                {loading ? 'Criando sua conta...' : 'Testar 7 Dias Grátis'}
              </button>
            </form>

            <div className="flex items-center justify-center gap-6 mt-5 text-xs text-gray-400">
              <span className="flex items-center gap-1"><span className="text-green-500">&#10003;</span> Sem cartão</span>
              <span className="flex items-center gap-1"><span className="text-green-500">&#10003;</span> Sem contrato</span>
              <span className="flex items-center gap-1"><span className="text-green-500">&#10003;</span> Cancele quando quiser</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer className="py-8 px-6 text-center bg-gray-50 border-t border-gray-100">
        <p className="text-xs font-bold text-gray-400">
          AgendeZap © 2026 · Gestão de Agendamentos Inteligente
        </p>
      </footer>
    </div>
  );
};

export default ReferralLandingPage;
