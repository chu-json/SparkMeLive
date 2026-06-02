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
import { useTextToSpeech, TTS_VOICE_OPTIONS, DEFAULT_TTS_VOICE } from "@/lib/hooks/useTextToSpeech";

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

  // UI panel toggles — both start closed so the orb/caption have full screen on mobile
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [isTextInputOpen, setIsTextInputOpen]   = useState(false);
  const [textInput, setTextInput]               = useState("");
  const [isMuted, setIsMuted]                   = useState(false);
  const [voice, setVoice]                       = useState<string>(DEFAULT_TTS_VOICE);
  // Shown briefly after the user changes the voice while the AI is mid-sentence
  // (we deliberately don't cut off the AI in that case — the change applies to
  // the next interviewer turn instead).
  const [voiceChangeHint, setVoiceChangeHint]   = useState<string | null>(null);
  const voiceHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist the chosen AI voice across reloads
  useEffect(() => {
    const saved = window.localStorage.getItem("sparkme.ttsVoice");
    if (saved && TTS_VOICE_OPTIONS.some((v) => v.id === saved)) setVoice(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("sparkme.ttsVoice", voice);
  }, [voice]);
  const [isTranscribing, setIsTranscribing]     = useState(false);
  const [lastTranscriptSource, setLastTranscriptSource] = useState<"aws" | "browser" | null>(null);

  // Audio gate — true once the user clicks "Begin Interview".
  // Gating the first TTS call behind a user gesture satisfies Chrome's
  // autoplay policy, preventing the "muted then starts mid-sentence" issue.
  const [hasBegun, setHasBegun] = useState(initialTurns.length > 0);

  const typewriterRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captionGenRef  = useRef(0);
  // Id of the interviewer turn we've already animated, so unrelated `turns`
  // updates (e.g. the background AWS transcript refine) don't restart the
  // AI's speech/caption from the beginning.
  const animatedTurnIdRef = useRef<string | null>(null);
  const voicePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Animate new interviewer turns — only after the user has clicked "Begin"
  // so the AudioContext is already unlocked by a prior gesture.
  useEffect(() => {
    if (turns.length === 0 || !hasBegun) return;
    const last = turns[turns.length - 1];
    if (
      last.speaker === "interviewer" &&
      !isLoading &&
      last.id !== animatedTurnIdRef.current
    ) {
      animatedTurnIdRef.current = last.id;
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

    const audioDurationSec = isMuted ? 0 : await tts.speak(text, voice);
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
  }, [tts, isMuted, voice]); // eslint-disable-line react-hooks/exhaustive-deps

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

      // Both 200 (created) and 409 (already existed) carry the opening turn.
      // We set state directly rather than router.refresh() so React picks it up.
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

  const handleSubmit = useCallback(async (text: string): Promise<string | null> => {
    if (!text.trim() || isLoading) return null;

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

      const intervieweeTurnId =
        (data.interviewee_turn as TranscriptTurn | undefined)?.id ?? null;

      if (data.is_complete) {
        router.push(`/complete?interview_id=${interview.id}`);
      } else {
        // Fire-and-forget the background analysis (Agenda Manager + Planner) so
        // the heavy agents run OFF the critical path and prep state for the next
        // turn. Never awaited — it must not delay the spoken response.
        void fetch("/api/interview/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interview_id: interview.id }),
        }).catch(() => {});
      }

      return intervieweeTurnId;
    } catch (err) {
      setTurns((prev) => prev.filter((t) => !t.id.startsWith("optimistic-")));
      setOrbState("idle");
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, interview.id, turns.length, router]);

  // ==========================================================================
  // Refine a saved interviewee turn with the accurate AWS transcript.
  // Runs in the background after the conversation already proceeded on the
  // instant browser transcript — improves the stored/displayed record only.
  // ==========================================================================

  const refineTranscript = useCallback(async (turnId: string, text: string) => {
    try {
      const res = await fetch("/api/interview/refine-turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interview_id: interview.id, turn_id: turnId, text }),
      });
      if (!res.ok) return;
      setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, text } : t)));
      setLastTranscriptSource("aws");
    } catch {
      // Keep the browser transcript on any failure
    }
  }, [interview.id]);

  // ==========================================================================
  // Voice selection — preview the chosen voice immediately so the change is
  // audible in real time (the next interview turn also uses it automatically).
  // ==========================================================================

  const handleVoiceChange = useCallback((newVoice: string) => {
    setVoice(newVoice);
    // unlock() must run synchronously within this click gesture (before any await)
    tts.unlock();

    if (isMuted || isLoading) return;

    // If the AI is currently speaking the interview turn, do NOT cut it off
    // to play a preview — that was the source of the "voice change kills the
    // AI mid-sentence" bug. Just record the new voice; it applies on the next
    // interviewer turn. Show a brief inline hint so the user knows.
    const aiIsSpeaking = isAnimatingCaption || orbState === "speaking" || tts.isSpeaking;
    if (aiIsSpeaking) {
      if (voiceHintTimerRef.current) clearTimeout(voiceHintTimerRef.current);
      setVoiceChangeHint("Voice will change on the next response");
      voiceHintTimerRef.current = setTimeout(() => setVoiceChangeHint(null), 3500);
      return;
    }

    // If we already know the server TTS route is unavailable, skip the preview
    // entirely — browser SpeechSynthesis ignores the requested voice and would
    // just play the same fallback voice, which is confusing UX.
    if (tts.mode === "browser") {
      if (voiceHintTimerRef.current) clearTimeout(voiceHintTimerRef.current);
      setVoiceChangeHint("Browser fallback in use — selected voice can't be previewed");
      voiceHintTimerRef.current = setTimeout(() => setVoiceChangeHint(null), 3500);
      return;
    }

    if (voicePreviewTimerRef.current) clearTimeout(voicePreviewTimerRef.current);

    // Debounce rapid dropdown changes — each preview is a TTS API call (~1–5s).
    // Cached after the first play per voice so re-selecting is instant.
    voicePreviewTimerRef.current = setTimeout(() => {
      setOrbState("speaking");
      void tts.previewVoice(newVoice);
    }, 350);
  }, [isMuted, isLoading, isAnimatingCaption, orbState, tts]);

  useEffect(() => {
    return () => {
      if (voicePreviewTimerRef.current) clearTimeout(voicePreviewTimerRef.current);
      if (voiceHintTimerRef.current) clearTimeout(voiceHintTimerRef.current);
    };
  }, []);

  // ==========================================================================
  // AWS Transcribe helper — sends recorded blob to server, returns text.
  // Falls back silently (returns "") so the caller can use Web Speech instead.
  // ==========================================================================

  const transcribeAudio = useCallback(async (blob: Blob): Promise<{ text: string; source: "aws" | "browser" }> => {
    if (blob.size === 0) return { text: "", source: "browser" };
    try {
      const ext = blob.type.includes("mp4") ? "mp4"
                : blob.type.includes("ogg") ? "ogg"
                : "webm";
      const formData = new FormData();
      formData.append("audio", blob, `recording.${ext}`);

      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 55_000);

      try {
        const res = await fetch("/api/transcribe", {
          method: "POST",
          body:   formData,
          signal: controller.signal,
        });
        if (!res.ok) return { text: "", source: "browser" };
        const data = await res.json() as { transcript?: string; source?: string };
        const text = data.transcript?.trim() ?? "";
        const source = data.source === "aws" ? "aws" : "browser";
        console.log(`[transcribe] source=${source} chars=${text.length}`, text.slice(0, 80));
        return { text, source };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return { text: "", source: "browser" };
    }
  }, []);

  // ==========================================================================
  // Voice mode: press-to-talk
  // ==========================================================================

  const handleMicPress = useCallback(async () => {
    console.log(`[mic] press — recorderState=${audio.recorderState} orbState=${orbState}`);
    if (orbState === "thinking" || turns.length === 0) return;

    if (audio.recorderState === "recording") {
      console.log("[mic] stopping recording");
      // Grab the live browser (Web Speech) transcript captured while recording.
      const browserText = (speech.finalTranscript + speech.interimTranscript).trim();
      speech.stopListening();
      speech.resetTranscript();

      // stopRecording returns the audio blob immediately once MediaRecorder
      // flushes; the Supabase upload continues in the background.
      const blobPromise = audio.stopRecording(interview.id);

      if (browserText) {
        // ── Fast path ──────────────────────────────────────────────────────
        // Drive the conversation instantly on the browser transcript (no AWS
        // wait), then refine the saved turn with the accurate AWS transcript
        // in the background.
        setLastTranscriptSource("browser");
        const intervieweeTurnId = await handleSubmit(browserText);

        void (async () => {
          try {
            const blob   = await blobPromise;
            const result = await transcribeAudio(blob);
            if (
              result.text &&
              result.source === "aws" &&
              intervieweeTurnId &&
              result.text !== browserText
            ) {
              await refineTranscript(intervieweeTurnId, result.text);
            }
          } catch {
            // Keep the browser transcript on any failure
          }
        })();
      } else {
        // ── Fallback path ──────────────────────────────────────────────────
        // No instant browser transcript (e.g. Safari/iOS lacks Web Speech), so
        // we must wait for AWS before we have anything to submit.
        setIsTranscribing(true);
        setOrbState("thinking");
        setCaptionSpeaker(null);
        setCaption("");

        let finalText = "";
        let usedSource: "aws" | "browser" = "browser";
        try {
          const blob   = await blobPromise;
          const result = await transcribeAudio(blob);
          if (result.text) {
            finalText  = result.text;
            usedSource = result.source;
          }
        } catch (e) {
          console.warn("[mic] transcribeAudio threw", e);
        } finally {
          setIsTranscribing(false);
          setLastTranscriptSource(usedSource);
        }

        if (finalText) {
          await handleSubmit(finalText);
        } else {
          setOrbState("idle");
          setCaptionSpeaker(null);
        }
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

      console.log("[mic] starting recording…");
      const started = await audio.startRecording();
      console.log(`[mic] startRecording success=${started} — press mic again to STOP and transcribe`);
      if (speech.isSupported) {
        speech.startListening();
      }
    }
  }, [orbState, audio, speech, tts, interview.id, turns.length, handleSubmit, transcribeAudio, refineTranscript]);

  // ==========================================================================
  // Begin — unlocks AudioContext within the gesture, then starts the interview
  // ==========================================================================

  const handleBegin = useCallback(() => {
    // unlock() MUST run synchronously here, before any await, so it fires
    // while we are still inside Chrome's user-gesture activation window.
    tts.unlock();
    setHasBegun(true);
    // The turns useEffect will fire because hasBegun just became true,
    // and will call animateAICaption — which now runs after unlock().
  }, [tts]);

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
  const isMicDisabled = orbState === "thinking" || !canInteract || isTranscribing;

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
        {/* Left: session badge + AI voice picker */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-stone-400" />
            <span className="text-[11px] text-stone-400 font-mono tracking-widest uppercase">
              {studyId}
            </span>
          </div>

          <label
            className="relative flex items-center gap-1.5 pl-2.5 pr-1 py-1.5 rounded-full
                       border border-stone-200 bg-stone-50 text-stone-500
                       hover:border-stone-400 hover:bg-stone-100 transition-colors duration-150"
            title={
              tts.mode === "browser"
                ? "Browser fallback voice in use — set OPENAI_TTS_API_KEY on the server to enable selectable voices"
                : "Choose the interviewer's voice"
            }
          >
            <VoiceSelectIcon className="w-4 h-4 shrink-0" />
            <select
              value={voice}
              onChange={(e) => handleVoiceChange(e.target.value)}
              aria-label="Interviewer voice"
              className="appearance-none bg-transparent pr-5 text-[12px] font-medium
                         text-stone-700 focus:outline-none cursor-pointer"
            >
              {TTS_VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} — {v.description}
                </option>
              ))}
            </select>
            <ChevronIcon className="w-3.5 h-3.5 rotate-180 absolute right-2 pointer-events-none text-stone-400" />
          </label>

          {/* Persistent fallback indicator — only when the server TTS route is
              unavailable. Clarifies why the dropdown doesn't seem to change
              anything (browser SpeechSynthesis ignores the selected voice). */}
          {tts.mode === "browser" && (
            <span
              className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                         bg-amber-50 border border-amber-200 text-amber-700
                         text-[10px] font-mono uppercase tracking-widest"
              title="The server TTS route returned 503 (no OPENAI_TTS_API_KEY). Falling back to your browser's built-in voice, which ignores the voice selector."
            >
              fallback voice
            </span>
          )}

          {/* Transient hint — voice change happened during AI speech or while
              in browser-fallback mode; we deliberately didn't interrupt. */}
          {voiceChangeHint && (
            <span
              className="text-[11px] text-stone-500 transition-opacity duration-200"
              role="status"
            >
              {voiceChangeHint}
            </span>
          )}
        </div>

        {/* Center: title */}
        <h1 className="absolute left-1/2 -translate-x-1/2 text-[13px] font-medium
                       text-stone-600 tracking-wide">
          Life Story Interview
        </h1>

        {/* Right: transcript toggle */}
        <button
          onClick={() => setIsTranscriptOpen((o) => !o)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full border text-sm
                      font-medium transition-all duration-150
                      ${isTranscriptOpen
                        ? "bg-stone-800 border-stone-800 text-white"
                        : "bg-stone-100 border-stone-200 text-stone-600 hover:bg-stone-200 hover:text-stone-800"
                      }`}
        >
          <ListIcon className="w-4 h-4" />
          <span className="hidden sm:inline">
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
        {/* Orb — scales down on small screens via CSS transform so layout stays stable */}
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
        </div>

        {/* Transcription source badge — shows after each voice turn */}
        {lastTranscriptSource && !isTranscribing && !isRecording && (
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-mono tracking-widest uppercase
                          ${lastTranscriptSource === "aws"
                            ? "bg-emerald-50 border-emerald-200 text-emerald-600"
                            : "bg-stone-100 border-stone-200 text-stone-400"
                          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${lastTranscriptSource === "aws" ? "bg-emerald-400" : "bg-stone-300"}`} />
            {lastTranscriptSource === "aws" ? "AWS Transcribe" : "Browser fallback"}
          </div>
        )}

        {/* Status label */}
        <div className="text-center h-5">
          {isTranscribing && (
            <p className="text-[11px] text-violet-500 tracking-widest uppercase animate-pulse">
              Transcribing
            </p>
          )}
          {isLoading && orbState === "thinking" && !isTranscribing && (
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
          {canInteract && !hasBegun && !isLoading && (
            <p className="text-[11px] text-stone-500 tracking-widest uppercase">
              Ready
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

        {/* Center: Begin button (first load) or mic button (active) */}
        <div className="relative flex items-center justify-center">
          {!hasBegun && canInteract ? (
            /* Begin Interview — click unlocks AudioContext then starts animation */
            <button
              onClick={handleBegin}
              className="px-7 py-3.5 rounded-full bg-stone-800 text-white text-[15px]
                         font-medium hover:bg-stone-700 transition-colors shadow-md
                         hover:scale-105 duration-200"
            >
              Begin Interview
            </button>
          ) : (
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

function VoiceSelectIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 11a7 7 0 0014 0M12 18v3" />
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
