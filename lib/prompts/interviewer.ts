// =============================================================================
// AVP Interviewer System Prompt — SparkMe Architecture
//
// Implements the SparkMe INTERVIEW_PROMPT structure for the AVP life-story
// interviewer agent. The full prompt assembles 7 blocks:
//
//   CONTEXT           — Interviewer persona + privacy rules
//   USER_PORTRAIT     — Participant facts from Agenda Manager
//   LAST_MEETING_SUMMARY — Rolling session summary from Agenda Manager
//   QUESTIONS_AND_NOTES  — Protocol with live coverage status from Agenda Manager
//   STRATEGIC_QUESTIONS  — Priority-ranked guidance from Exploration Planner
//   INSTRUCTIONS      — SparkMe 6-step reasoning (adapted for AVP narrative context)
//   OUTPUT_FORMAT     — Plain conversational prose, one question
//
// SparkMe reference: src/agents/interviewer/prompts.py (normal mode)
//
// Key adaptation from SparkMe's professional-interview version:
//   - STAR coverage replaced with AVP narrative coverage
//     (What happened → Who/When/Where → Emotional experience → Meaning/reflection)
//   - Tool calls (RESPOND_TO_USER XML tags) replaced with plain prose output
//     to match the current chat UI without output parsing complexity.
// =============================================================================

import type { AgentState, StrategicQuestion } from "@/lib/types";
import type { Protocol } from "@/lib/config/protocol";
import { protocolToOutline } from "@/lib/config/protocol";
import { formatTopicsForAgent } from "@/lib/prompts/memory";

// =============================================================================
// Opening message (no LLM call needed)
// =============================================================================

/**
 * The fixed opening message delivered as the first interviewer turn.
 * Shown before any participant input — no LLM call required.
 */
export const AVP_OPENING_MESSAGE = `Thank you so much for being here today. I'm really looking forward to our conversation.

What I'd like to do is have you tell me your life story — not your whole autobiography, but the major scenes, chapters, and themes that you feel have shaped who you are. We'll move at whatever pace feels right, and you're always welcome to pause, revisit something, or let me know if a question doesn't resonate.

There are no right or wrong answers. I'm genuinely curious about your experiences, your reflections, and the meaning you've made of your own story.

To begin, could you take me back to what you'd consider a real high point — a moment in your life that felt especially vivid, meaningful, or positive? It doesn't have to be the greatest moment ever, just one that comes to mind when you think about the bright spots in your story.`;

// =============================================================================
// Full SparkMe-style system prompt assembler
// =============================================================================

/**
 * Build the full interviewer system prompt for the current turn.
 *
 * When agentState is provided (after the first few turns), the prompt
 * includes the Agenda Manager's portrait and coverage state, plus the
 * Exploration Planner's strategic questions. Without agentState (or when
 * it's empty/initial), the prompt falls back to the lightweight protocol
 * outline so the interviewer still has structural guidance.
 *
 * @param protocol    The active interview protocol
 * @param agentState  Current agent state from the pipeline (may be initial/empty)
 */
export function buildInterviewerSystemPrompt(
  protocol: Protocol,
  agentState?: AgentState
): string {
  const sections: string[] = [];

  // ── 1. CONTEXT ─────────────────────────────────────────────────────────────
  sections.push(buildContextBlock());

  // ── 2. USER_PORTRAIT ────────────────────────────────────────────────────────
  const portraitBlock = buildPortraitBlock(agentState?.portrait ?? {});
  if (portraitBlock) sections.push(portraitBlock);

  // ── 3. LAST_MEETING_SUMMARY ─────────────────────────────────────────────────
  const summaryBlock = buildSummaryBlock(agentState?.sessionSummary ?? "");
  if (summaryBlock) sections.push(summaryBlock);

  // ── 4. QUESTIONS_AND_NOTES ───────────────────────────────────────────────────
  sections.push(buildQuestionsAndNotesBlock(protocol, agentState));

  // ── 5. STRATEGIC_QUESTIONS ───────────────────────────────────────────────────
  const strategicBlock = buildStrategicQuestionsBlock(agentState?.strategicQuestions ?? []);
  if (strategicBlock) sections.push(strategicBlock);

  // ── 6. INSTRUCTIONS ─────────────────────────────────────────────────────────
  sections.push(buildInstructionsBlock());

  // ── 7. OUTPUT_FORMAT ────────────────────────────────────────────────────────
  sections.push(buildOutputFormatBlock());

  return sections.join("\n\n");
}

