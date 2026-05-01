"use client";

import { useEffect, useRef } from "react";
import type { TranscriptTurn } from "@/lib/types";
import { TurnBubble } from "./TurnBubble";
import { Spinner } from "@/components/ui/Spinner";

interface ChatWindowProps {
  turns: TranscriptTurn[];
  isLoading: boolean;
}

export function ChatWindow({ turns, isLoading }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, isLoading]);

  if (turns.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-stone-400 text-sm">
        Your conversation will appear here.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-5">
      {turns.map((turn) => (
        <TurnBubble key={turn.id} turn={turn} />
      ))}

      {isLoading && (
        <div className="flex items-center gap-2 text-stone-400 text-sm max-w-2xl">
          <Spinner size="sm" />
          <span>Thinking...</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
