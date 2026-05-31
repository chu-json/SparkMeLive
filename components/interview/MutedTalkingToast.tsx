"use client";

import { useEffect } from "react";

interface MutedTalkingToastProps {
  /** Controls visibility — parent owns the timer dismissal. */
  visible: boolean;
  /** Called when the user clicks Unmute on the toast. */
  onUnmute: () => void;
  /** Called when the toast auto-dismisses or the X is clicked. */
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. Defaults to 5000. */
  durationMs?: number;
}

/**
 * Zoom-style "you're talking while muted" toast.
 *
 * Designed to appear ONCE per session (the parent enforces that rule).
 * Provides a one-tap Unmute action since that's almost always what
 * the user wants when they see this.
 */
export function MutedTalkingToast({
  visible,
  onUnmute,
  onDismiss,
  durationMs = 5000,
}: MutedTalkingToastProps) {
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [visible, durationMs, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed left-1/2 -translate-x-1/2 z-50
                  bottom-28 sm:bottom-32 max-w-[90vw] w-[340px]
                  transition-all duration-300 ease-out
                  ${visible
                    ? "opacity-100 translate-y-0 pointer-events-auto"
                    : "opacity-0 translate-y-3 pointer-events-none"
                  }`}
    >
      <div className="flex items-center gap-3 rounded-2xl border border-stone-200
                      bg-stone-900 text-white shadow-lg px-4 py-3">
        <div className="shrink-0 w-9 h-9 rounded-full bg-red-500/15
                        flex items-center justify-center">
          <MutedMicIcon className="w-5 h-5 text-red-400" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold leading-tight">
            You&rsquo;re talking, but you&rsquo;re muted
          </p>
          <p className="text-[11px] text-stone-400 leading-tight mt-0.5">
            Unmute to let the interviewer hear you.
          </p>
        </div>

        <button
          onClick={onUnmute}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-white text-stone-900
                     text-[12px] font-semibold hover:bg-stone-100
                     transition-colors"
        >
          Unmute
        </button>

        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 p-1 rounded-md text-stone-400 hover:text-white
                     hover:bg-stone-800 transition-colors"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function MutedMicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
      <path strokeLinecap="round" strokeLinejoin="round"
            d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
      <line x1="3" y1="3" x2="21" y2="21"
            strokeLinecap="round" strokeWidth={2} />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
            d="M6 6l12 12M6 18L18 6" />
    </svg>
  );
}
