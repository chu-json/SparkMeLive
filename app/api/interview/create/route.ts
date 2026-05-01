// POST /api/interview/create
// Creates a new interview for an authenticated participant.
// Returns the interview record and the opening interviewer message.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOpeningMessage } from "@/lib/interview/engine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const participantId = body.participant_id as string | undefined;

    if (!participantId) {
      return NextResponse.json({ error: "participant_id is required" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Verify participant exists
    const { data: participant, error: pError } = await supabase
      .from("participants")
      .select("id")
      .eq("id", participantId)
      .single();

    if (pError || !participant) {
      return NextResponse.json({ error: "Participant not found" }, { status: 404 });
    }

    // Create interview
    const { data: interview, error: iError } = await supabase
      .from("interviews")
      .insert({
        participant_id: participantId,
        mode: "avp",
        started_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (iError || !interview) {
      console.error("[interview/create] error:", iError);
      return NextResponse.json({ error: "Failed to create interview" }, { status: 500 });
    }

    // Save the opening interviewer turn (turn_index = 0)
    const openingMessage = getOpeningMessage();

    const { error: turnError } = await supabase.from("transcript_turns").insert({
      interview_id: interview.id,
      turn_index: 0,
      speaker: "interviewer",
      text: openingMessage,
      timestamp_start: new Date().toISOString(),
    });

    if (turnError) {
      console.error("[interview/create] opening turn error:", turnError);
    }

    return NextResponse.json({
      interview,
      opening_question: openingMessage,
      turn_index: 0,
    });
  } catch (err) {
    console.error("[interview/create] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
