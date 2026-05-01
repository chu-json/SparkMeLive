// =============================================================================
// Interview Export Generator
//
// Generates structured exports from completed interviews:
//   - JSON: full structured payload with all metadata and transcript turns
//   - TXT: human-readable plain text transcript with speaker labels + timestamps
//
// Both files are uploaded to Supabase Storage (exports/ bucket) and paths
// are recorded in the interview_exports table.
// =============================================================================

import { createServiceClient } from "@/lib/supabase/server";
import type {
  ExportResponse,
  InterviewExportPayload,
  TranscriptTurnExport,
  TranscriptTurn,
  Interview,
  Participant,
} from "@/lib/types";

/**
 * Generate and upload both export formats for an interview.
 * Creates or updates the interview_exports record.
 */
export async function generateExport(interviewId: string): Promise<ExportResponse> {
  const supabase = createServiceClient();

  // ---- Load all data ----
  const { data: interview, error: iError } = await supabase
    .from("interviews")
    .select("*")
    .eq("id", interviewId)
    .single();

  if (iError || !interview) {
    throw new Error(`Interview not found: ${interviewId}`);
  }

  const { data: participant, error: pError } = await supabase
    .from("participants")
    .select("*")
    .eq("id", (interview as Interview).participant_id)
    .single();

  if (pError || !participant) {
    throw new Error(`Participant not found for interview: ${interviewId}`);
  }

  const { data: turns, error: tError } = await supabase
    .from("transcript_turns")
    .select("*")
    .eq("interview_id", interviewId)
    .order("turn_index", { ascending: true });

  if (tError) {
    throw new Error(`Failed to load transcript: ${tError.message}`);
  }

  const typedTurns = (turns ?? []) as TranscriptTurn[];
  const typedInterview = interview as Interview;
  const typedParticipant = participant as Participant;

  // ---- Build audio URL if present ----
  let audioUrl: string | null = null;
  if (typedInterview.audio_path) {
    const { data: signedAudio } = await supabase.storage
      .from("audio")
      .createSignedUrl(typedInterview.audio_path, 86400); // 24 hours
    audioUrl = signedAudio?.signedUrl ?? null;
  }

  // ---- Build export payload ----
  const turnExports: TranscriptTurnExport[] = typedTurns.map((t) => ({
    turn_index: t.turn_index,
    speaker: t.speaker,
    text: t.text,
    timestamp_start: t.timestamp_start,
    timestamp_end: t.timestamp_end,
  }));

  const exportPayload: InterviewExportPayload = {
    participant_id: typedParticipant.id,
    study_id: typedParticipant.study_id,
    interview_id: interviewId,
    mode: typedInterview.mode,
    started_at: typedInterview.started_at,
    ended_at: typedInterview.ended_at,
    completed: typedInterview.completed,
    audio_url: audioUrl,
    transcript: turnExports,
    metadata: {
      exported_at: new Date().toISOString(),
      total_turns: typedTurns.length,
      version: "1.0.0",
    },
  };

  // ---- Generate file contents ----
  const jsonContent = JSON.stringify(exportPayload, null, 2);
  const txtContent = buildPlainTextTranscript(exportPayload);

  // ---- Upload to Supabase Storage ----
  const jsonPath = `${interviewId}/export.json`;
  const txtPath = `${interviewId}/export.txt`;

  const { error: jsonUploadError } = await supabase.storage
    .from("exports")
    .upload(jsonPath, Buffer.from(jsonContent, "utf-8"), {
      contentType: "application/json",
      upsert: true,
    });

  if (jsonUploadError) {
    console.error("[export] json upload error:", jsonUploadError);
    throw new Error("Failed to upload JSON export");
  }

  const { error: txtUploadError } = await supabase.storage
    .from("exports")
    .upload(txtPath, Buffer.from(txtContent, "utf-8"), {
      contentType: "text/plain",
      upsert: true,
    });

  if (txtUploadError) {
    console.error("[export] txt upload error:", txtUploadError);
    throw new Error("Failed to upload TXT export");
  }

  // ---- Record export in DB ----
  await supabase.from("interview_exports").upsert(
    {
      interview_id: interviewId,
      json_path: jsonPath,
      txt_path: txtPath,
    },
    { onConflict: "interview_id" }
  );

  // Update interview with transcript path
  await supabase
    .from("interviews")
    .update({ transcript_path: txtPath })
    .eq("id", interviewId);

  // ---- Generate signed URLs for download ----
  const { data: jsonSigned } = await supabase.storage
    .from("exports")
    .createSignedUrl(jsonPath, 3600);

  const { data: txtSigned } = await supabase.storage
    .from("exports")
    .createSignedUrl(txtPath, 3600);

  return {
    json_url: jsonSigned?.signedUrl ?? "",
    txt_url: txtSigned?.signedUrl ?? "",
    export: exportPayload,
  };
}

// ---------------------------------------------------------------------------
// Plain text transcript formatter
// ---------------------------------------------------------------------------

function buildPlainTextTranscript(payload: InterviewExportPayload): string {
  const lines: string[] = [];

  lines.push("=".repeat(72));
  lines.push("AVP LIFE STORY INTERVIEW TRANSCRIPT");
  lines.push("=".repeat(72));
  lines.push("");
  lines.push(`Study ID:      ${payload.study_id}`);
  lines.push(`Interview ID:  ${payload.interview_id}`);
  lines.push(`Mode:          ${payload.mode.toUpperCase()}`);
  lines.push(`Started:       ${formatTimestamp(payload.started_at)}`);
  lines.push(`Ended:         ${formatTimestamp(payload.ended_at)}`);
  lines.push(`Completed:     ${payload.completed ? "Yes" : "No"}`);
  lines.push(`Total turns:   ${payload.metadata.total_turns}`);
  if (payload.audio_url) {
    lines.push(`Audio:         ${payload.audio_url}`);
  }
  lines.push(`Exported:      ${formatTimestamp(payload.metadata.exported_at)}`);
  lines.push("");
  lines.push("-".repeat(72));
  lines.push("TRANSCRIPT");
  lines.push("-".repeat(72));
  lines.push("");

  for (const turn of payload.transcript) {
    const speakerLabel =
      turn.speaker === "interviewer"
        ? "INTERVIEWER"
        : "PARTICIPANT ";

    const timestamp = turn.timestamp_start
      ? ` [${formatTimestamp(turn.timestamp_start)}]`
      : "";

    lines.push(`${speakerLabel}${timestamp}`);
    lines.push(turn.text);
    lines.push("");
  }

  lines.push("=".repeat(72));
  lines.push("END OF TRANSCRIPT");
  lines.push("=".repeat(72));

  return lines.join("\n");
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "N/A";
  try {
    return new Date(ts).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return ts;
  }
}
