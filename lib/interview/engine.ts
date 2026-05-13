// =============================================================================
// Interview Engine — SparkMe 3-Agent Pipeline
//
// Orchestrates three agents per turn, mirroring SparkMe's architecture:
//
//   1. Agenda Manager  (lib/prompts/memory.ts)
//      - Updates per-probe coverage notes after the latest interviewee turn
//      - Updates the participant portrait with new facts and insights
//      - Refreshes session summary every SUMMARY_INTERVAL turns
//
//   2. Exploration Planner  (lib/prompts/planner.ts)
//      - Evaluates coverage gaps and emergence potential
//      - Returns priority-ranked strategic questions (U = α·Coverage − β·Cost + γ·Emergence)
//
//   3. Interviewer  (lib/prompts/interviewer.ts + lib/llm/generateNextQuestion.ts)
//      - Assembles the full SparkMe INTERVIEW_PROMPT with all agent outputs
//      - Runs the main LLM call to produce the next conversational question
//
// Total LLM calls per turn: 3  (2 parallel agent calls + 1 interviewer call)
// =============================================================================

import type { TranscriptTurn, GenerateQuestionOutput, AgentState } from "@/lib/types";
import type { Protocol } from "@/lib/config/protocol";
import { buildInterviewerSystemPrompt, AVP_OPENING_MESSAGE } from "@/lib/prompts/interviewer";
import { updateMemoryState, initAgentState } from "@/lib/prompts/memory";
import { generateStrategicQuestions } from "@/lib/prompts/planner";
import { generateNextQuestion } from "@/lib/llm/generateNextQuestion";

// =============================================================================
// Public API
// =============================================================================

/**
 * Return the fixed opening message for a new interview session.
 * No LLM call needed — the greeting is deterministic.
 */
export function getOpeningMessage(): string {
  return AVP_OPENING_MESSAGE;
}

/**
 * Run the full SparkMe 3-agent pipeline for one interviewer turn.
 *
 * Pipeline:
 *   1. Agenda Manager updates coverage + portrait (2 parallel LLM calls inside)
 *   2. Exploration Planner generates strategic questions (1 LLM call)
 *   3. Interviewer assembles full prompt + calls LLM for the next question (1 LLM call)
 *
 * @param latestQuestion  The interviewer's last question (just sent)
 * @param latestAnswer    The interviewee's latest response
 * @param history         Full transcript history up to and including latestAnswer
 * @param protocol        The active interview protocol
 * @param currentState    Current AgentState (from interviews.agent_state)
 * @returns               The generated question and the fully updated AgentState
 */
export async function generateInterviewerResponse(
  latestQuestion: string,
  latestAnswer: string,
  history: TranscriptTurn[],
  protocol: Protocol,
  currentState: AgentState
): Promise<{ output: GenerateQuestionOutput; updatedState: AgentState }> {
  // ── Step 1: Agenda Manager ──────────────────────────────────────────────────
  // Updates coverage notes + participant portrait in parallel.
  // Falls back to currentState on any failure.
  const stateAfterMemory = await updateMemoryState(
    latestQuestion,
    latestAnswer,
    history,
    protocol,
    currentState
  );

  // ── Step 2: Exploration Planner ─────────────────────────────────────────────
  // Generates priority-ranked strategic questions.
  // Returns empty array on failure (interviewer handles the fallback).
  const strategicQuestions = await generateStrategicQuestions(
    history,
    protocol,
    stateAfterMemory
  );

  const updatedState: AgentState = {
    ...stateAfterMemory,
    strategicQuestions,
  };

  // ── Step 3: Interviewer ─────────────────────────────────────────────────────
  // Assemble the full SparkMe INTERVIEW_PROMPT and call the LLM.
  const systemPrompt = buildInterviewerSystemPrompt(protocol, updatedState);

  const output = await generateNextQuestion({
    history,
    systemPrompt,
    protocolContext: "", // already embedded in systemPrompt via buildInterviewerSystemPrompt
  });

  return { output, updatedState };
}

/**
 * Re-export initAgentState so the turn route can initialise state
 * without importing directly from memory.ts.
 */
export { initAgentState };

// =============================================================================
// Completion heuristic
// =============================================================================

/**
 * Determine whether the interview should be considered complete.
 *
 * Heuristics (in order):
 *   1. Participant explicitly requests to stop
 *   2. Maximum turn count reached
 *
 * Future: the Exploration Planner could emit a completion signal when
 * all protocol topics reach sufficient coverage (isCovered = true).
 */
export const MAX_TURNS = 60;

export function shouldCompleteInterview(
  history: TranscriptTurn[],
  latestResponse: string,
  agentState?: AgentState
): boolean {
  // Check explicit stop phrases
  const stopPhrases = [
    "i want to stop",
    "i'd like to stop",
    "end the interview",
    "i'm done",
    "that's all",
    "no more questions",
  ];
  const normalized = latestResponse.toLowerCase().trim();
  if (stopPhrases.some((phrase) => normalized.includes(phrase))) return true;

  // Hard turn cap
  if (history.length >= MAX_TURNS * 2) return true;

  // Optional: all sub1 probes covered
  if (agentState) {
    const sub1Probes = Object.entries(agentState.coverage).filter(([id]) =>
      // sub1 ids don't contain nested underscores beyond the base pattern
      !id.includes("_1_") && !id.match(/_\d+_\d+/)
    );
    if (sub1Probes.length > 0 && sub1Probes.every(([, state]) => state.isCovered)) {
      return true;
    }
  }

  return false;
}
