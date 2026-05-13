"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export interface TTSState {
  isSupported: boolean;
  isSpeaking: boolean;
  /** Ref driven with real AnalyserNode amplitude 0–1 during API TTS,
   *  or synthetic wave during browser TTS fallback */
  ttsAmplitudeRef: React.RefObject<number>;
  /** Duration of the last audio response in seconds (0 if unknown) */
  lastAudioDuration: number;
}

export interface TTSControls {
  /** Speak text. Returns the audio duration in seconds once the audio starts
   *  playing (resolves to 0 on failure so callers can handle gracefully). */
  speak: (text: string) => Promise<number>;
  stop: () => void;
}

type TTSMode = "api" | "browser" | "unknown";

/**
 * React hook for Text-to-Speech with two tiers:
 *
 * Tier 1 — OpenAI TTS API (via /api/tts server route):
 *   - Natural, human-like voices (default: nova)
 *   - Real microphone-style amplitude data via Web Audio AnalyserNode
 *   - Returns exact audio duration so the caption typewriter can sync
 *   - Requires OPENAI_TTS_API_KEY on the server
 *
 * Tier 2 — Browser SpeechSynthesis (automatic fallback):
 *   - Used when the API key is not configured or the API fails
 *   - Synthetic sine-wave amplitude to keep the orb animated
 *   - Duration estimated from text length at average reading speed
 *
 * The hook detects which tier is available on first call and caches the result.
 */
export function useTextToSpeech(): TTSState & TTSControls {
  const [isSpeaking, setIsSpeaking]             = useState(false);
  const [lastAudioDuration, setLastAudioDuration] = useState(0);

  const ttsAmplitudeRef = useRef<number>(0);
  const modeRef         = useRef<TTSMode>("unknown");

  // Web Audio refs (API tier)
  const audioCtxRef     = useRef<AudioContext | null>(null);
  const sourceNodeRef   = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef     = useRef<AnalyserNode | null>(null);
  const ampRafRef       = useRef<number>(0);

  // Synthetic wave refs (browser tier)
  const synthRafRef     = useRef<number>(0);
  const tPhaseRef       = useRef(0);

  const isSupported =
    typeof window !== "undefined" &&
    ("speechSynthesis" in window || typeof AudioContext !== "undefined");

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAll();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Amplitude loop for Web Audio ──────────────────────────────────────────

  const startAmplitudeLoop = useCallback(() => {
    if (!analyserRef.current) return;
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);

    const tick = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      ttsAmplitudeRef.current = Math.min(1, (sum / dataArray.length) / 48);
      ampRafRef.current = requestAnimationFrame(tick);
    };

    ampRafRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Synthetic speech wave (browser fallback) ──────────────────────────────

  const startSyntheticAmplitude = useCallback(() => {
    tPhaseRef.current = 0;
    const tick = () => {
      const t = tPhaseRef.current;
      ttsAmplitudeRef.current = Math.min(1,
        0.32 * Math.abs(Math.sin(t * 2.6)) +
        0.22 * Math.abs(Math.sin(t * 5.9)) +
        0.10 * Math.abs(Math.sin(t * 11.3))
      );
      tPhaseRef.current += 0.052;
      synthRafRef.current = requestAnimationFrame(tick);
    };
    synthRafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopAll = useCallback(() => {
    // Stop Web Audio
    cancelAnimationFrame(ampRafRef.current);
    sourceNodeRef.current?.stop();
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;

    // Stop browser TTS
    cancelAnimationFrame(synthRafRef.current);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    ttsAmplitudeRef.current = 0;
    setIsSpeaking(false);
  }, []);

  // ── Tier 1: OpenAI TTS via API route ─────────────────────────────────────

  const speakViaAPI = useCallback(async (text: string): Promise<number> => {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        if (res.status === 503) {
          // Key not configured — switch to browser tier permanently
          modeRef.current = "browser";
        }
        return 0;
      }

      const arrayBuffer = await res.arrayBuffer();

      // Create (or reuse) AudioContext
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;

      // Resume if suspended (browser autoplay policy)
      if (ctx.state === "suspended") await ctx.resume();

      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const duration    = audioBuffer.duration;

      // Connect graph: source → analyser → destination
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      analyserRef.current = analyser;

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      sourceNodeRef.current = source;

      source.onended = () => {
        cancelAnimationFrame(ampRafRef.current);
        ttsAmplitudeRef.current = 0;
        setIsSpeaking(false);
        setLastAudioDuration(0);
      };

      source.start(0);
      setIsSpeaking(true);
      setLastAudioDuration(duration);
      startAmplitudeLoop();

      modeRef.current = "api";
      return duration;
    } catch {
      return 0;
    }
  }, [startAmplitudeLoop]);

  // ── Tier 2: Browser SpeechSynthesis fallback ─────────────────────────────

  const speakViaBrowser = useCallback((text: string): number => {
    if (!("speechSynthesis" in window)) return 0;

    window.speechSynthesis.cancel();
    cancelAnimationFrame(synthRafRef.current);

    const utterance = new SpeechSynthesisUtterance(text);

    // Find the best available English voice
    const voices     = window.speechSynthesis.getVoices();
    const enVoices   = voices.filter((v) => v.lang.startsWith("en"));
    const qualityTerms = ["neural", "natural", "premium", "enhanced", "samantha", "karen"];
    const best = enVoices.find((v) =>
      qualityTerms.some((t) => v.name.toLowerCase().includes(t))
    ) ?? enVoices.find((v) => v.lang === "en-US") ?? enVoices[0];

    if (best) utterance.voice = best;
    utterance.rate   = 1.05;
    utterance.pitch  = 1.0;
    utterance.volume = 1.0;

    utterance.onstart  = () => { setIsSpeaking(true);  startSyntheticAmplitude(); };
    utterance.onend    = () => { setIsSpeaking(false); cancelAnimationFrame(synthRafRef.current); ttsAmplitudeRef.current = 0; };
    utterance.onerror  = () => { setIsSpeaking(false); cancelAnimationFrame(synthRafRef.current); ttsAmplitudeRef.current = 0; };

    // Estimate duration: ~160 words per minute, ~5 chars per word
    const estimatedDuration = (text.length / 5 / 160) * 60;

    setTimeout(() => window.speechSynthesis.speak(utterance), 80);
    return estimatedDuration;
  }, [startSyntheticAmplitude]);

  // ── Public speak() ────────────────────────────────────────────────────────

  const speak = useCallback(async (text: string): Promise<number> => {
    if (!text.trim()) return 0;
    stopAll();

    // First call: probe the API to detect which mode to use
    if (modeRef.current === "unknown") {
      const duration = await speakViaAPI(text);
      if (duration > 0) return duration;
      // API unavailable — fall through to browser
      modeRef.current = "browser";
    }

    if (modeRef.current === "api") {
      const duration = await speakViaAPI(text);
      if (duration > 0) return duration;
      modeRef.current = "browser"; // API failed mid-session, fall back
    }

    // Browser fallback
    return speakViaBrowser(text);
  }, [stopAll, speakViaAPI, speakViaBrowser]);

  const stop = useCallback(() => stopAll(), [stopAll]);

  return {
    isSupported,
    isSpeaking,
    ttsAmplitudeRef: ttsAmplitudeRef as React.RefObject<number>,
    lastAudioDuration,
    speak,
    stop,
  };
}
