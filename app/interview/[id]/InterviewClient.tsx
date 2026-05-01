"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { TranscriptTurn, Interview } from "@/lib/types";
import { ChatWindow } from "@/components/interview/ChatWindow";
import { InputArea } from "@/components/interview/InputArea";
import { StatusBar } from "@/components/interview/StatusBar";
import { AudioRecorder } from "@/components/interview/AudioRecorder";

interface InterviewClientProps {
  interview: Interview;
  initialTurns: TranscriptTurn[];
  studyId: string;
}

export function InterviewClient({
  interview,
  initialTurns,
  studyId,
}: InterviewClientProps) {
  const router = useRouter();
  const [turns, setTurns] = useState<TranscriptTurn[]>(initialTurns);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStarted, setIsStarted] = useState(initialTurns.length > 0);
  const [error, setError] = useState<string | null>(null);

  // If no turns yet, fetch the opening message on mount
  useEffect(() => {
    if (initialTurns.length === 0 && !isStarted) {
      startInterview();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startInterview = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/interview/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participant_id: interview.participant_id }),
      });

      if (!res.ok) {
        const data = await res.json();
        // If interview already exists (409 or 404 with interview), just reload
        if (res.status === 409) {
          router.refresh();
          return;
        }
        throw new Error(data.error ?? "Failed to start interview");
      }

      const data = await res.json();
      // Reload to get the saved opening turn from DB
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start interview");
    } finally {
      setIsLoading(false);
      setIsStarted(true);
    }
  };

  const handleSubmit = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;

    setInputText("");
    setIsLoading(true);
    setError(null);

    // Optimistically add the interviewee turn to UI
    const optimisticTurn: TranscriptTurn = {
      id: `optimistic-${Date.now()}`,
      interview_id: interview.id,
      turn_index: turns.length,
      speaker: "interviewee",
      text,
      timestamp_start: new Date().toISOString(),
      timestamp_end: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, optimisticTurn]);

    try {
      const res = await fetch("/api/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interview_id: interview.id,
          text,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to submit response");
      }

      const data = await res.json();

      // Replace optimistic turn with real turns from server
      setTurns((prev) => {
        const withoutOptimistic = prev.filter(
          (t) => !t.id.startsWith("optimistic-")
        );
        return [
          ...withoutOptimistic,
          data.interviewee_turn as TranscriptTurn,
          data.interviewer_turn as TranscriptTurn,
        ];
      });

      // If the interview is marked complete, navigate to completion page
      if (data.is_complete) {
        router.push(`/complete?interview_id=${interview.id}`);
      }
    } catch (err) {
      // Remove optimistic turn on error
      setTurns((prev) =>
        prev.filter((t) => !t.id.startsWith("optimistic-"))
      );
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  }, [inputText, isLoading, interview.id, turns.length, router]);

  const status = interview.completed
    ? "completed"
    : turns.length > 0
    ? "active"
    : "not_started";

  return (
    <div className="flex flex-col h-screen max-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 px-4 md:px-8 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <h1 className="text-base font-semibold text-stone-800 tracking-tight">
            Life Story Interview
          </h1>
          <span className="text-xs text-stone-400 font-mono hidden sm:block">
            {interview.id.slice(0, 8)}
          </span>
        </div>
      </header>

      {/* Status bar */}
      <StatusBar
        status={status}
        turnCount={turns.length}
        studyId={studyId}
      />

      {/* Chat area */}
      <div className="flex-1 overflow-hidden flex flex-col max-w-3xl w-full mx-auto">
        {/* Interview start notice */}
        {turns.length === 0 && !isLoading && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="max-w-md">
              <h2 className="text-xl font-semibold text-stone-800 mb-3">
                Ready to begin?
              </h2>
              <p className="text-sm text-stone-500 leading-relaxed mb-6">
                This is a life story interview. You will be asked to share experiences
                and reflections from your life. There are no right or wrong answers.
                Take your time and respond as fully as you like.
              </p>
              <p className="text-xs text-stone-400 leading-relaxed">
                The interview will begin automatically. Please wait a moment.
              </p>
            </div>
          </div>
        )}

        {/* Transcript */}
        <ChatWindow turns={turns} isLoading={isLoading} />

        {/* Error banner */}
        {error && (
          <div className="px-4 md:px-8 py-3 bg-red-50 border-t border-red-200">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>

      {/* Audio recorder */}
      <div className="max-w-3xl w-full mx-auto">
        <AudioRecorder interviewId={interview.id} />
      </div>

      {/* Input area */}
      <div className="max-w-3xl w-full mx-auto">
        <InputArea
          value={inputText}
          onChange={setInputText}
          onSubmit={handleSubmit}
          disabled={turns.length === 0 || interview.completed}
          loading={isLoading}
        />
      </div>
    </div>
  );
}
