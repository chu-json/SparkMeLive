// =============================================================================
// Interview Engine
//
// Orchestrates the interview loop:
//   1. Load conversation history
//   2. Assemble LLM context (system prompt + protocol + participant context)
//   3. Call generateNextQuestion()
//   4. Return the result
//
// This is the primary extension point for wiring in SparkMe planner/memory:
//   - After step 1, call updateMemory() from lib/prompts/memory.ts
//   - After memory update, call generateStrategicQuestions() from lib/prompts/planner.ts
//   - Inject both into buildInterviewerSystemPrompt() before step 3
// =============================================================================

import type { TranscriptTurn, GenerateQuestionOutput } from "@/lib/types";
import type { Protocol } from "@/lib/config/protocol";
import { protocolToOutline } from "@/lib/config/protocol";
import {
  buildInterviewerSystemPrompt,
  AVP_OPENING_MESSAGE,
} from "@/lib/prompts/interviewer";
import { generateNextQuestion } from "@/lib/llm/generateNextQuestion";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the opening question/message when an interview first starts.
 * Returns the AVP opening message — no LLM call needed for the greeting.
 */
export function getOpeningMessage(): string {
  return AVP_OPENING_MESSAGE;
}

/**
 * Generate the next interviewer question after a participant submits a response.
 *
 * @param history  - Full transcript history so far (all turns, ordered by turn_index)
 * @param protocol - The active interview protocol
 * @returns The generated question and optional reasoning
 */
export async function generateInterviewerResponse(
  history: TranscriptTurn[],
  protocol: Protocol
): Promise<GenerateQuestionOutput> {
  // Build protocol outline for injection into system prompt
  const protocolOutline = protocolToOutline(protocol);

  // -- SparkMe integration point --
  // When memory module is active:
  //   const { portrait, agenda } = await updateMemory(latestTurn, history, portrait, agenda)
  //   const participantContext = formatPortraitBlock(portrait)
  //   const sessionNotes = formatAgendaBlock(agenda)
  //
  // When planner module is active:
  //   const strategicQuestions = await generateStrategicQuestions(plannerState, history, protocol)
  //   const strategicBlock = formatStrategicQuestionsBlock(strategicQuestions)
  //   // inject strategicBlock into system prompt

  const systemPrompt = buildInterviewerSystemPrompt(
    protocolOutline,
    undefined, // participantContext — injected by memory module when available
    undefined  // sessionNotes — injected by agenda manager when available
  );

  return generateNextQuestion({
    history,
    systemPrompt,
    protocolContext: "", // protocol already embedded in systemPrompt above
  });
}

/**
 * Determine whether the interview should be considered complete.
 *
 * MVP heuristic: complete after MAX_TURNS turns or when the participant
 * explicitly says they want to stop.
 *
 * Future: the SparkMe exploration_planner can emit a COMPLETE signal
 * when all protocol topics reach sufficient coverage.
 */
export const MAX_TURNS = 60;

export function shouldCompleteInterview(
  history: TranscriptTurn[],
  latestResponse: string
): boolean {
  if (history.length >= MAX_TURNS * 2) return true; // *2 because each turn = 2 rows

  const endPhrases = [
    "i want to stop",
    "i'd like to stop",
    "end the interview",
    "i'm done",
    "that's all",
    "no more questions",
  ];

  const normalized = latestResponse.toLowerCase().trim();
  return endPhrases.some((phrase) => normalized.includes(phrase));
}
