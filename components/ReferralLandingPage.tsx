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

  return (
    <div style={{ minHeight: '100vh', background: '#ffffff', color: '#1a1a1a', fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      {/* ── NAVBAR ────────────────────────────────────────────── */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(255,255,255,0.97)', borderBottom: '1px solid #e5e5e5', backdropFilter: 'blur(8px)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 22, fontWeight: 900, fontStyle: 'italic', letterSpacing: '-0.5px', color: '#111' }}>AgendeZap</span>
          <button
            onClick={scrollToForm}
            style={{ padding: '10px 24px', background: '#f97316', color: '#fff', fontWeight: 700, borderRadius: 999, fontSize: 14, border: 'none', cursor: 'pointer', boxShadow: '0 4px 14px rgba(249,115,22,0.3)' }}
          >
            Criar Conta
          </button>
        </div>
      </nav>

      {/* ── REFERRAL BANNER ──────────────────────────────────── */}
      {(referralName || isCustomerReferral) && (
        <div style={{ background: '#fff7ed', borderBottom: '1px solid #fed7aa', padding: '12px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 15, color: '#9a3412', margin: 0 }}>
            {referralName ? (
              <>Você foi indicado por <strong style={{ fontWeight: 900 }}>{referralName}</strong></>
            ) : (
              <>Um cliente satisfeito indicou você</>
            )}
            {' '} — crie sua conta e comece a usar hoje!
          </p>
        </div>
      )}

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section style={{ padding: '64px 24px 80px', background: '#ffffff' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 48 }}>
          {/* Left — Text */}
          <div style={{ flex: '1 1 480px', minWidth: 300 }}>
            <h2 style={{ fontSize: 'clamp(32px, 5vw, 52px)', fontWeight: 900, color: '#111111', lineHeight: 1.08, letterSpacing: '-1px', margin: '0 0 24px' }}>
              Sistema de agendamento pelo WhatsApp para seu negócio
            </h2>
            <p style={{ fontSize: 18, color: '#555555', lineHeight: 1.7, margin: '0 0 32px', maxWidth: 500 }}>
              AgendeZap: sistema completo para barbearias, salões de beleza, manicures, cabeleireiros e esteticistas. Agenda inteligente com IA, relatórios financeiros em tempo real e controle total do seu negócio.
            </p>
            <button
              onClick={scrollToForm}
              style={{ padding: '16px 36px', background: '#f97316', color: '#fff', fontWeight: 900, borderRadius: 999, fontSize: 16, border: 'none', cursor: 'pointer', boxShadow: '0 8px 24px rgba(249,115,22,0.35)', letterSpacing: '0.5px', textTransform: 'uppercase' as const }}
            >
              Começar Agora
            </button>
            <div style={{ display: 'flex', gap: 24, marginTop: 20, flexWrap: 'wrap' as const }}>
              {['Sem complicação', 'Sem contrato', 'Garantia de 7 dias'].map((t, i) => (
                <span key={i} style={{ fontSize: 14, color: '#666', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#22c55e', fontWeight: 700 }}>&#10003;</span> {t}
                </span>
              ))}
            </div>
          </div>

          {/* Right — Mockup cards */}
          <div style={{ flex: '1 1 360px', maxWidth: 420, display: 'flex', flexDirection: 'column' as const, gap: 16 }}>
            <div style={{ background: '#ffffff', borderRadius: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', border: '1px solid #e5e5e5', padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, background: '#dcfce7', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#16a34a', fontSize: 18 }}>&#9993;</span>
                </div>
                <div>
                  <p style={{ fontSize: 10, fontWeight: 800, color: '#16a34a', textTransform: 'uppercase' as const, letterSpacing: 1.5, margin: 0 }}>IA AgendeZap</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#222', margin: '2px 0 0' }}>Agendamento confirmado para Maria às 14:00!</p>
                </div>
              </div>
            </div>
            <div style={{ background: '#ffffff', borderRadius: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', border: '1px solid #e5e5e5', padding: 20 }}>
              <p style={{ fontSize: 10, fontWeight: 900, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 2, margin: '0 0 8px' }}>Faturamento Hoje</p>
              <span style={{ display: 'inline-block', padding: '2px 8px', background: '#fff7ed', color: '#ea580c', fontSize: 9, fontWeight: 900, borderRadius: 99, marginBottom: 4, textTransform: 'uppercase' as const }}>Popular</span>
              <p style={{ fontSize: 32, fontWeight: 900, color: '#111', margin: '4px 0 0' }}>R$ 950,00</p>
              <p style={{ fontSize: 13, color: '#888', margin: '4px 0 0' }}>18 Atendimentos · 15 Clientes</p>
            </div>
            <div style={{ background: '#ffffff', borderRadius: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', border: '1px solid #e5e5e5', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: 10, fontWeight: 900, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 2, margin: 0 }}>Fiscal</p>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#333', margin: '2px 0 0' }}>NFS-e emitida</p>
              </div>
              <span style={{ fontSize: 12, fontWeight: 900, color: '#16a34a', background: '#dcfce7', padding: '4px 12px', borderRadius: 99 }}>Automático</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── RECURSOS ─────────────────────────────────────────── */}
      <section style={{ padding: '80px 24px', background: '#f8f8f8' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <h3 style={{ fontSize: 'clamp(26px, 4vw, 40px)', fontWeight: 900, color: '#111', textAlign: 'center', margin: '0 0 12px' }}>
            Tudo que seu negócio precisa
          </h3>
          <p style={{ fontSize: 16, color: '#777', textAlign: 'center', margin: '0 auto 48px', maxWidth: 500 }}>
            O sistema completo para transformar seu negócio com inteligência artificial
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
            {[
              { icon: '🤖', title: 'Agendamento com IA', desc: 'Seus clientes agendam pelo WhatsApp com IA. 24h por dia, sem precisar atender.' },
              { icon: '📊', title: 'Dashboard Inteligente', desc: 'Visão geral do seu negócio em tempo real: faturamento, agendamentos e crescimento.' },
              { icon: '💰', title: 'Gestão Financeira', desc: 'Controle de caixa, comandas, folha de pagamento e notas fiscais integradas.' },
              { icon: '📱', title: 'Agenda Operacional', desc: 'Visualize todos os agendamentos do dia, filtre por profissional e acompanhe cada atendimento.' },
            ].map((b, i) => (
              <div key={i} style={{ background: '#ffffff', borderRadius: 16, padding: 24, border: '1px solid #e5e5e5' }}>
                <p style={{ fontSize: 32, margin: '0 0 12px' }}>{b.icon}</p>
                <h4 style={{ fontSize: 18, fontWeight: 900, color: '#111', margin: '0 0 8px' }}>{b.title}</h4>
                <p style={{ fontSize: 14, color: '#666', lineHeight: 1.6, margin: 0 }}>{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SOCIAL PROOF ─────────────────────────────────────── */}
      <section style={{ padding: '56px 24px', background: '#ffffff', borderTop: '1px solid #eee', borderBottom: '1px solid #eee' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, textAlign: 'center' }}>
          {[
            { value: '500+', label: 'Estabelecimentos' },
            { value: '50.000+', label: 'Agendamentos' },
            { value: '4.9 ★', label: 'Avaliação Média' },
          ].map((s, i) => (
            <div key={i}>
              <p style={{ fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: 900, color: '#111', margin: 0 }}>{s.value}</p>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase' as const, letterSpacing: 2, marginTop: 6 }}>{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── PLANOS ───────────────────────────────────────────── */}
      <section style={{ padding: '80px 24px', background: '#f8f8f8' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
          <h3 style={{ fontSize: 'clamp(26px, 4vw, 40px)', fontWeight: 900, color: '#111', margin: '0 0 8px' }}>Planos a partir de</h3>
          <p style={{ margin: '0 0 4px' }}>
            <span style={{ fontSize: 20, color: '#999', fontWeight: 700 }}>R$</span>
            <span style={{ fontSize: 64, fontWeight: 900, color: '#f97316' }}>39</span>
            <span style={{ fontSize: 20, color: '#999', fontWeight: 700 }}>,90/mês</span>
          </p>
          <p style={{ fontSize: 16, color: '#777', margin: '0 0 40px' }}>Comece com o plano Start e evolua conforme cresce</p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, maxWidth: 760, margin: '0 auto' }}>
            {[
              { name: 'Start', price: '39,90', features: ['1 profissional', 'IA agendamento', 'WhatsApp integrado'], highlight: false },
              { name: 'Profissional', price: '89,90', features: ['3 profissionais', 'Relatórios', 'Follow-up automático'], highlight: true },
              { name: 'Elite', price: '149,90', features: ['Ilimitado', 'Assistente Admin', 'Todas as features'], highlight: false },
            ].map((p, i) => (
              <div key={i} style={{
                borderRadius: 16, padding: 24,
                border: p.highlight ? '2px solid #f97316' : '2px solid #e0e0e0',
                background: '#ffffff',
                boxShadow: p.highlight ? '0 8px 30px rgba(249,115,22,0.15)' : 'none',
                transform: p.highlight ? 'scale(1.03)' : 'none',
              }}>
                {p.highlight && <p style={{ fontSize: 9, fontWeight: 900, color: '#f97316', textTransform: 'uppercase' as const, letterSpacing: 2, margin: '0 0 8px' }}>Mais Popular</p>}
                <p style={{ fontSize: 18, fontWeight: 900, color: '#111', textTransform: 'uppercase' as const, letterSpacing: 1, margin: 0 }}>{p.name}</p>
                <p style={{ fontSize: 28, fontWeight: 900, color: '#111', margin: '8px 0 16px' }}>R${p.price}<span style={{ fontSize: 13, color: '#999', fontWeight: 600 }}>/mês</span></p>
                {p.features.map((f, j) => (
                  <p key={j} style={{ fontSize: 14, color: '#555', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#22c55e', fontWeight: 700 }}>&#10003;</span> {f}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FORM DE CADASTRO ─────────────────────────────────── */}
      <section ref={formRef} style={{ padding: '80px 24px', background: '#ffffff' }}>
        <div style={{ maxWidth: 440, margin: '0 auto' }}>
          <h3 style={{ fontSize: 'clamp(26px, 4vw, 36px)', fontWeight: 900, color: '#111', textAlign: 'center', margin: '0 0 8px' }}>
            Crie sua conta agora
          </h3>
          <p style={{ fontSize: 16, color: '#777', textAlign: 'center', margin: '0 0 32px' }}>Garantia de reembolso total em até 7 dias</p>

          <div style={{ background: '#fff', borderRadius: 24, border: '2px solid #e5e5e5', boxShadow: '0 12px 40px rgba(0,0,0,0.08)', padding: 32 }}>
            <form onSubmit={handleSubmit}>
              {[
                { label: 'Nome do Estabelecimento', type: 'text', value: storeName, onChange: (v: string) => setStoreName(v), placeholder: 'Ex: Barbearia do João' },
                { label: 'WhatsApp do Responsável', type: 'tel', value: phone, onChange: (v: string) => setPhone(v), placeholder: '(11) 99999-9999' },
                { label: 'E-mail de Acesso', type: 'email', value: email, onChange: (v: string) => setEmail(v), placeholder: 'seu@email.com' },
                { label: 'Senha', type: 'password', value: password, onChange: (v: string) => setPassword(v), placeholder: '••••••••' },
              ].map((f, i) => (
                <div key={i} style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: '#333', marginLeft: 4, display: 'block', marginBottom: 6 }}>{f.label}</label>
                  <input
                    type={f.type}
                    value={f.value}
                    onChange={e => f.onChange(e.target.value)}
                    placeholder={f.placeholder}
                    style={{ width: '100%', padding: '14px 16px', borderRadius: 12, background: '#f5f5f5', border: '2px solid #e0e0e0', color: '#111', fontSize: 15, fontWeight: 500, outline: 'none', boxSizing: 'border-box' as const }}
                    onFocus={e => { e.target.style.borderColor = '#f97316'; e.target.style.background = '#fff'; }}
                    onBlur={e => { e.target.style.borderColor = '#e0e0e0'; e.target.style.background = '#f5f5f5'; }}
                  />
                </div>
              ))}

              {error && (
                <p style={{ fontSize: 13, fontWeight: 700, textAlign: 'center', padding: 12, borderRadius: 12, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', marginBottom: 16 }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%', padding: '16px 0', borderRadius: 999,
                  fontWeight: 900, fontSize: 16, textTransform: 'uppercase' as const, letterSpacing: 1,
                  border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                  background: loading ? '#fdba74' : '#f97316', color: '#fff',
                  opacity: loading ? 0.7 : 1,
                  boxShadow: '0 8px 24px rgba(249,115,22,0.35)',
                  marginTop: 8,
                }}
              >
                {loading ? 'Criando sua conta...' : 'Criar Minha Conta'}
              </button>
            </form>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 16, flexWrap: 'wrap' as const }}>
              {['Pagamento seguro', 'Sem contrato', 'Reembolso em até 7 dias'].map((t, i) => (
                <span key={i} style={{ fontSize: 12, color: '#999', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: '#22c55e', fontWeight: 700 }}>&#10003;</span> {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer style={{ padding: '32px 24px', textAlign: 'center', background: '#f8f8f8', borderTop: '1px solid #eee' }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: '#aaa', margin: 0 }}>
          AgendeZap © 2026 · Gestão de Agendamentos Inteligente
        </p>
      </footer>
    </div>
  );
};

export default ReferralLandingPage;
