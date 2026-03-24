import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useFFmpeg } from '../../hooks/useFFmpeg';

type Tool = 'trim' | 'audio' | 'denoise';

export default function VideoEditor() {
  const { status, progress, error, resultBlob, loadFFmpeg, trimVideo, addAudio, denoiseAudio, reset } = useFFmpeg();

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [activeTool, setActiveTool] = useState<Tool>('trim');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioName, setAudioName] = useState('');
  const [videoVol, setVideoVol] = useState(0.3);
  const [audioVol, setAudioVol] = useState(0.7);
  const [dragging, setDragging] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Load FFmpeg on mount
  useEffect(() => { loadFFmpeg(); }, [loadFFmpeg]);

  // Clean up object URLs
  useEffect(() => {
    return () => { if (videoUrl) URL.revokeObjectURL(videoUrl); };
  }, [videoUrl]);

  const handleVideoUpload = useCallback((file: File) => {
    if (file.size > 100 * 1024 * 1024) {
      alert('Vídeo muito grande. Máximo 100MB.');
      return;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoUrl(url);
    setTrimStart(0);
    setTrimEnd(0);
    setAudioFile(null);
    setAudioName('');
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
      setTrimEnd(dur);
    }
  };

  const handleTrim = async () => {
    if (!videoFile) return;
    await trimVideo(videoFile, trimStart, trimEnd);
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
    setTrimStart(0);
    setTrimEnd(0);
    setAudioFile(null);
    setAudioName('');
    reset();
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  // Loading FFmpeg
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

  // Upload screen
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
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleVideoUpload(f); }}
        />
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
          className="w-full max-h-[350px] object-contain"
          controls
          onLoadedMetadata={onVideoLoaded}
          onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
        />
      </div>

      {/* Timeline bar (trim mode) */}
      {activeTool === 'trim' && duration > 0 && status !== 'done' && (
        <div className="bg-white dark:bg-[#132040] rounded-xl p-4 border border-gray-100 dark:border-gray-800">
          <div className="flex items-center justify-between text-xs font-bold text-gray-500 mb-2">
            <span>{fmt(trimStart)}</span>
            <span className="text-purple-600">{fmt(trimEnd - trimStart)} selecionado</span>
            <span>{fmt(trimEnd)}</span>
          </div>
          {/* Timeline visual */}
          <div className="relative h-10 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden">
            {/* Selected range */}
            <div
              className="absolute top-0 bottom-0 bg-purple-500/30"
              style={{
                left: `${(trimStart / duration) * 100}%`,
                width: `${((trimEnd - trimStart) / duration) * 100}%`,
              }}
            />
            {/* Current time indicator */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white shadow-md z-10"
              style={{ left: `${(currentTime / duration) * 100}%` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Início
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={trimStart}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  setTrimStart(Math.min(v, trimEnd - 0.5));
                  if (videoRef.current) videoRef.current.currentTime = v;
                }}
                className="w-full mt-1 accent-purple-600"
              />
            </label>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Fim
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={trimEnd}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  setTrimEnd(Math.max(v, trimStart + 0.5));
                  if (videoRef.current) videoRef.current.currentTime = v;
                }}
                className="w-full mt-1 accent-purple-600"
              />
            </label>
          </div>
        </div>
      )}

      {/* Tool tabs */}
      {status !== 'done' && (
        <div className="flex gap-2">
          {([
            { id: 'trim' as Tool, label: 'Cortar', emoji: '✂️' },
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
          {activeTool === 'trim' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Ajuste o início e fim do vídeo usando os controles acima.
                O corte é instantâneo (sem re-encodar).
              </p>
              <button
                onClick={handleTrim}
                disabled={status === 'processing'}
                className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                ✂️ Cortar Vídeo
              </button>
            </div>
          )}

          {activeTool === 'audio' && (
            <div className="space-y-4">
              <div>
                <button
                  onClick={() => audioInputRef.current?.click()}
                  className="w-full py-3 bg-gray-100 dark:bg-gray-800 rounded-xl font-bold text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  {audioName ? `🎵 ${audioName}` : '🎵 Selecionar música (MP3)'}
                </button>
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/mpeg,audio/mp3,audio/m4a,audio/wav"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) { setAudioFile(f); setAudioName(f.name); }
                  }}
                />
              </div>
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
              <button
                onClick={handleAddAudio}
                disabled={!audioFile || status === 'processing'}
                className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                🎵 Adicionar Áudio
              </button>
            </div>
          )}

          {activeTool === 'denoise' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Remove ruído de fundo da gravação (vento, ar-condicionado, chiado).
              </p>
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  ⚠️ Este processo pode demorar em vídeos longos. Recomendado para vídeos de até 2 minutos.
                </p>
              </div>
              <button
                onClick={handleDenoise}
                disabled={status === 'processing'}
                className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                🔇 Limpar Ruído
              </button>
            </div>
          )}
        </div>
      )}

      {/* Processing progress */}
      {status === 'processing' && (
        <div className="bg-white dark:bg-[#132040] rounded-xl p-6 border border-gray-100 dark:border-gray-800 text-center space-y-3">
          <div className="w-10 h-10 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto" />
          <p className="font-bold text-gray-900 dark:text-white">Processando...</p>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${Math.max(progress, 5)}%` }}
            />
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

      {/* Result actions */}
      {status === 'done' && resultBlob && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 space-y-3">
          <p className="text-sm font-bold text-green-700 dark:text-green-400 text-center">Vídeo editado com sucesso!</p>
          <div className="flex gap-3">
            <button
              onClick={handleExport}
              className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 transition-colors"
            >
              ⬇️ Baixar Vídeo
            </button>
            <button
              onClick={handleNewEdit}
              className="flex-1 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-bold text-sm hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Nova Edição
            </button>
          </div>
        </div>
      )}

      {/* Change video button */}
      {status !== 'processing' && status !== 'done' && (
        <button
          onClick={handleNewEdit}
          className="text-xs font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors text-center"
        >
          Trocar vídeo
        </button>
      )}
    </div>
  );
}