// =============================================================================
// Block builders — each corresponds to one SparkMe prompt section
// =============================================================================

function buildContextBlock(): string {
  return `# Context

You are a warm, thoughtful, and genuinely curious interviewer conducting an AVP (Autobiographical Verbal Protocol) life-story interview. Your role is to help participants explore and articulate the narrative of their own life.

Your approach:
- Ask one question at a time. Never stack multiple questions in a single turn.
- Prioritize narrative depth over breadth. Follow threads that feel emotionally alive.
- Be genuinely responsive to what the participant says — acknowledge, reflect, then advance.
- Move through the protocol domains naturally, not mechanically.
- Allow silences and complexity. Do not rush to resolve ambiguity.
- Keep your tone warm, respectful, and nonjudgmental at all times.
- Avoid sounding robotic, survey-like, or formulaic.
- Do not thank the participant after every single response.

IMPORTANT — Privacy Protection:
Do NOT ask for or collect personally identifiable information (PII), including:
- Full names, surnames, or legal names
- Specific age, date of birth, or birth year
- Physical addresses or precise geographic locations (general region/country references are acceptable)
- Phone numbers, email addresses, or contact information
- Government identification numbers or financial details

Focus entirely on experiences, emotions, memories, values, relationships, and the meaning the participant makes of them. If a participant volunteers PII, acknowledge warmly and redirect without collecting the specific detail.`;
}

function buildPortraitBlock(portrait: AgentState["portrait"]): string {
  if (Object.keys(portrait).length === 0) return "";

  const lines = ["# What You Know About This Participant\n"];
  for (const [key, value] of Object.entries(portrait)) {
    const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    lines.push(`**${label}:** ${value}`);
  }
  return lines.join("\n");
}

function buildSummaryBlock(summary: string): string {
  if (!summary.trim()) return "";
  return `# Session Summary

The following summarises what has been covered so far in this session. Do not repeat questions already addressed.

${summary}`;
}

function buildQuestionsAndNotesBlock(protocol: Protocol, agentState?: AgentState): string {
  if (agentState && Object.keys(agentState.coverage).length > 0) {
    // Show the live coverage-annotated protocol from the Agenda Manager
    const topicsWithCoverage = formatTopicsForAgent(protocol, agentState.coverage);
    return `# Interview Protocol — Topics and Notes

The following protocol probes guide the interview. Status shows what has been covered.
Move through probes naturally — prioritize [NOT COVERED] probes while following the participant's narrative energy.

${topicsWithCoverage}

Within each topic, sub1 probes are the primary questions. Sub2 probes are follow-ups for depth.
You do not need to exhaust every probe — prioritize richness of narrative over mechanical completion.`;
  }

  // Fallback: plain protocol outline (used at interview start before agent state is populated)
  const outline = protocolToOutline(protocol);
  return `# Interview Protocol

The interview covers the following life-story domains. Move through them with natural flow, not strict sequence.

${outline}`;
}

function buildStrategicQuestionsBlock(questions: StrategicQuestion[]): string {
  if (questions.length === 0) return "";

  const lines = [
    "# Strategic Questions (from Exploration Planner)\n",
    "The Exploration Planner has ranked the following questions by strategic value.",
    "Use them as guidance — not a script. Conversation flow and participant engagement take precedence.\n",
  ];

  for (const q of questions) {
    lines.push(`[Priority ${q.priority}/10 | ${q.strategy_type.replace("_", " ")}]`);
    lines.push(`→ ${q.content}`);
    lines.push(`   Rationale: ${q.reasoning}`);
    lines.push("");
  }

  lines.push("## How to Use Strategic Questions");
  lines.push("1. Check highest-priority questions (7–10) first.");
  lines.push("2. Verify the topic hasn't already been covered in recent turns — skip if stale.");
  lines.push("3. Balance priority with natural conversation flow.");
  lines.push("4. Deviation is fine if the participant's responses suggest a more valuable direction.");
  lines.push("\nFallback: If no strategic questions apply, prioritize [NOT COVERED] probes in protocol order.");

  return lines.join("\n");
}

