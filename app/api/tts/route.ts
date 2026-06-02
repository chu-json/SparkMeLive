// =============================================================================
// POST /api/tts
//
// Server-side Text-to-Speech using the OpenAI TTS API.
// Returns raw audio bytes (mp3) so the client can play them via Web Audio API
// and drive the VoiceOrb amplitude visualizer with real data.
//
// Model (default: gpt-4o-mini-tts):
//   gpt-4o-mini-tts — newest, most natural / "conversational" voice. Flows
//                     like a real person and accepts a tone `instructions`
//                     prompt for warmth. Recommended.
//   tts-1           — older, faster, more robotic. ~300ms latency.
//   tts-1-hd        — older, higher fidelity than tts-1. ~600ms latency.
//
// Voices (gpt-4o-mini-tts — must match OpenAI's enum exactly):
//   alloy · ash · coral · echo · fable · nova · onyx · sage · shimmer
//   The client may pass { voice } in the body to pick one per request; an
//   invalid/absent value falls back to OPENAI_TTS_VOICE (default "nova").
//
// Environment variables:
//   OPENAI_TTS_API_KEY   — direct OpenAI key (separate from the chat key).
//                          If not set the route returns 503 and the client
//                          falls back to browser SpeechSynthesis.
//   OPENAI_TTS_BASE_URL  — defaults to https://api.openai.com/v1
//   OPENAI_TTS_VOICE     — default voice when none is sent (default "nova")
//   OPENAI_TTS_MODEL     — defaults to "gpt-4o-mini-tts"
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// Voices accepted by gpt-4o-mini-tts. Kept in sync with the client dropdown.
const VALID_VOICES = [
  "alloy", "ash", "coral", "echo", "fable",
  "nova", "onyx", "sage", "shimmer",
] as const;
type Voice = (typeof VALID_VOICES)[number];

// Tone guidance for gpt-4o-mini-tts so it sounds like a warm human interviewer
// instead of a flat narrator. (Ignored by the older tts-1 models.)
const CONVERSATIONAL_INSTRUCTIONS =
  "Speak in a warm, natural, conversational tone, like a thoughtful and " +
  "empathetic human interviewer. Use a relaxed, unhurried pace with genuine, " +
  "gentle intonation. Sound curious and caring rather than robotic or scripted.";

let _ttsClient: OpenAI | null = null;

function getTTSClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_TTS_API_KEY;
  if (!apiKey) return null;

  if (!_ttsClient) {
    _ttsClient = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_TTS_BASE_URL ?? "https://api.openai.com/v1",
    });
  }
  return _ttsClient;
}

export async function POST(req: NextRequest) {
  const client = getTTSClient();

  if (!client) {
    return NextResponse.json(
      { error: "TTS_NOT_CONFIGURED", message: "OPENAI_TTS_API_KEY is not set — falling back to browser TTS" },
      { status: 503 }
    );
  }

  let text: string;
  let requestedVoice: string | undefined;
  try {
    const body = await req.json();
    text = (body.text as string | undefined)?.trim() ?? "";
    requestedVoice = body.voice as string | undefined;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  // Truncate very long responses to stay under TTS limits
  const truncated = text.length > 4096 ? text.slice(0, 4096) + "…" : text;

  // Per-request voice wins if valid; otherwise env default; otherwise "nova".
  const envVoice = process.env.OPENAI_TTS_VOICE ?? "nova";
  const voice = (
    requestedVoice && (VALID_VOICES as readonly string[]).includes(requestedVoice)
      ? requestedVoice
      : (VALID_VOICES as readonly string[]).includes(envVoice) ? envVoice : "nova"
  ) as Voice;

  const model = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";

  try {
    // gpt-4o-mini-tts uses `instructions` for tone (and ignores `speed`);
    // the older tts-1 models use `speed` and ignore `instructions`.
    const params: Record<string, unknown> = {
      model,
      voice,
      input: truncated,
      response_format: "mp3",
    };
    if (model === "gpt-4o-mini-tts") {
      params.instructions = CONVERSATIONAL_INSTRUCTIONS;
    } else {
      params.speed = 1.0;
    }

    const response = await client.audio.speech.create(
      params as unknown as Parameters<typeof client.audio.speech.create>[0]
    );

    const buffer = Buffer.from(await response.arrayBuffer());

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
        // Let the client know the original text length for caption sync
        "X-Text-Length": String(truncated.length),
        "X-TTS-Voice": voice,
      },
    });
  } catch (err) {
    console.error("[api/tts] OpenAI TTS error:", err);
    return NextResponse.json(
      { error: "TTS_FAILED", message: String(err) },
      { status: 500 }
    );
  }
}
