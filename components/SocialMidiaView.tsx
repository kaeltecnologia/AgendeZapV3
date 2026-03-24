import React, { useState, useEffect, useCallback } from 'react';
import { SocialMediaProfile } from '../types';
import { db } from '../services/mockDb';
import ContentOnboarding from './social/ContentOnboarding';
import ContentCalendar from './social/ContentCalendar';
import TrendingContent from './social/TrendingContent';
import PublicarView from './PublicarView';
import VideoEditor from './social/VideoEditor';

type Tab = 'calendario' | 'editor' | 'publicar' | 'tendencias';

interface Props {
  tenantId: string;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'calendario', label: 'Calendário', icon: '📅' },
  { id: 'editor', label: 'Editor', icon: '✂️' },
  { id: 'publicar', label: 'Publicar', icon: '📸' },
  { id: 'tendencias', label: 'Tendências', icon: '🔥' },
];

const MAX_RESETS_PER_MONTH = 3;

const getCurrentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const SocialMidiaView: React.FC<Props> = ({ tenantId }) => {
  const [tab, setTab] = useState<Tab>('calendario');
  const [profile, setProfile] = useState<SocialMediaProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetCount, setResetCount] = useState(0);
  const [resetMonth, setResetMonth] = useState('');
  const [showResetWarning, setShowResetWarning] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const settings = await db.getSettings(tenantId);
      const raw = settings.socialMediaProfile;
      // Only accept profiles with the new quiz format (has estiloImagem array)
      if (raw && Array.isArray(raw.estiloImagem)) {
        setProfile(raw);
      }
      // Load reset tracking
      const followUp = (settings as any).follow_up || {};
      const savedMonth = followUp._quizResetMonth || '';
      const savedCount = followUp._quizResetCount || 0;
      const currentKey = getCurrentMonthKey();
      if (savedMonth === currentKey) {
        setResetCount(savedCount);
        setResetMonth(savedMonth);
      } else {
        setResetCount(0);
        setResetMonth(currentKey);
      }
    } catch (e) {
      console.error('[SocialMidiaView] load error:', e);
    }
    setLoading(false);
  }, [tenantId]);

  const handleResetProfile = async () => {
    const currentKey = getCurrentMonthKey();
    const effectiveCount = resetMonth === currentKey ? resetCount : 0;

    if (effectiveCount >= MAX_RESETS_PER_MONTH) {
      setShowResetWarning(true);
      return;
    }

    const newCount = effectiveCount + 1;
    const remaining = MAX_RESETS_PER_MONTH - newCount;

    // Save reset count
    const settings = await db.getSettings(tenantId);
    const followUp = (settings as any).follow_up || {};
    await db.updateSettings(tenantId, {
      socialMediaProfile: null,
      contentCalendar: null,
      follow_up: { ...followUp, _quizResetCount: newCount, _quizResetMonth: currentKey },
    } as any);

    setResetCount(newCount);
    setResetMonth(currentKey);
    setProfile(null);
    setTab('calendario');

    if (remaining <= 1) {
      setShowResetWarning(true);
    }
  };

  useEffect(() => { loadProfile(); }, [loadProfile]);

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-8 h-8 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  // Show onboarding if no profile and not on Publicar tab
  if (!profile && tab !== 'publicar') {
    return (
      <div className="space-y-6">
        {/* Tab bar still visible so user can go to Publicar */}
        <div className="flex items-center gap-2">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-display font-bold text-xs transition-all duration-300 ${
                tab === t.id
                  ? 'bg-slate-900 text-white shadow-lg'
                  : 'bg-white text-slate-500 border border-slate-100 hover:border-slate-200 hover:shadow-sm'
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        <ContentOnboarding
          tenantId={tenantId}
          onComplete={(p) => {
            setProfile(p);
            setTab('calendario');
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex items-center gap-2">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-display font-bold text-xs transition-all duration-300 ${
              tab === t.id
                ? 'bg-slate-900 text-white shadow-lg'
                : 'bg-white text-slate-500 border border-slate-100 hover:border-slate-200 hover:shadow-sm'
            }`}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        {(() => {
          const currentKey = getCurrentMonthKey();
          const effectiveCount = resetMonth === currentKey ? resetCount : 0;
          const remaining = MAX_RESETS_PER_MONTH - effectiveCount;
          const blocked = remaining <= 0;
          return (
            <button
              onClick={blocked ? () => setShowResetWarning(true) : handleResetProfile}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-medium text-xs border transition-all duration-300 ${
                blocked
                  ? 'text-slate-300 border-slate-100 cursor-not-allowed'
                  : 'text-slate-400 hover:text-red-500 hover:bg-red-50 border-slate-100 hover:border-red-200'
              }`}
              title={blocked ? 'Limite de resets atingido este mês' : `Refazer quiz (${remaining} restante${remaining !== 1 ? 's' : ''} este mês)`}
            >
              <span>🔄</span>
              Refazer Quiz
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${remaining <= 1 ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                {remaining}/{MAX_RESETS_PER_MONTH}
              </span>
            </button>
          );
        })()}
      </div>

      {/* Reset warning modal */}
      {showResetWarning && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <span className="text-xl flex-shrink-0">⚠️</span>
          <div className="flex-1">
            {(() => {
              const currentKey = getCurrentMonthKey();
              const effectiveCount = resetMonth === currentKey ? resetCount : 0;
              const remaining = MAX_RESETS_PER_MONTH - effectiveCount;
              if (remaining <= 0) {
                return (
                  <>
                    <p className="text-sm font-bold text-amber-800">Limite de resets atingido</p>
                    <p className="text-xs text-amber-700 mt-1">
                      Você já usou {MAX_RESETS_PER_MONTH} resets este mês. Aguarde o próximo mês para refazer o quiz.
                    </p>
                  </>
                );
              }
              return (
                <>
                  <p className="text-sm font-bold text-amber-800">Quiz resetado com sucesso!</p>
                  <p className="text-xs text-amber-700 mt-1">
                    Você tem <span className="font-bold">{remaining}</span> reset{remaining !== 1 ? 's' : ''} restante{remaining !== 1 ? 's' : ''} este mês (máximo {MAX_RESETS_PER_MONTH}/mês).
                  </p>
                </>
              );
            })()}
          </div>
          <button onClick={() => setShowResetWarning(false)} className="text-amber-500 hover:text-amber-700 text-lg font-bold">×</button>
        </div>
      )}

      {/* Content */}
      {tab === 'calendario' && profile && (
        <ContentCalendar tenantId={tenantId} profile={profile} />
      )}
      {tab === 'editor' && (
        <VideoEditor />
      )}
      {tab === 'publicar' && (
        <PublicarView tenantId={tenantId} />
      )}
      {tab === 'tendencias' && profile && (
        <TrendingContent tenantId={tenantId} profile={profile} />
      )}
    </div>
  );
};

export default SocialMidiaView;
