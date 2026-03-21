import React, { useState, useEffect, useCallback } from 'react';
import OpenAI from 'openai';
import { SocialMediaProfile, ContentCalendar as CalendarType, MonthStrategy, ContentDay, ScriptScene } from '../../types';
import { db } from '../../services/mockDb';

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const DIA_MAP: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
const DIA_LABEL: Record<string, string> = { dom: 'domingo', seg: 'segunda', ter: 'terça', qua: 'quarta', qui: 'quinta', sex: 'sexta', sab: 'sábado' };

const MONTH_THEMES = [
  'Construindo Presença',
  'Autoridade no Nicho',
  'Engajamento e Comunidade',
  'Conteúdo de Valor',
  'Prova Social',
  'Consolidando Seguidores',
  'Bastidores e Autenticidade',
  'Tendências e Inovação',
  'Depoimentos e Cases',
  'Campanhas Sazonais',
  'Fechamento e Ofertas',
  'Retrospectiva e Planejamento',
];

interface Props {
  tenantId: string;
  profile: SocialMediaProfile;
}

type ViewMode = 'year' | 'month' | 'day';

const formatSec = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `0:${String(sec).padStart(2, '0')}`;
};

const ContentCalendar: React.FC<Props> = ({ tenantId, profile }) => {
  const [calendar, setCalendar] = useState<CalendarType | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generationStage, setGenerationStage] = useState<string>('');
  const [generationProgress, setGenerationProgress] = useState<number>(0);
  const [viewMode, setViewMode] = useState<ViewMode>('year');
  const [selectedMonth, setSelectedMonth] = useState<MonthStrategy | null>(null);
  const [selectedDay, setSelectedDay] = useState<ContentDay | null>(null);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const loadCalendar = useCallback(async () => {
    setLoading(true);
    try {
      const settings = await db.getSettings(tenantId);
      if (settings.contentCalendar) {
        setCalendar(settings.contentCalendar);
      }
    } catch (e) {
      console.error('[ContentCalendar] load error:', e);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { loadCalendar(); }, [loadCalendar]);

  const generateStrategies = async (): Promise<CalendarType> => {
    const strategies: MonthStrategy[] = [];
    for (let i = 0; i < 12; i++) {
      const m = ((currentMonth - 1 + i) % 12) + 1;
      const y = currentYear + Math.floor((currentMonth - 1 + i) / 12);
      strategies.push({
        month: m,
        year: y,
        theme: MONTH_THEMES[i % 12],
        description: '',
        days: [],
        generated: false,
      });
    }
    return { strategies, startMonth: currentMonth, startYear: currentYear };
  };

  const resolveApiKey = async (): Promise<string> => {
    const settings = await db.getSettings(tenantId);
    let key = ((settings as any).openaiApiKey || '').trim();
    if (!key) {
      const tenant = await db.getTenant(tenantId);
      key = ((tenant as any)?.gemini_api_key || '').trim();
    }
    if (!key) {
      const cfg = await db.getGlobalConfig();
      key = (cfg['shared_openai_key'] || '').trim();
    }
    return key;
  };

  const diasPermitidos = (profile.diasSemana || ['seg', 'ter', 'qua', 'qui', 'sex']).map(d => DIA_LABEL[d] || d).join(', ');

  const generateMonthContent = async (strategy: MonthStrategy): Promise<ContentDay[]> => {
    const apiKey = await resolveApiKey();
    if (!apiKey) {
      throw new Error('Chave OpenAI não configurada. Peça ao administrador para adicionar no SuperAdmin > IA.');
    }

    const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
    const totalPosts = profile.postsPerWeek * 4;
    const daysInMonth = new Date(strategy.year, strategy.month, 0).getDate();

    const prompt = `Você é um diretor criativo e estrategista de conteúdo de VÍDEO para redes sociais, especializado no nicho "${profile.nicho}". Você cria roteiros CINEMATOGRÁFICOS segundo a segundo — tão detalhados que o profissional só precisa apertar REC e seguir as instruções.

IMPORTANTE: TODOS os conteúdos são VÍDEOS. Não sugira fotos ou carrosséis. O foco é 100% em vídeos curtos (Reels/TikTok).

PERFIL DO NEGÓCIO:
- Nicho: ${profile.nicho}
- Estilo de imagem: ${profile.estiloImagem.join(', ')}
- Público-alvo: ${profile.publicoAlvo.join(', ')}
- Tipos de conteúdo preferidos: ${profile.tiposConteudo.join(', ')}
- Tom de comunicação: ${profile.tomComunicacao.join(', ')}
- Objetivos: ${profile.objetivos.join(', ')}
- Diferenciais: ${profile.diferenciais.join(', ')}
- Frequência: ${profile.postsPerWeek}x por semana
- Dias permitidos: ${diasPermitidos}
- Plataformas: ${profile.plataformas.join(', ')}

ESTRATÉGIA DO MÊS: "${strategy.theme}"
Mês: ${MONTH_NAMES[strategy.month - 1]} ${strategy.year}
Dias no mês: ${daysInMonth}

REGRAS:
1. Gere exatamente ${totalPosts} vídeos APENAS nos dias: ${diasPermitidos}
2. NUNCA agende em dias fora da lista permitida
3. Horário de postagem entre 10:00 e 20:00 (varie estrategicamente)
4. TODOS os conteúdos são VÍDEOS — Reels ou Feed (vídeo)

FORMATO DE CADA VÍDEO — JSON com estas chaves:
- date: "YYYY-MM-DD" (apenas dias permitidos)
- postTime: "HH:MM"
- title: título criativo e emocional do vídeo
- placement: "reels" | "feed" (tipo de vídeo: reels curto ou vídeo para feed)
- objective: objetivo em 1-2 frases
- intro: contexto estratégico do conteúdo (2 frases)
- totalDuration: duração sugerida do vídeo (ex: "30-45s", "15-20s", "60s")
- musicSuggestion: música ou estilo musical para o vídeo (ex: "Lo-fi chill para fundo", "Trending audio 'espresso' da Sabrina Carpenter", "Beat motivacional trap")
- scriptTimeline: array de CENAS com roteiro SEGUNDO A SEGUNDO. Cada cena:
  {
    "startSec": 0,
    "endSec": 5,
    "label": "Abertura" (nome da cena: Abertura, Gancho, Desenvolvimento, Revelação, CTA, etc),
    "action": "O que acontece visualmente nesta cena — descreva o cenário, movimento, enquadramento",
    "spokenLine": "Fala EXATA que o profissional deve dizer nesta cena, entre aspas. Se não fala, omita este campo.",
    "music": "Sugestão de música/efeito sonoro NESTA cena específica (opcional)",
    "gesture": "Gesto, expressão facial ou movimento corporal do profissional (ex: 'olhar fixo para câmera', 'apontar para o cliente', 'sorriso confiante')",
    "cameraAngle": "Ângulo de câmera (close no rosto, plano médio, POV do cliente, câmera lenta no detalhe, panorâmica do espaço)",
    "onScreenText": "Texto que aparece na tela neste momento (legenda, título, dado) — opcional"
  }
  IMPORTANTE sobre scriptTimeline:
  - Mínimo 4 cenas, máximo 8 cenas por vídeo
  - O CTA deve ser a ÚLTIMA CENA do timeline (integrado no fluxo, não separado)
  - As falas (spokenLine) devem ser NATURAIS e COLOQUIAIS, como se estivesse falando com um amigo
  - Inclua gestos e expressões em TODAS as cenas
  - Varie os ângulos de câmera entre cenas
  - A primeira cena SEMPRE deve ser um gancho forte que prenda atenção nos primeiros 3 segundos

- editing: dicas gerais de edição do vídeo (cortes, transições, velocidade, efeitos)
- cta: texto curto do CTA para referência rápida
- hashtags: array com 8-12 hashtags
- captionSuggestion: legenda completa para a postagem do vídeo (com emojis, quebras de linha, CTA)
- storyEngagement: array com 2-3 stories para engajamento, cada uma: { "horario": "HH:MM", "tipo": "video_trecho"|"enquete"|"caixinha"|"contagem_regressiva", "descricao": "o que postar" }

Retorne JSON com chave "posts" contendo o array.`;

    let parsed: any[];
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Você é um diretor criativo de conteúdo para redes sociais. Crie roteiros cinematográficos segundo a segundo. Responda sempre em JSON válido com chave "posts". Sem markdown.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.85,
        response_format: { type: 'json_object' },
      });

      const raw = response.choices[0]?.message?.content || '{}';
      const obj = JSON.parse(raw);
      parsed = Array.isArray(obj) ? obj : (obj.posts || obj.content || obj.calendar || obj.data || Object.values(obj)[0] || []);
    } catch (e: any) {
      const msg = e?.message || JSON.stringify(e);
      if (msg.includes('Incorrect API key') || msg.includes('invalid_api_key')) {
        throw new Error('Chave OpenAI inválida. Vá em Configurações > IA e atualize sua chave.');
      }
      if (msg.includes('insufficient_quota') || msg.includes('rate_limit')) {
        throw new Error('Cota da OpenAI esgotada. Verifique seu billing em platform.openai.com');
      }
      throw new Error(`Erro na IA: ${msg.substring(0, 150)}`);
    }

    const days: ContentDay[] = (Array.isArray(parsed) ? parsed : []).map((d: any) => ({
      date: d.date || '',
      postTime: d.postTime || '18:00',
      title: d.title || '',
      mediaType: 'video',
      placement: d.placement || 'reels',
      objective: d.objective || '',
      intro: d.intro || '',
      scriptTimeline: Array.isArray(d.scriptTimeline) ? d.scriptTimeline.map((sc: any) => ({
        startSec: sc.startSec ?? 0,
        endSec: sc.endSec ?? 5,
        label: sc.label || 'Cena',
        action: sc.action || '',
        spokenLine: sc.spokenLine || undefined,
        music: sc.music || undefined,
        gesture: sc.gesture || undefined,
        cameraAngle: sc.cameraAngle || undefined,
        onScreenText: sc.onScreenText || undefined,
      })) : [],
      musicSuggestion: d.musicSuggestion || '',
      totalDuration: d.totalDuration || '30s',
      editing: d.editing || '',
      cta: d.cta || '',
      hashtags: Array.isArray(d.hashtags) ? d.hashtags : [],
      captionSuggestion: d.captionSuggestion || '',
      storyEngagement: Array.isArray(d.storyEngagement) ? d.storyEngagement.map((s: any) => ({
        horario: s.horario || '',
        tipo: s.tipo || 'foto',
        descricao: s.descricao || '',
      })) : [],
      completed: false,
    }));

    return days;
  };

  const handleGenerateCalendar = async () => {
    setGenerating(true);
    setError(null);
    setGenerationProgress(0);
    setGenerationStage('Preparando estratégias de conteúdo...');
    try {
      setGenerationProgress(10);
      const cal = await generateStrategies();

      setGenerationStage('Criando roteiros do primeiro mês...');
      setGenerationProgress(25);

      // Simulate intermediate progress while AI generates
      const progressTimer = setInterval(() => {
        setGenerationProgress(prev => Math.min(prev + 3, 85));
      }, 2000);

      cal.strategies[0].days = await generateMonthContent(cal.strategies[0]);
      clearInterval(progressTimer);

      setGenerationStage('Finalizando calendário...');
      setGenerationProgress(90);

      cal.strategies[0].generated = true;
      cal.strategies[0].description = `Estratégia focada em ${cal.strategies[0].theme.toLowerCase()} com ${profile.postsPerWeek} vídeos semanais.`;

      setGenerationStage('Salvando...');
      setGenerationProgress(95);
      await db.updateSettings(tenantId, { contentCalendar: cal });
      setGenerationProgress(100);
      setCalendar(cal);
    } catch (e: any) {
      console.error('[ContentCalendar] generate error:', e);
      setError(e.message || 'Erro ao gerar calendário.');
    }
    setGenerating(false);
    setGenerationStage('');
    setGenerationProgress(0);
  };

  const handleGenerateMonth = async (idx: number) => {
    if (!calendar) return;
    setGenerating(true);
    setError(null);
    setGenerationProgress(0);
    setGenerationStage('Analisando estratégia do mês...');
    try {
      setGenerationProgress(15);
      const strat = calendar.strategies[idx];

      setGenerationStage('Gerando roteiros com IA...');
      setGenerationProgress(25);

      const progressTimer = setInterval(() => {
        setGenerationProgress(prev => Math.min(prev + 3, 85));
      }, 2000);

      strat.days = await generateMonthContent(strat);
      clearInterval(progressTimer);

      setGenerationStage('Finalizando conteúdos...');
      setGenerationProgress(90);
      strat.generated = true;
      strat.description = `Estratégia focada em ${strat.theme.toLowerCase()} com ${profile.postsPerWeek} vídeos semanais.`;

      setGenerationStage('Salvando...');
      setGenerationProgress(95);
      const updated = { ...calendar, strategies: [...calendar.strategies] };
      updated.strategies[idx] = { ...strat };
      await db.updateSettings(tenantId, { contentCalendar: updated });
      setGenerationProgress(100);
      setCalendar(updated);
      setSelectedMonth(updated.strategies[idx]);
    } catch (e: any) {
      console.error('[ContentCalendar] generate month error:', e);
      setError(e.message || 'Erro ao gerar conteúdo do mês.');
    }
    setGenerating(false);
    setGenerationStage('');
    setGenerationProgress(0);
  };

  const handleToggleCompleted = async (day: ContentDay) => {
    if (!calendar || !selectedMonth) return;
    const stratIdx = calendar.strategies.findIndex(s => s.month === selectedMonth.month && s.year === selectedMonth.year);
    if (stratIdx < 0) return;

    const dayIdx = calendar.strategies[stratIdx].days.findIndex(d => d.date === day.date);
    if (dayIdx < 0) return;

    const updated = { ...calendar, strategies: [...calendar.strategies] };
    updated.strategies[stratIdx] = { ...updated.strategies[stratIdx], days: [...updated.strategies[stratIdx].days] };
    updated.strategies[stratIdx].days[dayIdx] = { ...day, completed: !day.completed };

    await db.updateSettings(tenantId, { contentCalendar: updated });
    setCalendar(updated);
    setSelectedMonth(updated.strategies[stratIdx]);
    setSelectedDay(updated.strategies[stratIdx].days[dayIdx]);
  };

  const isMonthLocked = (month: number, year: number): boolean => {
    if (year > currentYear) return true;
    if (year === currentYear) return month > currentMonth;
    return false;
  };

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-8 h-8 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  // No calendar yet — show generate button
  if (!calendar) {
    return (
      <div className="max-w-lg mx-auto text-center space-y-6 py-12 animate-fadeIn">
        <div className="w-20 h-20 bg-gradient-to-br from-orange-400 to-rose-500 rounded-[24px] flex items-center justify-center mx-auto text-4xl shadow-lg shadow-orange-200">
          📅
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-xl font-extrabold text-slate-900">Calendário de Conteúdo</h2>
          <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
            A IA vai criar 12 meses de estratégia personalizada com roteiros segundo a segundo para {profile.nicho}.
          </p>
        </div>
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <p className="text-xs font-bold text-red-600">{error}</p>
          </div>
        )}
        {generating ? (
          <div className="w-full max-w-sm mx-auto space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-600">{generationStage}</p>
                <span className="text-xs font-bold text-orange-500">{generationProgress}%</span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange-500 to-rose-500 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${generationProgress}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 text-slate-400">
              <div className="w-4 h-4 border-2 border-slate-200 border-t-orange-500 rounded-full animate-spin" />
              <p className="text-xs">Isso pode levar alguns segundos...</p>
            </div>
          </div>
        ) : (
          <button
            onClick={handleGenerateCalendar}
            className="bg-gradient-to-r from-orange-500 to-rose-500 text-white py-4 px-8 rounded-2xl font-display font-bold text-sm hover:shadow-xl hover:shadow-orange-200 hover:-translate-y-0.5 transition-all duration-300 flex items-center justify-center gap-3 mx-auto"
          >
            Gerar Calendário com IA
          </button>
        )}
      </div>
    );
  }

  // ── DAY DETAIL VIEW ──
  if (viewMode === 'day' && selectedDay && selectedMonth) {
    const d = selectedDay;
    const placementLabel = d.placement === 'reels' ? 'Reels' : 'Feed';
    const timeline: ScriptScene[] = d.scriptTimeline || [];

    return (
      <div className="max-w-2xl mx-auto space-y-5 animate-fadeIn">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <button onClick={() => { setViewMode('year'); setSelectedMonth(null); setSelectedDay(null); }} className="hover:text-orange-500 transition-colors font-medium">
            Calendário
          </button>
          <span className="text-slate-300">/</span>
          <button onClick={() => { setViewMode('month'); setSelectedDay(null); }} className="hover:text-orange-500 transition-colors font-medium">
            {MONTH_NAMES[selectedMonth.month - 1]}
          </button>
          <span className="text-slate-300">/</span>
          <span className="text-slate-700 font-semibold">{new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
        </div>

        {/* ── BLOCO 1: Header do Conteúdo ── */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-[24px] p-6 text-white space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold px-3 py-1 rounded-full bg-pink-100 text-pink-700">🎬 Vídeo</span>
              <span className={`text-[9px] font-bold px-3 py-1 rounded-full ${d.placement === 'reels' ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white' : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white'}`}>{placementLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Postar às</span>
              <span className="font-display text-lg font-extrabold text-orange-400">{d.postTime || '18:00'}</span>
            </div>
          </div>

          <div>
            <h2 className="font-display text-xl font-extrabold leading-tight">{d.title}</h2>
            <p className="text-sm text-slate-400 mt-1">
              {new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>

          {/* Objective */}
          <div className="bg-white/10 backdrop-blur rounded-2xl p-4 space-y-1">
            <p className="text-[9px] font-bold text-orange-400 uppercase tracking-wider">Objetivo</p>
            <p className="text-sm text-white/90 leading-relaxed">{d.objective}</p>
          </div>

          {/* Intro */}
          {d.intro && (
            <p className="text-sm text-slate-300 leading-relaxed">{d.intro}</p>
          )}

          {/* Duration + Music suggestion */}
          <div className="flex gap-3">
            {d.totalDuration && (
              <div className="bg-white/10 rounded-xl px-4 py-2 flex items-center gap-2">
                <span className="text-base">⏱</span>
                <span className="text-xs font-semibold text-white/80">{d.totalDuration}</span>
              </div>
            )}
            {d.musicSuggestion && (
              <div className="bg-white/10 rounded-xl px-4 py-2 flex items-center gap-2 flex-1 min-w-0">
                <span className="text-base">🎵</span>
                <span className="text-xs font-semibold text-white/80 truncate">{d.musicSuggestion}</span>
              </div>
            )}
          </div>

          <button
            onClick={() => handleToggleCompleted(d)}
            className={`w-full py-3 rounded-xl font-display font-bold text-sm transition-all duration-300 ${
              d.completed
                ? 'bg-green-500 text-white'
                : 'bg-white/10 text-white hover:bg-orange-500'
            }`}
          >
            {d.completed ? '✓ Conteúdo Concluído' : 'Marcar como Concluído'}
          </button>
        </div>

        {/* ── BLOCO 2: Timeline do Roteiro ── */}
        {timeline.length > 0 && (
          <div className="bg-white rounded-[24px] border border-slate-100 shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white text-sm">🎬</div>
              <div>
                <h3 className="font-display text-base font-extrabold text-slate-900">Roteiro Cena a Cena</h3>
                <p className="text-xs text-slate-400">Siga cada cena na ordem para gravar seu conteúdo</p>
              </div>
            </div>

            {/* Timeline vertical */}
            <div className="relative ml-4">
              {/* Vertical line */}
              <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-gradient-to-b from-orange-300 via-rose-300 to-violet-300 rounded-full" />

              <div className="space-y-4">
                {timeline.map((scene, i) => (
                  <div
                    key={i}
                    className="relative pl-10 animate-slideInLeft"
                    style={{ animationDelay: `${i * 0.08}s`, opacity: 0 }}
                  >
                    {/* Dot */}
                    <div className={`absolute left-0 top-1 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-md ${
                      i === 0 ? 'bg-orange-500' :
                      i === timeline.length - 1 ? 'bg-rose-500' :
                      'bg-gradient-to-br from-orange-400 to-rose-400'
                    }`}>
                      {i + 1}
                    </div>

                    <div className="bg-slate-50/80 rounded-2xl p-4 space-y-3 hover:shadow-md transition-shadow duration-300">
                      {/* Time badge + label */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold bg-slate-900 text-white px-2.5 py-1 rounded-lg">
                          {formatSec(scene.startSec)} — {formatSec(scene.endSec)}
                        </span>
                        <span className="font-display text-sm font-bold text-slate-800">{scene.label}</span>
                        {scene.cameraAngle && (
                          <span className="text-[9px] font-medium bg-sky-50 text-sky-600 px-2 py-0.5 rounded-full">
                            📷 {scene.cameraAngle}
                          </span>
                        )}
                      </div>

                      {/* Action */}
                      <p className="text-sm text-slate-600 leading-relaxed">{scene.action}</p>

                      {/* Spoken line */}
                      {scene.spokenLine && (
                        <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200/50 rounded-xl p-3 flex gap-3">
                          <span className="text-lg flex-shrink-0">🎤</span>
                          <div>
                            <p className="text-[9px] font-bold text-orange-600 uppercase tracking-wider mb-1">Fala</p>
                            <p className="text-sm font-medium text-slate-800 leading-relaxed italic">"{scene.spokenLine}"</p>
                          </div>
                        </div>
                      )}

                      {/* Gesture */}
                      {scene.gesture && (
                        <div className="flex items-start gap-2">
                          <span className="text-sm">🤌</span>
                          <p className="text-xs text-slate-500 italic">{scene.gesture}</p>
                        </div>
                      )}

                      {/* Music for this scene */}
                      {scene.music && (
                        <div className="flex items-center gap-2 bg-violet-50 rounded-lg px-3 py-2">
                          <span className="text-sm">🎵</span>
                          <p className="text-xs font-medium text-violet-700">{scene.music}</p>
                        </div>
                      )}

                      {/* On-screen text */}
                      {scene.onScreenText && (
                        <div className="bg-slate-900 rounded-lg px-4 py-2.5 text-center">
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Texto na tela</p>
                          <p className="text-sm font-bold text-white">{scene.onScreenText}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Editing tips */}
            {d.editing && (
              <div className="bg-amber-50 border border-amber-200/50 rounded-2xl p-4 space-y-1 mt-2">
                <p className="text-[9px] font-bold text-amber-700 uppercase tracking-wider">Dicas de Edição</p>
                <p className="text-sm text-slate-700 leading-relaxed">{d.editing}</p>
              </div>
            )}
          </div>
        )}

        {/* ── BLOCO 3: Legenda e Hashtags ── */}
        <div className="bg-white rounded-[24px] border border-slate-100 shadow-sm p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-white text-sm">✍</div>
            <h3 className="font-display text-base font-extrabold text-slate-900">Legenda e Hashtags</h3>
          </div>

          {/* Caption */}
          {d.captionSuggestion && (
            <div className="bg-slate-50 rounded-2xl p-5 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Sugestão de Legenda</p>
                <button
                  onClick={() => navigator.clipboard.writeText(d.captionSuggestion)}
                  className="text-xs font-semibold text-orange-500 hover:text-orange-700 transition-colors"
                >
                  Copiar
                </button>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{d.captionSuggestion}</p>
            </div>
          )}

          {/* CTA */}
          {d.cta && (
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-4 space-y-1">
              <p className="text-[9px] font-bold text-orange-400 uppercase tracking-wider">CTA</p>
              <p className="text-sm font-semibold text-white">{d.cta}</p>
            </div>
          )}

          {/* Hashtags */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Hashtags</p>
              <button
                onClick={() => navigator.clipboard.writeText(d.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' '))}
                className="text-xs font-semibold text-orange-500 hover:text-orange-700 transition-colors"
              >
                Copiar Todas
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {d.hashtags.map((h, i) => (
                <span
                  key={i}
                  onClick={() => navigator.clipboard.writeText(h.startsWith('#') ? h : `#${h}`)}
                  className="text-xs font-medium text-orange-600 bg-orange-50 px-3 py-1.5 rounded-full cursor-pointer hover:bg-orange-100 hover:shadow-sm transition-all"
                  title="Clique para copiar"
                >
                  {h.startsWith('#') ? h : `#${h}`}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── BLOCO 4: Stories para Engajamento ── */}
        {d.storyEngagement && d.storyEngagement.length > 0 && (
          <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-[24px] border border-purple-100 shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white text-sm">📱</div>
              <h3 className="font-display text-base font-extrabold text-slate-900">Stories para Engajamento</h3>
            </div>

            {d.storyEngagement.map((story, i) => {
              const tipoColor = story.tipo === 'enquete' ? 'bg-green-100 text-green-700'
                : story.tipo === 'caixinha' ? 'bg-sky-100 text-sky-700'
                : story.tipo === 'contagem_regressiva' ? 'bg-red-100 text-red-700'
                : story.tipo === 'video_trecho' ? 'bg-pink-100 text-pink-700'
                : 'bg-purple-100 text-purple-700';

              return (
                <div key={i} className="bg-white rounded-2xl p-4 space-y-2 hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-sm font-bold text-purple-600">{story.horario}</span>
                    <span className={`text-[9px] font-bold px-2.5 py-0.5 rounded-full ${tipoColor}`}>
                      {story.tipo.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">{story.descricao}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── MONTH VIEW ──
  if (viewMode === 'month' && selectedMonth) {
    const daysInMonth = new Date(selectedMonth.year, selectedMonth.month, 0).getDate();
    const firstDow = new Date(selectedMonth.year, selectedMonth.month - 1, 1).getDay();
    const contentDays = new Map<string, ContentDay>(selectedMonth.days.map(d => [d.date, d]));

    const completedCount = selectedMonth.days.filter(d => d.completed).length;
    const totalCount = selectedMonth.days.length;

    const cells: (number | null)[] = Array(firstDow).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);

    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-fadeIn">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <button onClick={() => { setViewMode('year'); setSelectedMonth(null); }} className="hover:text-orange-500 transition-colors font-medium">
            Calendário
          </button>
          <span className="text-slate-300">/</span>
          <span className="text-slate-700 font-semibold">{MONTH_NAMES[selectedMonth.month - 1]} {selectedMonth.year}</span>
        </div>

        {/* Month header card */}
        <div className="bg-gradient-to-br from-orange-500 via-orange-500 to-rose-500 rounded-[24px] p-8 text-white space-y-3 shadow-lg shadow-orange-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-orange-100">Estratégia do Mês</p>
              <h2 className="font-display text-xl font-extrabold">{selectedMonth.theme}</h2>
            </div>
            <div className="text-right">
              <p className="font-display text-3xl font-extrabold">{completedCount}/{totalCount}</p>
              <p className="text-xs text-orange-100">concluídos</p>
            </div>
          </div>
          {selectedMonth.description && (
            <p className="text-sm text-orange-100">{selectedMonth.description}</p>
          )}
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all"
              style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>

        {!selectedMonth.generated ? (
          <div className="text-center py-8 space-y-4">
            {generating ? (
              <div className="w-full max-w-sm mx-auto space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-600">{generationStage}</p>
                    <span className="text-xs font-bold text-orange-500">{generationProgress}%</span>
                  </div>
                  <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-orange-500 to-rose-500 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${generationProgress}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2 text-slate-400">
                  <div className="w-4 h-4 border-2 border-slate-200 border-t-orange-500 rounded-full animate-spin" />
                  <p className="text-xs">Gerando roteiros detalhados...</p>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-400">Conteúdo deste mês ainda não foi gerado.</p>
                <button
                  onClick={() => {
                    const idx = calendar.strategies.findIndex(s => s.month === selectedMonth.month && s.year === selectedMonth.year);
                    if (idx >= 0) handleGenerateMonth(idx);
                  }}
                  className="bg-gradient-to-r from-slate-900 to-slate-800 text-white py-3 px-8 rounded-2xl font-display font-bold text-sm hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 flex items-center justify-center gap-2 mx-auto"
                >
                  Gerar Conteúdos do Mês
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Calendar grid */}
            <div className="bg-white rounded-[24px] border border-slate-100 shadow-sm p-6">
              <div className="grid grid-cols-7 gap-1 mb-2">
                {DAY_NAMES.map(d => (
                  <div key={d} className="text-center text-[10px] font-semibold text-slate-400 py-2">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((day, i) => {
                  if (day === null) return <div key={i} />;
                  const iso = `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const content = contentDays.get(iso);
                  const isToday = iso === `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

                  return (
                    <button
                      key={i}
                      onClick={() => { if (content) { setSelectedDay(content); setViewMode('day'); } }}
                      className={`relative aspect-square rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all duration-200 ${
                        content
                          ? content.completed
                            ? 'bg-green-50 hover:bg-green-100 hover:shadow-sm cursor-pointer'
                            : 'bg-orange-50 hover:bg-orange-100 hover:shadow-sm cursor-pointer'
                          : 'hover:bg-slate-50'
                      } ${isToday ? 'ring-2 ring-orange-400' : ''}`}
                    >
                      <span className={`text-xs font-bold ${content ? (content.completed ? 'text-green-700' : 'text-slate-800') : 'text-slate-400'}`}>
                        {day}
                      </span>
                      {content && (
                        <span className={`text-[7px] font-semibold ${content.completed ? 'text-green-500' : 'text-orange-500'}`}>
                          {content.postTime || ''}
                        </span>
                      )}
                      {content?.completed && (
                        <span className="absolute top-0.5 right-0.5 text-[8px] text-green-500">✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Content list */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-400">Conteúdos do mês</p>
              {selectedMonth.days.map((day, i) => {
                const placementBadge = day.placement === 'reels' ? 'Reels' : 'Feed';
                const placementColor = day.placement === 'reels' ? 'bg-pink-100 text-pink-700' : 'bg-orange-100 text-orange-700';

                return (
                  <button
                    key={i}
                    onClick={() => { setSelectedDay(day); setViewMode('day'); }}
                    className={`w-full flex items-center gap-4 bg-white rounded-2xl border p-4 transition-all duration-300 text-left hover:-translate-y-0.5 ${
                      day.completed ? 'border-green-200 opacity-70' : 'border-slate-100 hover:border-orange-200 hover:shadow-lg'
                    }`}
                  >
                    <div className="w-12 h-12 bg-slate-50 rounded-xl flex flex-col items-center justify-center flex-shrink-0">
                      <span className="text-[9px] font-semibold text-slate-400">
                        {DAY_NAMES[new Date(day.date + 'T12:00:00').getDay()]}
                      </span>
                      <span className="font-display text-sm font-bold text-slate-900">{parseInt(day.date.split('-')[2])}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs">🎬</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${placementColor}`}>
                          {placementBadge}
                        </span>
                        <span className="text-[10px] text-slate-400">{day.postTime}</span>
                        {day.completed && <span className="text-[9px] font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Concluído</span>}
                      </div>
                      <p className="text-sm font-bold text-slate-900 truncate">{day.title}</p>
                      <p className="text-xs text-slate-400 truncate">{day.objective}</p>
                    </div>
                    <span className="text-slate-300 text-sm">›</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <p className="text-xs font-bold text-red-600">{error}</p>
          </div>
        )}
      </div>
    );
  }

  // ── YEAR VIEW (default) ──
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-extrabold text-slate-900">Planejamento Estratégico</h2>
          <p className="text-sm text-slate-400">{profile.nicho} — {profile.postsPerWeek}x/semana — {(profile.diasSemana || []).join(', ')}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-xs font-bold text-red-600">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {calendar.strategies.map((strat, idx) => {
          const locked = isMonthLocked(strat.month, strat.year);
          const isCurrent = strat.month === currentMonth && strat.year === currentYear;
          const completedCount = strat.days.filter(d => d.completed).length;
          const totalCount = strat.days.length;
          const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

          return (
            <button
              key={idx}
              onClick={() => {
                if (!locked) {
                  setSelectedMonth(strat);
                  setViewMode('month');
                }
              }}
              disabled={locked}
              className={`relative rounded-[24px] border p-6 text-left transition-all duration-300 space-y-3 ${
                locked
                  ? 'border-slate-100 bg-slate-50/50 opacity-60 cursor-not-allowed'
                  : isCurrent
                    ? 'border-orange-200 bg-gradient-to-br from-orange-50 to-rose-50 hover:shadow-xl hover:-translate-y-1'
                    : 'border-slate-100 bg-white hover:border-orange-200 hover:shadow-lg hover:-translate-y-0.5'
              }`}
            >
              {locked && (
                <div className="absolute inset-0 rounded-[24px] flex items-center justify-center bg-white/60 z-10">
                  <span className="text-2xl">🔒</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <p className={`text-xs font-semibold ${isCurrent ? 'text-orange-600' : 'text-slate-400'}`}>
                  {MONTH_NAMES[strat.month - 1]}
                </p>
                <span className="text-[10px] text-slate-300">{strat.year}</span>
              </div>

              <h3 className="font-display text-sm font-bold text-slate-900 leading-tight">{strat.theme}</h3>

              {strat.generated && totalCount > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>{completedCount}/{totalCount}</span>
                    <span>{Math.round(progressPct)}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isCurrent ? 'bg-gradient-to-r from-orange-500 to-rose-500' : 'bg-slate-300'}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}

              {!strat.generated && !locked && (
                <p className="text-xs font-medium text-orange-500">Clique para gerar</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ContentCalendar;
