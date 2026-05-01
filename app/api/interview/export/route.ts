// POST /api/interview/export
// Generate JSON + TXT exports for a completed interview and store in Supabase Storage.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateExport } from "@/lib/interview/export";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const interviewId = body.interview_id as string | undefined;

    if (!interviewId) {
      return NextResponse.json({ error: "interview_id is required" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Verify interview exists
    const { data: interview, error: iError } = await supabase
      .from("interviews")
      .select("*")
      .eq("id", interviewId)
      .single();

    if (iError || !interview) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    const result = await generateExport(interviewId);

    return NextResponse.json(result);
  } catch (err) {
    console.error("[interview/export] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/interview/export?interview_id=xxx — check if export already exists
export async function GET(req: NextRequest) {
  const interviewId = req.nextUrl.searchParams.get("interview_id");

  if (!interviewId) {
    return NextResponse.json({ error: "interview_id is required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: exportRecord } = await supabase
    .from("interview_exports")
    .select("*")
    .eq("interview_id", interviewId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!exportRecord) {
    return NextResponse.json({ exists: false });
  }

  // Generate signed URLs (valid for 1 hour)
  const urls: { json_url?: string; txt_url?: string } = {};

  if (exportRecord.json_path) {
    const { data } = await supabase.storage
      .from("exports")
      .createSignedUrl(exportRecord.json_path, 3600);
    if (data) urls.json_url = data.signedUrl;
  }

  if (exportRecord.txt_path) {
    const { data } = await supabase.storage
      .from("exports")
      .createSignedUrl(exportRecord.txt_path, 3600);
    if (data) urls.txt_url = data.signedUrl;
  }

  return NextResponse.json({ exists: true, ...urls, export_record: exportRecord });
}
