import type { TranscriptTurn } from "@/lib/types";

interface TurnBubbleProps {
  turn: TranscriptTurn;
}

export function TurnBubble({ turn }: TurnBubbleProps) {
  const isInterviewer = turn.speaker === "interviewer";
  const timestamp = turn.timestamp_start
    ? new Date(turn.timestamp_start).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  if (isInterviewer) {
    return (
      <div className="flex flex-col gap-1 max-w-2xl">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Interviewer
          </span>
          {timestamp && (
            <span className="text-xs text-stone-400">{timestamp}</span>
          )}
        </div>
        <div className="bg-stone-100 rounded-lg rounded-tl-sm px-4 py-3">
          <p className="text-stone-800 text-[15px] leading-relaxed whitespace-pre-wrap">
            {turn.text}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 max-w-2xl ml-auto items-end">
      <div className="flex items-center gap-2">
        {timestamp && (
          <span className="text-xs text-stone-400">{timestamp}</span>
        )}
        <span className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
          You
        </span>
      </div>
      <div className="bg-white border border-stone-200 rounded-lg rounded-tr-sm px-4 py-3">
        <p className="text-stone-700 text-[15px] leading-relaxed whitespace-pre-wrap">
          {turn.text}
        </p>
      </div>
    </div>
  );
}
