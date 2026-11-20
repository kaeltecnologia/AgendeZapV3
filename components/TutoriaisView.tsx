import React, { useEffect, useState } from 'react';
import { TUTORIAIS, Tutorial } from '../config/tutoriais';

// Tela "Tutoriais": vídeos curtos de como usar o AgendeZap.
// Os itens sem vídeo aparecem como "Em breve" e são liberados em config/tutoriais.ts.

const GRUPOS: Tutorial['grupo'][] = ['Primeira configuração', 'Dia a dia'];

const PlayIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.4-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5z" /></svg>
);

const TutoriaisView: React.FC = () => {
  const [aberto, setAberto] = useState<Tutorial | null>(null);
  const prontos = TUTORIAIS.filter(t => t.arquivo).length;

  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aberto]);

  return (
    <div className="space-y-8 animate-fadeIn">
      <div>
        <h1 className="text-xl sm:text-2xl font-black text-black">Tutoriais</h1>
        <p className="text-sm text-slate-500 mt-1">
          Vídeos curtos mostrando como usar cada parte do AgendeZap. {prontos} de {TUTORIAIS.length} disponíveis — novos tutoriais chegam toda semana.
        </p>
      </div>

      {GRUPOS.map(grupo => (
        <section key={grupo} className="space-y-3">
          <h2 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{grupo}</h2>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {TUTORIAIS.filter(t => t.grupo === grupo).map(t => {
              const pronto = !!t.arquivo;
              const conteudo = (
                <>
                  <div className="relative w-full overflow-hidden rounded-xl bg-slate-100" style={{ aspectRatio: '16 / 9' }}>
                    {pronto ? (
                      <>
                        <img src={`/tutoriais/${t.arquivo}.jpg`} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                        <span className="absolute left-2 bottom-2 w-10 h-10 rounded-full flex items-center justify-center text-white shadow-lg" style={{ background: 'var(--color-primary)' }}>
                          <PlayIcon />
                        </span>
                        {t.duracao && (
                          <span className="absolute right-2 bottom-2 text-[11px] font-semibold text-white px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(17,17,19,0.78)' }}>{t.duracao}</span>
                        )}
                      </>
                    ) : (
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-400">
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                        <span className="text-xs font-semibold">Em breve</span>
                      </span>
                    )}
                  </div>
                  <div className="pt-3 space-y-1 text-left">
                    <div className="flex items-start gap-2">
                      <span className="text-[11px] font-semibold text-slate-400 mt-0.5">{t.id}</span>
                      <h3 className={`text-sm font-semibold leading-snug ${pronto ? 'text-black' : 'text-slate-500'}`}>{t.titulo}</h3>
                    </div>
                    <p className="text-[13px] text-slate-500 leading-snug">{t.descricao}</p>
                  </div>
                </>
              );
              return pronto ? (
                <button key={t.id} type="button" onClick={() => setAberto(t)}
                  className="bg-white rounded-2xl border border-slate-200 p-3 text-left flex flex-col justify-start hover:border-orange-300 hover:shadow-md transition-all">
                  {conteudo}
                </button>
              ) : (
                <div key={t.id} className="bg-white rounded-2xl border border-dashed border-slate-200 p-3 opacity-80" aria-label={`${t.titulo} — em breve`}>
                  {conteudo}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {aberto && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" style={{ background: 'rgba(17,17,19,0.85)' }}
          onClick={() => setAberto(null)} role="dialog" aria-modal="true" aria-label={aberto.titulo}>
          <div className="w-full max-w-5xl space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-white font-semibold text-base sm:text-lg">{aberto.titulo}</h2>
              <button type="button" onClick={() => setAberto(null)} aria-label="Fechar vídeo"
                className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-white hover:bg-white/10">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>
            <video key={aberto.id} src={`/tutoriais/${aberto.arquivo}.mp4`} poster={`/tutoriais/${aberto.arquivo}.jpg`}
              controls autoPlay playsInline preload="metadata" className="w-full rounded-xl bg-black" style={{ aspectRatio: '16 / 9' }} />
          </div>
        </div>
      )}
    </div>
  );
};

export default TutoriaisView;
