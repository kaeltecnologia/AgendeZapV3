import React, { useState, useEffect, useCallback } from 'react';
import OpenAI from 'openai';
import { SocialMediaProfile, TrendingItem } from '../../types';
import { db } from '../../services/mockDb';

interface Props {
  tenantId: string;
  profile: SocialMediaProfile;
}

const TrendingContent: React.FC<Props> = ({ tenantId, profile }) => {
  const [trends, setTrends] = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const isStale = (dateStr: string | null): boolean => {
    if (!dateStr) return true;
    const diff = Date.now() - new Date(dateStr).getTime();
    return diff > 7 * 24 * 60 * 60 * 1000; // 7 days
  };

  const fetchTrends = useCallback(async (force = false) => {
    try {
      const settings = await db.getSettings(tenantId);
      const cached = settings.trendingContent as TrendingItem[] | null;
      const cachedDate = settings.trendingContentDate as string | null;

      if (cached && cachedDate && !isStale(cachedDate) && !force) {
        setTrends(cached);
        setLastUpdated(cachedDate);
        setLoading(false);
        return;
      }

      // Resolve API key
      let apiKey = ((settings as any).openaiApiKey || '').trim();
      if (!apiKey) {
        const tenant = await db.getTenant(tenantId);
        apiKey = ((tenant as any)?.gemini_api_key || '').trim();
      }
      if (!apiKey) {
        const cfg = await db.getGlobalConfig();
        apiKey = (cfg['shared_openai_key'] || '').trim();
      }
      if (!apiKey) {
        setError('Chave OpenAI não configurada. Peça ao administrador para adicionar no SuperAdmin > IA.');
        setLoading(false);
        return;
      }

      setRefreshing(true);
      const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });

      const now = new Date();
      const monthName = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][now.getMonth()];

      const prompt = `Você é um analista de tendências virais de VÍDEO para redes sociais, especializado no nicho "${profile.nicho}".

IMPORTANTE: Todas as tendências são de VÍDEO (Reels, TikTok, vídeos curtos). Não inclua tendências de foto ou carrossel.

CONTEXTO DO NEGÓCIO:
- Nicho: ${profile.nicho}
- Estilo de imagem: ${profile.estiloImagem.join(', ')}
- Público-alvo: ${profile.publicoAlvo.join(', ')}
- Plataformas: ${profile.plataformas.join(', ')}
- Período: ${monthName} ${now.getFullYear()}

TAREFA:
Liste as 8 tendências de VÍDEO mais VIRAIS e RELEVANTES desta semana para o nicho "${profile.nicho}" no TikTok e Instagram Reels.

Para CADA tendência, retorne um objeto JSON com:
- platform: "tiktok" ou "instagram"
- title: nome/título da tendência de vídeo (ex: "Trend da Transformação em 3 Passos")
- description: por que está viralizando e o que é (2-3 frases)
- contentFormat: formato do vídeo (ex: "POV", "Before/After", "Tutorial Rápido", "Day in My Life", "Resposta a Comentário", "Transition", "Get Ready With Me", "Vlog Rápido")
- viralReference: descreva um VÍDEO viral REAL de referência dessa trend (ex: "Barbeiro mostrando fade perfeito em câmera lenta com 2.3M views — o segredo é o close final no resultado")
- trendingAudio: nome EXATO do áudio/música que está sendo mais usado nessa trend de vídeo (ex: "'Espresso' - Sabrina Carpenter", "'APT' - ROSÉ & Bruno Mars", "som original de @creator")
- audioArtist: artista ou criador do áudio
- recreationSteps: array com 5-7 passos PRÁTICOS e DETALHADOS para GRAVAR e EDITAR esse vídeo do zero. Cada passo deve ser uma instrução clara de filmagem (ex: ["Posicione a câmera em close no rosto", "Use a transição no beat drop do áudio", "Grave em câmera lenta o resultado final", ...])
- hashtags: array com 5-8 hashtags mais usadas nessa trend
- difficulty: "facil" | "medio" | "avancado" — baseado em equipamento e habilidade de filmagem necessária
- estimatedViews: alcance médio estimado (ex: "500K-2M views")
- adaptationTip: como o negócio "${profile.nicho}" pode FILMAR e adaptar essa tendência de vídeo (2-3 frases práticas e específicas)

IMPORTANTE:
- TODAS as tendências são de VÍDEO — Reels e TikTok
- Baseie-se em trends REAIS e formatos comprovados de ${monthName} ${now.getFullYear()}
- Alterne entre TikTok e Instagram Reels
- Inclua tendências de diferentes formatos de vídeo (POV, transição, tutorial, trending audio, storytelling)
- Os áudios devem ser músicas/sons REAIS que estão viralizando
- As referências virais devem ser descrições detalhadas de VÍDEOS reais populares

Retorne JSON com chave "trends" contendo o array.`;

      let items: TrendingItem[];
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Você é um analista de tendências virais de redes sociais. Responda sempre em JSON válido com chave "trends". Sem markdown.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.85,
          response_format: { type: 'json_object' },
        });

        const raw = response.choices[0]?.message?.content || '{}';
        const obj = JSON.parse(raw);
        const arr = Array.isArray(obj) ? obj : (obj.trends || obj.tendencias || obj.data || Object.values(obj)[0] || []);
        items = (Array.isArray(arr) ? arr : []).map((t: any) => ({
          platform: t.platform || 'instagram',
          title: t.title || '',
          description: t.description || '',
          adaptationTip: t.adaptationTip || '',
          estimatedViews: t.estimatedViews || '',
          viralReference: t.viralReference || '',
          trendingAudio: t.trendingAudio || '',
          audioArtist: t.audioArtist || '',
          recreationSteps: Array.isArray(t.recreationSteps) ? t.recreationSteps : [],
          hashtags: Array.isArray(t.hashtags) ? t.hashtags : [],
          difficulty: t.difficulty || 'medio',
          contentFormat: t.contentFormat || '',
        }));
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
      const nowIso = new Date().toISOString();

      await db.updateSettings(tenantId, {
        trendingContent: items,
        trendingContentDate: nowIso,
      });

      setTrends(items);
      setLastUpdated(nowIso);
      setError(null);
    } catch (e: any) {
      console.error('[TrendingContent] error:', e);
      setError(e.message || 'Erro ao buscar tendências.');
    }
    setLoading(false);
    setRefreshing(false);
  }, [tenantId, profile]);

  useEffect(() => { fetchTrends(); }, [fetchTrends]);

  const diffColor = (d: string) =>
    d === 'facil' ? 'bg-green-100 text-green-700' :
    d === 'avancado' ? 'bg-red-100 text-red-700' :
    'bg-amber-100 text-amber-700';

  const diffLabel = (d: string) =>
    d === 'facil' ? 'Fácil' :
    d === 'avancado' ? 'Avançado' :
    'Médio';

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-8 h-8 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto" />
        <p className="text-sm text-slate-400 mt-4">Buscando tendências...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto animate-fadeIn">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-[24px] p-8 text-white space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-xl shadow-lg">🔥</div>
              <div>
                <h2 className="font-display text-lg font-extrabold">Tendências da Semana</h2>
                <p className="text-xs text-slate-400">
                  Conteúdos virais no TikTok e Instagram para {profile.nicho}
                </p>
              </div>
            </div>
          </div>
          <div className="text-right space-y-2">
            {lastUpdated && (
              <p className="text-[10px] text-slate-500">
                Atualizado em {new Date(lastUpdated).toLocaleDateString('pt-BR')}
              </p>
            )}
            <button
              onClick={() => fetchTrends(true)}
              disabled={refreshing}
              className="bg-white/10 text-white px-4 py-2 rounded-xl font-display font-bold text-xs hover:bg-white/20 transition-all disabled:opacity-40 flex items-center gap-2"
            >
              {refreshing ? (
                <>
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Atualizando...
                </>
              ) : (
                'Atualizar'
              )}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-xs font-bold text-red-600">{error}</p>
        </div>
      )}

      {/* Trends */}
      {trends.length === 0 && !error ? (
        <div className="text-center py-12 space-y-4">
          <p className="text-4xl">📊</p>
          <p className="text-sm text-slate-400">Nenhuma tendência carregada ainda.</p>
          <button
            onClick={() => fetchTrends(true)}
            disabled={refreshing}
            className="bg-gradient-to-r from-slate-900 to-slate-800 text-white py-3 px-6 rounded-2xl font-display font-bold text-sm hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
          >
            Buscar Tendências
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {trends.map((trend, i) => {
            const isTikTok = trend.platform === 'tiktok';
            const isOpen = expanded === i;

            return (
              <div
                key={i}
                className={`bg-white rounded-[20px] border overflow-hidden transition-all duration-300 ${
                  isOpen ? 'border-orange-200 shadow-xl' : 'border-slate-100 hover:border-slate-200 hover:shadow-lg hover:-translate-y-0.5'
                }`}
              >
                {/* Card header — always visible */}
                <button
                  onClick={() => setExpanded(isOpen ? null : i)}
                  className="w-full p-5 text-left space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] font-bold px-3 py-1 rounded-full ${
                        isTikTok ? 'bg-slate-900 text-white' : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                      }`}>
                        {isTikTok ? '🎵 TikTok' : '📸 Instagram'}
                      </span>
                      {trend.contentFormat && (
                        <span className="text-[9px] font-semibold px-2.5 py-1 rounded-full bg-sky-50 text-sky-700">
                          {trend.contentFormat}
                        </span>
                      )}
                      <span className={`text-[9px] font-semibold px-2.5 py-1 rounded-full ${diffColor(trend.difficulty)}`}>
                        {diffLabel(trend.difficulty)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        👁 {trend.estimatedViews}
                      </span>
                      <span className={`text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
                        ▼
                      </span>
                    </div>
                  </div>

                  <h3 className="font-display text-sm font-bold text-slate-900 leading-tight">{trend.title}</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">{trend.description}</p>
                </button>

                {/* Expanded content */}
                {isOpen && (
                  <div className="px-5 pb-5 space-y-4 animate-fadeInUp" style={{ animationDuration: '0.3s' }}>
                    <div className="h-px bg-slate-100" />

                    {/* Viral reference */}
                    {trend.viralReference && (
                      <div className="bg-gradient-to-r from-rose-50 to-orange-50 border border-rose-100 rounded-xl p-4 space-y-1">
                        <p className="text-[9px] font-bold text-rose-600 uppercase tracking-wider flex items-center gap-1">▶ Referência Viral</p>
                        <p className="text-sm text-slate-700 leading-relaxed">{trend.viralReference}</p>
                      </div>
                    )}

                    {/* Trending audio */}
                    {trend.trendingAudio && (
                      <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 flex items-start gap-3">
                        <span className="text-xl">🎵</span>
                        <div>
                          <p className="text-[9px] font-bold text-violet-600 uppercase tracking-wider">Áudio Trending</p>
                          <p className="text-sm font-semibold text-slate-800">{trend.trendingAudio}</p>
                          {trend.audioArtist && (
                            <p className="text-xs text-slate-500">{trend.audioArtist}</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Recreation steps */}
                    {trend.recreationSteps && trend.recreationSteps.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">Como Recriar</p>
                        <div className="space-y-2">
                          {trend.recreationSteps.map((step, si) => (
                            <div key={si} className="flex gap-3 items-start">
                              <span className="w-5 h-5 rounded-full bg-gradient-to-br from-orange-400 to-rose-400 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                                {si + 1}
                              </span>
                              <p className="text-sm text-slate-700 leading-relaxed">{step}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Hashtags */}
                    {trend.hashtags && trend.hashtags.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">Hashtags da Trend</p>
                        <div className="flex flex-wrap gap-2">
                          {trend.hashtags.map((h, hi) => (
                            <span
                              key={hi}
                              onClick={() => navigator.clipboard.writeText(h.startsWith('#') ? h : `#${h}`)}
                              className="text-xs font-medium text-violet-600 bg-violet-50 px-3 py-1.5 rounded-full cursor-pointer hover:bg-violet-100 transition-all"
                              title="Clique para copiar"
                            >
                              {h.startsWith('#') ? h : `#${h}`}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Adaptation tip */}
                    <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200/50 rounded-xl p-4 space-y-1">
                      <p className="text-[9px] font-bold text-orange-600 uppercase tracking-wider">Como adaptar para {profile.nicho}</p>
                      <p className="text-sm text-slate-700 leading-relaxed">{trend.adaptationTip}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TrendingContent;
