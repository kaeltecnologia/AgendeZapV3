import React, { useState, useEffect, useCallback } from 'react';
import OpenAI from 'openai';
import { SocialMediaProfile, ContentCalendar as CalendarType, MonthStrategy, ContentDay } from '../../types';
import { db } from '../../services/mockDb';

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

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

const ContentCalendar: React.FC<Props> = ({ tenantId, profile }) => {
  const [calendar, setCalendar] = useState<CalendarType | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
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

  const generateMonthContent = async (strategy: MonthStrategy): Promise<ContentDay[]> => {
    const apiKey = await resolveApiKey();
    if (!apiKey) {
      throw new Error('Chave OpenAI não configurada. Peça ao administrador para adicionar no SuperAdmin → IA.');
    }

    const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
    const totalPosts = profile.postsPerWeek * 4;
    const daysInMonth = new Date(strategy.year, strategy.month, 0).getDate();

    const prompt = `Você é um estrategista de conteúdo para redes sociais especializado em ${profile.nicho}.

PERFIL DO NEGÓCIO:
- Nicho: ${profile.nicho}
- Estilo de imagem: ${profile.estiloImagem.join(', ')}
- Público-alvo: ${profile.publicoAlvo.join(', ')}
- Tipos de conteúdo preferidos: ${profile.tiposConteudo.join(', ')}
- Tom de comunicação: ${profile.tomComunicacao.join(', ')}
- Objetivos: ${profile.objetivos.join(', ')}
- Diferenciais: ${profile.diferenciais.join(', ')}
- Frequência: ${profile.postsPerWeek}x por semana
- Plataformas: ${profile.plataformas.join(', ')}

ESTRATÉGIA DO MÊS: "${strategy.theme}"
Mês: ${MONTH_NAMES[strategy.month - 1]} ${strategy.year}
Dias no mês: ${daysInMonth}

INSTRUÇÕES:
Gere exatamente ${totalPosts} posts distribuídos ao longo do mês (${profile.postsPerWeek} por semana).
Cada post deve ser prático, acionável e baseado em tendências reais que funcionam para ${profile.nicho}.
Referencie cases de sucesso reais e formatos comprovados do nicho.
Adapte o formato (Reels, Stories, Carrossel, Post) de acordo com as plataformas escolhidas.
Considere o estilo de imagem ${profile.estiloImagem.join('/')} e o tom ${profile.tomComunicacao.join('/')} nas sugestões.

Para cada post retorne:
- date: formato YYYY-MM-DD (distribua nos dias úteis do mês)
- title: título criativo do conteúdo
- format: "Reels" | "Stories" | "Carrossel" | "Post"
- objective: resumo do objetivo em 1-2 frases
- script: roteiro detalhado de como fazer (mínimo 3 frases)
- scene: como filmar/criar a cena (ambiente, ângulo, props)
- editing: dicas de edição (cortes, textos, músicas)
- cta: call-to-action final
- hashtags: array com 5-8 hashtags relevantes

Retorne APENAS o JSON array, sem markdown ou texto adicional.`;

    let parsed: any[];
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Você é um estrategista de conteúdo para redes sociais. Responda sempre em JSON array válido, sem markdown.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
        response_format: { type: 'json_object' },
      });

      const raw = response.choices[0]?.message?.content || '{}';
      const obj = JSON.parse(raw);
      // OpenAI json_object wraps in an object — extract the array
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
      title: d.title || '',
      format: d.format || 'Post',
      objective: d.objective || '',
      script: d.script || '',
      scene: d.scene || '',
      editing: d.editing || '',
      cta: d.cta || '',
      hashtags: Array.isArray(d.hashtags) ? d.hashtags : [],
      completed: false,
    }));

    return days;
  };

  const handleGenerateCalendar = async () => {
    setGenerating(true);
    setError(null);
    try {
      const cal = await generateStrategies();
      // Generate content for the current month
      cal.strategies[0].days = await generateMonthContent(cal.strategies[0]);
      cal.strategies[0].generated = true;
      cal.strategies[0].description = `Estratégia focada em ${cal.strategies[0].theme.toLowerCase()} com ${profile.postsPerWeek} posts semanais no estilo ${profile.estiloImagem.join('/')}, tom ${profile.tomComunicacao.join('/')}.`;

      await db.updateSettings(tenantId, { contentCalendar: cal });
      setCalendar(cal);
    } catch (e: any) {
      console.error('[ContentCalendar] generate error:', e);
      setError(e.message || 'Erro ao gerar calendário.');
    }
    setGenerating(false);
  };

  const handleGenerateMonth = async (idx: number) => {
    if (!calendar) return;
    setGenerating(true);
    setError(null);
    try {
      const strat = calendar.strategies[idx];
      strat.days = await generateMonthContent(strat);
      strat.generated = true;
      strat.description = `Estratégia focada em ${strat.theme.toLowerCase()} com ${profile.postsPerWeek} posts semanais no estilo ${profile.estiloImagem.join('/')}, tom ${profile.tomComunicacao.join('/')}.`;

      const updated = { ...calendar, strategies: [...calendar.strategies] };
      updated.strategies[idx] = { ...strat };
      await db.updateSettings(tenantId, { contentCalendar: updated });
      setCalendar(updated);
      setSelectedMonth(updated.strategies[idx]);
    } catch (e: any) {
      console.error('[ContentCalendar] generate month error:', e);
      setError(e.message || 'Erro ao gerar conteúdo do mês.');
    }
    setGenerating(false);
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
    if (year > currentYear) return month > currentMonth || year > currentYear;
    if (year === currentYear) return month > currentMonth;
    return false;
  };

  const isCurrentOrPast = (month: number, year: number): boolean => {
    if (year < currentYear) return true;
    if (year === currentYear && month <= currentMonth) return true;
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
      <div className="max-w-lg mx-auto text-center space-y-6 py-12">
        <div className="w-20 h-20 bg-gradient-to-br from-orange-400 to-orange-600 rounded-[24px] flex items-center justify-center mx-auto text-4xl shadow-lg">
          📅
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-black text-black uppercase tracking-tight">Calendário de Conteúdo</h2>
          <p className="text-xs font-bold text-slate-400 max-w-sm mx-auto">
            A IA vai criar 12 meses de estratégia personalizada com base no seu perfil: {profile.nicho}, {profile.postsPerWeek}x/semana.
          </p>
        </div>
        {error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
            <p className="text-xs font-bold text-red-600">{error}</p>
          </div>
        )}
        <button
          onClick={handleGenerateCalendar}
          disabled={generating}
          className="bg-gradient-to-r from-orange-500 to-orange-600 text-white py-4 px-8 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:from-black hover:to-black transition-all disabled:opacity-40 flex items-center justify-center gap-2 mx-auto"
        >
          {generating ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Gerando calendário...
            </>
          ) : (
            'Gerar Calendário com IA'
          )}
        </button>
      </div>
    );
  }

  // ── DAY DETAIL VIEW ──
  if (viewMode === 'day' && selectedDay && selectedMonth) {
    const formatColor = selectedDay.format === 'Reels' ? 'bg-pink-100 text-pink-700'
      : selectedDay.format === 'Stories' ? 'bg-purple-100 text-purple-700'
      : selectedDay.format === 'Carrossel' ? 'bg-blue-100 text-blue-700'
      : 'bg-green-100 text-green-700';

    return (
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
          <button onClick={() => { setViewMode('year'); setSelectedMonth(null); setSelectedDay(null); }} className="hover:text-orange-500 transition-colors">
            Calendário
          </button>
          <span>›</span>
          <button onClick={() => { setViewMode('month'); setSelectedDay(null); }} className="hover:text-orange-500 transition-colors">
            {MONTH_NAMES[selectedMonth.month - 1]}
          </button>
          <span>›</span>
          <span className="text-black">{new Date(selectedDay.date + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
        </div>

        {/* Day header */}
        <div className="bg-white rounded-[24px] border-2 border-slate-100 p-8 space-y-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${formatColor}`}>
                {selectedDay.format}
              </span>
              <h2 className="text-lg font-black text-black uppercase tracking-tight">{selectedDay.title}</h2>
              <p className="text-xs font-bold text-slate-400">
                {new Date(selectedDay.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
            </div>
            <button
              onClick={() => handleToggleCompleted(selectedDay)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
                selectedDay.completed
                  ? 'bg-green-100 text-green-700 border-2 border-green-200'
                  : 'bg-slate-100 text-slate-500 border-2 border-slate-200 hover:border-orange-300'
              }`}
            >
              {selectedDay.completed ? '✓ Concluído' : 'Marcar como feito'}
            </button>
          </div>

          {/* Objective */}
          <div className="bg-orange-50 rounded-2xl p-5 space-y-2">
            <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest">Objetivo</p>
            <p className="text-sm font-bold text-slate-700">{selectedDay.objective}</p>
          </div>

          {/* Script */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Roteiro</p>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{selectedDay.script}</p>
          </div>

          {/* Scene */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Cena / Filmagem</p>
            <p className="text-sm text-slate-600 leading-relaxed">{selectedDay.scene}</p>
          </div>

          {/* Editing */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Edição</p>
            <p className="text-sm text-slate-600 leading-relaxed">{selectedDay.editing}</p>
          </div>

          {/* CTA */}
          <div className="bg-black rounded-2xl p-5 space-y-2">
            <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest">Call-to-Action</p>
            <p className="text-sm font-bold text-white">{selectedDay.cta}</p>
          </div>

          {/* Hashtags */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Hashtags</p>
            <div className="flex flex-wrap gap-2">
              {selectedDay.hashtags.map((h, i) => (
                <span
                  key={i}
                  onClick={() => navigator.clipboard.writeText(h.startsWith('#') ? h : `#${h}`)}
                  className="text-[10px] font-bold text-orange-600 bg-orange-50 px-3 py-1.5 rounded-full cursor-pointer hover:bg-orange-100 transition-all"
                  title="Clique para copiar"
                >
                  {h.startsWith('#') ? h : `#${h}`}
                </span>
              ))}
            </div>
          </div>
        </div>
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
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
          <button onClick={() => { setViewMode('year'); setSelectedMonth(null); }} className="hover:text-orange-500 transition-colors">
            Calendário
          </button>
          <span>›</span>
          <span className="text-black">{MONTH_NAMES[selectedMonth.month - 1]} {selectedMonth.year}</span>
        </div>

        {/* Month header card */}
        <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-[24px] p-8 text-white space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-orange-200">Estratégia do Mês</p>
              <h2 className="text-xl font-black uppercase tracking-tight">{selectedMonth.theme}</h2>
            </div>
            <div className="text-right">
              <p className="text-3xl font-black">{completedCount}/{totalCount}</p>
              <p className="text-[10px] font-bold text-orange-200">concluídos</p>
            </div>
          </div>
          {selectedMonth.description && (
            <p className="text-xs font-bold text-orange-100">{selectedMonth.description}</p>
          )}
          {/* Progress bar */}
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all"
              style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>

        {!selectedMonth.generated ? (
          <div className="text-center py-8 space-y-4">
            <p className="text-xs font-bold text-slate-400">Conteúdo deste mês ainda não foi gerado.</p>
            <button
              onClick={() => {
                const idx = calendar.strategies.findIndex(s => s.month === selectedMonth.month && s.year === selectedMonth.year);
                if (idx >= 0) handleGenerateMonth(idx);
              }}
              disabled={generating}
              className="bg-black text-white py-3 px-8 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-500 transition-all disabled:opacity-40 flex items-center justify-center gap-2 mx-auto"
            >
              {generating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Gerando conteúdos...
                </>
              ) : (
                'Gerar Conteúdos do Mês'
              )}
            </button>
          </div>
        ) : (
          <>
            {/* Calendar grid */}
            <div className="bg-white rounded-[24px] border-2 border-slate-100 p-6">
              <div className="grid grid-cols-7 gap-1 mb-2">
                {DAY_NAMES.map(d => (
                  <div key={d} className="text-center text-[9px] font-black text-slate-400 uppercase tracking-widest py-2">{d}</div>
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
                      className={`relative aspect-square rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all ${
                        content
                          ? content.completed
                            ? 'bg-green-50 hover:bg-green-100 cursor-pointer'
                            : 'bg-orange-50 hover:bg-orange-100 cursor-pointer'
                          : 'hover:bg-slate-50'
                      } ${isToday ? 'ring-2 ring-orange-400' : ''}`}
                    >
                      <span className={`text-xs font-black ${content ? (content.completed ? 'text-green-700' : 'text-black') : 'text-slate-400'}`}>
                        {day}
                      </span>
                      {content && (
                        <span className={`text-[7px] font-black uppercase tracking-wider ${content.completed ? 'text-green-500' : 'text-orange-500'}`}>
                          {content.format === 'Reels' ? 'R' : content.format === 'Stories' ? 'S' : content.format === 'Carrossel' ? 'C' : 'P'}
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
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Conteúdos do mês</p>
              {selectedMonth.days.map((day, i) => {
                const formatColor = day.format === 'Reels' ? 'bg-pink-100 text-pink-700'
                  : day.format === 'Stories' ? 'bg-purple-100 text-purple-700'
                  : day.format === 'Carrossel' ? 'bg-blue-100 text-blue-700'
                  : 'bg-green-100 text-green-700';

                return (
                  <button
                    key={i}
                    onClick={() => { setSelectedDay(day); setViewMode('day'); }}
                    className={`w-full flex items-center gap-4 bg-white rounded-2xl border-2 p-4 transition-all text-left ${
                      day.completed ? 'border-green-200 opacity-70' : 'border-slate-100 hover:border-orange-300 hover:shadow-lg'
                    }`}
                  >
                    <div className="w-12 h-12 bg-slate-50 rounded-xl flex flex-col items-center justify-center flex-shrink-0">
                      <span className="text-[9px] font-black text-slate-400 uppercase">
                        {DAY_NAMES[new Date(day.date + 'T12:00:00').getDay()]}
                      </span>
                      <span className="text-sm font-black text-black">{parseInt(day.date.split('-')[2])}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${formatColor}`}>
                          {day.format}
                        </span>
                        {day.completed && <span className="text-[8px] font-black text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Concluído</span>}
                      </div>
                      <p className="text-xs font-black text-black truncate">{day.title}</p>
                      <p className="text-[10px] text-slate-400 truncate">{day.objective}</p>
                    </div>
                    <span className="text-slate-300 text-sm">›</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
            <p className="text-xs font-bold text-red-600">{error}</p>
          </div>
        )}
      </div>
    );
  }

  // ── YEAR VIEW (default) ──
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-black text-black uppercase tracking-widest">Planejamento Estratégico</h2>
          <p className="text-[10px] font-bold text-slate-400">{profile.nicho} — {profile.postsPerWeek}x/semana — {profile.estiloImagem.join(', ')}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
          <p className="text-xs font-bold text-red-600">{error}</p>
        </div>
      )}

      {/* 12-month grid */}
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
              className={`relative rounded-[24px] border-2 p-6 text-left transition-all space-y-3 ${
                locked
                  ? 'border-slate-100 bg-slate-50/50 opacity-60 cursor-not-allowed'
                  : isCurrent
                    ? 'border-orange-300 bg-gradient-to-br from-orange-50 to-white hover:shadow-xl hover:scale-[1.02]'
                    : 'border-slate-100 bg-white hover:border-orange-300 hover:shadow-lg'
              }`}
            >
              {locked && (
                <div className="absolute inset-0 rounded-[24px] flex items-center justify-center bg-white/60 z-10">
                  <span className="text-2xl">🔒</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <p className={`text-[10px] font-black uppercase tracking-widest ${isCurrent ? 'text-orange-600' : 'text-slate-400'}`}>
                  {MONTH_NAMES[strat.month - 1]}
                </p>
                <span className="text-[9px] font-bold text-slate-300">{strat.year}</span>
              </div>

              <h3 className="text-xs font-black text-black uppercase tracking-tight leading-tight">{strat.theme}</h3>

              {strat.generated && totalCount > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] font-bold text-slate-400">
                    <span>{completedCount}/{totalCount}</span>
                    <span>{Math.round(progressPct)}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isCurrent ? 'bg-orange-500' : 'bg-slate-300'}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}

              {!strat.generated && !locked && (
                <p className="text-[9px] font-bold text-orange-500">Clique para gerar</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ContentCalendar;
