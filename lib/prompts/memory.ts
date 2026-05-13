// =============================================================================
// Agenda Manager — Memory Module
//
// Implements the SparkMe agenda_manager agent in TypeScript.
// After each interviewee turn, two LLM calls run in parallel:
//
//   1. updateCoverage  — reviews the latest exchange against the protocol,
//      updates per-probe notes, and marks probes as covered when sufficient.
//      Adapted from: agenda_manager/prompts.py (update_subtopic_notes +
//      update_subtopic_coverage)
//
//   2. updatePortrait  — extracts new facts and themes from the latest
//      answer and merges them into the running participant portrait.
//      Adapted from: agenda_manager/prompts.py (update_user_portrait)
//
//   The two results are combined into an updated AgentState. A session
//   summary is refreshed every SUMMARY_INTERVAL turns.
//
// SparkMe reference: src/agents/agenda_manager/prompts.py
// =============================================================================

import type { TranscriptTurn, AgentState, SubtopicState, UserPortrait } from "@/lib/types";
import type { Protocol } from "@/lib/config/protocol";
import { callLLM } from "@/lib/llm/generateNextQuestion";

// Refresh the session summary every N interviewee turns
const SUMMARY_INTERVAL = 5;

// =============================================================================
// Public API
// =============================================================================

/**
 * Run the Agenda Manager after a new interviewee turn.
 * Updates per-probe coverage notes, portrait, and (periodically) session summary.
 *
 * @param latestQuestion  The interviewer's last question
 * @param latestAnswer    The interviewee's new response
 * @param history         Full transcript history up to and including the new turn
 * @param protocol        The active interview protocol
 * @param currentState    Current AgentState to update
 * @returns               Updated AgentState (never throws; falls back to current state on error)
 */
export async function updateMemoryState(
  latestQuestion: string,
  latestAnswer: string,
  history: TranscriptTurn[],
  protocol: Protocol,
  currentState: AgentState
): Promise<AgentState> {
  const currentTurn = currentState.lastUpdatedTurn + 1;

  // Run coverage and portrait updates in parallel
  const [coverageResult, portraitResult] = await Promise.allSettled([
    updateCoverage(latestQuestion, latestAnswer, history, protocol, currentState.coverage),
    updatePortrait(latestAnswer, history, currentState.portrait),
  ]);

  const updatedCoverage =
    coverageResult.status === "fulfilled" ? coverageResult.value : currentState.coverage;

  const updatedPortrait =
    portraitResult.status === "fulfilled" ? portraitResult.value : currentState.portrait;

  // Refresh session summary periodically
  let sessionSummary = currentState.sessionSummary;
  if (currentTurn % SUMMARY_INTERVAL === 0) {
    try {
      sessionSummary = await generateSessionSummary(history, updatedPortrait, protocol);
    } catch {
      // keep the old summary on failure
    }
  }

  return {
    ...currentState,
    coverage: updatedCoverage,
    portrait: updatedPortrait,
    sessionSummary,
    lastUpdatedTurn: currentTurn,
  };
}

/**
 * Initialise a blank AgentState for a new interview session.
 * Seeds coverage entries for every sub1 and sub2 probe in the protocol.
 */
export function initAgentState(protocol: Protocol): AgentState {
  const coverage: Record<string, SubtopicState> = {};

  for (const topic of protocol) {
    for (const probe of topic.subquestions) {
      coverage[probe.id] = { notes: [], isCovered: false, aggregatedNotes: "" };
      if (probe.children) {
        for (const child of probe.children) {
          coverage[child.id] = { notes: [], isCovered: false, aggregatedNotes: "" };
          // sub3 probes tracked via their parent sub2 — no separate entry needed
        }
      }
    }
  }

  return {
    portrait: {},
    coverage,
    sessionSummary: "",
    strategicQuestions: [],
    lastUpdatedTurn: 0,
  };
}

// =============================================================================
// Coverage update (agenda_manager: update_subtopic_notes + update_subtopic_coverage)
// =============================================================================

