"use client";

import { useEffect, useRef } from "react";

export type CaptionSpeaker = "ai" | "user";

interface LiveCaptionProps {
  /** Last 1–2 completed turns for context (shown faded above) */
  previousTurns?: { speaker: CaptionSpeaker; text: string }[];
  /** The currently active caption text (may be mid-animation or live transcription) */
  currentText: string;
  currentSpeaker: CaptionSpeaker | null;
  /** True while AI typewriter is running or speech recognition is live */
  isAnimating: boolean;
}

const SPEAKER_LABELS: Record<CaptionSpeaker, string> = {
  ai:   "Interviewer",
  user: "You",
};

const SPEAKER_COLORS: Record<CaptionSpeaker, {
  label: string;
  text: string;
  border: string;
  bg: string;
  dot: string;
}> = {
  ai: {
    label:  "text-blue-600",
    text:   "text-slate-800",
    border: "border-blue-200",
    bg:     "bg-blue-50",
    dot:    "#3b82f6",
  },
  user: {
    label:  "text-amber-600",
    text:   "text-stone-800",
    border: "border-amber-200",
    bg:     "bg-amber-50",
    dot:    "#f59e0b",
  },
};

/**
 * Live caption panel displayed below the voice orb.
 * Light-themed to match the stone-50 interview background.
 */
export function LiveCaption({
  previousTurns = [],
  currentText,
  currentSpeaker,
  isAnimating,
}: LiveCaptionProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [currentText]);

  return (
    <div className="w-full max-w-xl mx-auto px-2">
      {/* Previous turns — faded history */}
      {previousTurns.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {previousTurns.slice(-2).map((turn, i) => {
            const colors = SPEAKER_COLORS[turn.speaker];
            const isOldest = i === 0 && previousTurns.length > 1;
            return (
              <div
                key={i}
                className={`flex gap-2 items-start transition-opacity duration-500 ${
                  isOldest ? "opacity-20" : "opacity-40"
                }`}
              >
                <span className={`text-[10px] font-semibold tracking-widest uppercase shrink-0 mt-0.5 ${colors.label}`}>
                  {SPEAKER_LABELS[turn.speaker]}
                </span>
                <p className="text-[13px] text-stone-500 leading-snug line-clamp-2 font-normal">
                  {turn.text}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Divider */}
      {previousTurns.length > 0 && currentSpeaker && (
        <div className="h-px bg-stone-200 mb-3" />
      )}

      {/* Current active caption */}
      {currentSpeaker && (
        <div
          className={`rounded-xl border px-5 py-4 shadow-sm ${
            SPEAKER_COLORS[currentSpeaker].border
          } ${SPEAKER_COLORS[currentSpeaker].bg}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`text-[10px] font-bold tracking-[0.15em] uppercase ${
                SPEAKER_COLORS[currentSpeaker].label
              }`}
            >
              {SPEAKER_LABELS[currentSpeaker]}
            </span>
            {isAnimating && (
              <span className="flex items-center gap-1 ml-auto">
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: SPEAKER_COLORS[currentSpeaker].dot }}
                />
                <span className="text-[10px] text-stone-400 tracking-wide">
                  {currentSpeaker === "ai" ? "speaking" : "listening"}
                </span>
              </span>
            )}
          </div>

          <div ref={scrollRef} className="max-h-32 overflow-y-auto scrollbar-none">
            {!currentText && !isAnimating ? (
              <p className="text-stone-400 text-sm italic font-light">Waiting to begin…</p>
            ) : (
              <p
                className={`text-[15px] leading-relaxed font-normal ${
                  SPEAKER_COLORS[currentSpeaker].text
                } ${isAnimating ? "caption-cursor" : ""}`}
              >
                {currentText}
                {!currentText && isAnimating && (
                  <span className="opacity-40">…</span>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Placeholder when nothing is happening */}
      {!currentSpeaker && previousTurns.length === 0 && (
        <div className="text-center">
          <p className="text-stone-400 text-sm font-normal tracking-wide">
            Press the microphone to begin
          </p>
        </div>
      )}
    </div>
  );
}
