// POST /api/interview/create
// Finds or creates an interview for a participant and ensures the opening
// interviewer turn exists. Idempotent — safe to call multiple times.
//
// Returns 200 with { interview, opening_question, turn_id } on success.
// Returns 409 with the same payload when the opening turn already existed
// (client should read opening_question and update state directly).

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

    // Find the most recent active (non-completed) interview for this participant.
    // The login route already creates one — we must not duplicate it.
    const { data: existingInterview } = await supabase
      .from("interviews")
      .select("*")
      .eq("participant_id", participantId)
      .eq("completed", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let interview = existingInterview;

    if (!interview) {
      // No active interview found — create one
      const { data: newInterview, error: iError } = await supabase
        .from("interviews")
        .insert({
          participant_id: participantId,
          mode: "avp",
          started_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (iError || !newInterview) {
        console.error("[interview/create] error:", iError);
        return NextResponse.json({ error: "Failed to create interview" }, { status: 500 });
      }
      interview = newInterview;
    }

    // Check if the opening turn (turn_index = 0) already exists for this interview
    const { data: existingTurn } = await supabase
      .from("transcript_turns")
      .select("id, text")
      .eq("interview_id", interview.id)
      .eq("turn_index", 0)
      .maybeSingle();

    if (existingTurn) {
      // Opening turn already saved — return 409 so client can read it directly
      return NextResponse.json(
        { interview, opening_question: existingTurn.text, turn_id: existingTurn.id },
        { status: 409 }
      );
    }

    // Save the opening interviewer turn
    const openingMessage = getOpeningMessage();

    const { data: savedTurn, error: turnError } = await supabase
      .from("transcript_turns")
      .insert({
        interview_id: interview.id,
        turn_index: 0,
        speaker: "interviewer",
        text: openingMessage,
        timestamp_start: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (turnError) {
      console.error("[interview/create] opening turn error:", turnError);
    }

    return NextResponse.json({
      interview,
      opening_question: openingMessage,
      turn_id: savedTurn?.id ?? null,
    });
  } catch (err) {
    console.error("[interview/create] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