interface CoverageUpdateItem {
  id: string;
  new_notes: string[];
  is_covered: boolean;
  aggregated_notes: string;
}

async function updateCoverage(
  latestQuestion: string,
  latestAnswer: string,
  history: TranscriptTurn[],
  protocol: Protocol,
  currentCoverage: Record<string, SubtopicState>
): Promise<Record<string, SubtopicState>> {
  const topicsList = formatTopicsForAgent(protocol, currentCoverage);
  const recentHistory = formatRecentHistory(history, 6);

  const systemPrompt = `You are an agenda manager assisting a life-story interviewer. Your job is to:
1. Review the latest interviewer question and participant response.
2. Update per-probe notes for any protocol probe that was touched in the exchange.
3. Mark a probe as fully covered when the participant has given sufficient depth.

Coverage standard for life-story interviews:
- Score 1 (Partial): Participant named the experience but gave minimal detail.
- Score 2 (Good): Basic facts shared (what, when, who) — some emotional/reflective content.
- Score 3 (Full): Rich narrative with emotional context, meaning-making, and personal reflection.
Mark a probe as covered (is_covered: true) when it reaches Score 3 or when notes are already comprehensive.

Only call tool for probes that were actually discussed in this exchange.
Do NOT invent information not present in the response.`;

  const userPrompt = `## Protocol Probes
${topicsList}

## Recent Conversation Context
${recentHistory}

## Current Exchange to Process
Interviewer: ${latestQuestion}
Participant: ${latestAnswer}

## Task
Return a JSON object with exactly this structure:
{
  "subtopic_updates": [
    {
      "id": "<probe_id from list above>",
      "new_notes": ["<concise note 1>", "<concise note 2>"],
      "is_covered": false,
      "aggregated_notes": ""
    }
  ]
}

Rules:
- Only include probes discussed in the current exchange.
- new_notes should be 1-3 concise factual sentences per probe.
- Set is_covered to true and write aggregated_notes when the probe is fully explored.
- Return valid JSON only, no other text.`;

  const raw = await callLLM(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    800,
    0.2
  );

  const parsed = safeParseJSON<{ subtopic_updates?: CoverageUpdateItem[] }>(raw, {});
  const updates = parsed.subtopic_updates ?? [];

  const updated = { ...currentCoverage };
  for (const u of updates) {
    if (!u.id || !(u.id in updated)) continue;
    const existing = updated[u.id];
    const mergedNotes = [...existing.notes, ...(u.new_notes ?? [])];
    updated[u.id] = {
      notes: mergedNotes,
      isCovered: u.is_covered ?? existing.isCovered,
      aggregatedNotes: u.aggregated_notes || existing.aggregatedNotes,
    };
  }

  return updated;
}

// =============================================================================
// Portrait update (agenda_manager: update_user_portrait)
// =============================================================================

async function updatePortrait(
  latestAnswer: string,
  history: TranscriptTurn[],
  currentPortrait: UserPortrait
): Promise<UserPortrait> {
  const currentPortraitStr =
    Object.keys(currentPortrait).length > 0
      ? JSON.stringify(currentPortrait, null, 2)
      : "{}  (portrait is empty — populate from the response below)";

  const recentHistory = formatRecentHistory(history, 4);

  const systemPrompt = `You are an agenda manager for a life-story interview. You maintain a structured participant portrait to help the interviewer recall context and ask relevant follow-up questions.

The portrait is a JSON dictionary where each key is a meaningful dimension of the participant's life story (e.g. "background", "key_themes", "important_relationships", "values", "significant_events").

Your goals:
- Update existing keys if the new response changes or deepens understanding.
- Add new keys only if the response reveals a fundamental new dimension.
- Do not invent details not present in the response.
- Keep values concise (1-3 sentences each).
- Output only valid JSON — no other text.`;

  const userPrompt = `## Current Portrait
${currentPortraitStr}

## Recent Conversation Context
${recentHistory}

## Latest Participant Response
${latestAnswer}

Update the portrait based on the latest response. Output the complete updated portrait as a JSON object only.`;

  const raw = await callLLM(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    600,
    0.2
  );

  const parsed = safeParseJSON<UserPortrait>(raw, currentPortrait);
  // Ensure all values are strings (guard against nested objects)
  const cleaned: UserPortrait = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === "string") {
      cleaned[k] = v;
    } else if (v !== null && v !== undefined) {
      cleaned[k] = String(v);
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : currentPortrait;
}

