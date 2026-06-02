// =============================================================================
// POST /api/interview/analyze
//
// Background analysis step for the SparkMe agent pipeline.
//
// The client fires this (fire-and-forget) immediately after /api/interview/turn
// returns, so the heavy Agenda Manager + Exploration Planner agents run OFF the
// participant's critical path. The resulting AgentState is persisted to
// interviews.agent_state and consumed by the NEXT turn's interviewer call.
//
// Because it runs as its own request, this works on Vercel serverless without
// relying on after()/waitUntil — the conversation is never blocked by it.
//
// Body: { interview_id: string }
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { computeUpdatedAgentState, initAgentState } from "@/lib/interview/engine";
import avpProtocol from "@/lib/config/avp-protocol.json";
import type { TranscriptTurn, AgentState } from "@/lib/types";
import type { Protocol } from "@/lib/config/protocol";

// Allow generous time for the (background) agent calls
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const interviewId = body.interview_id as string | undefined;

    if (!interviewId) {
      return NextResponse.json({ error: "interview_id is required" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Load interview (for current agent_state)
    const { data: interview, error: iError } = await supabase
      .from("interviews")
      .select("*")
      .eq("id", interviewId)
      .single();

    if (iError || !interview) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    // Load full history
    const { data: history, error: histError } = await supabase
      .from("transcript_turns")
      .select("*")
      .eq("interview_id", interviewId)
      .order("turn_index", { ascending: true });

    if (histError || !history) {
      return NextResponse.json({ error: "Failed to load history" }, { status: 500 });
    }

    const turns = history as TranscriptTurn[];

    // Find the most recent interviewee answer and the interviewer question that
    // prompted it. (After a turn, history ends with the new interviewer question.)
    let answerIdx = -1;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].speaker === "interviewee") {
        answerIdx = i;
        break;
      }
    }

    // Nothing to analyze yet (e.g. only the opening question exists)
    if (answerIdx === -1) {
      return NextResponse.json({ ok: true, analyzed: false });
    }

    const latestAnswer = turns[answerIdx].text;
    let latestQuestion = "";
    for (let i = answerIdx - 1; i >= 0; i--) {
      if (turns[i].speaker === "interviewer") {
        latestQuestion = turns[i].text;
        break;
      }
    }

    // Use history up to and including the latest answer (matches the original
    // pipeline semantics, before the new interviewer question was appended).
    const historyUpToAnswer = turns.slice(0, answerIdx + 1);

    const currentState: AgentState =
      interview.agent_state ?? initAgentState(avpProtocol as Protocol);

    const updatedState = await computeUpdatedAgentState(
      latestQuestion,
      latestAnswer,
      historyUpToAnswer,
      avpProtocol as Protocol,
      currentState
    );

    await supabase
      .from("interviews")
      .update({ agent_state: updatedState })
      .eq("id", interviewId);

    return NextResponse.json({ ok: true, analyzed: true });
  } catch (err) {
    console.error("[interview/analyze] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
