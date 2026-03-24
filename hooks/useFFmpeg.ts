import { useState, useRef, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

type Status = 'idle' | 'loading' | 'ready' | 'processing' | 'done' | 'error';

export type Transition = 'none' | 'fade' | 'fadeblack' | 'fadewhite' | 'slideleft' | 'slideright' | 'slideup' | 'slidedown' | 'wipeleft' | 'wiperight' | 'dissolve';

export interface Segment {
  id: string;
  start: number;
  end: number;
  transition: Transition; // transition AFTER this segment (into the next one)
  transitionDuration: number; // seconds (0.3 - 1.5)
}

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

  // Simple trim (keep start-end)
  const trimVideo = useCallback(async (file: File, startSec: number, endSec: number) => {
    const ffmpeg = ffmpegRef.current;
    if (!ffmpeg) return;
    try {
      setStatus('processing');
      setProgress(0);
      setResultBlob(null);
      await ffmpeg.writeFile('input.mp4', await fetchFile(file));
      await ffmpeg.exec(['-i', 'input.mp4', '-ss', fmt(startSec), '-to', fmt(endSec), '-c', 'copy', 'output.mp4']);
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

  // Multi-segment cut with transitions
  const spliceVideo = useCallback(async (file: File, segments: Segment[]) => {
    const ffmpeg = ffmpegRef.current;
    if (!ffmpeg || segments.length === 0) return;
    try {
      setStatus('processing');
      setProgress(0);
      setResultBlob(null);
      await ffmpeg.writeFile('input.mp4', await fetchFile(file));

      const hasTransitions = segments.some((s, i) => i < segments.length - 1 && s.transition !== 'none');

      if (segments.length === 1 && !hasTransitions) {
        // Single segment, just trim
        const s = segments[0];
        await ffmpeg.exec(['-i', 'input.mp4', '-ss', fmt(s.start), '-to', fmt(s.end), '-c', 'copy', 'output.mp4']);
      } else if (!hasTransitions) {
        // Multiple segments, no transitions — use concat (fast, no re-encode)
        for (let i = 0; i < segments.length; i++) {
          const s = segments[i];
          await ffmpeg.exec(['-i', 'input.mp4', '-ss', fmt(s.start), '-to', fmt(s.end), '-c', 'copy', `seg${i}.mp4`]);
        }
        const concatList = segments.map((_, i) => `file 'seg${i}.mp4'`).join('\n');
        await ffmpeg.writeFile('list.txt', concatList);
        await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'output.mp4']);
      } else {
        // Segments with transitions — requires re-encoding
        // First extract each segment
        for (let i = 0; i < segments.length; i++) {
          const s = segments[i];
          await ffmpeg.exec(['-i', 'input.mp4', '-ss', fmt(s.start), '-to', fmt(s.end), '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', `seg${i}.mp4`]);
        }

        if (segments.length === 2) {
          // 2 segments with xfade
          const t = segments[0];
          const dur = t.transitionDuration || 0.5;
          const seg0Dur = t.end - t.start;
          const offset = Math.max(0, seg0Dur - dur);
          await ffmpeg.exec([
            '-i', 'seg0.mp4', '-i', 'seg1.mp4',
            '-filter_complex', `[0:v][1:v]xfade=transition=${t.transition}:duration=${dur}:offset=${offset}[v];[0:a][1:a]acrossfade=d=${dur}[a]`,
            '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', 'output.mp4'
          ]);
        } else {
          // 3+ segments — chain xfade filters
          let filterV = '';
          let filterA = '';
          const inputs: string[] = [];
          for (let i = 0; i < segments.length; i++) {
            inputs.push('-i', `seg${i}.mp4`);
          }

          // Build xfade chain
          let runningOffset = 0;
          for (let i = 0; i < segments.length - 1; i++) {
            const segDur = segments[i].end - segments[i].start;
            const tr = segments[i].transition !== 'none' ? segments[i].transition : 'fade';
            const dur = segments[i].transitionDuration || 0.5;

            const vIn = i === 0 ? `[0:v]` : `[xv${i}]`;
            const vIn2 = `[${i + 1}:v]`;
            const vOut = i === segments.length - 2 ? '[v]' : `[xv${i + 1}]`;

            const aIn = i === 0 ? `[0:a]` : `[xa${i}]`;
            const aIn2 = `[${i + 1}:a]`;
            const aOut = i === segments.length - 2 ? '[a]' : `[xa${i + 1}]`;

            runningOffset += segDur - (i > 0 ? (segments[i - 1].transitionDuration || 0.5) : 0);
            const offset = Math.max(0, runningOffset - dur);

            filterV += `${vIn}${vIn2}xfade=transition=${tr}:duration=${dur}:offset=${offset}${vOut};`;
            filterA += `${aIn}${aIn2}acrossfade=d=${dur}${aOut};`;
          }

          const fc = (filterV + filterA).replace(/;$/, '');
          await ffmpeg.exec([
            ...inputs,
            '-filter_complex', fc,
            '-map', '[v]', '-map', '[a]',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac',
            'output.mp4'
          ]);
        }
      }

      const data = await ffmpeg.readFile('output.mp4');
      const blob = new Blob([data], { type: 'video/mp4' });
      setResultBlob(blob);
      setStatus('done');
      return blob;
    } catch (e: any) {
      setError(e.message || 'Erro ao processar vídeo');
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
      await ffmpeg.exec([
        '-i', 'video.mp4', '-i', 'audio.mp3',
        '-filter_complex', `[0:a]volume=${videoVol.toFixed(2)}[a0];[1:a]volume=${audioVol.toFixed(2)}[a1];[a0][a1]amix=inputs=2:duration=first[out]`,
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

  return { status, progress, error, resultBlob, loadFFmpeg, trimVideo, spliceVideo, addAudio, denoiseAudio, reset };
}

function fmt(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}
