import React, { useState } from 'react';
import { SocialMediaProfile } from '../../types';
import { db } from '../../services/mockDb';

const TOTAL_STEPS = 8;

const NICHOS = [
  'Barbearia', 'Salão de Beleza', 'Clínica Estética', 'Estúdio de Tatuagem',
  'Nail Designer', 'Lash Designer', 'Design de Sobrancelhas', 'Clínica Odontológica',
  'Fisioterapia', 'Personal Trainer', 'Nutricionista', 'Psicólogo(a)',
  'Pet Shop / Banho e Tosa', 'Estúdio de Pilates', 'Outro',
];

const ESTILO_IMAGEM = [
  { id: 'premium', label: 'Premium / Sofisticado', desc: 'Alto padrão, luxo, exclusividade', icon: '💎' },
  { id: 'popular', label: 'Popular / Acessível', desc: 'Preço justo, volume, simplicidade', icon: '🤝' },
  { id: 'moderno', label: 'Moderno / Jovem', desc: 'Tendências, inovação, estilo atual', icon: '🔥' },
  { id: 'classico', label: 'Clássico / Tradicional', desc: 'Confiança, tradição, qualidade comprovada', icon: '👔' },
  { id: 'minimalista', label: 'Minimalista / Clean', desc: 'Simplicidade elegante, menos é mais', icon: '✨' },
  { id: 'ousado', label: 'Ousado / Criativo', desc: 'Diferentão, arte, personalidade forte', icon: '🎨' },
];

const PUBLICO_ALVO = [
  { id: 'homens', label: 'Homens', icon: '👨' },
  { id: 'mulheres', label: 'Mulheres', icon: '👩' },
  { id: 'jovens', label: 'Jovens (18-25)', icon: '🧑' },
  { id: 'adultos', label: 'Adultos (25-40)', icon: '👤' },
  { id: 'maduros', label: 'Maduros (40+)', icon: '🧔' },
  { id: 'executivos', label: 'Executivos / Empresários', icon: '💼' },
  { id: 'familias', label: 'Famílias', icon: '👨‍👩‍👧' },
  { id: 'noivas', label: 'Noivas / Eventos', icon: '💒' },
];

const TIPOS_CONTEUDO = [
  { id: 'antes_depois', label: 'Antes e Depois', desc: 'Transformações visuais', icon: '🔄' },
  { id: 'bastidores', label: 'Bastidores', desc: 'Dia a dia, rotina, por trás das câmeras', icon: '🎬' },
  { id: 'dicas', label: 'Dicas e Tutoriais', desc: 'Ensinar algo útil para o seguidor', icon: '💡' },
  { id: 'depoimentos', label: 'Depoimentos', desc: 'Clientes falando sobre a experiência', icon: '⭐' },
  { id: 'promocoes', label: 'Promoções e Ofertas', desc: 'Descontos, combos, oportunidades', icon: '🏷️' },
  { id: 'humor', label: 'Humor e Trends', desc: 'Memes, trends virais, entretenimento', icon: '😂' },
  { id: 'educativo', label: 'Conteúdo Educativo', desc: 'Informações e curiosidades do nicho', icon: '📚' },
  { id: 'lifestyle', label: 'Lifestyle / Dia a Dia', desc: 'Rotina pessoal, conexão com o público', icon: '☕' },
];

const TOM_COMUNICACAO = [
  { id: 'descontraido', label: 'Descontraído', desc: 'Linguagem leve, informal e próxima', icon: '😎' },
  { id: 'profissional', label: 'Profissional', desc: 'Sério, técnico, transmite credibilidade', icon: '🎯' },
  { id: 'inspiracional', label: 'Inspiracional', desc: 'Motiva, emociona, conta histórias', icon: '💫' },
  { id: 'educativo', label: 'Educativo', desc: 'Ensina e agrega valor real', icon: '🎓' },
  { id: 'divertido', label: 'Divertido', desc: 'Usa humor, memes, é engraçado', icon: '🤣' },
  { id: 'provocativo', label: 'Provocativo', desc: 'Polêmico na medida, gera debate', icon: '💥' },
];

const OBJETIVOS = [
  { id: 'atrair', label: 'Atrair Novos Clientes', desc: 'Alcançar pessoas que ainda não te conhecem', icon: '🧲' },
  { id: 'fidelizar', label: 'Fidelizar Clientes', desc: 'Manter quem já é cliente voltando', icon: '🤝' },
  { id: 'autoridade', label: 'Construir Autoridade', desc: 'Ser referência no nicho na sua região', icon: '👑' },
  { id: 'engajamento', label: 'Aumentar Engajamento', desc: 'Mais curtidas, comentários e compartilhamentos', icon: '📈' },
  { id: 'vender', label: 'Vender Mais Serviços', desc: 'Converter seguidores em clientes pagantes', icon: '💰' },
  { id: 'marca', label: 'Fortalecer a Marca', desc: 'Ser lembrado e reconhecido pelo público', icon: '🏆' },
];

