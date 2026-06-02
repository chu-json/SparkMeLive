// =============================================================================
// POST /api/transcribe
//
// Accepts an audio blob, uploads it to S3, runs an AWS Transcribe batch job,
// polls until complete, and returns the final transcript text.
//
// If AWS is not configured or the job times out, returns { transcript: "" }
// so the caller can fall back to the Web Speech API transcript.
//
// Expected FormData fields:
//   audio       — audio File/Blob
//   language    — optional BCP-47 language code (default "en-US")
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { transcribeAudioBuffer } from "@/lib/transcribe";

// Allow up to 60 seconds for this route (for Vercel / hosted deployments)
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file     = formData.get("audio")    as File   | null;
    const language = formData.get("language") as string | null;

    if (!file || file.size === 0) {
      return NextResponse.json(
        { error: "audio file is required" },
        { status: 400 },
      );
    }

    const audioBuffer = Buffer.from(await file.arrayBuffer());
    const result = await transcribeAudioBuffer(
      audioBuffer,
      file.type || "audio/webm",
      language ?? "en-US",
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/transcribe] unexpected error:", err);
    return NextResponse.json({ transcript: "", source: "error" });
  }
}
