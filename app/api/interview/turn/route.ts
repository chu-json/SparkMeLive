// =============================================================================
// POST /api/interview/turn
//
// The core interview loop endpoint.
// Called each time the participant submits a response.
//
// Flow:
//   1. Validate request + interview state
//   2. Save interviewee turn to DB
//   3. Load full transcript history
//   4. Load or initialise agent_state (portrait + coverage + strategic questions)
//   5. Run SparkMe 3-agent pipeline (Agenda Manager → Planner → Interviewer)
//   6. Check for completion
//   7. Save interviewer turn + updated agent_state to DB
//   8. Return new turns + completion flag
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  generateInterviewerQuestion,
  shouldCompleteInterview,
  initAgentState,
} from "@/lib/interview/engine";
import avpProtocol from "@/lib/config/avp-protocol.json";
import type { TranscriptTurn, AgentState } from "@/lib/types";
import type { Protocol } from "@/lib/config/protocol";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const interviewId = body.interview_id as string | undefined;
    const text = (body.text as string | undefined)?.trim();

    if (!interviewId || !text) {
      return NextResponse.json(
        { error: "interview_id and text are required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // ── 1. Load interview and verify it's active ────────────────────────────
    const { data: interview, error: iError } = await supabase
      .from("interviews")
      .select("*")
      .eq("id", interviewId)
      .single();

    if (iError || !interview) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    if (interview.completed) {
      return NextResponse.json({ error: "Interview is already completed" }, { status: 409 });
    }

    // ── 2. Get current turn count ───────────────────────────────────────────
    const { count } = await supabase
      .from("transcript_turns")
      .select("*", { count: "exact", head: true })
      .eq("interview_id", interviewId);

    const intervieweeTurnIndex = count ?? 0;
    const interviewerTurnIndex = intervieweeTurnIndex + 1;
    const now = new Date().toISOString();

    // ── 3. Save interviewee turn ────────────────────────────────────────────
    const { data: intervieweeTurn, error: itError } = await supabase
      .from("transcript_turns")
      .insert({
        interview_id: interviewId,
        turn_index: intervieweeTurnIndex,
        speaker: "interviewee",
        text,
        timestamp_start: now,
        timestamp_end: now,
      })
      .select("*")
      .single();

    if (itError || !intervieweeTurn) {
      console.error("[interview/turn] save interviewee turn error:", itError);
      return NextResponse.json({ error: "Failed to save response" }, { status: 500 });
    }

    // ── 4. Load full history ────────────────────────────────────────────────
    const { data: history, error: histError } = await supabase
      .from("transcript_turns")
      .select("*")
      .eq("interview_id", interviewId)
      .order("turn_index", { ascending: true });

    if (histError || !history) {
      console.error("[interview/turn] load history error:", histError);
      return NextResponse.json({ error: "Failed to load interview history" }, { status: 500 });
    }

    // ── 5. Load or initialise agent state ───────────────────────────────────
    const currentState: AgentState =
      interview.agent_state ?? initAgentState(avpProtocol as Protocol);

    // ── 6. Check for completion before calling agents ────────────────────────
    const isComplete = shouldCompleteInterview(
      history as TranscriptTurn[],
      text,
      currentState
    );

    let interviewerQuestion: string;

    if (isComplete) {
      interviewerQuestion =
        "Thank you so much for sharing your story with me today. " +
        "This has been a meaningful conversation, and I'm grateful for your time and openness. " +
        "The interview is now complete. You can download your transcript below.";
    } else {
      // ── 7. Generate the next question — the ONLY LLM call on the critical ───
      // path. It uses the AgentState computed by the previous turn's background
      // analysis (/api/interview/analyze). The heavy Agenda Manager + Planner
      // agents no longer run here, so the participant only waits for one call.
      const output = await generateInterviewerQuestion(
        history as TranscriptTurn[],
        avpProtocol as Protocol,
        currentState
      );
      interviewerQuestion = output.question;
    }

    const questionNow = new Date().toISOString();

    // ── 9. Save interviewer turn ────────────────────────────────────────────
    const { data: interviewerTurn, error: interviewerError } = await supabase
      .from("transcript_turns")
      .insert({
        interview_id: interviewId,
        turn_index: interviewerTurnIndex,
        speaker: "interviewer",
        text: interviewerQuestion,
        timestamp_start: questionNow,
        timestamp_end: questionNow,
      })
      .select("*")
      .single();

    if (interviewerError || !interviewerTurn) {
      console.error("[interview/turn] save interviewer turn error:", interviewerError);
      return NextResponse.json({ error: "Failed to save question" }, { status: 500 });
    }

    // ── 10. Persist completion if reached ───────────────────────────────────
    // NOTE: interviews.agent_state is owned by /api/interview/analyze, which the
    // client fires right after this response. We deliberately do NOT write it
    // here to avoid clobbering the background analysis with stale state.
    if (isComplete) {
      await supabase
        .from("interviews")
        .update({ completed: true, ended_at: new Date().toISOString() })
        .eq("id", interviewId);
    }

    return NextResponse.json({
      interviewee_turn: intervieweeTurn,
      interviewer_turn: interviewerTurn,
      question: interviewerQuestion,
      turn_index: interviewerTurnIndex,
      is_complete: isComplete,
    });
  } catch (err) {
    console.error("[interview/turn] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
