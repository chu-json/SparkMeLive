// =============================================================================
// AWS Transcribe Integration — PLACEHOLDER
//
// This file is the integration stub for AWS Transcribe.
// It is NOT active in the MVP. Audio is recorded and stored as raw files.
//
// When AWS Transcribe is ready:
//   1. Install: npm install @aws-sdk/client-transcribe @aws-sdk/client-s3
//   2. Set env vars: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION,
//      AWS_TRANSCRIBE_BUCKET
//   3. Implement startTranscriptionJob() below
//   4. Call it from /api/audio/upload after the audio is saved to S3
//
// Docs:
//   https://docs.aws.amazon.com/transcribe/latest/dg/getting-started.html
//   https://boto3.amazonaws.com/v1/documentation/api/latest/guide/quickstart.html
// =============================================================================

export interface TranscribeJobInput {
  /** S3 URI of the audio file, e.g. s3://bucket/audio/interview_id.webm */
  s3Uri: string;
  /** Unique job name */
  jobName: string;
  /** Audio format, e.g. 'WEBM', 'MP3', 'WAV' */
  mediaFormat: string;
  /** Optional language code, default 'en-US' */
  languageCode?: string;
}

export interface TranscribeJobResult {
  jobName: string;
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
  transcriptUri?: string;
  errorMessage?: string;
}

/**
 * PLACEHOLDER: Submit an audio file to AWS Transcribe for transcription.
 *
 * When implemented:
 *   import { TranscribeClient, StartTranscriptionJobCommand } from "@aws-sdk/client-transcribe"
 *   const client = new TranscribeClient({ region: process.env.AWS_REGION })
 *   await client.send(new StartTranscriptionJobCommand({ ... }))
 */
export async function startTranscriptionJob(
  _input: TranscribeJobInput
): Promise<TranscribeJobResult> {
  // FUTURE: implement AWS Transcribe job submission
  console.warn(
    "[transcribe] AWS Transcribe not yet implemented. Audio stored as raw file only."
  );
  return {
    jobName: _input.jobName,
    status: "IN_PROGRESS",
  };
}

/**
 * PLACEHOLDER: Poll for transcription job completion.
 */
export async function getTranscriptionResult(
  _jobName: string
): Promise<TranscribeJobResult> {
  // FUTURE: implement polling / webhook for job completion
  return {
    jobName: _jobName,
    status: "IN_PROGRESS",
  };
}