const DIFERENCIAIS = [
  { id: 'atendimento', label: 'Atendimento Diferenciado', icon: '💎' },
  { id: 'ambiente', label: 'Ambiente / Espaço Bonito', icon: '🏠' },
  { id: 'tecnica', label: 'Técnica / Habilidade', icon: '✂️' },
  { id: 'preco', label: 'Preço Competitivo', icon: '💲' },
  { id: 'localizacao', label: 'Localização Privilegiada', icon: '📍' },
  { id: 'produtos', label: 'Produtos Premium', icon: '🧴' },
  { id: 'rapidez', label: 'Rapidez no Atendimento', icon: '⚡' },
  { id: 'exclusividade', label: 'Exclusividade / Personalização', icon: '🌟' },
];

const DIAS_SEMANA = [
  { id: 'seg', label: 'Segunda', short: 'S', icon: '📅' },
  { id: 'ter', label: 'Terça', short: 'T', icon: '📅' },
  { id: 'qua', label: 'Quarta', short: 'Q', icon: '📅' },
  { id: 'qui', label: 'Quinta', short: 'Q', icon: '📅' },
  { id: 'sex', label: 'Sexta', short: 'S', icon: '📅' },
  { id: 'sab', label: 'Sábado', short: 'S', icon: '📅' },
  { id: 'dom', label: 'Domingo', short: 'D', icon: '📅' },
];

const PLATAFORMAS = [
  { id: 'instagram', label: 'Instagram', icon: '📸', color: 'purple' },
  { id: 'tiktok', label: 'TikTok', icon: '🎵', color: 'pink' },
  { id: 'whatsapp', label: 'WhatsApp Status', icon: '📱', color: 'green' },
];

interface Props {
  tenantId: string;
  onComplete: (profile: SocialMediaProfile) => void;
}

// Reusable multi-select card grid
const MultiSelectGrid: React.FC<{
  options: { id: string; label: string; desc?: string; icon: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  columns?: number;
}> = ({ options, selected, onToggle, columns = 2 }) => (
  <div className={`grid gap-3 ${columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
    {options.map(opt => {
      const isSelected = selected.includes(opt.id);
      return (
        <button
          key={opt.id}
          onClick={() => onToggle(opt.id)}
          className={`flex items-start gap-3 rounded-2xl border p-4 transition-all duration-300 text-left ${
            isSelected
              ? 'border-orange-300 bg-orange-50 shadow-md'
              : 'border-slate-100 hover:border-slate-200 hover:shadow-sm'
          }`}
        >
          <span className="text-xl mt-0.5">{opt.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900">{opt.label}</p>
            {opt.desc && <p className="text-xs text-slate-400 mt-0.5 leading-tight">{opt.desc}</p>}
          </div>
          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
            isSelected ? 'bg-orange-500 border-orange-500 text-white' : 'border-slate-200'
          }`}>
            {isSelected && <span className="text-[9px] font-bold">✓</span>}
          </div>
        </button>
      );
    })}
  </div>
);

