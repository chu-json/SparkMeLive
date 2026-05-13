"use client";

import { useEffect } from "react";
import type { TranscriptTurn } from "@/lib/types";

interface TranscriptDrawerProps {
  turns: TranscriptTurn[];
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Full transcript history panel.
 * Slides in from the right on desktop, slides up from the bottom on mobile.
 * Tap the backdrop or the close button to dismiss.
 */
export function TranscriptDrawer({ turns, isOpen, onClose }: TranscriptDrawerProps) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        className={`transcript-drawer fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[420px]
                    bg-[#0f0f1a] border-l border-white/10 flex flex-col
                    ${isOpen ? "transcript-drawer-open" : "transcript-drawer-closed"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <div>
            <h2 className="text-sm font-semibold text-white tracking-tight">
              Transcript
            </h2>
            <p className="text-[11px] text-white/30 mt-0.5">
              {turns.length} turn{turns.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center
                       text-white/40 hover:text-white hover:bg-white/8
                       transition-colors duration-150"
            aria-label="Close transcript"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Turn list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {turns.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <p className="text-white/25 text-sm text-center font-light">
                The transcript will appear here as the interview progresses.
              </p>
            </div>
          ) : (
            turns.map((turn) => <DrawerTurn key={turn.id} turn={turn} />)
          )}
        </div>
      </div>
    </>
  );
}

// Individual turn inside the drawer
function DrawerTurn({ turn }: { turn: TranscriptTurn }) {
  const isAI = turn.speaker === "interviewer";
  const time = turn.timestamp_start
    ? new Date(turn.timestamp_start).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className={`flex flex-col gap-1 ${isAI ? "" : "items-end"}`}>
      <div className={`flex items-center gap-2 ${isAI ? "" : "flex-row-reverse"}`}>
        <span
          className={`text-[10px] font-bold tracking-widest uppercase ${
            isAI ? "text-blue-400" : "text-amber-400"
          }`}
        >
          {isAI ? "Interviewer" : "You"}
        </span>
        {time && (
          <span className="text-[10px] text-white/20">{time}</span>
        )}
      </div>
      <div
        className={`rounded-xl px-4 py-3 max-w-[90%] ${
          isAI
            ? "bg-blue-950/40 border border-blue-500/15"
            : "bg-amber-950/30 border border-amber-500/15"
        }`}
      >
        <p className="text-[13.5px] text-white/80 leading-relaxed font-light whitespace-pre-wrap">
          {turn.text}
        </p>
      </div>
    </div>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
