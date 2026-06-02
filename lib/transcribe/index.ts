// =============================================================================
// AWS Transcribe — server-side only (do not import from client components)
//
// Flow per voice turn:
//   1. Upload audio blob to S3
//   2. Start a batch transcription job
//   3. Poll until COMPLETED or FAILED (max ~45 s)
//   4. Fetch the JSON transcript from S3 and return the text
//
// If AWS credentials are missing or the job times out, callers should fall
// back to the Web Speech API transcript that was captured live.
// =============================================================================

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  TranscriptionJobStatus,
  type MediaFormat,
  type LanguageCode,
} from "@aws-sdk/client-transcribe";
import type { Readable } from "stream";

// ---------------------------------------------------------------------------
// Configuration — all resolved from env at module load time
// ---------------------------------------------------------------------------

const REGION = process.env.AWS_REGION ?? "us-east-1";
const BUCKET = process.env.AWS_TRANSCRIBE_BUCKET ?? "";
const KEY_ID = process.env.AWS_ACCESS_KEY_ID ?? "";
const KEY_SECRET = process.env.AWS_SECRET_ACCESS_KEY ?? "";

const CREDENTIALS = { accessKeyId: KEY_ID, secretAccessKey: KEY_SECRET };

/** True when all four env vars are present */
export function isAwsConfigured(): boolean {
  return !!(BUCKET && KEY_ID && KEY_SECRET);
}

// Lazy-initialised so missing credentials don't crash the module at load time
let _s3: S3Client | null = null;
let _transcribe: TranscribeClient | null = null;

function s3(): S3Client {
  if (!_s3) _s3 = new S3Client({ region: REGION, credentials: CREDENTIALS });
  return _s3;
}

function transcribeClient(): TranscribeClient {
  if (!_transcribe)
    _transcribe = new TranscribeClient({ region: REGION, credentials: CREDENTIALS });
  return _transcribe;
}

// ---------------------------------------------------------------------------
// MIME → Transcribe MediaFormat mapping
// ---------------------------------------------------------------------------

const MIME_TO_FORMAT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4":  "mp4",
  "audio/mpeg": "mp3",
  "audio/ogg":  "ogg",
  "audio/wav":  "wav",
  "audio/flac": "flac",
  "audio/x-m4a": "mp4",
};

function mediaFormatFor(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return MIME_TO_FORMAT[base] ?? "webm";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TranscribeResult {
  transcript: string;
  /** "aws" = from Transcribe, "timeout" = job took too long, "error" = failed */
  source: "aws" | "timeout" | "error" | "unconfigured";
}

/**
 * Transcribe an audio buffer using AWS Transcribe.
 *
 * @param audioBuffer - Raw audio bytes
 * @param mimeType    - MIME type of the audio (e.g. "audio/webm;codecs=opus")
 * @param languageCode - BCP-47 language code, defaults to "en-US"
 * @param maxWaitMs   - How long to poll before giving up (default 45 s)
 */
export async function transcribeAudioBuffer(
  audioBuffer: Buffer,
  mimeType: string,
  languageCode = "en-US",
  maxWaitMs = 45_000,
): Promise<TranscribeResult> {
  if (!isAwsConfigured()) {
    console.warn("[transcribe] AWS credentials not configured — skipping");
    return { transcript: "", source: "unconfigured" };
  }

  const format     = mediaFormatFor(mimeType);
  const jobName    = `sparkme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const audioKey   = `audio/${jobName}.${format}`;
  const outputKey  = `transcripts/${jobName}.json`;

  console.log(`[transcribe] starting job ${jobName} — bucket=${BUCKET} region=${REGION} format=${format} bytes=${audioBuffer.length}`);

  try {
    // 1. Upload audio to S3
    await s3().send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         audioKey,
      Body:        audioBuffer,
      ContentType: mimeType || "audio/webm",
    }));
    console.log(`[transcribe] S3 upload OK → s3://${BUCKET}/${audioKey}`);

    // 2. Start transcription job
    console.log(`[transcribe] submitting Transcribe job…`);
    await transcribeClient().send(new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      Media:  { MediaFileUri: `s3://${BUCKET}/${audioKey}` },
      MediaFormat: format as MediaFormat,
      LanguageCode: languageCode as LanguageCode,
      OutputBucketName: BUCKET,
      OutputKey: outputKey,
    }));

    // 3. Poll until COMPLETED / FAILED, or until maxWaitMs
    const deadline = Date.now() + maxWaitMs;
    const POLL_MS  = 2_000;

    while (Date.now() < deadline) {
      await sleep(POLL_MS);

      const { TranscriptionJob: job } = await transcribeClient().send(
        new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
      );

      const status = job?.TranscriptionJobStatus;

      console.log(`[transcribe] poll status: ${status}`);

      if (status === TranscriptionJobStatus.COMPLETED) {
        console.log(`[transcribe] job completed — fetching result`);
        const transcript = await fetchTranscriptFromS3(outputKey);
        console.log(`[transcribe] AWS transcript (${transcript.length} chars):`, transcript.slice(0, 120));
        return { transcript, source: "aws" };
      }

      if (status === TranscriptionJobStatus.FAILED) {
        console.error("[transcribe] job failed:", job?.FailureReason);
        return { transcript: "", source: "error" };
      }
    }

    // Timed out
    console.warn("[transcribe] job timed out after", maxWaitMs, "ms");
    return { transcript: "", source: "timeout" };

  } catch (err) {
    console.error("[transcribe] unexpected error:", err);
    return { transcript: "", source: "error" };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTranscriptFromS3(key: string): Promise<string> {
  const obj = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = await streamToString(obj.Body as Readable);
  const json = JSON.parse(body) as {
    results?: { transcripts?: Array<{ transcript: string }> };
  };
  return json?.results?.transcripts?.[0]?.transcript ?? "";
}

async function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on("end",  () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}
