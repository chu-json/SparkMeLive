"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import type { TranscriptTurn, Interview } from "@/lib/types";
import type { OrbState } from "@/components/interview/VoiceOrb";
import { VoiceOrb } from "@/components/interview/VoiceOrb";
import { LiveCaption } from "@/components/interview/LiveCaption";
import { TranscriptDrawer } from "@/components/interview/TranscriptDrawer";
import { useSpeechRecognition } from "@/lib/hooks/useSpeechRecognition";
import { useAudioRecorder } from "@/lib/hooks/useAudioRecorder";
import { useTextToSpeech } from "@/lib/hooks/useTextToSpeech";

interface InterviewClientProps {
  interview: Interview;
  initialTurns: TranscriptTurn[];
  studyId: string;
}

// Typewriter speed: ms per character
const TYPEWRITER_MS = 18;

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

  // Orb & caption state
  const [orbState, setOrbState]               = useState<OrbState>("idle");
  const [caption, setCaption]                 = useState("");
  const [captionSpeaker, setCaptionSpeaker]   = useState<"ai" | "user" | null>(null);
  const [isAnimatingCaption, setIsAnimatingCaption] = useState(false);

  // UI panel toggles — transcript and text input both open by default
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(true);
  const [isTextInputOpen, setIsTextInputOpen]   = useState(true);
  const [textInput, setTextInput]               = useState("");
  const [isMuted, setIsMuted]                   = useState(false);

  const typewriterRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captionGenRef  = useRef(0);

  // Hooks
  const speech = useSpeechRecognition();
  const audio  = useAudioRecorder();
  const tts    = useTextToSpeech();

  // Combined amplitude ref
  const activeAmplitudeRef = useRef<number>(0);
  useEffect(() => {
    const tick = () => {
      if (orbState === "listening") {
        activeAmplitudeRef.current = audio.amplitudeRef.current ?? 0;
      } else if (orbState === "speaking") {
        activeAmplitudeRef.current = tts.ttsAmplitudeRef.current ?? 0;
      } else {
        activeAmplitudeRef.current = 0;
      }
      requestAnimationFrame(tick);
    };
    const id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [orbState, audio.amplitudeRef, tts.ttsAmplitudeRef]);

  // Reset orb to idle when TTS finishes speaking
  useEffect(() => {
    if (!tts.isSpeaking && orbState === "speaking" && !isAnimatingCaption) {
      setOrbState("idle");
    }
  }, [tts.isSpeaking, orbState, isAnimatingCaption]);

  // Initialise the interview on mount if needed
  useEffect(() => {
    if (initialTurns.length === 0 && !isStarted) {
      startInterview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect live speech recognition in caption
  useEffect(() => {
    if (speech.isListening) {
      const live = (speech.finalTranscript + speech.interimTranscript).trim();
      setCaption(live);
    }
  }, [speech.isListening, speech.finalTranscript, speech.interimTranscript]);

  // Animate new interviewer turns
  useEffect(() => {
    if (turns.length === 0) return;
    const last = turns[turns.length - 1];
    if (last.speaker === "interviewer" && !isLoading) {
      void animateAICaption(last.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns]);

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

    const audioDurationSec = isMuted ? 0 : await tts.speak(text);
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
  }, [tts, isMuted]); // eslint-disable-line react-hooks/exhaustive-deps

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

      if (res.status === 409) { router.refresh(); return; }
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to start interview");
      }
      router.refresh();
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
    if (!text.trim() || isLoading) return;

    setTextInput("");
    setIsLoading(true);
    setError(null);
    setOrbState("thinking");

    setCaptionSpeaker("user");
    setCaption(text.trim());
    setIsAnimatingCaption(false);

    const optimisticTurn: TranscriptTurn = {
      id: `optimistic-${Date.now()}`,
      interview_id: interview.id,
      turn_index: turns.length,
      speaker: "interviewee",
      text: text.trim(),
      timestamp_start: new Date().toISOString(),
      timestamp_end: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, optimisticTurn]);

    try {
      const res = await fetch("/api/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interview_id: interview.id, text: text.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to submit response");
      }

      const data = await res.json();

      setTurns((prev) => {
        const withoutOptimistic = prev.filter((t) => !t.id.startsWith("optimistic-"));
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
      setTurns((prev) => prev.filter((t) => !t.id.startsWith("optimistic-")));
      setOrbState("idle");
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, interview.id, turns.length, router]);

  // ==========================================================================
  // Voice mode: press-to-talk
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
  // Text mode submit
  // ==========================================================================

  const handleTextSubmit = useCallback(() => {
    const text = textInput.trim();
    if (!text) return;
    handleSubmit(text);
  }, [textInput, handleSubmit]);

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

  const formatDuration = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-stone-50 select-none">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-5 py-3
                         bg-white border-b border-stone-200">
        {/* Left: session badge */}
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-stone-400" />
          <span className="text-[11px] text-stone-400 font-mono tracking-widest uppercase">
            {studyId}
          </span>
        </div>

        {/* Center: title */}
        <h1 className="absolute left-1/2 -translate-x-1/2 text-[13px] font-medium
                       text-stone-600 tracking-wide">
          Life Story Interview
        </h1>

        {/* Right: transcript toggle — large and prominent */}
        <button
          onClick={() => setIsTranscriptOpen((o) => !o)}
          className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm
                      font-medium transition-all duration-150
                      ${isTranscriptOpen
                        ? "bg-stone-800 border-stone-800 text-white"
                        : "bg-stone-100 border-stone-200 text-stone-600 hover:bg-stone-200 hover:text-stone-800"
                      }`}
        >
          <ListIcon className="w-4 h-4" />
          <span>{isTranscriptOpen ? "Hide Transcript" : "Transcript"}</span>
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
        {/* Orb */}
        <div className="relative">
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
        </div>

        {/* Status label */}
        <div className="text-center h-5">
          {isLoading && orbState === "thinking" && (
            <p className="text-[11px] text-stone-400 tracking-widest uppercase animate-pulse">
              Processing
            </p>
          )}
          {isRecording && (
            <p className="text-[11px] text-orange-500 tracking-widest uppercase">
              {speech.isSupported ? "Listening" : "Recording"}
            </p>
          )}
          {orbState === "speaking" && isAnimatingCaption && (
            <p className="text-[11px] text-blue-500 tracking-widest uppercase">
              Interviewer
            </p>
          )}
          {orbState === "idle" && !isRecording && !isLoading && canInteract && (
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
          isAnimating={isAnimatingCaption || speech.isListening}
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
        {/* Toggle row */}
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

        {/* Collapsible textarea */}
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
                placeholder="Type your response here… (Enter to send, Shift+Enter for new line)"
                rows={4}
                className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2
                           text-[15px] text-stone-800 placeholder-stone-400
                           focus:outline-none leading-relaxed select-text"
                autoFocus={isTextInputOpen}
              />
              <div className="flex items-center justify-between px-4 pb-3">
                <span className="text-[11px] text-stone-400">Shift+Enter for new line</span>
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
                      px-10 py-4 bg-white border-t border-stone-200 shrink-0">
        {/* Left: mute toggle */}
        <button
          onClick={() => {
            if (!isMuted && tts.isSpeaking) tts.stop();
            setIsMuted((m) => !m);
          }}
          title={isMuted ? "Unmute AI voice" : "Mute AI voice"}
          className={`w-13 h-13 w-[52px] h-[52px] rounded-full flex items-center justify-center
                      border-2 transition-all duration-200
                      ${isMuted
                        ? "border-red-300 bg-red-50 text-red-500"
                        : "border-stone-200 bg-stone-50 text-stone-500 hover:text-stone-800 hover:border-stone-400 hover:bg-stone-100"
                      }`}
        >
          {isMuted ? (
            <VolumeOffIcon className="w-5 h-5" />
          ) : (
            <VolumeOnIcon className="w-5 h-5" />
          )}
        </button>

        {/* Center: mic button */}
        <div className="relative flex items-center justify-center">
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
        </div>

        {/* Right: placeholder for visual balance */}
        <div className="w-[52px] h-[52px]" />
      </nav>

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