const ContentOnboarding: React.FC<Props> = ({ tenantId, onComplete }) => {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Form state
  const [nicho, setNicho] = useState('');
  const [nichoCustom, setNichoCustom] = useState('');
  const [estiloImagem, setEstiloImagem] = useState<string[]>([]);
  const [publicoAlvo, setPublicoAlvo] = useState<string[]>([]);
  const [tiposConteudo, setTiposConteudo] = useState<string[]>([]);
  const [tomComunicacao, setTomComunicacao] = useState<string[]>([]);
  const [objetivos, setObjetivos] = useState<string[]>([]);
  const [diferenciais, setDiferenciais] = useState<string[]>([]);
  // postsPerWeek is derived from diasSemana.length (no separate state needed)
  const [diasSemana, setDiasSemana] = useState<string[]>(['seg', 'ter', 'qua', 'qui', 'sex']);
  const [plataformas, setPlataformas] = useState<string[]>(['instagram']);
  const [gerarImagem, setGerarImagem] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => {
    set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  };

  const canAdvance = () => {
    switch (step) {
      case 1: return (nicho && nicho !== 'Outro') || nichoCustom.trim().length > 0;
      case 2: return estiloImagem.length > 0;
      case 3: return publicoAlvo.length > 0;
      case 4: return tiposConteudo.length > 0;
      case 5: return tomComunicacao.length > 0;
      case 6: return objetivos.length > 0 && diferenciais.length > 0;
      case 7: return diasSemana.length > 0;
      case 8: return plataformas.length > 0;
      default: return false;
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    const profile: SocialMediaProfile = {
      nicho: nicho === 'Outro' ? nichoCustom.trim() : nicho,
      estiloImagem,
      publicoAlvo,
      tiposConteudo,
      tomComunicacao,
      objetivos,
      diferenciais,
      postsPerWeek: diasSemana.length,
      diasSemana,
      plataformas,
      gerarImagem,
      createdAt: new Date().toISOString(),
    };
    try {
      await db.updateSettings(tenantId, { socialMediaProfile: profile });
      onComplete(profile);
    } catch (e) {
      console.error('[ContentOnboarding] Error saving:', e);
    }
    setSaving(false);
  };

  const progress = ((step - 1) / (TOTAL_STEPS - 1)) * 100;

  const STEP_TITLES: Record<number, { title: string; subtitle: string }> = {
    1: { title: 'Seu Negócio', subtitle: 'Qual o nicho do seu negócio?' },
    2: { title: 'Estilo de Imagem', subtitle: 'Que imagem você quer passar? Selecione uma ou mais.' },
    3: { title: 'Público-Alvo', subtitle: 'Quem são seus clientes ideais? Selecione todos que se aplicam.' },
    4: { title: 'Tipos de Conteúdo', subtitle: 'Que tipo de conteúdo você quer criar? Selecione seus favoritos.' },
    5: { title: 'Tom de Comunicação', subtitle: 'Como você quer se comunicar? Selecione os tons que combinam.' },
    6: { title: 'Objetivos e Diferenciais', subtitle: 'O que você quer alcançar e o que te diferencia?' },
    7: { title: 'Dias e Frequência', subtitle: 'Em quais dias você quer postar e com que frequência?' },
    8: { title: 'Plataformas', subtitle: 'Onde você publica seu conteúdo?' },
  };

  const currentStep = STEP_TITLES[step];

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-rose-500 rounded-[20px] flex items-center justify-center mx-auto text-3xl shadow-lg shadow-orange-200">
          🎬
        </div>
        <h1 className="font-display text-2xl font-extrabold text-slate-900">Social Mídia</h1>
        <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
          Responda as perguntas para a IA entender seu perfil e gerar um calendário de conteúdo personalizado.
        </p>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-slate-400">
          <span className="font-medium">Etapa {step} de {TOTAL_STEPS}</span>
          <span className="font-medium">{Math.round(progress)}%</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-orange-400 to-rose-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="bg-white rounded-[24px] border border-slate-100 shadow-sm p-4 sm:p-8 space-y-6">
        <div className="space-y-1">
          <h2 className="font-display text-base font-extrabold text-slate-900">{currentStep.title}</h2>
          <p className="text-sm text-slate-400">{currentStep.subtitle}</p>
        </div>

        {/* Step 1: Nicho */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {NICHOS.map(n => (
                <button
                  key={n}
                  onClick={() => { setNicho(n); if (n !== 'Outro') setNichoCustom(''); }}
                  className={`rounded-2xl border p-4 text-center transition-all duration-300 ${
                    nicho === n
                      ? 'border-orange-300 bg-orange-50 shadow-md'
                      : 'border-slate-100 hover:border-slate-200 hover:shadow-sm'
                  }`}
                >
                  <p className="text-sm font-bold text-slate-900">{n}</p>
                </button>
              ))}
            </div>
            {nicho === 'Outro' && (
              <input
                type="text"
                value={nichoCustom}
                onChange={e => setNichoCustom(e.target.value)}
                placeholder="Digite o seu nicho..."
                className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400"
              />
            )}
          </div>
        )}

        {/* Step 2: Estilo de Imagem */}
        {step === 2 && (
          <MultiSelectGrid
            options={ESTILO_IMAGEM}
            selected={estiloImagem}
            onToggle={id => toggle(estiloImagem, setEstiloImagem, id)}
          />
        )}

        {/* Step 3: Público-Alvo */}
        {step === 3 && (
          <MultiSelectGrid
            options={PUBLICO_ALVO}
            selected={publicoAlvo}
            onToggle={id => toggle(publicoAlvo, setPublicoAlvo, id)}
            columns={3}
          />
        )}

        {/* Step 4: Tipos de Conteúdo */}
        {step === 4 && (
          <MultiSelectGrid
            options={TIPOS_CONTEUDO}
            selected={tiposConteudo}
            onToggle={id => toggle(tiposConteudo, setTiposConteudo, id)}
          />
        )}

        {/* Step 5: Tom de Comunicação */}
        {step === 5 && (
          <MultiSelectGrid
            options={TOM_COMUNICACAO}
            selected={tomComunicacao}
            onToggle={id => toggle(tomComunicacao, setTomComunicacao, id)}
          />
        )}

        {/* Step 6: Objetivos + Diferenciais */}
        {step === 6 && (
          <div className="space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-500">Seus objetivos</p>
              <MultiSelectGrid
                options={OBJETIVOS}
                selected={objetivos}
                onToggle={id => toggle(objetivos, setObjetivos, id)}
              />
            </div>
            <div className="border-t border-slate-100 pt-6 space-y-3">
              <p className="text-xs font-semibold text-slate-500">Seus diferenciais</p>
              <MultiSelectGrid
                options={DIFERENCIAIS}
                selected={diferenciais}
                onToggle={id => toggle(diferenciais, setDiferenciais, id)}
                columns={3}
              />
            </div>
          </div>
        )}

        {/* Step 7: Dias da Semana */}
        {step === 7 && (
          <div className="space-y-4">
            <p className="text-xs font-semibold text-slate-500">Selecione os dias que você quer postar</p>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {DIAS_SEMANA.map(d => {
                const selected = diasSemana.includes(d.id);
                return (
                  <button
                    key={d.id}
                    onClick={() => toggle(diasSemana, setDiasSemana, d.id)}
                    className={`rounded-2xl border p-3 text-center transition-all duration-300 ${
                      selected
                        ? 'border-orange-300 bg-orange-50 shadow-md'
                        : 'border-slate-100 hover:border-slate-200 hover:shadow-sm'
                    }`}
                  >
                    <p className="font-display text-lg font-bold text-slate-900">{d.short}</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">{d.label}</p>
                  </button>
                );
              })}
            </div>
            <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200/50 rounded-xl p-4 flex items-center gap-3">
              <span className="text-2xl">📅</span>
              <div>
                <p className="font-display text-sm font-bold text-slate-900">
                  {diasSemana.length} vídeo{diasSemana.length !== 1 ? 's' : ''} por semana
                </p>
                <p className="text-xs text-slate-500">A IA vai gerar 1 roteiro para cada dia selecionado.</p>
              </div>
            </div>
          </div>
        )}

        {/* Step 8: Plataformas + Geração de Imagem */}
        {step === 8 && (
          <div className="space-y-6">
            <div className="space-y-3">
              {PLATAFORMAS.map(p => {
                const selected = plataformas.includes(p.id);
                const borderColor = selected
                  ? p.color === 'purple' ? 'border-purple-300 bg-purple-50'
                  : p.color === 'pink' ? 'border-pink-300 bg-pink-50'
                  : 'border-green-300 bg-green-50'
                  : 'border-slate-100 hover:border-slate-200 hover:shadow-sm';
                return (
                  <button
                    key={p.id}
                    onClick={() => toggle(plataformas, setPlataformas, p.id)}
                    className={`w-full flex items-center gap-4 rounded-2xl border p-4 transition-all duration-300 text-left ${borderColor}`}
                  >
                    <span className="text-2xl">{p.icon}</span>
                    <p className="text-sm font-bold text-slate-900 flex-1">{p.label}</p>
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                      selected ? 'bg-orange-500 border-orange-500 text-white' : 'border-slate-200'
                    }`}>
                      {selected && <span className="text-[9px] font-bold">✓</span>}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="border-t border-slate-100 pt-6">
              <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200/50 rounded-xl p-4 flex items-center gap-3">
                <span className="text-2xl">🎬</span>
                <div>
                  <p className="font-display text-sm font-bold text-slate-900">Foco 100% em Vídeos</p>
                  <p className="text-xs text-slate-500">Todos os roteiros serão para Reels e TikTok com direção cena a cena.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex gap-4">
        {step > 1 && (
          <button
            onClick={() => setStep(step - 1)}
            className="flex-1 py-4 rounded-2xl font-display font-bold text-sm border border-slate-200 text-slate-500 hover:border-slate-400 transition-all duration-300"
          >
            ← Voltar
          </button>
        )}
        {step < TOTAL_STEPS ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={!canAdvance()}
            className="flex-1 py-4 rounded-2xl font-display font-bold text-sm bg-slate-900 text-white hover:bg-orange-500 transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Próximo →
          </button>
        ) : (
          <button
            onClick={handleFinish}
            disabled={!canAdvance() || saving}
            className="flex-1 py-4 rounded-2xl font-display font-bold text-sm bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:shadow-xl hover:shadow-orange-200 hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Salvando...
              </>
            ) : (
              'Gerar Calendário'
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default ContentOnboarding;
