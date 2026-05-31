"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import type { TranscriptTurn, Interview } from "@/lib/types";
import type { OrbState } from "@/components/interview/VoiceOrb";
import { VoiceOrb } from "@/components/interview/VoiceOrb";
import { LiveCaption } from "@/components/interview/LiveCaption";
import { TranscriptDrawer } from "@/components/interview/TranscriptDrawer";
import { MutedTalkingToast } from "@/components/interview/MutedTalkingToast";
import { ModeToggle, type VoiceMode } from "@/components/interview/ModeToggle";
import { useSpeechRecognition } from "@/lib/hooks/useSpeechRecognition";
import { useAudioRecorder } from "@/lib/hooks/useAudioRecorder";
import { useTextToSpeech } from "@/lib/hooks/useTextToSpeech";
import { useConversationVoice } from "@/lib/hooks/useConversationVoice";

interface InterviewClientProps {
  interview: Interview;
  initialTurns: TranscriptTurn[];
  studyId: string;
}

// Typewriter speed: ms per character
const TYPEWRITER_MS = 18;

// LocalStorage key for the mode preference
const MODE_STORAGE_KEY = "sparkme.voiceMode";

function loadInitialMode(): VoiceMode {
  if (typeof window === "undefined") return "hands-free";
  try {
    const v = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (v === "push-to-talk" || v === "hands-free") return v;
  } catch { /* ignore */ }
  return "hands-free";
}

