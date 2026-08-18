"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

import { formatDuration } from "@/lib/inbox/utils";
import { cn } from "@/lib/utils";

const PLAYBACK_RATES = [1, 1.5, 2] as const;

interface AudioPlayerProps {
  src: string;
  /** Duração conhecida (metadata do canal) — evita layout shift. */
  durationSeconds?: number;
  className?: string;
}

/**
 * Player de áudio custom (estilo WhatsApp): play/pause, barra de progresso
 * arrastável, tempo decorrido/total e velocidade 1x/1.5x/2x.
 */
export function AudioPlayer({ src, durationSeconds, className }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [rateIndex, setRateIndex] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = (): void => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = (): void => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const onEnded = (): void => {
      setPlaying(false);
      setCurrentTime(0);
    };
    const onPlay = (): void => setPlaying(true);
    const onPause = (): void => setPlaying(false);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  const togglePlay = useCallback((): void => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, []);

  const seek = (value: number): void => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setCurrentTime(value);
  };

  const cycleRate = (): void => {
    setRateIndex((index) => {
      const next = (index + 1) % PLAYBACK_RATES.length;
      const audio = audioRef.current;
      if (audio) audio.playbackRate = PLAYBACK_RATES[next] ?? 1;
      return next;
    });
  };

  const rate = PLAYBACK_RATES[rateIndex] ?? 1;
  const safeDuration = duration > 0 ? duration : 1;
  // currentColor com alpha — herda a cor do texto da bolha (inbound/outbound).
  const subtleBg = { backgroundColor: "color-mix(in srgb, currentColor 14%, transparent)" };

  return (
    <div className={cn("flex w-60 max-w-full items-center gap-2", className)}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
        style={subtleBg}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-80"
      >
        {playing ? (
          <Pause className="h-4 w-4 fill-current" />
        ) : (
          <Play className="ml-0.5 h-4 w-4 fill-current" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={safeDuration}
          step={0.1}
          value={Math.min(currentTime, safeDuration)}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Posição do áudio"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-current [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-current"
          style={{ accentColor: "currentColor", ...subtleBg }}
        />
        <div className="mt-0.5 flex items-center justify-between text-[10px] tabular-nums opacity-80">
          <span>{formatDuration(currentTime)}</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={cycleRate}
        aria-label={`Velocidade de reprodução: ${rate}x`}
        style={subtleBg}
        className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums transition-opacity hover:opacity-80"
      >
        {rate}x
      </button>
    </div>
  );
}