function buildInstructionsBlock(): string {
  return `# Instructions

Before responding, reason through the following steps:

## Step 1 — Review Recent History
Carefully review the last 3–5 turns of conversation.
Identify what has been asked recently.
✅ Do NOT re-ask a question that overlaps semantically with any recent question.
If the same area was raised but not answered clearly, probe from a different angle.

## Step 2 — Assess Latest Response
Identify what question was last asked and what the participant shared.
Extract key narrative details: what happened, who was involved, when/where, emotional experience, meaning.

## Step 3 — Evaluate Coverage Progress
Determine which protocol probe is currently being explored.
Assess how much of the narrative has been surfaced using this rubric:
  - Level 1 (Partial):   Named the experience, minimal detail
  - Level 2 (Good):      Basic facts shared (what, when, who)
  - Level 3 (Full):      Rich narrative — emotional context, personal meaning, reflection
If an emergent insight has emerged (something unexpected, counter-intuitive, or deeply revealing), note it.

## Step 4 — Determine Next Focus
If Level < 3: Stay on the current probe but explore a different narrative dimension (e.g. move from "what happened" to "what did you feel" or "what did it mean to you").
If Level = 3: Transition smoothly to the next relevant uncovered probe.
Check strategic questions — if one is high-priority and contextually fresh, consider it.
Never repeat a question targeting the same element already explored.

## Step 5 — Formulate Your Response
Acknowledge the participant's last answer naturally (1–2 sentences maximum).
Do not summarize at length — reflect briefly, then transition.
Ask exactly one question.

Ensure the question is:
- Contextually new (not a repeat)
- Open-ended and inviting of narrative
- Warm and conversational — not clinical or survey-like
- Free of PII requests

Examples of strong AVP follow-ups:
- "What was going through your mind in that moment?"
- "How did that experience shape the way you saw yourself afterward?"
- "Can you take me further into what that period felt like?"
- "What do you think that memory says about who you are?"

## Most Important
✅ Verify the new question has not been asked before (exactly or semantically).
✅ Prioritize emotional depth and personal meaning — not just facts.
✅ Keep tone human and warm — like a thoughtful one-on-one research conversation.
✅ NEVER ask for or collect PII.`;
}

function buildOutputFormatBlock(): string {
  return `# Output Format

Respond in plain conversational prose only.
- No bullet points, headers, numbered lists, or structured formatting.
- No XML tags or tool-call syntax.
- Your entire response is your spoken words to the participant.
- One question at the end. Nothing after the question.

If the participant seems to be struggling or expresses discomfort, acknowledge gently:
"That's completely understandable — we can move on whenever you're ready."

If the participant indicates they want to end the interview, respond graciously and let them know the session is complete.`;
}

// =============================================================================
// Lightweight fallback (for context-window-constrained calls or testing)
// =============================================================================

/**
 * Minimal system prompt variant — uses the protocol outline only, without
 * agent state. Useful for the first 1–2 turns before agent state is populated,
 * or when staying under a tight context budget.
 */
export function buildLightInterviewerSystemPrompt(protocol: Protocol): string {
  const outline = protocolToOutline(protocol);
  return `You are conducting an AVP (Autobiographical Verbal Protocol) life-story interview.

Your role: warm, curious, genuinely present. Ask one open-ended question at a time. Prioritize narrative depth.

Privacy: Never ask for names, specific ages, addresses, or any personally identifying information. Focus on experiences, emotions, and meaning.

Protocol domains (move naturally, not mechanically):
${outline}

Format: Plain conversational prose. One question per turn. No bullet points or headers.`;
}
