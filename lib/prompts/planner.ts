// =============================================================================
// Exploration Planner — Strategic Question Generator
//
// Implements the SparkMe exploration_planner agent in TypeScript.
// Runs once per turn after the Agenda Manager update.
//
// The planner uses a utility function to rank candidate questions:
//   U = α·Coverage  −  β·Cost  +  γ·Emergence
//
//   α = 3.0  (coverage weight  — filling gaps is the primary objective)
//   β = 0.5  (cost penalty     — prefer efficient, low-follow-up questions)
//   γ = 2.0  (emergence bonus  — reward questions likely to surface novel insights)
//
// These weights were chosen for the AVP life-story context where narrative
// breadth and depth are both important, but unexpected personal insight
// ("emergence") is highly valuable.
//
// Note: SparkMe's full pipeline also runs draft_rollouts (predicting N
// conversation trajectories) before this step. That adds another LLM call
// per turn. For the MVP, we skip rollouts and use direct utility scoring —
// strategic questions are still priority-ranked by U but without trajectory
// simulation. Rollouts can be added in a future phase.
//
// SparkMe reference: src/agents/exploration_planner/prompts.py
// =============================================================================

import type { TranscriptTurn, AgentState, StrategicQuestion } from "@/lib/types";
import type { Protocol } from "@/lib/config/protocol";
import { callLLM } from "@/lib/llm/generateNextQuestion";
import { formatTopicsForAgent, formatRecentHistory } from "@/lib/prompts/memory";

// Utility function weights
const ALPHA = 3.0; // coverage importance
const BETA  = 0.5; // cost penalty
const GAMMA = 2.0; // emergence bonus

// Number of strategic questions the planner produces per turn
const MAX_QUESTIONS = 5;

// =============================================================================
// Public API
// =============================================================================

/**
 * Generate strategic questions for the interviewer using the Exploration Planner.
 *
 * @param history     Full transcript history (used for recent context)
 * @param protocol    The active interview protocol
 * @param agentState  Current AgentState (portrait + coverage from Agenda Manager)
 * @returns           Priority-ranked StrategicQuestion[] — empty array on failure
 */
export async function generateStrategicQuestions(
  history: TranscriptTurn[],
  protocol: Protocol,
  agentState: AgentState
): Promise<StrategicQuestion[]> {
  try {
    return await runPlannerCall(history, protocol, agentState);
  } catch (err) {
    console.warn("[planner] generateStrategicQuestions failed, returning empty:", err);
    return [];
  }
}

// =============================================================================
// Planner LLM call
// =============================================================================

interface RawStrategicQuestion {
  content?: string;
  probe_id?: string;
  strategy_type?: string;
  priority?: number;
  reasoning?: string;
}

async function runPlannerCall(
  history: TranscriptTurn[],
  protocol: Protocol,
  agentState: AgentState
): Promise<StrategicQuestion[]> {
  const topicsList = formatTopicsForAgent(protocol, agentState.coverage);
  const recentHistory = formatRecentHistory(history, 8);
  const portraitStr =
    Object.keys(agentState.portrait).length > 0
      ? JSON.stringify(agentState.portrait, null, 2)
      : "(portrait not yet populated)";

  const systemPrompt = `You are a strategic question planner for a semi-structured life-story interview (AVP — Autobiographical Verbal Protocol).

Your role is to generate ${MAX_QUESTIONS} high-value interviewer questions that maximize:
  U = α·Coverage  −  β·Cost  +  γ·Emergence
  α = ${ALPHA}  (filling uncovered protocol probes — primary goal)
  β = ${BETA}   (prefer questions needing few follow-ups)
  γ = ${GAMMA}  (reward questions likely to surface unexpected insights)

Priority scale (1–10):
  9–10: Critical gap + high emergence potential + efficient
  7–8:  Important coverage OR high emergence + moderate cost
  5–6:  Standard coverage question with moderate utility
  3–4:  Minor improvement or high-cost question
  1–2:  Low utility — avoid unless no better options

Privacy: Never suggest questions asking for names, exact age, specific addresses, contact info, or other PII.
Focus entirely on experiences, emotions, memories, values, relationships, and meaning.`;

  const userPrompt = `## Participant Portrait
${portraitStr}

## Protocol Probes with Coverage Status
${topicsList}

## Recent Conversation
${recentHistory}

## Task
Generate exactly ${MAX_QUESTIONS} strategic questions for the interviewer to consider next.
Prioritize probes marked [NOT COVERED] or [PARTIAL] with the highest utility scores.
Also watch for emergent insights in the recent conversation that deserve follow-up.

Return a JSON object with exactly this structure:
{
  "strategic_questions": [
    {
      "content": "The interviewer question (open-ended, conversational)",
      "probe_id": "<probe_id from the topics list above>",
      "strategy_type": "coverage_gap",
      "priority": 9,
      "reasoning": "Why this is valuable given the utility function and current coverage"
    }
  ]
}

Rules:
- strategy_type must be "coverage_gap" or "emergent_insight"
- priority must be an integer 1–10
- Questions must be open-ended and life-story appropriate (not yes/no, not PII)
- Return valid JSON only, no other text.`;

  const raw = await callLLM(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    1000,
    0.4
  );

  const parsed = safeParseJSON<{ strategic_questions?: RawStrategicQuestion[] }>(raw, {});
  const rawQuestions = parsed.strategic_questions ?? [];

  // Validate and normalise
  const questions: StrategicQuestion[] = rawQuestions
    .filter((q): q is Required<RawStrategicQuestion> => !!(q.content && q.probe_id))
    .map((q) => ({
      content: q.content,
      probe_id: q.probe_id,
      strategy_type:
        (q.strategy_type === "emergent_insight" ? "emergent_insight" : "coverage_gap") as
          StrategicQuestion["strategy_type"],
      priority: Math.max(1, Math.min(10, Math.round(q.priority ?? 5))),
      reasoning: q.reasoning ?? "",
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_QUESTIONS);

  return questions;
}

// =============================================================================
// Utility
// =============================================================================

function safeParseJSON<T>(raw: string, fallback: T): T {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        // fall through
      }
    }
    return fallback;
  }
}
