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

      // Need to generate — resolve API key (settings → tenant → global)
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
        setError('Chave OpenAI não configurada. Peça ao administrador para adicionar no SuperAdmin → IA.');
        setLoading(false);
        return;
      }

      setRefreshing(true);
      const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });

      const now = new Date();
      const monthName = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][now.getMonth()];

      const prompt = `Você é um analista de tendências de redes sociais especializado no nicho "${profile.nicho}".

CONTEXTO:
- Nicho do negócio: ${profile.nicho}
- Estilo de imagem: ${profile.estiloImagem.join(', ')}
- Público-alvo: ${profile.publicoAlvo.join(', ')}
- Plataformas: ${profile.plataformas.join(', ')}
- Período: ${monthName} ${now.getFullYear()}

TAREFA:
Liste as 8 tendências de conteúdo mais relevantes e virais desta semana para o nicho "${profile.nicho}" no TikTok e Instagram.

Para cada tendência retorne:
- platform: "tiktok" ou "instagram"
- title: nome/título da tendência (ex: "Trend da Transformação em 3 Passos")
- description: descrição da tendência e por que está viralizando (2-3 frases)
- adaptationTip: como o negócio "${profile.nicho}" pode adaptar essa tendência (2-3 frases práticas)
- estimatedViews: média de views estimada (ex: "500K-2M views")

IMPORTANTE:
- Baseie-se em trends REAIS e formatos comprovados que funcionam em ${monthName} ${now.getFullYear()}
- Alterne entre TikTok e Instagram
- Foque em tendências aplicáveis ao nicho "${profile.nicho}"
- Inclua formats como: POV, Before/After, Day in my Life, Tutorial rápido, Resposta a comentário, Trending audio, etc.

Retorne APENAS o JSON array, sem markdown ou texto adicional.`;

      let items: TrendingItem[];
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Você é um analista de tendências de redes sociais. Responda sempre em JSON array válido, sem markdown.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.8,
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

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-8 h-8 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto" />
        <p className="text-xs font-bold text-slate-400 mt-4">Buscando tendências...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-[24px] p-8 text-white space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🔥</span>
              <h2 className="text-lg font-black uppercase tracking-tight">Tendências da Semana</h2>
            </div>
            <p className="text-[10px] font-bold text-slate-400">
              Conteúdos virais no TikTok e Instagram para {profile.nicho}
            </p>
          </div>
          <div className="text-right space-y-2">
            {lastUpdated && (
              <p className="text-[9px] font-bold text-slate-500">
                Atualizado em {new Date(lastUpdated).toLocaleDateString('pt-BR')}
              </p>
            )}
            <button
              onClick={() => fetchTrends(true)}
              disabled={refreshing}
              className="bg-white/10 text-white px-4 py-2 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-white/20 transition-all disabled:opacity-40 flex items-center gap-2"
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
        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
          <p className="text-xs font-bold text-red-600">{error}</p>
        </div>
      )}

      {/* Trends grid */}
      {trends.length === 0 && !error ? (
        <div className="text-center py-12 space-y-4">
          <p className="text-4xl">📊</p>
          <p className="text-xs font-bold text-slate-400">Nenhuma tendência carregada ainda.</p>
          <button
            onClick={() => fetchTrends(true)}
            disabled={refreshing}
            className="bg-black text-white py-3 px-6 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-500 transition-all"
          >
            Buscar Tendências
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {trends.map((trend, i) => {
            const isTikTok = trend.platform === 'tiktok';
            return (
              <div
                key={i}
                className="bg-white rounded-[20px] border-2 border-slate-100 hover:border-slate-200 p-6 space-y-4 transition-all hover:shadow-lg"
              >
                {/* Platform badge */}
                <div className="flex items-center justify-between">
                  <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${
                    isTikTok ? 'bg-black text-white' : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                  }`}>
                    {isTikTok ? '🎵 TikTok' : '📸 Instagram'}
                  </span>
                  <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                    👁 {trend.estimatedViews}
                  </span>
                </div>

                {/* Title */}
                <h3 className="text-sm font-black text-black leading-tight">{trend.title}</h3>

                {/* Description */}
                <p className="text-[11px] text-slate-500 leading-relaxed">{trend.description}</p>

                {/* Adaptation tip */}
                <div className="bg-orange-50 rounded-xl p-4 space-y-1">
                  <p className="text-[9px] font-black text-orange-600 uppercase tracking-widest">Como adaptar</p>
                  <p className="text-[11px] font-bold text-slate-700 leading-relaxed">{trend.adaptationTip}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TrendingContent;
