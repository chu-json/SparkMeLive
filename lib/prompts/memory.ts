// =============================================================================
// Memory / Agenda Manager Prompt — PLACEHOLDER
//
// In the full SparkMe system, the agenda_manager agent:
//   - Takes running notes on what the participant has shared
//   - Maintains a "user portrait" (structured summary of known facts)
//   - Evaluates coverage levels per subtopic after each turn
//   - Detects emergent insights that fall outside the original protocol
//   - Produces a LAST_MEETING_SUMMARY for resuming sessions across sittings
//
// SparkMe reference: src/agents/agenda_manager/prompts.py
//
// Integration path:
//   1. After each interviewee turn, call updateMemory(turn, currentMemory)
//   2. The updated memory is injected into buildInterviewerSystemPrompt()
//      as participantContext and sessionNotes
//   3. For multi-session interviews, persist MemoryState to the interviews table
//
// For MVP, this module provides types and a no-op implementation.
// The interviewer LLM maintains implicit context through the full history.
// =============================================================================

import type { TranscriptTurn } from "@/lib/types";

/** Running portrait of the participant built up during the interview */
export interface ParticipantPortrait {
  /** Key facts and themes identified so far */
  knownFacts: string[];
  /** Emergent themes or insights outside the original protocol */
  emergentInsights: string[];
  /** General notes about communication style or emotional tenor */
  notes: string;
  /** Turn index at last update */
  lastUpdatedAt: number;
}

/** Agenda / coverage notes per topic domain */
export interface AgendaState {
  /** topic id → brief notes on what was covered */
  topicNotes: Record<string, string>;
  /** probe ids that have been adequately covered */
  coveredProbes: string[];
  /** Summary suitable for session resumption */
  sessionSummary: string;
}

/**
 * PLACEHOLDER: Update the participant portrait after a new interviewee turn.
 *
 * In the full SparkMe system, this would call an LLM with the agenda_manager
 * prompt to extract new facts, update coverage, and detect emergent insights.
 *
 * Currently returns the existing portrait unchanged.
 */
export async function updateMemory(
  _newTurn: TranscriptTurn,
  _history: TranscriptTurn[],
  currentPortrait: ParticipantPortrait,
  currentAgenda: AgendaState
): Promise<{ portrait: ParticipantPortrait; agenda: AgendaState }> {
  // FUTURE: implement SparkMe-style agenda manager LLM call here
  return { portrait: currentPortrait, agenda: currentAgenda };
}

/** Initialize empty memory state for a new interview */
export function initMemoryState(): {
  portrait: ParticipantPortrait;
  agenda: AgendaState;
} {
  return {
    portrait: {
      knownFacts: [],
      emergentInsights: [],
      notes: "",
      lastUpdatedAt: 0,
    },
    agenda: {
      topicNotes: {},
      coveredProbes: [],
      sessionSummary: "",
    },
  };
}

/**
 * PLACEHOLDER: Format the participant portrait for injection into the
 * interviewer system prompt. Returns empty string when portrait is empty.
 */
export function formatPortraitBlock(portrait: ParticipantPortrait): string {
  if (portrait.knownFacts.length === 0 && portrait.emergentInsights.length === 0) {
    return "";
  }

  const lines = ["# What You Know About This Participant\n"];

  if (portrait.knownFacts.length > 0) {
    lines.push("**Known facts and themes:**");
    for (const fact of portrait.knownFacts) {
      lines.push(`- ${fact}`);
    }
    lines.push("");
  }

  if (portrait.emergentInsights.length > 0) {
    lines.push("**Emergent insights worth exploring further:**");
    for (const insight of portrait.emergentInsights) {
      lines.push(`- ${insight}`);
    }
    lines.push("");
  }

  if (portrait.notes) {
    lines.push(`**Notes:** ${portrait.notes}`);
  }

  return lines.join("\n");
}

/**
 * PLACEHOLDER: Format agenda/coverage notes for injection into the
 * interviewer system prompt. Returns empty string when agenda is empty.
 */
export function formatAgendaBlock(agenda: AgendaState): string {
  if (agenda.coveredProbes.length === 0 && !agenda.sessionSummary) {
    return "";
  }

  const lines = ["# Session Coverage\n"];

  if (agenda.sessionSummary) {
    lines.push(agenda.sessionSummary);
    lines.push("");
  }

  if (agenda.coveredProbes.length > 0) {
    lines.push(`**Covered probes:** ${agenda.coveredProbes.join(", ")}`);
  }

  return lines.join("\n");
}
