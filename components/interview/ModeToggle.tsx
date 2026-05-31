"use client";

export type VoiceMode = "hands-free" | "push-to-talk";

interface ModeToggleProps {
  mode: VoiceMode;
  onChange: (mode: VoiceMode) => void;
  /** When true the toggle is non-interactive (e.g. mid-turn). */
  disabled?: boolean;
}

/**
 * Segmented pill that picks between the two voice interaction modes.
 *
 *   Hands-free  →  always-on mic, mute/unmute, AI auto-detects pauses
 *   Push to Talk →  user holds (taps) record to speak, AI listens only then
 */
export function ModeToggle({ mode, onChange, disabled = false }: ModeToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Voice interaction mode"
      className={`inline-flex items-center gap-1 rounded-full p-1
                  bg-stone-100 border border-stone-200
                  ${disabled ? "opacity-60 pointer-events-none" : ""}`}
    >
      <Segment
        active={mode === "hands-free"}
        onClick={() => onChange("hands-free")}
        label="Hands-free"
        title="AI listens continuously and replies when you pause"
      >
        <WaveIcon className="w-3.5 h-3.5" />
      </Segment>
      <Segment
        active={mode === "push-to-talk"}
        onClick={() => onChange("push-to-talk")}
        label="Push to Talk"
        title="Tap the record button each time you want to speak"
      >
        <MicIcon className="w-3.5 h-3.5" />
      </Segment>
    </div>
  );
}

interface SegmentProps {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
  children: React.ReactNode;
}

function Segment({ active, onClick, label, title, children }: SegmentProps) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full
                  text-[12px] font-medium transition-all duration-150
                  ${active
                    ? "bg-stone-800 text-white shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                  }`}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function WaveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 12h2" />
    </svg>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
      <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
    </svg>
  );
}
