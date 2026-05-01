// =============================================================================
// Seed Script — create test data and verify the interview pipeline
//
// Usage:
//   npm run seed
//   # or: npx tsx scripts/seed.ts
//
// What this does:
//   1. Creates a test participant with study_id = TEST001 (idempotent)
//   2. Creates a new interview for that participant
//   3. Inserts sample transcript turns (simulates 2 interview exchanges)
//   4. Calls the export API and prints the generated JSON export
//   5. Prints the download URLs for both export formats
//
// Prerequisites:
//   - .env file with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   - Supabase migration 001_initial.sql applied
//   - Supabase Storage buckets 'audio' and 'exports' created
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "fs";

// Load env manually (tsx doesn't auto-load .env)
function loadEnv() {
  try {
    const envFile = dotenv.readFileSync(".env", "utf-8");
    for (const line of envFile.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...valueParts] = trimmed.split("=");
      const value = valueParts.join("=").trim();
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env not found — assume vars are already set
  }
}

loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment."
  );
  console.error("Copy .env.example to .env and fill in your Supabase credentials.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  console.log("\n=== SparkMeLive Seed Script ===\n");

  // ---- 1. Create or get participant ----
  console.log("1. Creating test participant (study_id = TEST001)...");

  const { data: existing } = await supabase
    .from("participants")
    .select("id, study_id")
    .eq("study_id", "TEST001")
    .single();

  let participantId: string;

  if (existing) {
    console.log(`   Participant already exists: ${existing.id}`);
    participantId = existing.id;
  } else {
    const { data: newParticipant, error } = await supabase
      .from("participants")
      .insert({ study_id: "TEST001", status: "active" })
      .select("id")
      .single();

    if (error || !newParticipant) {
      console.error("   Failed to create participant:", error?.message);
      process.exit(1);
    }
    console.log(`   Created participant: ${newParticipant.id}`);
    participantId = newParticipant.id;
  }

  // ---- 2. Create interview ----
  console.log("\n2. Creating interview...");

  const { data: interview, error: iError } = await supabase
    .from("interviews")
    .insert({
      participant_id: participantId,
      mode: "avp",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (iError || !interview) {
    console.error("   Failed to create interview:", iError?.message);
    process.exit(1);
  }
  console.log(`   Interview ID: ${interview.id}`);

  // ---- 3. Insert sample transcript turns ----
  console.log("\n3. Inserting sample transcript turns...");

  const sampleTurns = [
    {
      interview_id: interview.id,
      turn_index: 0,
      speaker: "interviewer",
      text: `Thank you so much for being here today. I'm really looking forward to our conversation.

What I'd like to do is have you tell me your life story — not your whole autobiography, but the major scenes, chapters, and themes that you feel have shaped who you are. We'll move at whatever pace feels right.

To begin, could you take me back to what you'd consider a real high point — a moment in your life that felt especially vivid, meaningful, or positive?`,
      timestamp_start: new Date(Date.now() - 3 * 60000).toISOString(),
      timestamp_end: new Date(Date.now() - 3 * 60000).toISOString(),
    },
    {
      interview_id: interview.id,
      turn_index: 1,
      speaker: "interviewee",
      text: "I think the clearest high point was when I graduated from my residency program. It had been six years of incredibly hard work — sleepless nights, real self-doubt — and standing in that room surrounded by colleagues who had become family, I just felt an overwhelming sense of having actually made it through something that tested me in every way.",
      timestamp_start: new Date(Date.now() - 2.5 * 60000).toISOString(),
      timestamp_end: new Date(Date.now() - 2 * 60000).toISOString(),
    },
    {
      interview_id: interview.id,
      turn_index: 2,
      speaker: "interviewer",
      text: "That sounds like a profoundly meaningful moment — both the achievement and the community around you. I'm curious about that feeling of having been tested in every way. What were you thinking and feeling in that room, and was there a particular person or moment within that day that stands out most vividly?",
      timestamp_start: new Date(Date.now() - 2 * 60000).toISOString(),
      timestamp_end: new Date(Date.now() - 2 * 60000).toISOString(),
    },
    {
      interview_id: interview.id,
      turn_index: 3,
      speaker: "interviewee",
      text: "My attending physician, Dr. Rodriguez — she gave a short speech about each of us, and when she described me she said 'quietly relentless.' I didn't even realize she'd been watching me that closely. That phrase stuck with me. I felt seen in a way I hadn't expected. There were tears, which surprised me — I'm not usually someone who cries in public.",
      timestamp_start: new Date(Date.now() - 1.5 * 60000).toISOString(),
      timestamp_end: new Date(Date.now() - 1 * 60000).toISOString(),
    },
  ];

  const { error: turnError } = await supabase
    .from("transcript_turns")
    .insert(sampleTurns);

  if (turnError) {
    console.error("   Failed to insert turns:", turnError.message);
    process.exit(1);
  }
  console.log(`   Inserted ${sampleTurns.length} sample turns.`);

  // ---- 4. Mark interview complete ----
  console.log("\n4. Marking interview as complete...");
  await supabase
    .from("interviews")
    .update({ completed: true, ended_at: new Date().toISOString() })
    .eq("id", interview.id);

  // ---- 5. Generate export ----
  console.log("\n5. Generating export...");
  console.log("   (requires NEXT_PUBLIC_SUPABASE_URL and Supabase Storage buckets)");

  // Direct export generation (without going through the HTTP API)
  try {
    // Load export module
    const { generateExport } = await import("../lib/interview/export");

    // Temporarily mock cookies() since we're not in a Next.js request context
    // by re-using the service client directly
    const exportResult = await generateExport(interview.id);

    console.log("\n   Export generated successfully!");
    console.log(`   JSON: ${exportResult.json_url}`);
    console.log(`   TXT:  ${exportResult.txt_url}`);
    console.log("\n   Sample export payload:");
    console.log(
      JSON.stringify(
        {
          ...exportResult.export,
          transcript: exportResult.export.transcript.slice(0, 2),
        },
        null,
        2
      )
    );
  } catch (err) {
    console.warn(
      "\n   Export generation requires Next.js context (cookies).",
      "\n   Instead, visit http://localhost:3000/admin after starting the dev server",
      "\n   and click 'Export' for the interview to generate and download the files."
    );
    console.warn("   Error:", err instanceof Error ? err.message : err);
  }

  console.log("\n=== Seed complete ===");
  console.log("\nNext steps:");
  console.log(`  1. Start dev server: npm run dev`);
  console.log(`  2. Go to: http://localhost:3000/login`);
  console.log(`  3. Enter participant ID: TEST001`);
  console.log(`  4. Admin dashboard: http://localhost:3000/admin`);
  console.log(`  5. Interview (direct): http://localhost:3000/interview/${interview.id}`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
