"use client";

import { useEffect, useRef } from "react";

export type CaptionSpeaker = "ai" | "user";

interface CaptionEntry {
  speaker: CaptionSpeaker;
  text: string;
  isAnimating?: boolean;
}

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

const SPEAKER_COLORS: Record<CaptionSpeaker, { label: string; text: string; border: string }> = {
  ai: {
    label:  "text-blue-400",
    text:   "text-white",
    border: "border-blue-500/30",
  },
  user: {
    label:  "text-amber-400",
    text:   "text-white/90",
    border: "border-amber-500/30",
  },
};

/**
 * Live caption panel displayed below the voice orb.
 *
 * Shows:
 *  - Up to 2 previous turns, faded and truncated
 *  - The current active caption, full brightness
 *    - With blinking cursor when animating (AI typewriter or live speech)
 *
 * Design: dark frosted glass panel, minimal, centered.
 */
export function LiveCaption({
  previousTurns = [],
  currentText,
  currentSpeaker,
  isAnimating,
}: LiveCaptionProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to end of caption as text grows
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [currentText]);

  const isEmpty = !currentText && previousTurns.length === 0;

  return (
    <div className="w-full max-w-xl mx-auto px-2">
      {/* Previous turns — faded history */}
      {previousTurns.length > 0 && (
        <div className="space-y-2 mb-3">
          {previousTurns.slice(-2).map((turn, i) => {
            const colors = SPEAKER_COLORS[turn.speaker];
            const isOldest = i === 0 && previousTurns.length > 1;
            return (
              <div
                key={i}
                className={`flex gap-2 items-start transition-opacity duration-500 ${
                  isOldest ? "opacity-20" : "opacity-35"
                }`}
              >
                <span className={`text-[10px] font-semibold tracking-widest uppercase shrink-0 mt-0.5 ${colors.label}`}>
                  {SPEAKER_LABELS[turn.speaker]}
                </span>
                <p className="text-[13px] text-white/60 leading-snug line-clamp-2 font-light">
                  {turn.text}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Divider */}
      {previousTurns.length > 0 && currentSpeaker && (
        <div className="h-px bg-white/8 mb-3" />
      )}

      {/* Current active caption */}
      {currentSpeaker && (
        <div
          className={`rounded-xl border bg-white/[0.04] backdrop-blur-sm px-5 py-4 ${
            SPEAKER_COLORS[currentSpeaker].border
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            {/* Speaker badge */}
            <span
              className={`text-[10px] font-bold tracking-[0.15em] uppercase ${
                SPEAKER_COLORS[currentSpeaker].label
              }`}
            >
              {SPEAKER_LABELS[currentSpeaker]}
            </span>
            {/* Live indicator dot */}
            {isAnimating && (
              <span className="flex items-center gap-1 ml-auto">
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse opacity-60"
                      style={{ color: currentSpeaker === "ai" ? "#60a5fa" : "#fbbf24" }} />
                <span className="text-[10px] opacity-40 tracking-wide">
                  {currentSpeaker === "ai" ? "speaking" : "listening"}
                </span>
              </span>
            )}
          </div>

          {/* Caption text */}
          <div ref={scrollRef} className="max-h-32 overflow-y-auto scrollbar-none">
            {isEmpty ? (
              <p className="text-white/20 text-sm italic font-light">Waiting to begin…</p>
            ) : (
              <p
                className={`text-[15px] leading-relaxed font-light ${
                  SPEAKER_COLORS[currentSpeaker].text
                } ${isAnimating ? "caption-cursor" : ""}`}
              >
                {currentText}
                {!currentText && isAnimating && (
                  <span className="opacity-30">…</span>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Placeholder when nothing is happening */}
      {!currentSpeaker && previousTurns.length === 0 && (
        <div className="text-center">
          <p className="text-white/20 text-sm font-light tracking-wide">
            Press the microphone to begin
          </p>
        </div>
      )}
    </div>
  );
}
