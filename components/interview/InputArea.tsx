"use client";

import { useRef, KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";

interface InputAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function InputArea({
  value,
  onChange,
  onSubmit,
  disabled = false,
  loading = false,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without Shift) — Shift+Enter inserts newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && !loading && value.trim()) {
        onSubmit();
      }
    }
  };

  return (
    <div className="border-t border-stone-200 bg-white px-4 md:px-8 py-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex gap-3 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled || loading}
              placeholder="Type your response here... (Enter to send, Shift+Enter for new line)"
              rows={3}
              className="
                w-full resize-none rounded-lg border border-stone-300
                px-4 py-3 text-[15px] text-stone-800 placeholder-stone-400
                focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-transparent
                disabled:opacity-50 disabled:cursor-not-allowed
                leading-relaxed
              "
            />
          </div>
          <Button
            onClick={onSubmit}
            disabled={disabled || loading || !value.trim()}
            loading={loading}
            size="lg"
            className="flex-shrink-0 mb-0.5"
          >
            Send
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-stone-400">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
