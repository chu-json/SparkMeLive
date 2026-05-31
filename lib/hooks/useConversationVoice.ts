"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Local types for the Web Speech API (not in lib.dom.d.ts) ───────────────

interface SpeechRec {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechResultItem {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechResultItem;
}

interface SpeechResultList {
  readonly length: number;
  [index: number]: SpeechResult;
}

interface SpeechResultEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechResultList;
}

interface SpeechErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

// ── Tuning constants ──────────────────────────────────────────────────────
// All times in ms unless noted. Tuned for natural conversation pacing.

/** Amplitude (0–1) above which we consider the user to be actively speaking. */
const SPEECH_AMP_START = 0.08;
/** Hysteresis: must drop below this to count as silent. */
const SPEECH_AMP_STOP = 0.045;
/** Minimum sustained speech (ms) before we register "user is speaking". */
const SPEECH_DEBOUNCE_MS = 180;
/**
 * Sustained "loud" speech needed to register a barge-in over the AI. We use
 * BOTH a higher amplitude threshold AND a longer duration than normal
 * speech detection because the open mic inevitably leaks some of the TTS
 * audio coming out of the user's speakers — without a buffer here, the AI
 * cuts itself off the moment it starts speaking.
 */
const BARGE_IN_AMP_START = 0.16;
const BARGE_IN_MS = 350;
/** How long someone must be audibly speaking while muted to show the toast. */
const MUTED_TALKING_MS = 800;
/**
 * After start() opens the mic, AnalyserNode samples are noisy for a few
 * dozen ms while the audio graph stabilises. Ignore endpoint + barge-in
 * detection for this brief warm-up so the first frame can't fire a phantom
 * "user is talking" event.
 */
const STARTUP_GRACE_MS = 600;

/** Default silence window before we treat an utterance as complete. */
const SILENCE_DEFAULT_MS = 1400;
/** Quick submit when the transcript clearly ends a sentence. */
const SILENCE_TERMINATED_MS = 900;
/** Slower submit when the last token is a conjunction (likely a pause). */
const SILENCE_CONJUNCTION_MS = 2200;
/** Even slower for filler words ("um", "uh") — they're definitely still thinking. */
const SILENCE_FILLER_MS = 2500;
/** Slower for very short utterances (< 3 words) — easy to misfire. */
const SILENCE_SHORT_MS = 2000;
/** Hard cap so a hot mic doesn't keep us waiting forever. */
const SILENCE_MAX_MS = 4000;

const FILLERS = new Set([
  "um", "umm", "uh", "uhh", "uhm", "er", "erm",
  "hmm", "hm", "like", "you", "know",
]);

const CONJUNCTIONS = new Set([
  "and", "but", "or", "so", "because", "cause", "cuz",
  "if", "when", "while", "as", "since", "though", "although",
  "then", "however", "actually", "well",
]);

