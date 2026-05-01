"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/Button";

interface AudioRecorderProps {
  interviewId: string;
  onUploadComplete?: (audioPath: string) => void;
}

type RecordingState = "idle" | "recording" | "uploading" | "uploaded" | "error";

export function AudioRecorder({ interviewId, onUploadComplete }: AudioRecorderProps) {
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = useCallback(async () => {
    setError(null);
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access denied. Please allow microphone access and try again.");
      setState("error");
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/ogg";

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());

      const blob = new Blob(chunksRef.current, { type: mimeType });
      await uploadAudio(blob, mimeType);
    };

    recorder.start(1000); // collect data every second
    setState("recording");

    // Track duration
    setDuration(0);
    timerRef.current = setInterval(() => {
      setDuration((d) => d + 1);
    }, 1000);
  }, [interviewId]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    mediaRecorderRef.current?.stop();
    setState("uploading");
  }, []);

  const uploadAudio = async (blob: Blob, mimeType: string) => {
    setState("uploading");

    const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : "webm";
    const file = new File([blob], `recording.${ext}`, { type: mimeType });

    const formData = new FormData();
    formData.append("audio", file);
    formData.append("interview_id", interviewId);

    try {
      const res = await fetch("/api/audio/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Upload failed");
      }

      const data = await res.json();
      setState("uploaded");
      onUploadComplete?.(data.audio_path);
    } catch {
      setError("Failed to upload recording. Your responses have been saved as text.");
      setState("error");
    }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  return (
    <div className="flex items-center gap-3 px-4 md:px-8 py-2 bg-stone-50 border-t border-stone-100">
      <div className="flex items-center gap-2 flex-1">
        {state === "recording" && (
          <>
            <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs text-stone-600 font-mono">{formatDuration(duration)}</span>
            <span className="text-xs text-stone-400">Recording audio</span>
          </>
        )}
        {state === "uploading" && (
          <span className="text-xs text-stone-400">Uploading recording...</span>
        )}
        {state === "uploaded" && (
          <>
            <span className="text-xs text-emerald-600">Audio saved</span>
          </>
        )}
        {state === "idle" && (
          <span className="text-xs text-stone-400">Audio recording optional</span>
        )}
        {state === "error" && error && (
          <span className="text-xs text-red-500">{error}</span>
        )}
      </div>

      {(state === "idle" || state === "error") && (
        <Button variant="ghost" size="sm" onClick={startRecording}>
          <MicIcon className="w-3.5 h-3.5 mr-1.5" />
          Record
        </Button>
      )}
      {state === "recording" && (
        <Button variant="danger" size="sm" onClick={stopRecording}>
          <StopIcon className="w-3.5 h-3.5 mr-1.5" />
          Stop
        </Button>
      )}
    </div>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}
