// =============================================================================
// Exploration Planner Prompt — PLACEHOLDER
//
// In the full SparkMe system, the exploration_planner agent:
//   - Assigns utility scores to uncovered protocol topics/subtopics
//   - Runs a rollout simulation to predict the most valuable question sequences
//   - Produces a ranked list of "strategic questions" for the interviewer
//
// SparkMe reference: src/agents/exploration_planner/prompts.py
//
// Integration path:
//   1. Implement a PlannerState type that tracks coverage per protocol node
//   2. On each turn, call generateStrategicQuestions(state, history) here
//   3. Inject the result into buildInterviewerSystemPrompt() as a STRATEGIC_QUESTIONS block
//   4. The interviewer LLM will use these to prioritize its next question
//
// For MVP, this module exports a no-op that returns an empty strategic plan.
// The interviewer prompt handles coverage navigation on its own via the full
// protocol outline and conversation history.
// =============================================================================

import type { TranscriptTurn } from "@/lib/types";
import type { Protocol } from "@/lib/config/protocol";

export interface PlannerState {
  /** Coverage tracking per protocol probe id: 0 = not covered, 1-3 = coverage level */
  coverage: Record<string, number>;
  /** Emergent topics discovered outside the original protocol */
  emergentTopics: string[];
  /** Turn index at last planner update */
  lastUpdatedAt: number;
}

export interface StrategicQuestion {
  probe_id: string;
  question: string;
  priority: number;
  reasoning: string;
}

/**
 * PLACEHOLDER: Generate strategic questions for the interviewer.
 *
 * In the full SparkMe system, this would:
 *   - Evaluate coverage across the protocol tree
 *   - Run a utility-based rollout to find optimal next questions
 *   - Return ranked strategic questions the interviewer can act on
 *
 * Currently returns an empty array (no strategic guidance).
 * The interviewer navigates coverage using the full protocol outline instead.
 */
export async function generateStrategicQuestions(
  _state: PlannerState,
  _history: TranscriptTurn[],
  _protocol: Protocol
): Promise<StrategicQuestion[]> {
  // FUTURE: implement SparkMe-style utility scoring and rollout here
  return [];
}

/**
 * PLACEHOLDER: Initialize a fresh planner state for a new interview.
 */
export function initPlannerState(protocol: Protocol): PlannerState {
  const coverage: Record<string, number> = {};

  const visit = (probes: Protocol[number]["subquestions"]) => {
    for (const probe of probes) {
      coverage[probe.id] = 0;
      if (probe.children) {
        visit(probe.children as Protocol[number]["subquestions"]);
      }
    }
  };

  for (const topic of protocol) {
    visit(topic.subquestions);
  }

  return {
    coverage,
    emergentTopics: [],
    lastUpdatedAt: 0,
  };
}

/**
 * PLACEHOLDER: Render strategic questions as a string block for injection
 * into the interviewer system prompt. Returns empty string when no questions.
 */
export function formatStrategicQuestionsBlock(questions: StrategicQuestion[]): string {
  if (questions.length === 0) return "";

  const lines = [
    "# Strategic Questions (from Exploration Planner)\n",
    "The following questions have been prioritized based on coverage analysis:\n",
  ];

  for (const q of questions.slice(0, 5)) {
    lines.push(`[Priority ${q.priority}/10] ${q.question}`);
    lines.push(`  → ${q.reasoning}\n`);
  }

  return lines.join("\n");
}
