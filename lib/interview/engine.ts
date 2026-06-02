// =============================================================================
// Interview Engine — SparkMe Agents (latency-optimized split)
//
// The SparkMe agents are split across two phases so the participant only ever
// waits for ONE LLM call:
//
//   CRITICAL PATH (blocks the reply) — generateInterviewerQuestion():
//     3. Interviewer  (lib/prompts/interviewer.ts + generateNextQuestion.ts)
//        Single LLM call on the high-quality model to produce the next question,
//        using the AgentState computed by the PREVIOUS turn's analysis.
//
//   BACKGROUND (after the reply, via /api/interview/analyze) —
//   computeUpdatedAgentState():
//     1. Agenda Manager  (lib/prompts/memory.ts) — coverage notes + portrait
//        + periodic session summary (2 parallel LLM calls).
//     2. Exploration Planner (lib/prompts/planner.ts) — priority-ranked
//        strategic questions (U = α·Coverage − β·Cost + γ·Emergence).
//     These run on the faster OPENAI_AGENT_MODEL and feed the NEXT turn.
//
// Critical-path LLM calls per turn: 1  (down from 3).
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
 * Generate the next interviewer question — the ONLY LLM call on the user's
 * critical path (kept on the higher-quality OPENAI_MODEL, e.g. gpt-4.1).
 *
 * It uses the AgentState produced by the previous turn's background analysis
 * (computeUpdatedAgentState). The interviewer always sees the full raw history
 * directly, so the latest answer is never missing — only the derived coverage /
 * portrait / strategic-questions lag by one turn, which is an acceptable
 * trade-off for removing 2–3 sequential LLM round-trips from the response time.
 *
 * @param history       Full transcript history up to and including latestAnswer
 * @param protocol      The active interview protocol
 * @param currentState  AgentState from interviews.agent_state (previous turn)
 */
export async function generateInterviewerQuestion(
  history: TranscriptTurn[],
  protocol: Protocol,
  currentState: AgentState
): Promise<GenerateQuestionOutput> {
  const systemPrompt = buildInterviewerSystemPrompt(protocol, currentState);

  return generateNextQuestion({
    history,
    systemPrompt,
    protocolContext: "", // already embedded in systemPrompt via buildInterviewerSystemPrompt
  });
}

/**
 * Run the SparkMe analysis agents (Agenda Manager + Exploration Planner) and
 * return the updated AgentState. This is intentionally OFF the critical path —
 * it is invoked by /api/interview/analyze after the interviewer has already
 * replied, so its latency (and the faster OPENAI_AGENT_MODEL it uses) never
 * makes the participant wait. The result is persisted and consumed by the
 * NEXT turn's generateInterviewerQuestion call.
 *
 * @param latestQuestion  The interviewer question that prompted latestAnswer
 * @param latestAnswer    The interviewee's latest response
 * @param history         Transcript history up to and including latestAnswer
 * @param protocol        The active interview protocol
 * @param currentState    Current AgentState to update
 * @returns               The fully updated AgentState
 */
export async function computeUpdatedAgentState(
  latestQuestion: string,
  latestAnswer: string,
  history: TranscriptTurn[],
  protocol: Protocol,
  currentState: AgentState
): Promise<AgentState> {
  // ── Agenda Manager: coverage notes + participant portrait (parallel) ────────
  const stateAfterMemory = await updateMemoryState(
    latestQuestion,
    latestAnswer,
    history,
    protocol,
    currentState
  );

  // ── Exploration Planner: priority-ranked strategic questions ────────────────
  const strategicQuestions = await generateStrategicQuestions(
    history,
    protocol,
    stateAfterMemory
  );

  return {
    ...stateAfterMemory,
    strategicQuestions,
  };
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
