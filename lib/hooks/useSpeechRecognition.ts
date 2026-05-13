"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ── Local minimal type definitions for Web Speech API ────────────────────────
// These types are not included in TypeScript's standard lib.dom.d.ts and need
// to be declared locally. When AWS Transcribe streaming is wired in, replace
// the SpeechRec implementation below — this interface stays the same.

interface SpeechRec {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechResultItem {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechResultItem;
  [index: number]: SpeechResultItem;
}

interface SpeechResultList {
  readonly length: number;
  item(index: number): SpeechResult;
  [index: number]: SpeechResult;
}

interface SpeechResultEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechResultList;
}

interface SpeechErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}
// ─────────────────────────────────────────────────────────────────────────────

export interface SpeechRecognitionState {
  isSupported: boolean;
  isListening: boolean;
  /** Partial in-progress transcript — updates as you speak */
  interimTranscript: string;
  /** Final confirmed transcript — accumulates across the session */
  finalTranscript: string;
  error: string | null;
}

export interface SpeechRecognitionControls {
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
}

/**
 * React hook wrapping the Web Speech API SpeechRecognition interface.
 *
 * Provides live interim captions as the user speaks and a stable
 * finalTranscript once they stop.
 *
 * Browser support: Chrome, Edge, Safari (webkit). Not supported in Firefox.
 * Falls back gracefully (isSupported = false) — the keyboard button should be
 * surfaced as a text-input alternative when isSupported is false.
 *
 * AWS Transcribe integration note:
 *   When real-time streaming transcription is available, replace the
 *   SpeechRec implementation below with Amazon Transcribe Streaming SDK
 *   event handlers (TranscriptResultStream). The exported hook interface
 *   (startListening / stopListening / interimTranscript / finalTranscript)
 *   stays the same — no changes needed in InterviewClient.
 */
export function useSpeechRecognition(): SpeechRecognitionState & SpeechRecognitionControls {
  const [isListening, setIsListening]             = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript]     = useState("");
  const [error, setError]                         = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRec | null>(null);

  const isSupported =
    typeof window !== "undefined" &&
    !!((window as unknown as Record<string, unknown>).SpeechRecognition ||
       (window as unknown as Record<string, unknown>).webkitSpeechRecognition);

  useEffect(() => {
    return () => { recognitionRef.current?.stop(); };
  }, []);

  const startListening = useCallback(() => {
    if (!isSupported) return;

    const win = window as unknown as Record<string, unknown>;
    const API = (win.SpeechRecognition || win.webkitSpeechRecognition) as new () => SpeechRec;
    const recognition = new API();

    recognition.continuous      = true;
    recognition.interimResults  = true;
    recognition.lang            = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechResultEvent) => {
      let interim = "";
      let finalChunk = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text   = result[0].transcript;
        if (result.isFinal) {
          finalChunk += text + " ";
        } else {
          interim += text;
        }
      }

      if (finalChunk) setFinalTranscript((prev) => prev + finalChunk);
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: SpeechErrorEvent) => {
      if (event.error !== "aborted") {
        setError(`Speech recognition error: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript("");
    };

    recognitionRef.current = recognition;
    setError(null);
    setInterimTranscript("");
    setFinalTranscript("");
    recognition.start();
    setIsListening(true);
  }, [isSupported]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
    setInterimTranscript("");
  }, []);

  const resetTranscript = useCallback(() => {
    setFinalTranscript("");
    setInterimTranscript("");
    setError(null);
  }, []);

  return {
    isSupported,
    isListening,
    interimTranscript,
    finalTranscript,
    error,
    startListening,
    stopListening,
    resetTranscript,
  };
}
