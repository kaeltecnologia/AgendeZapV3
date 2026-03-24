import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useFFmpeg, Segment, Transition } from '../../hooks/useFFmpeg';

type Tool = 'cut' | 'audio' | 'denoise';

const TRANSITIONS: { id: Transition; label: string; emoji: string }[] = [
  { id: 'none', label: 'Nenhuma', emoji: '—' },
  { id: 'fade', label: 'Fade', emoji: '🌗' },
  { id: 'fadeblack', label: 'Fade Preto', emoji: '⬛' },
  { id: 'fadewhite', label: 'Fade Branco', emoji: '⬜' },
  { id: 'dissolve', label: 'Dissolver', emoji: '💫' },
  { id: 'slideleft', label: 'Deslizar ←', emoji: '⬅️' },
  { id: 'slideright', label: 'Deslizar →', emoji: '➡️' },
  { id: 'wipeleft', label: 'Limpar ←', emoji: '🧹' },
  { id: 'wiperight', label: 'Limpar →', emoji: '🧹' },
];

let segIdCounter = 0;
const newSegId = () => `seg_${++segIdCounter}`;

export default function VideoEditor() {
  const { status, progress, error, resultBlob, loadFFmpeg, spliceVideo, addAudio, denoiseAudio, reset } = useFFmpeg();

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegIdx, setSelectedSegIdx] = useState(0);
  const [activeTool, setActiveTool] = useState<Tool>('cut');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioName, setAudioName] = useState('');
  const [videoVol, setVideoVol] = useState(0.3);
  const [audioVol, setAudioVol] = useState(0.7);
  const [dragging, setDragging] = useState(false);
  const [editingTransition, setEditingTransition] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadFFmpeg(); }, [loadFFmpeg]);
  useEffect(() => { return () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }; }, [videoUrl]);

  const handleVideoUpload = useCallback((file: File) => {
    if (file.size > 100 * 1024 * 1024) { alert('Vídeo muito grande. Máximo 100MB.'); return; }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoUrl(url);
    setSegments([]);
    setSelectedSegIdx(0);
    setAudioFile(null);
    setAudioName('');
    setEditingTransition(null);
    reset();
  }, [videoUrl, reset]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) handleVideoUpload(file);
  }, [handleVideoUpload]);

  const onVideoLoaded = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      setDuration(dur);
      setSegments([{ id: newSegId(), start: 0, end: dur, transition: 'none', transitionDuration: 0.5 }]);
    }
  };

  // Split a segment at a given time
  const splitSegment = (time: number) => {
    const idx = segments.findIndex(s => time > s.start && time < s.end);
    if (idx < 0) return;
    const seg = segments[idx];
    const newSegs = [...segments];
    newSegs.splice(idx, 1,
      { id: seg.id, start: seg.start, end: time, transition: 'none', transitionDuration: 0.5 },
      { id: newSegId(), start: time, end: seg.end, transition: seg.transition, transitionDuration: seg.transitionDuration }
    );
    setSegments(newSegs);
    setSelectedSegIdx(idx);
  };

  // Remove a segment (mark as "cut out")
  const removeSegment = (idx: number) => {
    if (segments.length <= 1) return;
    const newSegs = segments.filter((_, i) => i !== idx);
    setSegments(newSegs);
    setSelectedSegIdx(Math.min(selectedSegIdx, newSegs.length - 1));
  };

  const updateTransition = (idx: number, transition: Transition) => {
    const newSegs = [...segments];
    newSegs[idx] = { ...newSegs[idx], transition };
    setSegments(newSegs);
  };

  const updateTransitionDuration = (idx: number, dur: number) => {
    const newSegs = [...segments];
    newSegs[idx] = { ...newSegs[idx], transitionDuration: dur };
    setSegments(newSegs);
  };

  const handleProcess = async () => {
    if (!videoFile || segments.length === 0) return;
    await spliceVideo(videoFile, segments);
  };

  const handleAddAudio = async () => {
    if (!videoFile || !audioFile) return;
    await addAudio(videoFile, audioFile, videoVol, audioVol);
  };

  const handleDenoise = async () => {
    if (!videoFile) return;
    await denoiseAudio(videoFile);
  };

  const handleExport = () => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `editado_${Date.now()}.mp4`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleNewEdit = () => {
    setVideoFile(null);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setDuration(0);
    setSegments([]);
    setSelectedSegIdx(0);
    setAudioFile(null);
    setAudioName('');
    setEditingTransition(null);
    reset();
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const totalKept = segments.reduce((sum, s) => sum + (s.end - s.start), 0);

  // Loading
  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
        <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">Carregando editor de vídeo...</p>
        <p className="text-xs text-gray-400">Primeira vez pode demorar alguns segundos</p>
      </div>
    );
  }

  if (status === 'error' && !videoFile) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-red-500 font-semibold">Erro ao carregar editor</p>
        <p className="text-xs text-gray-400">{error}</p>
        <button onClick={loadFFmpeg} className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-bold">Tentar novamente</button>
      </div>
    );
  }

  // Upload
  if (!videoFile || !videoUrl) {
    return (
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center py-20 gap-6 border-2 border-dashed rounded-2xl mx-4 my-6 transition-colors cursor-pointer ${
          dragging ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-purple-300'
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
          <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </div>
        <div className="text-center">
          <p className="font-bold text-gray-900 dark:text-white text-lg">Arraste um vídeo aqui</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">ou clique para selecionar</p>
          <p className="text-xs text-gray-400 mt-2">MP4, MOV ou WebM • Máximo 100MB</p>
        </div>
        <input ref={fileInputRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleVideoUpload(f); }} />
      </div>
    );
  }

  const resultUrl = resultBlob ? URL.createObjectURL(resultBlob) : null;

  return (
    <div className="flex flex-col gap-4 p-4 max-w-2xl mx-auto">
      {/* Video Preview */}
      <div className="bg-black rounded-2xl overflow-hidden shadow-lg">
        <video
          ref={videoRef}
          src={status === 'done' && resultUrl ? resultUrl : videoUrl}
          className="w-full max-h-[300px] object-contain"
          controls
          onLoadedMetadata={onVideoLoaded}
          onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
        />
      </div>

      {/* Timeline with segments */}
      {duration > 0 && status !== 'done' && activeTool === 'cut' && (
        <div className="bg-white dark:bg-[#132040] rounded-xl p-4 border border-gray-100 dark:border-gray-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500">Timeline</span>
            <span className="text-xs font-semibold text-purple-600">{fmtTime(totalKept)} mantido de {fmtTime(duration)}</span>
          </div>

          {/* Visual timeline */}
          <div className="relative h-12 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden">
            {segments.map((seg, i) => {
              const left = (seg.start / duration) * 100;
              const width = ((seg.end - seg.start) / duration) * 100;
              return (
                <div
                  key={seg.id}
                  onClick={() => {
                    setSelectedSegIdx(i);
                    if (videoRef.current) videoRef.current.currentTime = seg.start;
                  }}
                  className={`absolute top-1 bottom-1 rounded cursor-pointer transition-all ${
                    selectedSegIdx === i ? 'bg-purple-500 ring-2 ring-purple-300' : 'bg-purple-400/60 hover:bg-purple-400/80'
                  }`}
                  style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
                >
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white truncate px-1">
                    {width > 5 ? `${fmtTime(seg.start)}-${fmtTime(seg.end)}` : ''}
                  </span>
                </div>
              );
            })}
            {/* Playhead */}
            <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
              style={{ left: `${(currentTime / duration) * 100}%` }} />
          </div>

          {/* Segments list */}
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {segments.map((seg, i) => (
              <React.Fragment key={seg.id}>
                <div
                  onClick={() => {
                    setSelectedSegIdx(i);
                    if (videoRef.current) videoRef.current.currentTime = seg.start;
                  }}
                  className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all text-sm ${
                    selectedSegIdx === i ? 'bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <span className="w-6 h-6 rounded-full bg-purple-500 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">{i + 1}</span>
                  <span className="font-semibold text-gray-700 dark:text-gray-300 flex-1">{fmtTime(seg.start)} — {fmtTime(seg.end)}</span>
                  <span className="text-xs text-gray-400">{fmtTime(seg.end - seg.start)}</span>
                  {segments.length > 1 && (
                    <button
                      onClick={e => { e.stopPropagation(); removeSegment(i); }}
                      className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/30 text-red-500 flex items-center justify-center hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                      title="Remover trecho"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                  )}
                </div>

                {/* Transition picker between segments */}
                {i < segments.length - 1 && (
                  <div className="flex items-center gap-2 pl-8">
                    <div className="w-0.5 h-4 bg-gray-200 dark:bg-gray-700" />
                    <button
                      onClick={() => setEditingTransition(editingTransition === i ? null : i)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold transition-all ${
                        seg.transition !== 'none'
                          ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      {seg.transition !== 'none'
                        ? `${TRANSITIONS.find(t => t.id === seg.transition)?.emoji} ${TRANSITIONS.find(t => t.id === seg.transition)?.label}`
                        : '+ Transição'}
                    </button>
                  </div>
                )}

                {/* Transition editor */}
                {editingTransition === i && i < segments.length - 1 && (
                  <div className="ml-8 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700 space-y-2">
                    <div className="grid grid-cols-3 gap-1.5">
                      {TRANSITIONS.map(t => (
                        <button
                          key={t.id}
                          onClick={() => updateTransition(i, t.id)}
                          className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                            seg.transition === t.id
                              ? 'bg-indigo-500 text-white'
                              : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
                          }`}
                        >
                          {t.emoji} {t.label}
                        </button>
                      ))}
                    </div>
                    {seg.transition !== 'none' && (
                      <label className="flex items-center justify-between text-[10px] font-semibold text-gray-500">
                        <span>Duração: {seg.transitionDuration.toFixed(1)}s</span>
                        <input type="range" min={0.3} max={1.5} step={0.1} value={seg.transitionDuration}
                          onChange={e => updateTransitionDuration(i, parseFloat(e.target.value))}
                          className="w-24 accent-indigo-500" />
                      </label>
                    )}
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Split button */}
          <button
            onClick={() => splitSegment(currentTime)}
            className="w-full py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            ✂️ Cortar em {fmtTime(currentTime)} (posição atual)
          </button>
        </div>
      )}

      {/* Tool tabs */}
      {status !== 'done' && (
        <div className="flex gap-2">
          {([
            { id: 'cut' as Tool, label: 'Cortar', emoji: '✂️' },
            { id: 'audio' as Tool, label: 'Áudio', emoji: '🎵' },
            { id: 'denoise' as Tool, label: 'Limpar Ruído', emoji: '🔇' },
          ]).map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTool(t.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${
                activeTool === t.id
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'bg-gray-100 dark:bg-[#132040] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <span>{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Tool panels */}
      {status !== 'done' && status !== 'processing' && (
        <div className="bg-white dark:bg-[#132040] rounded-xl p-4 border border-gray-100 dark:border-gray-800">
          {activeTool === 'cut' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Navegue no vídeo e clique <strong>"Cortar"</strong> para dividir. Remova trechos indesejados com o <strong>X</strong>. Adicione transições entre os cortes.
              </p>
              {segments.some((s, i) => i < segments.length - 1 && s.transition !== 'none') && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2">
                  <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                    ⚠️ Transições precisam re-encodar o vídeo. Pode demorar mais.
                  </p>
                </div>
              )}
              <button
                onClick={handleProcess}
                disabled={status === 'processing'}
                className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                🎬 Processar Vídeo ({segments.length} trecho{segments.length > 1 ? 's' : ''})
              </button>
            </div>
          )}

          {activeTool === 'audio' && (
            <div className="space-y-4">
              <button onClick={() => audioInputRef.current?.click()}
                className="w-full py-3 bg-gray-100 dark:bg-gray-800 rounded-xl font-bold text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                {audioName ? `🎵 ${audioName}` : '🎵 Selecionar música (MP3)'}
              </button>
              <input ref={audioInputRef} type="file" accept="audio/mpeg,audio/mp3,audio/m4a,audio/wav" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) { setAudioFile(f); setAudioName(f.name); } }} />
              <div className="space-y-2">
                <label className="flex items-center justify-between text-xs font-semibold text-gray-600 dark:text-gray-400">
                  <span>Volume do vídeo original</span>
                  <span className="text-purple-600">{Math.round(videoVol * 100)}%</span>
                </label>
                <input type="range" min={0} max={1} step={0.05} value={videoVol} onChange={e => setVideoVol(parseFloat(e.target.value))} className="w-full accent-purple-600" />
              </div>
              <div className="space-y-2">
                <label className="flex items-center justify-between text-xs font-semibold text-gray-600 dark:text-gray-400">
                  <span>Volume da música</span>
                  <span className="text-purple-600">{Math.round(audioVol * 100)}%</span>
                </label>
                <input type="range" min={0} max={1} step={0.05} value={audioVol} onChange={e => setAudioVol(parseFloat(e.target.value))} className="w-full accent-purple-600" />
              </div>
              <button onClick={handleAddAudio} disabled={!audioFile}
                className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition-colors disabled:opacity-50">
                🎵 Adicionar Áudio
              </button>
            </div>
          )}

          {activeTool === 'denoise' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">Remove ruído de fundo (vento, ar-condicionado, chiado).</p>
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">⚠️ Pode demorar em vídeos longos. Recomendado até 2 minutos.</p>
              </div>
              <button onClick={handleDenoise}
                className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition-colors disabled:opacity-50">
                🔇 Limpar Ruído
              </button>
            </div>
          )}
        </div>
      )}

      {/* Processing */}
      {status === 'processing' && (
        <div className="bg-white dark:bg-[#132040] rounded-xl p-6 border border-gray-100 dark:border-gray-800 text-center space-y-3">
          <div className="w-10 h-10 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto" />
          <p className="font-bold text-gray-900 dark:text-white">Processando...</p>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${Math.max(progress, 5)}%` }} />
          </div>
          <p className="text-sm text-gray-500">{progress}%</p>
        </div>
      )}

      {/* Error */}
      {error && status === 'error' && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-600 dark:text-red-400">{error}</p>
          <button onClick={reset} className="mt-2 text-xs font-bold text-red-500 underline">Tentar novamente</button>
        </div>
      )}

      {/* Result */}
      {status === 'done' && resultBlob && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 space-y-3">
          <p className="text-sm font-bold text-green-700 dark:text-green-400 text-center">Vídeo editado com sucesso!</p>
          <div className="flex gap-3">
            <button onClick={handleExport}
              className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 transition-colors">
              ⬇️ Baixar Vídeo
            </button>
            <button onClick={handleNewEdit}
              className="flex-1 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-bold text-sm hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
              Nova Edição
            </button>
          </div>
        </div>
      )}

      {/* Change video */}
      {status !== 'processing' && status !== 'done' && (
        <button onClick={handleNewEdit}
          className="text-xs font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors text-center">
          Trocar vídeo
        </button>
      )}
    </div>
  );
}
