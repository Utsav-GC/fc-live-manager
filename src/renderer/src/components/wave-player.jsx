import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { drawNoRender, drawWaveform } from '@/lib/draw';
import { fmtLength } from '@/lib/format';
import { audioPeaks } from '@/lib/peaks-client';
import { registerPlayer, reportPlay } from '@/lib/player-bus';
import { cn } from '@/lib/utils';

/**
 * Preview player: canvas waveform + cursor + play/pause, and a drop target -
 * dropping an MP3/WAV here makes it this project's preview. With no audio the
 * wave shows the "blank clip" hatch with a plain-words note.
 */
export function WavePlayer({ proxyUrl, peaksUrl, onDropFile }) {
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const waveRef = useRef(null);
  const peaksRef = useRef(null);
  const progressRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [time, setTime] = useState({ cur: 0, dur: 0 });

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    if (!proxyUrl || !peaksRef.current) {
      drawNoRender(c); // no audio - or waveform data not loaded yet
      return;
    }
    drawWaveform(c, peaksRef.current, progressRef.current);
  }, [proxyUrl]);

  // Waveform: the cached WAV/AIFF numbers from the main process when they
  // exist; otherwise (MP3, M4A, …) decode-and-reduce in Chromium, so every
  // preview draws a real waveform. Everything redraws on resize.
  useEffect(() => {
    let cancelled = false;
    peaksRef.current = null;
    progressRef.current = 0;
    setPlaying(false);
    setTime({ cur: 0, dur: 0 });

    const c = canvasRef.current;
    if (!c) return undefined;

    if (proxyUrl) {
      (async () => {
        let peaks = null;
        if (peaksUrl) {
          peaks = await fetch(peaksUrl)
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null);
        }
        if (!peaks) peaks = await audioPeaks(proxyUrl);
        if (cancelled) return;
        peaksRef.current = peaks;
        redraw();
      })();
    } else {
      redraw();
    }

    const ro = new ResizeObserver(() => redraw());
    ro.observe(c);
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [proxyUrl, peaksUrl, redraw]);

  // Audio wiring.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return undefined;
    const offBus = registerPlayer('detail', () => {
      if (!a.paused) a.pause();
    });
    const onTime = () => {
      const dur = a.duration && isFinite(a.duration) ? a.duration : 0;
      progressRef.current = dur ? a.currentTime / dur : 0;
      setTime({ cur: a.currentTime, dur });
      redraw();
    };
    const onPlay = () => {
      setPlaying(true);
      reportPlay('detail');
      onTime();
    };
    const onPause = () => {
      setPlaying(false);
      onTime();
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onTime);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    return () => {
      offBus();
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('ended', onTime);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.pause();
    };
  }, [redraw]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a || !proxyUrl) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  const seek = (e) => {
    const a = audioRef.current;
    const wave = waveRef.current;
    if (!a || !wave || !a.duration || !isFinite(a.duration)) return;
    const rect = wave.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * a.duration;
  };

  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const progress = time.dur ? Math.min(1, time.cur / time.dur) : 0;

  return (
    <div className="rounded-lg border bg-card/50 p-3">
      {/* the screen: waveform, cursor, and - when there is nothing to play -
          an honest empty display that also takes a drop */}
      <div
        ref={waveRef}
        data-testid="wave"
        onClick={seek}
        onDragOver={
          onDropFile
            ? (e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                if (!dragOver) setDragOver(true);
              }
            : undefined
        }
        onDragLeave={
          onDropFile
            ? (e) => {
                if (e.currentTarget.contains(e.relatedTarget)) return;
                setDragOver(false);
              }
            : undefined
        }
        onDrop={
          onDropFile
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOver(false);
                const file = e.dataTransfer.files && e.dataTransfer.files[0];
                if (file) onDropFile(file);
              }
            : undefined
        }
        className={cn(
          'well relative h-24 overflow-hidden rounded-md border border-border/50',
          proxyUrl && 'cursor-pointer',
          dragOver && 'border-primary/70 ring-1 ring-primary/50',
        )}
      >
        <canvas ref={canvasRef} data-testid="wave-canvas" className="absolute inset-0 h-full w-full" />
        <div aria-hidden="true" className="well-scanlines pointer-events-none absolute inset-0" />
        {proxyUrl ? (
          <div
            data-testid="wave-cursor"
            className="absolute inset-y-1 w-px bg-primary shadow-[0_0_8px] shadow-primary/50 transition-[left] duration-150 ease-linear"
            style={{ left: `${progress * 100}%` }}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-muted-foreground">
            No audio yet - drop an MP3 or WAV here, or use “Add audio”.
          </div>
        )}
        {dragOver ? (
          <div className="absolute inset-0 z-20 grid place-items-center bg-background/85 text-[10px] font-medium text-primary">
            Drop to set preview
          </div>
        ) : null}
      </div>

      {/* transport readout */}
      <div className="mt-3 flex items-center gap-3">
        <Button
          size="icon-sm"
          variant={playing ? 'default' : 'secondary'}
          disabled={!proxyUrl}
          onClick={toggle}
          data-testid="play-btn"
          aria-label={playing ? 'Pause' : 'Play'}
          className="size-9 rounded-full"
        >
          {playing ? (
            <Pause className="size-3.5" fill="currentColor" />
          ) : (
            <Play className="size-3.5 translate-x-px" fill="currentColor" />
          )}
        </Button>
        <span data-testid="wave-time" className="ml-auto font-mono text-xs tabular-nums">
          {proxyUrl ? (
            <>
              <span className="text-foreground">{fmtLength(time.cur)}</span>
              <span className="text-muted-foreground"> / {fmtLength(time.dur)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">no audio</span>
          )}
        </span>
        <audio ref={audioRef} preload="metadata" src={proxyUrl || undefined} className="hidden" />
      </div>
    </div>
  );
}