export function InterviewClient({
  interview,
  initialTurns,
  studyId,
}: InterviewClientProps) {
  const router = useRouter();

  // Core interview state
  const [turns, setTurns]           = useState<TranscriptTurn[]>(initialTurns);
  const [isLoading, setIsLoading]   = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [isStarted, setIsStarted]   = useState(initialTurns.length > 0);

  // Sync turns if the server component refreshes with new data (safety net)
  useEffect(() => {
    if (initialTurns.length > 0 && turns.length === 0) {
      setTurns(initialTurns);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTurns]);

  // Orb & caption state
  const [orbState, setOrbState]               = useState<OrbState>("idle");
  const [caption, setCaption]                 = useState("");
  const [captionSpeaker, setCaptionSpeaker]   = useState<"ai" | "user" | null>(null);
  const [isAnimatingCaption, setIsAnimatingCaption] = useState(false);

  // UI panel toggles
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [isTextInputOpen, setIsTextInputOpen]   = useState(false);
  const [textInput, setTextInput]               = useState("");
  const [isAIMuted, setIsAIMuted]               = useState(false);

  // Mode (Hands-free vs Push-to-Talk), persisted in localStorage
  const [mode, setMode] = useState<VoiceMode>(loadInitialMode);
  const isHandsFree = mode === "hands-free";

  // Audio gate — true once the user clicks "Begin Interview".
  const [hasBegun, setHasBegun] = useState(initialTurns.length > 0);

  // Muted-talking toast (one-shot per session)
  const [showMutedToast, setShowMutedToast]   = useState(false);

  // Cache of the most recent submitted user text so we can restore it when
  // the user "overwrites" a turn by continuing to talk before the AI replies.
  const lastSubmittedTextRef = useRef<string>("");

  // AbortController for the current /api/interview/turn request, so we can
  // cancel mid-flight when the user resumes talking.
  const turnAbortRef = useRef<AbortController | null>(null);

  const typewriterRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captionGenRef  = useRef(0);

  // Hooks
  const speech       = useSpeechRecognition();
  const audio        = useAudioRecorder();
  const tts          = useTextToSpeech();

  // ── Hands-free voice loop callbacks (forward refs so they always read
  //    the latest state without re-instantiating the hook) ─────────────────
  const handleUtteranceCompleteRef    = useRef<(text: string) => void>(() => {});
  const handleBargeInSpeakingRef      = useRef<() => void>(() => {});
  const handleBargeInThinkingRef      = useRef<() => void>(() => {});
  const handleMutedTalkingRef         = useRef<() => void>(() => {});

  const conversation = useConversationVoice({
    enabled: isHandsFree && hasBegun,
    isAISpeaking: tts.isSpeaking || isAnimatingCaption,
    isAIThinking: isLoading,
    onUtteranceComplete: (text) => handleUtteranceCompleteRef.current(text),
    onBargeInWhileSpeaking: () => handleBargeInSpeakingRef.current(),
    onBargeInWhileThinking: () => handleBargeInThinkingRef.current(),
    onMutedTalking: () => handleMutedTalkingRef.current(),
    onError: (msg) => setError(msg),
  });

  // Persist mode preference
  useEffect(() => {
    try { window.localStorage.setItem(MODE_STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  // ── Combined amplitude ref — orb pulls from whichever source is active ──
  const activeAmplitudeRef = useRef<number>(0);
  useEffect(() => {
    const tick = () => {
      if (orbState === "speaking") {
        activeAmplitudeRef.current = tts.ttsAmplitudeRef.current ?? 0;
      } else if (isHandsFree && conversation.isReady) {
        // Hands-free idle/listening: mic is always hot
        activeAmplitudeRef.current = conversation.isMuted
          ? 0
          : (conversation.amplitudeRef.current ?? 0);
      } else if (orbState === "listening") {
        activeAmplitudeRef.current = audio.amplitudeRef.current ?? 0;
      } else {
        activeAmplitudeRef.current = 0;
      }
      requestAnimationFrame(tick);
    };
    const id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [orbState, isHandsFree, conversation.isReady, conversation.isMuted,
      audio.amplitudeRef, tts.ttsAmplitudeRef, conversation.amplitudeRef]);

  // ── Hands-free: drive the orb state from voice activity ─────────────────
  // Two separate concerns split into two effects:
  //   (a) when the AI has finished speaking, transition back to listening.
  //       The standalone push-to-talk reset effect below is no-op in
  //       hands-free, so we need our own.
  //   (b) when we're already in a non-AI state, reflect the mute flag.
  useEffect(() => {
    if (!isHandsFree || !conversation.isReady) return;
    if (orbState !== "speaking") return;
    if (tts.isSpeaking || isAnimatingCaption) return;
    setOrbState(conversation.isMuted ? "idle" : "listening");
  }, [isHandsFree, conversation.isReady, conversation.isMuted,
      orbState, tts.isSpeaking, isAnimatingCaption]);

  useEffect(() => {
    if (!isHandsFree || !conversation.isReady) return;
    if (orbState === "thinking" || orbState === "speaking") return;
    setOrbState(conversation.isMuted ? "idle" : "listening");
  }, [isHandsFree, conversation.isReady, conversation.isMuted, orbState]);

  // ── Hands-free: live caption while the user is mid-utterance ────────────
  useEffect(() => {
    if (!isHandsFree) return;
    if (conversation.isMuted) return;
    if (orbState === "thinking" || orbState === "speaking" || isAnimatingCaption) return;
    if (conversation.liveTranscript) {
      setCaptionSpeaker("user");
      setCaption(conversation.liveTranscript);
    }
  }, [isHandsFree, conversation.liveTranscript, conversation.isMuted,
      orbState, isAnimatingCaption]);

  // ── Push-to-talk: reflect live speech recognition in caption ────────────
  useEffect(() => {
    if (isHandsFree) return;
    if (speech.isListening) {
      const live = (speech.finalTranscript + speech.interimTranscript).trim();
      setCaption(live);
    }
  }, [isHandsFree, speech.isListening, speech.finalTranscript, speech.interimTranscript]);

  // Reset orb to idle when TTS finishes speaking (push-to-talk only — in
  // hands-free the dedicated effect above takes over)
  useEffect(() => {
    if (isHandsFree) return;
    if (!tts.isSpeaking && orbState === "speaking" && !isAnimatingCaption) {
      setOrbState("idle");
    }
  }, [isHandsFree, tts.isSpeaking, orbState, isAnimatingCaption]);

  // Initialise the interview on mount if needed
  useEffect(() => {
    if (initialTurns.length === 0 && !isStarted) {
      startInterview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Animate new interviewer turns — only after the user has clicked "Begin"
  // so the AudioContext is already unlocked by a prior gesture.
  useEffect(() => {
    if (turns.length === 0 || !hasBegun) return;
    const last = turns[turns.length - 1];
    if (last.speaker === "interviewer" && !isLoading) {
      void animateAICaption(last.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, hasBegun]);

  // ==========================================================================
  // Typewriter animation
  // ==========================================================================

  const animateAICaption = useCallback(async (text: string) => {
    if (typewriterRef.current) clearTimeout(typewriterRef.current);
    const gen = ++captionGenRef.current;

    setCaptionSpeaker("ai");
    setIsAnimatingCaption(true);
    setOrbState("speaking");
    setCaption("");

    const audioDurationSec = isAIMuted ? 0 : await tts.speak(text);
    if (gen !== captionGenRef.current) return;

    let msPerChar = TYPEWRITER_MS;
    if (audioDurationSec > 0 && text.length > 0) {
      const targetMs = audioDurationSec * 1000 * 0.85;
      msPerChar = Math.max(12, Math.min(55, targetMs / text.length));
    }

    let i = 0;
    const step = () => {
      if (gen !== captionGenRef.current) return;
      if (i < text.length) {
        setCaption(text.slice(0, ++i));
        typewriterRef.current = setTimeout(step, msPerChar);
      } else {
        setIsAnimatingCaption(false);
        if (audioDurationSec === 0) setOrbState("idle");
      }
    };
    typewriterRef.current = setTimeout(step, msPerChar);
  }, [tts, isAIMuted]); // eslint-disable-line react-hooks/exhaustive-deps

  // ==========================================================================
  // Interview initialisation
  // ==========================================================================

  const startInterview = async () => {
    setIsLoading(true);
    setOrbState("thinking");
    setError(null);

    try {
      const res = await fetch("/api/interview/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participant_id: interview.participant_id }),
      });

      if (res.ok || res.status === 409) {
        const data = await res.json();
        const openingTurn: TranscriptTurn = {
          id: data.turn_id ?? `opening-${Date.now()}`,
          interview_id: interview.id,
          turn_index: 0,
          speaker: "interviewer",
          text: data.opening_question,
          timestamp_start: new Date().toISOString(),
          timestamp_end: null,
          created_at: new Date().toISOString(),
        };
        setTurns([openingTurn]);
        return;
      }

      const data = await res.json();
      throw new Error(data.error ?? "Failed to start interview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start interview");
      setOrbState("idle");
    } finally {
      setIsLoading(false);
      setIsStarted(true);
    }
  };

  // ==========================================================================
  // Submit a participant response
  // ==========================================================================

  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    setTextInput("");
    setIsLoading(true);
    setError(null);
    setOrbState("thinking");

    setCaptionSpeaker("user");
    setCaption(trimmed);
    setIsAnimatingCaption(false);

    lastSubmittedTextRef.current = trimmed;

    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticTurn: TranscriptTurn = {
      id: optimisticId,
      interview_id: interview.id,
      turn_index: turns.length,
      speaker: "interviewee",
      text: trimmed,
      timestamp_start: new Date().toISOString(),
      timestamp_end: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, optimisticTurn]);

    // Build an AbortController so a barge-in mid-flight can cancel us.
    const controller = new AbortController();
    turnAbortRef.current = controller;

    try {
      const res = await fetch("/api/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interview_id: interview.id, text: trimmed }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to submit response");
      }

      const data = await res.json();

      lastSubmittedTextRef.current = "";

      setTurns((prev) => {
        const withoutOptimistic = prev.filter((t) => t.id !== optimisticId);
        return [
          ...withoutOptimistic,
          data.interviewee_turn as TranscriptTurn,
          data.interviewer_turn as TranscriptTurn,
        ];
      });

      if (data.is_complete) {
        router.push(`/complete?interview_id=${interview.id}`);
      }
    } catch (err) {
      // AbortError = user resumed talking, we'll re-submit shortly. Don't
      // clobber the UI or surface an error in that case.
      if ((err as Error)?.name === "AbortError") {
        setTurns((prev) => prev.filter((t) => t.id !== optimisticId));
        return;
      }
      setTurns((prev) => prev.filter((t) => t.id !== optimisticId));
      setOrbState("idle");
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      if (turnAbortRef.current === controller) turnAbortRef.current = null;
      setIsLoading(false);
    }
  }, [isLoading, interview.id, turns.length, router]);

  // ==========================================================================
  // Hands-free callbacks — kept in refs so the conversation hook never
  // sees stale closures.
  // ==========================================================================

  useEffect(() => {
    handleUtteranceCompleteRef.current = (text: string) => {
      if (!text.trim()) return;
      void handleSubmit(text);
    };
  }, [handleSubmit]);

  useEffect(() => {
    handleBargeInSpeakingRef.current = () => {
      // User interrupted the AI mid-sentence. Cut TTS immediately and pivot
      // to a fresh listening turn.
      captionGenRef.current++;
      if (typewriterRef.current) {
        clearTimeout(typewriterRef.current);
        typewriterRef.current = null;
      }
      setIsAnimatingCaption(false);
      tts.stop();
      conversation.clearTranscript();
      setOrbState("listening");
      setCaptionSpeaker("user");
      setCaption("");
    };
  }, [tts, conversation]);

  useEffect(() => {
    handleBargeInThinkingRef.current = () => {
      // User started talking again while the LLM was still thinking.
      // Abort the in-flight request and restore the previously-submitted
      // text into the transcript buffer so the next utterance is the
      // *combined* answer.
      const prior = lastSubmittedTextRef.current;
      turnAbortRef.current?.abort();
      turnAbortRef.current = null;
      conversation.restoreTranscript(prior);
      setIsLoading(false);
      setOrbState("listening");
      setCaptionSpeaker("user");
      setCaption(prior);
    };
  }, [conversation]);

  useEffect(() => {
    handleMutedTalkingRef.current = () => setShowMutedToast(true);
  }, []);

  // ==========================================================================
  // Voice mode: push-to-talk
  // ==========================================================================

  const handleMicPress = useCallback(async () => {
    if (orbState === "thinking" || turns.length === 0) return;

    if (audio.recorderState === "recording") {
      audio.stopRecording(interview.id);
      speech.stopListening();

      const finalText = (speech.finalTranscript + speech.interimTranscript).trim();
      speech.resetTranscript();

      if (finalText) {
        await handleSubmit(finalText);
      } else {
        setOrbState("idle");
        setCaptionSpeaker(null);
      }
    } else {
      captionGenRef.current++;
      if (typewriterRef.current) {
        clearTimeout(typewriterRef.current);
        typewriterRef.current = null;
      }
      setIsAnimatingCaption(false);
      tts.stop();

      setOrbState("listening");
      setCaptionSpeaker("user");
      setCaption("");

      await audio.startRecording();
      if (speech.isSupported) {
        speech.startListening();
      }
    }
  }, [orbState, audio, speech, tts, interview.id, turns.length, handleSubmit]);

  // ==========================================================================
  // Begin — unlocks AudioContext and (in hands-free mode) starts the
  // continuous voice loop, both inside the same gesture so the browser
  // grants permission and audio playback in one prompt cycle.
  // ==========================================================================

  const handleBegin = useCallback(async () => {
    // unlock() MUST run synchronously here, before any await, so it fires
    // while we are still inside Chrome's user-gesture activation window.
    tts.unlock();
    setHasBegun(true);

    if (isHandsFree) {
      const ok = await conversation.start();
      if (!ok) {
        // Permission denied or device error — fall back to push-to-talk so
        // the participant can still proceed without a mic.
        setMode("push-to-talk");
      }
    } else {
      // Push-to-talk: warm up mic permission so the prompt happens now
      // (one user gesture) instead of on the first record press.
      try {
        const s = await navigator.mediaDevices?.getUserMedia({ audio: true });
        s?.getTracks().forEach((t) => t.stop());
      } catch { /* user can still grant later when they tap Record */ }
    }
  }, [tts, isHandsFree, conversation]);

  // ==========================================================================
  // Mode switching — gracefully tear down / spin up the right hooks.
  // ==========================================================================

  const handleModeChange = useCallback((next: VoiceMode) => {
    if (next === mode) return;
    if (next === "push-to-talk") {
      conversation.stop();
      // Don't keep the orb stuck on "listening" from the hands-free idle.
      if (orbState === "listening" && audio.recorderState !== "recording") {
        setOrbState("idle");
      }
    } else {
      // Switching to hands-free. If the participant has begun, start the
      // continuous voice loop immediately. Otherwise it'll start on Begin.
      if (audio.recorderState === "recording") {
        audio.stopRecording(interview.id);
        speech.stopListening();
        speech.resetTranscript();
      }
      if (hasBegun) {
        void conversation.start();
      }
    }
    setMode(next);
  }, [mode, conversation, audio, speech, interview.id, orbState, hasBegun]);

  // ==========================================================================
  // Text mode submit
  // ==========================================================================

  const handleTextSubmit = useCallback(() => {
    const text = textInput.trim();
    if (!text) return;
    handleSubmit(text);
  }, [textInput, handleSubmit]);

  // ==========================================================================
  // Export transcript (client-side, no API needed)
  // ==========================================================================

  const handleExportTranscript = useCallback(() => {
    if (turns.length === 0) return;

    const lines: string[] = [];
    const sep72 = "=".repeat(72);
    const sep72dash = "-".repeat(72);

    lines.push(sep72);
    lines.push("QUALITATIVE INTERVIEW TRANSCRIPT");
    lines.push(sep72);
    lines.push("");
    lines.push(`Study ID:      ${studyId}`);
    lines.push(`Interview ID:  ${interview.id}`);
    lines.push(`Exported:      ${new Date().toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
    })}`);
    lines.push(`Total turns:   ${turns.length}`);
    lines.push("");
    lines.push(sep72dash);
    lines.push("TRANSCRIPT");
    lines.push(sep72dash);
    lines.push("");

    for (const turn of turns) {
      const speaker = turn.speaker === "interviewer" ? "INTERVIEWER" : "PARTICIPANT ";
      const ts = turn.timestamp_start
        ? ` [${new Date(turn.timestamp_start).toLocaleString("en-US", {
            year: "numeric", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
          })}]`
        : "";
      lines.push(`${speaker}${ts}`);
      lines.push(turn.text);
      lines.push("");
    }

    lines.push(sep72);
    lines.push("END OF TRANSCRIPT");
    lines.push(sep72);

    const content = lines.join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `transcript-${studyId}-${interview.id.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [turns, studyId, interview.id]);

  // ==========================================================================
  // Derived UI values
  // ==========================================================================

  const previousCaptionTurns = turns
    .filter((t) => !t.id.startsWith("optimistic-"))
    .slice(-3, -1)
    .map((t) => ({
      speaker: t.speaker === "interviewer" ? ("ai" as const) : ("user" as const),
      text: t.text,
    }));

  const isRecording   = audio.recorderState === "recording";
  const canInteract   = turns.length > 0 && !interview.completed;
  const isMicDisabled = orbState === "thinking" || !canInteract;

  // Live "user is speaking" flag the caption + status label can react to.
  const userIsSpeakingNow = isHandsFree
    ? conversation.isUserSpeaking && !conversation.isMuted
    : isRecording;

  const formatDuration = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-stone-50 select-none">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between gap-2 px-3 sm:px-5 py-3
                         bg-white border-b border-stone-200">
        {/* Left: session badge */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-stone-400" />
          <span className="text-[11px] text-stone-400 font-mono tracking-widest uppercase">
            {studyId}
          </span>
        </div>

        {/* Center: mode toggle (replaces the static title — clearer + useful) */}
        <div className="flex-1 flex justify-center min-w-0">
          <ModeToggle
            mode={mode}
            onChange={handleModeChange}
            disabled={orbState === "thinking"}
          />
        </div>

        {/* Right: transcript toggle */}
        <button
          onClick={() => setIsTranscriptOpen((o) => !o)}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full border text-sm
                      font-medium transition-all duration-150
                      ${isTranscriptOpen
                        ? "bg-stone-800 border-stone-800 text-white"
                        : "bg-stone-100 border-stone-200 text-stone-600 hover:bg-stone-200 hover:text-stone-800"
                      }`}
        >
          <ListIcon className="w-4 h-4" />
          <span className="hidden md:inline">
            {isTranscriptOpen ? "Hide Transcript" : "Transcript"}
          </span>
          {turns.length > 0 && (
            <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded-full
                              ${isTranscriptOpen
                                ? "bg-white/20 text-white"
                                : "bg-stone-200 text-stone-600"
                              }`}>
              {turns.length}
            </span>
          )}
        </button>
      </header>

      {/* ── Main orb + caption area ─────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center gap-5 px-6 overflow-hidden">
        <div className="relative orb-scale-wrapper">
          {orbState === "thinking" && (
            <div className="absolute -inset-4 rounded-full border border-stone-300 animate-spin"
                 style={{ animationDuration: "3s" }} />
          )}
          <VoiceOrb
            state={orbState}
            amplitudeRef={activeAmplitudeRef as React.RefObject<number>}
            size={200}
          />
          {isRecording && (
            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2
                            flex items-center gap-1.5 px-3 py-1 rounded-full
                            bg-orange-50 border border-orange-200">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              <span className="text-[11px] font-mono text-orange-600">
                {formatDuration(audio.duration)}
              </span>
            </div>
          )}
          {isHandsFree && conversation.isReady && !conversation.isMuted &&
           orbState !== "thinking" && orbState !== "speaking" && (
            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2
                            flex items-center gap-1.5 px-3 py-1 rounded-full
                            bg-emerald-50 border border-emerald-200">
              <span className={`w-1.5 h-1.5 rounded-full bg-emerald-500 ${
                userIsSpeakingNow ? "animate-pulse" : ""
              }`} />
              <span className="text-[11px] font-mono text-emerald-700">
                {userIsSpeakingNow ? "Hearing you…" : "Mic live"}
              </span>
            </div>
          )}
          {isHandsFree && conversation.isReady && conversation.isMuted && (
            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2
                            flex items-center gap-1.5 px-3 py-1 rounded-full
                            bg-red-50 border border-red-200">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              <span className="text-[11px] font-mono text-red-600">Muted</span>
            </div>
          )}
        </div>

        {/* Status label */}
        <div className="text-center h-5">
          {isLoading && orbState === "thinking" && (
            <p className="text-[11px] text-stone-400 tracking-widest uppercase animate-pulse">
              Processing
            </p>
          )}
          {!isLoading && isRecording && (
            <p className="text-[11px] text-orange-500 tracking-widest uppercase">
              {speech.isSupported ? "Listening" : "Recording"}
            </p>
          )}
          {!isLoading && isHandsFree && orbState === "listening" && !conversation.isMuted && (
            <p className="text-[11px] text-emerald-600 tracking-widest uppercase">
              {userIsSpeakingNow ? "Listening" : "Ready when you are"}
            </p>
          )}
          {!isLoading && orbState === "speaking" && isAnimatingCaption && (
            <p className="text-[11px] text-blue-500 tracking-widest uppercase">
              Interviewer
            </p>
          )}
          {!isLoading && orbState === "idle" && !isRecording && canInteract && !isHandsFree && (
            <p className="text-[11px] text-stone-300 tracking-widest uppercase">
              Ready
            </p>
          )}
          {!canInteract && !isLoading && (
            <p className="text-[11px] text-stone-400 tracking-widest uppercase animate-pulse">
              Starting…
            </p>
          )}
        </div>

        {/* Live caption */}
        <LiveCaption
          previousTurns={previousCaptionTurns}
          currentText={caption}
          currentSpeaker={captionSpeaker}
          isAnimating={isAnimatingCaption || speech.isListening ||
                       (isHandsFree && userIsSpeakingNow)}
        />

        {/* Error */}
        {error && (
          <div className="w-full max-w-sm mx-auto px-4 py-2.5 rounded-xl
                          bg-red-50 border border-red-200">
            <p className="text-[12px] text-red-600 text-center">{error}</p>
          </div>
        )}
      </main>

      {/* ── Text input — persistent collapsible section ─────────────────────── */}
      <div className="shrink-0 border-t border-stone-200 bg-white">
        <button
          onClick={() => setIsTextInputOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3
                     text-stone-500 hover:text-stone-700 hover:bg-stone-50
                     transition-colors duration-150"
        >
          <div className="flex items-center gap-2">
            <KeyboardIcon className="w-4 h-4" />
            <span className="text-[13px] font-medium">Type a response</span>
          </div>
          <ChevronIcon className={`w-4 h-4 transition-transform duration-200
                                   ${isTextInputOpen ? "rotate-180" : ""}`} />
        </button>

        {isTextInputOpen && (
          <div className="px-4 pb-4">
            <div className="rounded-xl border border-stone-200 bg-stone-50 overflow-hidden">
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleTextSubmit();
                  }
                }}
                disabled={isMicDisabled}
                placeholder="Type your response here…"
                rows={3}
                className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2
                           text-[15px] text-stone-800 placeholder-stone-400
                           focus:outline-none leading-relaxed select-text"
              />
              <div className="flex items-center justify-between px-4 pb-3">
                <span className="text-[11px] text-stone-400 hidden sm:inline">Shift+Enter for new line</span>
                <span className="text-[11px] text-stone-400 sm:hidden">Enter to send</span>
                <button
                  onClick={handleTextSubmit}
                  disabled={!textInput.trim() || isMicDisabled}
                  className="px-5 py-2 rounded-xl bg-stone-800 text-white text-[13px]
                             font-medium disabled:opacity-30 hover:bg-stone-700
                             transition-colors duration-150"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Controls bar ────────────────────────────────────────────────────── */}
      <nav className="relative z-10 flex items-center justify-between
                      px-5 sm:px-10 py-4 bg-white border-t border-stone-200 shrink-0">
        {/* Left: AI voice mute toggle */}
        <button
          onClick={() => {
            if (!isAIMuted && tts.isSpeaking) tts.stop();
            setIsAIMuted((m) => !m);
          }}
          title={isAIMuted ? "Unmute interviewer voice" : "Mute interviewer voice"}
          className={`w-13 h-13 w-[52px] h-[52px] rounded-full flex items-center justify-center
                      border-2 transition-all duration-200
                      ${isAIMuted
                        ? "border-red-300 bg-red-50 text-red-500"
                        : "border-stone-200 bg-stone-50 text-stone-500 hover:text-stone-800 hover:border-stone-400 hover:bg-stone-100"
                      }`}
        >
          {isAIMuted ? (
            <VolumeOffIcon className="w-5 h-5" />
          ) : (
            <VolumeOnIcon className="w-5 h-5" />
          )}
        </button>

        {/* Center: Begin → then Record (push-to-talk) or Mute (hands-free) */}
        <div className="relative flex flex-col items-center justify-center gap-1.5">
          {!hasBegun && canInteract ? (
            <button
              onClick={handleBegin}
              className="px-7 py-3.5 rounded-full bg-stone-800 text-white text-[15px]
                         font-medium hover:bg-stone-700 transition-colors shadow-md
                         hover:scale-105 duration-200"
            >
              Begin Interview
            </button>
          ) : isHandsFree ? (
            // ── Hands-free: large mute/unmute toggle ─────────────────────
            <>
              {!conversation.isMuted && userIsSpeakingNow && (
                <div className="mic-pulse-ring absolute w-[76px] h-[76px] rounded-full
                                border-2 border-emerald-400/60" />
              )}
              <button
                onClick={conversation.toggleMute}
                disabled={!conversation.isReady}
                aria-label={conversation.isMuted ? "Unmute microphone" : "Mute microphone"}
                title={conversation.isMuted ? "Unmute microphone" : "Mute microphone"}
                className={`relative w-[68px] h-[68px] rounded-full flex items-center justify-center
                            transition-all duration-200 shadow-md
                            disabled:opacity-30 disabled:cursor-not-allowed
                            ${conversation.isMuted
                              ? "bg-red-500 hover:bg-red-600 shadow-red-200"
                              : "bg-emerald-600 hover:bg-emerald-700 hover:scale-105 shadow-emerald-200"
                            }`}
              >
                {conversation.isMuted ? (
                  <MicSlashIcon className="w-7 h-7 text-white" />
                ) : (
                  <MicIcon className="w-7 h-7 text-white" />
                )}
              </button>
              <span className="text-[10px] uppercase tracking-widest text-stone-400 font-mono">
                {conversation.isMuted ? "Unmute" : "Mute"}
              </span>
            </>
          ) : (
            // ── Push-to-talk: original record button ─────────────────────
            <>
              {isRecording && (
                <div className="mic-pulse-ring absolute w-[76px] h-[76px] rounded-full
                                border-2 border-orange-400/60" />
              )}
              <button
                onClick={handleMicPress}
                disabled={isMicDisabled}
                aria-label={isRecording ? "Stop recording" : "Start recording"}
                className={`relative w-[68px] h-[68px] rounded-full flex items-center justify-center
                            transition-all duration-200 shadow-md
                            disabled:opacity-30 disabled:cursor-not-allowed
                            ${isRecording
                              ? "bg-orange-500 hover:bg-orange-600 scale-105 shadow-orange-200"
                              : "bg-stone-800 hover:bg-stone-700 hover:scale-105 shadow-stone-200"
                            }
                            ${orbState === "thinking" ? "animate-pulse cursor-wait" : ""}
                          `}
              >
                {isRecording ? (
                  <StopIcon className="w-6 h-6 text-white" />
                ) : (
                  <MicIcon className={`w-6 h-6 ${orbState === "thinking" ? "text-white/40" : "text-white"}`} />
                )}
              </button>
              <span className="text-[10px] uppercase tracking-widest text-stone-400 font-mono">
                {isRecording ? "Stop" : "Record"}
              </span>
            </>
          )}
        </div>

        {/* Right: export transcript */}
        <button
          onClick={handleExportTranscript}
          disabled={turns.length === 0}
          title="Download transcript"
          className="w-[52px] h-[52px] rounded-full flex items-center justify-center
                     border-2 border-stone-200 bg-stone-50 text-stone-500
                     hover:text-stone-800 hover:border-stone-400 hover:bg-stone-100
                     disabled:opacity-20 disabled:cursor-not-allowed
                     transition-all duration-200"
        >
          <DownloadIcon className="w-5 h-5" />
        </button>
      </nav>

      {/* ── Muted-talking toast (one-shot per session) ──────────────────────── */}
      <MutedTalkingToast
        visible={showMutedToast}
        onUnmute={() => {
          conversation.setMuted(false);
          setShowMutedToast(false);
        }}
        onDismiss={() => setShowMutedToast(false)}
      />

      {/* ── Transcript drawer ────────────────────────────────────────────────── */}
      <TranscriptDrawer
        turns={turns}
        isOpen={isTranscriptOpen}
        onClose={() => setIsTranscriptOpen(false)}
      />
    </div>
  );
}

// ── Icon components ────────────────────────────────────────────────────────

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
    </svg>
  );
}

function MicSlashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
      <line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" strokeWidth={2} />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function KeyboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path strokeLinecap="round" d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h.01M12 14h.01M16 14h.01M6 14h.01M18 14h.01" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    </svg>
  );
}

function VolumeOnIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
    </svg>
  );
}

function VolumeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5z" />
      <line x1="23" y1="9" x2="17" y2="15" strokeLinecap="round" />
      <line x1="17" y1="9" x2="23" y2="15" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13m0 0l-4-4m4 4l4-4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </svg>
  );
}
