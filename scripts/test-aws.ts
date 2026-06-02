// =============================================================================
// Standalone AWS Transcribe / S3 connectivity test.
// Run with: npx tsx scripts/test-aws.ts
//
// Verifies, independent of the Next.js app / recording UI:
//   1. Env vars are loaded
//   2. Credentials are valid
//   3. The S3 bucket is reachable + writable
//   4. The Transcribe API is reachable (permissions OK)
// =============================================================================

import { readFileSync } from "fs";
import { join } from "path";
import {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  TranscribeClient,
  ListTranscriptionJobsCommand,
} from "@aws-sdk/client-transcribe";

// --- Minimal .env loader (mirrors Next.js precedence: .env.local > .env) ----
function loadEnv() {
  for (const file of [".env", ".env.local"]) {
    try {
      const content = readFileSync(join(process.cwd(), file), "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        // .env.local should win, so always overwrite as we go in this order
        process.env[key] = val;
      }
    } catch {
      // file may not exist — that's fine
    }
  }
}

async function main() {
  loadEnv();

  const REGION = process.env.AWS_REGION ?? "us-east-1";
  const BUCKET = process.env.AWS_TRANSCRIBE_BUCKET ?? "";
  const KEY_ID = process.env.AWS_ACCESS_KEY_ID ?? "";
  const SECRET = process.env.AWS_SECRET_ACCESS_KEY ?? "";

  console.log("\n=== AWS config (from env) ===");
  console.log("AWS_REGION            :", REGION);
  console.log("AWS_TRANSCRIBE_BUCKET :", BUCKET || "(missing)");
  console.log("AWS_ACCESS_KEY_ID     :", KEY_ID ? KEY_ID.slice(0, 6) + "…" + KEY_ID.slice(-4) : "(missing)");
  console.log("AWS_SECRET_ACCESS_KEY :", SECRET ? "(set, " + SECRET.length + " chars)" : "(missing)");

  if (!BUCKET || !KEY_ID || !SECRET) {
    console.error("\n❌ One or more AWS env vars are missing. Aborting.");
    process.exit(1);
  }

  const credentials = { accessKeyId: KEY_ID, secretAccessKey: SECRET };
  const s3 = new S3Client({ region: REGION, credentials });
  const transcribe = new TranscribeClient({ region: REGION, credentials });

  // 1. Bucket reachable?
  console.log("\n=== 1. HeadBucket ===");
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log("✅ Bucket exists and is reachable with these credentials");
  } catch (err) {
    console.error("❌ HeadBucket failed:", describeErr(err));
  }

  // 2. Can we write?
  console.log("\n=== 2. PutObject (write test) ===");
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: `connectivity-test/${Date.now()}.txt`,
      Body: "sparkme aws connectivity test",
      ContentType: "text/plain",
    }));
    console.log("✅ Successfully wrote a test object to the bucket");
  } catch (err) {
    console.error("❌ PutObject failed:", describeErr(err));
  }

  // 3. Transcribe API reachable / permission present?
  console.log("\n=== 3. Transcribe ListTranscriptionJobs ===");
  try {
    const res = await transcribe.send(new ListTranscriptionJobsCommand({ MaxResults: 1 }));
    console.log("✅ Transcribe API reachable. Existing jobs visible:", res.TranscriptionJobSummaries?.length ?? 0);
  } catch (err) {
    console.error("❌ Transcribe call failed:", describeErr(err));
  }

  console.log("\n=== Done ===");
  console.log("If all three show ✅, AWS is fully wired and the app path will work.");
  console.log("If any show ❌, the message above is the exact reason.\n");
}

function describeErr(err: unknown): string {
  const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  return `[${e.name ?? "Error"}] ${e.message ?? String(err)} (HTTP ${e.$metadata?.httpStatusCode ?? "?"})`;
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
