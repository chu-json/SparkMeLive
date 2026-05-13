// =============================================================================
// POST /api/tts
//
// Server-side Text-to-Speech using the OpenAI TTS API.
// Returns raw audio bytes (mp3) so the client can play them via Web Audio API
// and drive the VoiceOrb amplitude visualizer with real data.
//
// Voice options: alloy · echo · fable · onyx · nova (default) · shimmer
//   nova    — warm, expressive female voice — best for life-story interviewing
//   shimmer — lighter, slightly more formal female voice
//   echo    — warm male voice
//
// Model options:
//   tts-1    — fast, ~300ms latency, good quality  (default)
//   tts-1-hd — higher quality, ~600ms latency
//
// Environment variables:
//   OPENAI_TTS_API_KEY   — direct OpenAI key (separate from Stanford key)
//                          If not set the route returns 503 and the client
//                          falls back to browser SpeechSynthesis.
//   OPENAI_TTS_BASE_URL  — defaults to https://api.openai.com/v1
//   OPENAI_TTS_VOICE     — defaults to "nova"
//   OPENAI_TTS_MODEL     — defaults to "tts-1"
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

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
  try {
    const body = await req.json();
    text = (body.text as string | undefined)?.trim() ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  // Truncate very long responses to stay under TTS limits
  const truncated = text.length > 4096 ? text.slice(0, 4096) + "…" : text;

  const voice = (process.env.OPENAI_TTS_VOICE ?? "nova") as
    | "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  const model = (process.env.OPENAI_TTS_MODEL ?? "tts-1") as "tts-1" | "tts-1-hd";

  try {
    const response = await client.audio.speech.create({
      model,
      voice,
      input: truncated,
      response_format: "mp3",
      speed: 1.0,
    });

    const buffer = Buffer.from(await response.arrayBuffer());

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
        // Let the client know the original text length for caption sync
        "X-Text-Length": String(truncated.length),
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
