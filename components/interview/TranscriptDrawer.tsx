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
 * Slides in from the right. Light-themed to match the stone-50 interview UI.
 */
export function TranscriptDrawer({ turns, isOpen, onClose }: TranscriptDrawerProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-stone-900/20 backdrop-blur-[2px] transition-opacity duration-300 ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        className={`transcript-drawer fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[400px]
                    bg-white border-l border-stone-200 flex flex-col shadow-2xl shadow-stone-300/30
                    ${isOpen ? "transcript-drawer-open" : "transcript-drawer-closed"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 bg-stone-50">
          <div>
            <h2 className="text-sm font-semibold text-stone-800 tracking-tight">
              Transcript
            </h2>
            <p className="text-[11px] text-stone-400 mt-0.5">
              {turns.length} turn{turns.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center
                       text-stone-400 hover:text-stone-700 hover:bg-stone-200
                       transition-colors duration-150"
            aria-label="Close transcript"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Turn list */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-white">
          {turns.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <p className="text-stone-400 text-sm text-center font-normal">
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
            isAI ? "text-blue-600" : "text-amber-600"
          }`}
        >
          {isAI ? "Interviewer" : "You"}
        </span>
        {time && (
          <span className="text-[10px] text-stone-400">{time}</span>
        )}
      </div>
      <div
        className={`rounded-xl px-4 py-3 max-w-[92%] ${
          isAI
            ? "bg-blue-50 border border-blue-100"
            : "bg-amber-50 border border-amber-100"
        }`}
      >
        <p className={`text-[13.5px] leading-relaxed font-normal whitespace-pre-wrap ${
          isAI ? "text-slate-700" : "text-stone-700"
        }`}>
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
