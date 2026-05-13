// =============================================================================
// LLM Provider Abstraction — generateNextQuestion
//
// Single entry point for all LLM calls in the interview engine.
// Defaults to OpenAI-compatible API (gpt-4o-mini).
//
// To swap providers:
//   - Stanford AI Playground: set OPENAI_BASE_URL to the playground endpoint
//     and OPENAI_API_KEY to your Stanford key. The API is OpenAI-compatible.
//   - Any other OpenAI-compatible provider: same approach — change base URL.
//   - Non-OpenAI provider: implement the LLMProvider interface below and
//     swap it in at the bottom of this file.
//
// SparkMe integration note:
//   In the full SparkMe system, the interviewer agent uses tool calls
//   (RESPOND_TO_USER / RECALL_CONTEXT) structured in XML tags. When wiring
//   in the full SparkMe agent, replace the simple text extraction in
//   parseInterviewerResponse() with the SparkMe tool-call parser from
//   src/utils/llm/prompt_utils.py.
// =============================================================================

import OpenAI from "openai";
import type { GenerateQuestionInput, GenerateQuestionOutput, LLMMessage } from "@/lib/types";

// ---------------------------------------------------------------------------
// Provider interface — swap implementations here for non-OpenAI providers
// ---------------------------------------------------------------------------

interface LLMProvider {
  complete(messages: LLMMessage[], options?: CompletionOptions): Promise<string>;
}

interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider
// ---------------------------------------------------------------------------

class OpenAICompatibleProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    });
    this.model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  }

  async complete(messages: LLMMessage[], options: CompletionOptions = {}): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: options.maxTokens ?? 500,
      temperature: options.temperature ?? 0.7,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("LLM returned empty response");
    }
    return content.trim();
  }
}

// Lazy provider instance — initialized on first call to avoid build-time env checks
let _provider: LLMProvider | null = null;
function getProvider(): LLMProvider {
  if (!_provider) {
    _provider = new OpenAICompatibleProvider();
  }
  return _provider;
}

// ---------------------------------------------------------------------------
// General-purpose LLM call — used by agent sub-modules (memory, planner)
// ---------------------------------------------------------------------------

/**
 * Make a raw LLM call and return the response text.
 * Used by the Agenda Manager and Exploration Planner agents.
 *
 * @param messages   Ordered list of system/user/assistant messages
 * @param maxTokens  Token budget for the response (default 1200)
 * @param temperature Sampling temperature (default 0.3 for structured JSON tasks)
 */
export async function callLLM(
  messages: LLMMessage[],
  maxTokens = 1200,
  temperature = 0.3
): Promise<string> {
  return getProvider().complete(messages, { maxTokens, temperature });
}

// ---------------------------------------------------------------------------
// Main export: generateNextQuestion
// ---------------------------------------------------------------------------

/**
 * Generate the next interviewer question given the conversation history
 * and a fully-assembled system prompt.
 *
 * This is the single call the interview engine makes to the LLM.
 * It is intentionally thin — all prompt assembly happens in engine.ts.
 */
export async function generateNextQuestion(
  input: GenerateQuestionInput
): Promise<GenerateQuestionOutput> {
  const messages = buildMessages(input);

  const raw = await getProvider().complete(messages, {
    maxTokens: 500,
    temperature: 0.72,
  });

  return parseInterviewerResponse(raw);
}

// ---------------------------------------------------------------------------
// Message builder
// ---------------------------------------------------------------------------

/**
 * Converts the interview history into OpenAI chat message format.
 * Interviewer turns → assistant messages
 * Interviewee turns → user messages
 */
function buildMessages(input: GenerateQuestionInput): LLMMessage[] {
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: buildFullSystemPrompt(input),
    },
  ];

  // Inject conversation history
  for (const turn of input.history) {
    if (turn.speaker === "interviewer") {
      messages.push({ role: "assistant", content: turn.text });
    } else {
      messages.push({ role: "user", content: turn.text });
    }
  }

  // If history ends with an interviewer turn (e.g. opening), prompt the LLM
  // to generate the next question after the most recent interviewee response.
  // If history is empty, this is the first turn — LLM generates the opening.
  const lastTurn = input.history[input.history.length - 1];
  if (!lastTurn || lastTurn.speaker === "interviewer") {
    // Either no history (first turn) or history ends with interviewer:
    // Add a minimal user prompt to trigger the LLM to produce the next question.
    // This case is mainly for initial question generation when participant hasn't spoken yet.
  }

  return messages;
}

/**
 * Builds the complete system prompt from all available context.
 * Protocol outline and participant context are injected here.
 */
function buildFullSystemPrompt(input: GenerateQuestionInput): string {
  let prompt = input.systemPrompt;

  if (input.protocolContext) {
    prompt += `\n\n${input.protocolContext}`;
  }

  if (input.participantContext) {
    prompt += `\n\n# Additional Participant Context\n${input.participantContext}`;
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

/**
 * Parse the raw LLM response into a structured output.
 *
 * For MVP, the LLM outputs plain conversational prose — the entire response
 * is the question/response text.
 *
 * SparkMe integration note:
 *   When the full SparkMe agent is wired in, the LLM will output XML-tagged
 *   tool calls (RESPOND_TO_USER, RECALL_CONTEXT). Replace this parser with
 *   the SparkMe tool-call extractor that parses those tags.
 */
function parseInterviewerResponse(raw: string): GenerateQuestionOutput {
  // For MVP: the entire LLM output is the interviewer's conversational response
  return {
    question: raw,
  };
}
