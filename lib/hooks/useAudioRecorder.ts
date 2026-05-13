"use client";

import { useState, useRef, useCallback } from "react";

export type RecorderState = "idle" | "recording" | "uploading" | "uploaded" | "error";

export interface AudioRecorderState {
  recorderState: RecorderState;
  duration: number;
  error: string | null;
  /** Ref to current microphone amplitude 0–1 — updated every animation frame */
  amplitudeRef: React.RefObject<number>;
}

export interface AudioRecorderControls {
  startRecording: () => Promise<void>;
  stopRecording: (interviewId: string) => void;
  resetRecorder: () => void;
}

/**
 * React hook encapsulating MediaRecorder audio capture and upload.
 *
 * Also drives a Web Audio AnalyserNode so that amplitudeRef.current
 * tracks microphone loudness (0–1) in real time — used by VoiceOrb
 * to animate reactively.
 *
 * AWS Transcribe integration note:
 *   When streaming transcription is ready, pipe the same MediaStream
 *   from getUserMedia() into the AWS Transcribe SDK here instead of
 *   (or in addition to) uploading the final blob.
 */
export function useAudioRecorder(): AudioRecorderState & AudioRecorderControls {
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [duration, setDuration]           = useState(0);
  const [error, setError]                 = useState<string | null>(null);

  // Amplitude ref — updated via AnalyserNode RAF loop, read by VoiceOrb
  const amplitudeRef = useRef<number>(0);

  const mediaRecorderRef   = useRef<MediaRecorder | null>(null);
  const chunksRef          = useRef<Blob[]>([]);
  const timerRef           = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef    = useRef<AudioContext | null>(null);
  const analyserRef        = useRef<AnalyserNode | null>(null);
  const ampRafRef          = useRef<number>(0);
  const streamRef          = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    setError(null);
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch {
      setError("Microphone access denied.");
      setRecorderState("error");
      return;
    }

    // Set up Web Audio amplitude tracking
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      audioContextRef.current = ctx;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateAmplitude = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let idx = 0; idx < dataArray.length; idx++) sum += dataArray[idx];
        amplitudeRef.current = Math.min(1, (sum / dataArray.length) / 64);
        ampRafRef.current = requestAnimationFrame(updateAmplitude);
      };
      ampRafRef.current = requestAnimationFrame(updateAmplitude);
    } catch {
      // Amplitude tracking is optional — don't block recording
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/ogg";

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.start(1000);
    setRecorderState("recording");

    setDuration(0);
    timerRef.current = setInterval(() => {
      setDuration((d) => d + 1);
    }, 1000);
  }, []);

  const stopRecording = useCallback((interviewId: string) => {
    // Stop timers and cleanup
    if (timerRef.current) clearInterval(timerRef.current);
    cancelAnimationFrame(ampRafRef.current);
    amplitudeRef.current = 0;

    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    analyserRef.current = null;

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    setRecorderState("uploading");

    recorder.onstop = async () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());

      const mimeType = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const ext  = mimeType.includes("ogg") ? "ogg" : "webm";
      const file = new File([blob], `recording.${ext}`, { type: mimeType });

      const formData = new FormData();
      formData.append("audio", file);
      formData.append("interview_id", interviewId);

      try {
        const res = await fetch("/api/audio/upload", { method: "POST", body: formData });
        if (!res.ok) throw new Error("Upload failed");
        setRecorderState("uploaded");
      } catch {
        setError("Audio upload failed — your text responses are still saved.");
        setRecorderState("error");
      }
    };

    recorder.stop();
  }, []);

  const resetRecorder = useCallback(() => {
    setRecorderState("idle");
    setDuration(0);
    setError(null);
    amplitudeRef.current = 0;
  }, []);

  return {
    recorderState,
    duration,
    error,
    amplitudeRef: amplitudeRef as React.RefObject<number>,
    startRecording,
    stopRecording,
    resetRecorder,
  };
}
