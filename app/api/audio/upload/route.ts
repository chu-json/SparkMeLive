// =============================================================================
// POST /api/audio/upload
//
// Receives an audio blob from the browser AudioRecorder component and
// stores it in Supabase Storage under audio/{interview_id}/{filename}.
//
// Updates interviews.audio_path with the storage path.
//
// AWS Transcribe integration point:
//   After the upload, call startTranscriptionJob() from lib/transcribe/index.ts
//   to kick off transcription. The Transcribe job reads from S3 (not Supabase),
//   so you would need to also sync the audio to an S3 bucket before calling it.
//   See lib/transcribe/index.ts for the stub.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("audio") as File | null;
    const interviewId = formData.get("interview_id") as string | null;

    if (!file || !interviewId) {
      return NextResponse.json(
        { error: "audio file and interview_id are required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Verify the interview exists
    const { data: interview, error: iError } = await supabase
      .from("interviews")
      .select("id, participant_id")
      .eq("id", interviewId)
      .single();

    if (iError || !interview) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    // Determine file extension from mime type
    const mimeToExt: Record<string, string> = {
      "audio/webm": "webm",
      "audio/ogg": "ogg",
      "audio/mp4": "mp4",
      "audio/mpeg": "mp3",
      "audio/wav": "wav",
    };
    const ext = mimeToExt[file.type] ?? "webm";
    const storagePath = `${interviewId}/recording.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase Storage (audio bucket)
    const { error: uploadError } = await supabase.storage
      .from("audio")
      .upload(storagePath, buffer, {
        contentType: file.type || "audio/webm",
        upsert: true,
      });

    if (uploadError) {
      console.error("[audio/upload] storage error:", uploadError);
      return NextResponse.json({ error: "Failed to upload audio" }, { status: 500 });
    }

    // Update interview record with audio path
    await supabase
      .from("interviews")
      .update({ audio_path: storagePath })
      .eq("id", interviewId);

    // -- AWS Transcribe integration point --
    // When ready to implement:
    //   import { startTranscriptionJob } from "@/lib/transcribe"
    //   await startTranscriptionJob({
    //     s3Uri: `s3://${process.env.AWS_TRANSCRIBE_BUCKET}/audio/${storagePath}`,
    //     jobName: `interview-${interviewId}`,
    //     mediaFormat: ext.toUpperCase(),
    //   })

    return NextResponse.json({
      audio_path: storagePath,
      message: "Audio uploaded successfully",
    });
  } catch (err) {
    console.error("[audio/upload] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
