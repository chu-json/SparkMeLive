// =============================================================================
// Shared TypeScript types for SparkMeLive AVP Interview MVP
// These types mirror the Supabase database schema exactly so that
// DB rows can be cast directly to these interfaces.
// =============================================================================

// ---- Database row types ----------------------------------------------------

export interface Participant {
  id: string;
  study_id: string;
  auth_user_id: string | null;
  status: "active" | "completed" | "withdrawn";
  created_at: string;
}

export interface Interview {
  id: string;
  participant_id: string;
  started_at: string | null;
  ended_at: string | null;
  completed: boolean;
  audio_path: string | null;
  transcript_path: string | null;
  /** Interview mode — 'avp' for AVP life-story, extensible for other protocols */
  mode: string;
  created_at: string;
}

export interface TranscriptTurn {
  id: string;
  interview_id: string;
  turn_index: number;
  speaker: "interviewer" | "interviewee";
  text: string;
  timestamp_start: string | null;
  timestamp_end: string | null;
  created_at: string;
}

export interface InterviewExport {
  id: string;
  interview_id: string;
  json_path: string | null;
  txt_path: string | null;
  created_at: string;
}

// ---- API request / response types ------------------------------------------

export interface StartInterviewRequest {
  participant_id: string;
}

export interface StartInterviewResponse {
  interview: Interview;
  opening_question: string;
  turn_index: number;
}

export interface SubmitTurnRequest {
  interview_id: string;
  text: string;
}

export interface SubmitTurnResponse {
  interviewer_turn: TranscriptTurn;
  interviewee_turn: TranscriptTurn;
  /** The interviewer's next question */
  question: string;
  turn_index: number;
  is_complete: boolean;
}

export interface ExportRequest {
  interview_id: string;
}

export interface ExportResponse {
  json_url: string;
  txt_url: string;
  export: InterviewExportPayload;
}

// ---- Export payload structure -----------------------------------------------

export interface InterviewExportPayload {
  participant_id: string;
  study_id: string;
  interview_id: string;
  mode: string;
  started_at: string | null;
  ended_at: string | null;
  completed: boolean;
  audio_url: string | null;
  transcript: TranscriptTurnExport[];
  metadata: {
    exported_at: string;
    total_turns: number;
    version: string;
  };
}

export interface TranscriptTurnExport {
  turn_index: number;
  speaker: "interviewer" | "interviewee";
  text: string;
  timestamp_start: string | null;
  timestamp_end: string | null;
}

// ---- LLM types --------------------------------------------------------------

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateQuestionInput {
  history: TranscriptTurn[];
  systemPrompt: string;
  /** Stringified protocol context injected into system prompt */
  protocolContext: string;
  participantContext?: string;
}

export interface GenerateQuestionOutput {
  question: string;
  reasoning?: string;
}

// ---- Protocol types ---------------------------------------------------------
// See lib/config/protocol.ts for full protocol schema types