function pickSilenceThreshold(transcript: string): number {
  const trimmed = transcript.trim();
  if (!trimmed) return SILENCE_DEFAULT_MS;

  if (/[.!?]"?$/.test(trimmed)) return SILENCE_TERMINATED_MS;

  const tokens = trimmed.toLowerCase().split(/\s+/);
  const lastToken = tokens[tokens.length - 1]?.replace(/[^a-z']/g, "") ?? "";

  if (FILLERS.has(lastToken)) return SILENCE_FILLER_MS;
  if (CONJUNCTIONS.has(lastToken)) return SILENCE_CONJUNCTION_MS;
  if (tokens.length < 3) return SILENCE_SHORT_MS;

  return SILENCE_DEFAULT_MS;
}

// ── Hook params + return ──────────────────────────────────────────────────

export interface UseConversationVoiceParams {
  /** Master switch. When false the hook tears everything down. */
  enabled: boolean;
  /** Parent tells us when AI audio is actively playing (drives barge-in). */
  isAISpeaking: boolean;
  /**
   * Parent tells us when an LLM turn is in flight (between submit and TTS start).
   * Used as the "overwrite-last-call" window — if the user resumes speaking
   * during this phase the parent should abort the request and we'll keep
   * accumulating into the same turn.
   */
  isAIThinking: boolean;
  /** Fired when silence threshold has been met and we have content. */
  onUtteranceComplete: (text: string) => void;
  /** Fired the moment the user starts talking while AI is speaking. */
  onBargeInWhileSpeaking: () => void;
  /** Fired the moment the user resumes talking while AI is still thinking. */
  onBargeInWhileThinking: () => void;
  /** Fired the FIRST time the user speaks audibly while muted. */
  onMutedTalking: () => void;
  /** Fired with a permission / device error. */
  onError: (message: string) => void;
}

export interface UseConversationVoiceReturn {
  /** True once mic permission is granted and analyser is running. */
  isReady: boolean;
  /** User-controlled mute state. */
  isMuted: boolean;
  /** Live "user is speaking right now" flag (debounced). */
  isUserSpeaking: boolean;
  /** Live amplitude 0–1, driven by AnalyserNode. */
  amplitudeRef: React.RefObject<number>;
  /** Combined final + interim transcript shown live in the caption. */
  liveTranscript: string;
  /** Most recent error message, if any. */
  error: string | null;
  /** Acquire mic + start analyser + start speech recognition. Returns granted. */
  start: () => Promise<boolean>;
  /** Tear everything down (releases the mic). */
  stop: () => void;
  setMuted: (m: boolean) => void;
  toggleMute: () => void;
  /** Clear current utterance buffer (call after submitting a turn). */
  clearTranscript: () => void;
  /** Re-seed the transcript buffer (used by overwrite-last-call). */
  restoreTranscript: (text: string) => void;
}

/**
 * Continuous, hands-free voice loop.
 *
 * Drives one MediaStream + AnalyserNode + SpeechRecognition for the whole
 * interview session. Combines amplitude-based VAD with the Web Speech API's
 * own `isFinal` events to decide when the user has finished speaking, then
 * fires `onUtteranceComplete(text)` so the parent can submit a turn.
 *
 * Also detects:
 *   • barge-in over AI TTS playback
 *   • barge-in while AI is "thinking" (overwrite-last-call window)
 *   • the user talking while muted (Zoom-style, once per session)
 */
export function useConversationVoice(
  params: UseConversationVoiceParams,
): UseConversationVoiceReturn {
  const {
    enabled,
    isAISpeaking,
    isAIThinking,
    onUtteranceComplete,
    onBargeInWhileSpeaking,
    onBargeInWhileThinking,
    onMutedTalking,
    onError,
  } = params;

  const [isReady, setIsReady]                 = useState(false);
  const [isMuted, setIsMutedState]            = useState(false);
  const [isUserSpeaking, setIsUserSpeaking]   = useState(false);
  const [liveTranscript, setLiveTranscript]   = useState("");
  const [error, setError]                     = useState<string | null>(null);

  // Refs — long-lived audio + speech objects + counters
  const amplitudeRef        = useRef<number>(0);
  const streamRef           = useRef<MediaStream | null>(null);
  const audioCtxRef         = useRef<AudioContext | null>(null);
  const analyserRef         = useRef<AnalyserNode | null>(null);
  // Cast type is required because TypeScript 5.7+ tightened ArrayBuffer typing
  // and getByteFrequencyData expects Uint8Array<ArrayBuffer> specifically.
  const dataArrayRef        = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rafRef              = useRef<number>(0);

  const recognitionRef      = useRef<SpeechRec | null>(null);
  const recIsRunningRef     = useRef(false);
  const wantRunningRef      = useRef(false); // hold goal state for auto-restart

  // Endpointing state
  const finalTextRef        = useRef("");
  const interimTextRef      = useRef("");
  const lastSpeechAtRef     = useRef<number>(0); // performance.now() of last *real* user speech
  const speakingSinceRef    = useRef<number>(0); // when current "speaking" run started, 0 if silent
  const hasContentRef       = useRef(false);     // do we have anything to submit?
  /**
   * performance.now() when start() opened the mic — used for STARTUP_GRACE_MS.
   * Reset on each start() so a Push-to-Talk → Hands-free flip also gets a
   * clean warm-up window.
   */
  const startedAtRef        = useRef<number>(0);

  // Mute / barge-in latches
  const isMutedRef          = useRef(false);
  const isAISpeakingRef     = useRef(false);
  const isAIThinkingRef     = useRef(false);
  const mutedTalkingShownRef = useRef(false);
  const mutedTalkingSinceRef = useRef<number>(0);
  const bargeInSpeakingFiredRef = useRef(false);
  const bargeInThinkingFiredRef = useRef(false);

  // Keep refs in sync with props
  useEffect(() => { isMutedRef.current      = isMuted; },      [isMuted]);
  useEffect(() => { isAISpeakingRef.current = isAISpeaking; }, [isAISpeaking]);
  useEffect(() => { isAIThinkingRef.current = isAIThinking; }, [isAIThinking]);

  // Reset barge-in latches when the corresponding AI phase ends
  useEffect(() => {
    if (!isAISpeaking) bargeInSpeakingFiredRef.current = false;
  }, [isAISpeaking]);
  useEffect(() => {
    if (!isAIThinking) bargeInThinkingFiredRef.current = false;
  }, [isAIThinking]);

  // ── Speech Recognition setup ──────────────────────────────────────────────

  const startSpeechRecognition = useCallback(() => {
    if (typeof window === "undefined") return;
    const win = window as unknown as Record<string, unknown>;
    const API = (win.SpeechRecognition || win.webkitSpeechRecognition) as
      | (new () => SpeechRec)
      | undefined;
    if (!API) return; // graceful: VAD still works without transcription

    if (recIsRunningRef.current) return;

    const recognition = new API();
    recognition.continuous     = true;
    recognition.interimResults = true;
    recognition.lang           = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      recIsRunningRef.current = true;
    };

    recognition.onresult = (event: SpeechResultEvent) => {
      if (isMutedRef.current) return;
      // While the AI is speaking, the mic is still hot and Web Speech will
      // happily transcribe whatever leaks from the speakers into the mic
      // (e.g. the AI's own words). Discard those results — barge-in is
      // handled via the higher-threshold amplitude check below, and the
      // transcript buffer must stay clean for the upcoming user turn.
      if (isAISpeakingRef.current) return;

      let interim = "";
      let newFinal = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text   = result[0]?.transcript ?? "";
        if (result.isFinal) newFinal += text + " ";
        else                interim   += text;
      }

      if (newFinal) {
        finalTextRef.current = (finalTextRef.current + newFinal).trim() + " ";
      }
      interimTextRef.current = interim;

      const combined = (finalTextRef.current + interimTextRef.current).trim();
      if (combined) {
        hasContentRef.current = true;
        // Web Speech publishing a result IS evidence of real user speech
        // (its own ML-based VAD just admitted some). Treat that as activity
        // for the silence clock too, in case the amplitude was already
        // dipping by the time the result arrived.
        lastSpeechAtRef.current = performance.now();
      }
      setLiveTranscript(combined);

      // Web Speech itself just confirmed an utterance boundary — bias the
      // silence clock forward so we submit a touch faster.
      if (newFinal) {
        lastSpeechAtRef.current = Math.min(
          lastSpeechAtRef.current,
          performance.now() - 400,
        );
      }
    };

    recognition.onerror = (e: SpeechErrorEvent) => {
      // "no-speech" / "aborted" / "audio-capture" are all recoverable —
      // the onend handler below will restart the recognizer.
      if (e.error !== "aborted" && e.error !== "no-speech") {
        // Surface only real errors. Don't spam the user with "no-speech".
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setError("Microphone permission denied. Please allow access.");
          onError("Microphone permission denied. Please allow access.");
        }
      }
      recIsRunningRef.current = false;
    };

    recognition.onend = () => {
      recIsRunningRef.current = false;
      // Chrome ends recognition periodically even with continuous=true.
      // Restart as long as we still want to be running.
      if (wantRunningRef.current) {
        try { recognition.start(); } catch { /* will retry on next loop */ }
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // Could throw if already started — ignore.
    }
  }, [onError]);

  const stopSpeechRecognition = useCallback(() => {
    wantRunningRef.current = false;
    const rec = recognitionRef.current;
    if (!rec) return;
    rec.onend = null;
    try { rec.stop(); } catch { /* noop */ }
    try { rec.abort(); } catch { /* noop */ }
    recIsRunningRef.current = false;
    recognitionRef.current = null;
  }, []);

  // ── Main amplitude / endpointing loop ────────────────────────────────────

  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    const data     = dataArrayRef.current;
    if (!analyser || !data) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const amp = Math.min(1, (sum / data.length) / 64);
    amplitudeRef.current = amp;

    const now = performance.now();
    const sinceStart = now - startedAtRef.current;
    const inStartupGrace = sinceStart < STARTUP_GRACE_MS;

    // Track sustained speaking with hysteresis to debounce against blips.
    // CRITICAL: we no longer touch `lastSpeechAtRef.current` here on every
    // above-threshold frame — doing so means background noise that grazes
    // the threshold would reset the silence clock continuously and the
    // utterance would never complete. We only mark "real speech" once
    // sustained-speaking is confirmed below.
    const wasSpeaking = speakingSinceRef.current > 0;
    if (amp > SPEECH_AMP_START) {
      if (!wasSpeaking) speakingSinceRef.current = now;
    } else if (wasSpeaking && amp < SPEECH_AMP_STOP) {
      speakingSinceRef.current = 0;
    }

    const speakingFor = speakingSinceRef.current > 0
      ? now - speakingSinceRef.current
      : 0;

    const userIsSpeakingNow = !inStartupGrace && speakingFor >= SPEECH_DEBOUNCE_MS;
    setIsUserSpeaking((prev) => (prev !== userIsSpeakingNow ? userIsSpeakingNow : prev));

    // Only count *sustained* user speech as activity on the silence clock.
    // This is what stops momentary noise blips from preventing submission.
    if (userIsSpeakingNow) {
      lastSpeechAtRef.current = now;
    }

    // ── Muted-talking detection ─────────────────────────────────────────
    if (isMutedRef.current) {
      if (userIsSpeakingNow) {
        if (mutedTalkingSinceRef.current === 0) mutedTalkingSinceRef.current = now;
        const mutedFor = now - mutedTalkingSinceRef.current;
        if (mutedFor >= MUTED_TALKING_MS && !mutedTalkingShownRef.current) {
          mutedTalkingShownRef.current = true;
          onMutedTalking();
        }
      } else {
        mutedTalkingSinceRef.current = 0;
      }
      // While muted we never submit and we discard interim transcript.
      finalTextRef.current = "";
      interimTextRef.current = "";
      hasContentRef.current = false;
      lastSpeechAtRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
      return;
    } else {
      mutedTalkingSinceRef.current = 0;
    }

    // ── Barge-in detection ──────────────────────────────────────────────
    // Use a HIGHER amplitude threshold than the normal speech detector so
    // imperfect echo cancellation (i.e. the user's own speakers bleeding
    // into the mic while TTS plays) can't cut the AI off. The user has to
    // actually talk over it.
    const bargeInAmpHigh = amp > BARGE_IN_AMP_START;
    const bargeInFor = bargeInAmpHigh && speakingSinceRef.current > 0
      ? now - speakingSinceRef.current
      : 0;
    if (!inStartupGrace && bargeInFor >= BARGE_IN_MS) {
      if (isAISpeakingRef.current && !bargeInSpeakingFiredRef.current) {
        bargeInSpeakingFiredRef.current = true;
        onBargeInWhileSpeaking();
      } else if (isAIThinkingRef.current && !bargeInThinkingFiredRef.current) {
        bargeInThinkingFiredRef.current = true;
        onBargeInWhileThinking();
      }
    }

    // ── Endpoint (silence) detection ────────────────────────────────────
    // Only fire utterance-complete when we're "in our turn" — i.e. not while
    // the AI is speaking or actively thinking. (Barge-in handles those.)
    const aiBusy = isAISpeakingRef.current || isAIThinkingRef.current;
    if (!aiBusy && hasContentRef.current && !userIsSpeakingNow) {
      const silenceMs = now - lastSpeechAtRef.current;
      const transcript = (finalTextRef.current + interimTextRef.current).trim();
      const threshold = pickSilenceThreshold(transcript);
      const effective = Math.min(threshold, SILENCE_MAX_MS);

      if (silenceMs >= effective && transcript.length > 0) {
        // Snapshot + reset before firing, so the parent's clearTranscript
        // is idempotent and we don't double-fire.
        const text = transcript;
        finalTextRef.current = "";
        interimTextRef.current = "";
        hasContentRef.current = false;
        lastSpeechAtRef.current = now;
        setLiveTranscript("");
        onUtteranceComplete(text);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [onMutedTalking, onBargeInWhileSpeaking, onBargeInWhileThinking, onUtteranceComplete]);

  // ── start() / stop() ──────────────────────────────────────────────────────

  const start = useCallback(async (): Promise<boolean> => {
    if (streamRef.current) return true; // already started
    setError(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const msg = "Microphone access is not available in this browser.";
      setError(msg);
      onError(msg);
      return false;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const name = (err as DOMException)?.name;
      const msg =
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Microphone access denied. Please allow microphone access in your browser settings and try again."
          : name === "NotFoundError"
          ? "No microphone detected. Please connect a microphone and try again."
          : "Could not access the microphone. Please check your browser settings.";
      setError(msg);
      onError(msg);
      return false;
    }

    streamRef.current = stream;

    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      analyserRef.current  = analyser;
      dataArrayRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    } catch {
      // Without an analyser we can't do VAD. Bail out cleanly.
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const msg = "Could not initialise audio analysis.";
      setError(msg);
      onError(msg);
      return false;
    }

    const startTime = performance.now();
    startedAtRef.current = startTime;
    lastSpeechAtRef.current = startTime;
    speakingSinceRef.current = 0;
    finalTextRef.current = "";
    interimTextRef.current = "";
    hasContentRef.current = false;
    bargeInSpeakingFiredRef.current = false;
    bargeInThinkingFiredRef.current = false;

    wantRunningRef.current = true;
    startSpeechRecognition();

    rafRef.current = requestAnimationFrame(tick);
    setIsReady(true);
    return true;
  }, [onError, startSpeechRecognition, tick]);

  const stop = useCallback(() => {
    wantRunningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    stopSpeechRecognition();

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    dataArrayRef.current = null;

    amplitudeRef.current = 0;
    finalTextRef.current = "";
    interimTextRef.current = "";
    hasContentRef.current = false;
    setLiveTranscript("");
    setIsUserSpeaking(false);
    setIsReady(false);
  }, [stopSpeechRecognition]);

  // ── Public control surface ────────────────────────────────────────────────

  const setMuted = useCallback((m: boolean) => {
    setIsMutedState(m);
  }, []);

  const toggleMute = useCallback(() => {
    setIsMutedState((prev) => !prev);
  }, []);

  const clearTranscript = useCallback(() => {
    finalTextRef.current = "";
    interimTextRef.current = "";
    hasContentRef.current = false;
    setLiveTranscript("");
    lastSpeechAtRef.current = performance.now();
  }, []);

  const restoreTranscript = useCallback((text: string) => {
    const trimmed = text.trim();
    finalTextRef.current = trimmed ? trimmed + " " : "";
    interimTextRef.current = "";
    hasContentRef.current = trimmed.length > 0;
    setLiveTranscript(trimmed);
    // Reset the silence clock so we don't immediately re-submit.
    lastSpeechAtRef.current = performance.now();
  }, []);

  // Tear down if the master switch flips off
  useEffect(() => {
    if (!enabled) stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isReady,
    isMuted,
    isUserSpeaking,
    amplitudeRef: amplitudeRef as React.RefObject<number>,
    liveTranscript,
    error,
    start,
    stop,
    setMuted,
    toggleMute,
    clearTranscript,
    restoreTranscript,
  };
}
