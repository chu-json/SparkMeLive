// =============================================================================
// POST /api/interview/refine-turn
//
// Updates the text of a previously-saved interviewee turn with a higher-quality
// transcript (e.g. the AWS Transcribe result that arrives a few seconds after
// the browser's live Web Speech transcript already drove the conversation).
//
// This keeps AWS off the critical path: the conversation proceeds instantly on
// the browser transcript, and the accurate AWS text refines the stored/displayed
// record afterwards. Only interviewee turns may be refined.
//
// Body: { interview_id: string, turn_id: string, text: string }
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const interviewId = body.interview_id as string | undefined;
    const turnId = body.turn_id as string | undefined;
    const text = (body.text as string | undefined)?.trim();

    if (!interviewId || !turnId || !text) {
      return NextResponse.json(
        { error: "interview_id, turn_id and text are required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from("transcript_turns")
      .update({ text })
      .eq("id", turnId)
      .eq("interview_id", interviewId)
      .eq("speaker", "interviewee")
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[interview/refine-turn] update error:", error);
      return NextResponse.json({ error: "Failed to refine turn" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, updated: !!data });
  } catch (err) {
    console.error("[interview/refine-turn] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