// =============================================================================
// Session summary (agenda_manager: update_last_meeting_summary)
// =============================================================================

async function generateSessionSummary(
  history: TranscriptTurn[],
  portrait: UserPortrait,
  protocol: Protocol
): Promise<string> {
  const fullHistory = formatRecentHistory(history, 20);
  const portraitStr = JSON.stringify(portrait, null, 2);
  const topicNames = protocol.map((t, i) => `${i + 1}. ${t.topic}`).join("\n");

  const systemPrompt = `You are an agenda manager for a life-story interview. Produce a concise session summary (3-5 sentences) that:
- Highlights the main life experiences and themes the participant has shared.
- Notes which interview domains have been explored and which are still pending.
- Captures any particularly significant or emotionally resonant content.
- Will help the interviewer quickly orient themselves if continuing in a new session.

Write neutral, professional prose. Output only the summary — no headings, no bullet points.`;

  const userPrompt = `## Interview Domains
${topicNames}

## Participant Portrait
${portraitStr}

## Conversation So Far
${fullHistory}

Write the session summary now.`;

  return callLLM(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    300,
    0.3
  );
}

// =============================================================================
// Formatting helpers
// =============================================================================

/**
 * Format the protocol with current coverage status for injection into
 * agent prompts as the "topics_list" block.
 */
export function formatTopicsForAgent(
  protocol: Protocol,
  coverage: Record<string, SubtopicState>
): string {
  const lines: string[] = [];

  for (const topic of protocol) {
    lines.push(`\n## ${topic.topic}`);

    for (const probe of topic.subquestions) {
      const state = coverage[probe.id];
      const statusTag = state?.isCovered
        ? "[COVERED]"
        : state?.notes?.length
        ? "[PARTIAL]"
        : "[NOT COVERED]";

      lines.push(`  [${probe.id}] (sub1) ${statusTag}`);
      lines.push(`  Question: ${probe.text}`);

      if (state?.notes?.length) {
        lines.push(`  Notes: ${state.notes.slice(-2).join(" | ")}`);
      }
      if (state?.isCovered && state.aggregatedNotes) {
        lines.push(`  Summary: ${state.aggregatedNotes}`);
      }

      if (probe.children) {
        for (const child of probe.children) {
          const childState = coverage[child.id];
          const childTag = childState?.isCovered
            ? "[COVERED]"
            : childState?.notes?.length
            ? "[PARTIAL]"
            : "[NOT COVERED]";
          lines.push(`    [${child.id}] (sub2) ${childTag} — ${child.text}`);
          if (childState?.notes?.length) {
            lines.push(`    Notes: ${childState.notes.slice(-1).join(" | ")}`);
          }
        }
      }
    }
  }

  return lines.join("\n");
}

/**
 * Format the most recent N turns of history as readable Q&A for agent context.
 */
export function formatRecentHistory(history: TranscriptTurn[], maxTurns: number): string {
  const recent = history.slice(-maxTurns);
  if (recent.length === 0) return "(no conversation history yet)";

  return recent
    .map((t) => {
      const speaker = t.speaker === "interviewer" ? "Interviewer" : "Participant";
      return `${speaker}: ${t.text}`;
    })
    .join("\n\n");
}

// =============================================================================
// Utility
// =============================================================================

function safeParseJSON<T>(raw: string, fallback: T): T {
  try {
    // Strip markdown code fences if the LLM wrapped the JSON
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    // Try to extract a JSON object from mixed text
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
