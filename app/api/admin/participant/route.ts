// POST /api/admin/participant — create a participant from the admin UI
// Security note: this is an internal dev route. Before sharing the deployment
// URL, add ADMIN_ENABLED guard or remove this route.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const studyId = (body.study_id as string | undefined)?.trim().toUpperCase();

    if (!studyId) {
      return NextResponse.json({ error: "study_id is required" }, { status: 400 });
    }

    // Detect misconfigured service role key
    if (
      !process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY === "your-service-role-key-here"
    ) {
      return NextResponse.json(
        {
          error:
            "SUPABASE_SERVICE_ROLE_KEY is not configured. Add it to .env.local from your Supabase project Settings → API.",
        },
        { status: 500 }
      );
    }

    const supabase = createServiceClient();

    // Check if already exists
    const { data: existing } = await supabase
      .from("participants")
      .select("id, study_id")
      .eq("study_id", studyId)
      .single();

    if (existing) {
      return NextResponse.json({ participant: existing, created: false });
    }

    const { data: participant, error } = await supabase
      .from("participants")
      .insert({ study_id: studyId, status: "active" })
      .select("*")
      .single();

    if (error || !participant) {
      console.error("[admin/participant] create error:", error);
      return NextResponse.json(
        {
          error: `Failed to create participant: ${error?.message ?? "unknown error"}. Make sure the database schema has been applied (supabase/migrations/001_initial.sql).`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ participant, created: true });
  } catch (err) {
    console.error("[admin/participant] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/admin/participant?id=xxx
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = createServiceClient();
  await supabase.from("participants").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
