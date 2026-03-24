import { useState, useRef, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

type Status = 'idle' | 'loading' | 'ready' | 'processing' | 'done' | 'error';

export function useFFmpeg() {
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);

  const loadFFmpeg = useCallback(async () => {
    if (ffmpegRef.current) return;
    try {
      setStatus('loading');
      setError(null);
      const ffmpeg = new FFmpeg();
      ffmpeg.on('progress', ({ progress: p }) => {
        setProgress(Math.round(p * 100));
      });
      // Load single-threaded core from CDN (no COOP/COEP headers needed)
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      ffmpegRef.current = ffmpeg;
      setStatus('ready');
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar editor de vídeo');
      setStatus('error');
    }
  }, []);

  const trimVideo = useCallback(async (file: File, startSec: number, endSec: number) => {
    const ffmpeg = ffmpegRef.current;
    if (!ffmpeg) return;
    try {
      setStatus('processing');
      setProgress(0);
      setResultBlob(null);
      await ffmpeg.writeFile('input.mp4', await fetchFile(file));
      const startStr = formatTime(startSec);
      const endStr = formatTime(endSec);
      await ffmpeg.exec(['-i', 'input.mp4', '-ss', startStr, '-to', endStr, '-c', 'copy', 'output.mp4']);
      const data = await ffmpeg.readFile('output.mp4');
      const blob = new Blob([data], { type: 'video/mp4' });
      setResultBlob(blob);
      setStatus('done');
      return blob;
    } catch (e: any) {
      setError(e.message || 'Erro ao cortar vídeo');
      setStatus('error');
    }
  }, []);

  const addAudio = useCallback(async (videoFile: File, audioFile: File, videoVol: number, audioVol: number) => {
    const ffmpeg = ffmpegRef.current;
    if (!ffmpeg) return;
    try {
      setStatus('processing');
      setProgress(0);
      setResultBlob(null);
      await ffmpeg.writeFile('video.mp4', await fetchFile(videoFile));
      await ffmpeg.writeFile('audio.mp3', await fetchFile(audioFile));
      const vv = videoVol.toFixed(2);
      const av = audioVol.toFixed(2);
      await ffmpeg.exec([
        '-i', 'video.mp4', '-i', 'audio.mp3',
        '-filter_complex', `[0:a]volume=${vv}[a0];[1:a]volume=${av}[a1];[a0][a1]amix=inputs=2:duration=first[out]`,
        '-map', '0:v', '-map', '[out]', '-c:v', 'copy', 'output.mp4'
      ]);
      const data = await ffmpeg.readFile('output.mp4');
      const blob = new Blob([data], { type: 'video/mp4' });
      setResultBlob(blob);
      setStatus('done');
      return blob;
    } catch (e: any) {
      setError(e.message || 'Erro ao adicionar áudio');
      setStatus('error');
    }
  }, []);

  const denoiseAudio = useCallback(async (file: File) => {
    const ffmpeg = ffmpegRef.current;
    if (!ffmpeg) return;
    try {
      setStatus('processing');
      setProgress(0);
      setResultBlob(null);
      await ffmpeg.writeFile('input.mp4', await fetchFile(file));
      await ffmpeg.exec(['-i', 'input.mp4', '-af', 'afftdn=nf=-25', '-c:v', 'copy', 'output.mp4']);
      const data = await ffmpeg.readFile('output.mp4');
      const blob = new Blob([data], { type: 'video/mp4' });
      setResultBlob(blob);
      setStatus('done');
      return blob;
    } catch (e: any) {
      setError(e.message || 'Erro ao limpar ruído');
      setStatus('error');
    }
  }, []);

  const reset = useCallback(() => {
    setStatus(ffmpegRef.current ? 'ready' : 'idle');
    setProgress(0);
    setError(null);
    setResultBlob(null);
  }, []);

  return { status, progress, error, resultBlob, loadFFmpeg, trimVideo, addAudio, denoiseAudio, reset };
}

function formatTime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
