// GET /api/admin/status — check configuration health for the admin dashboard
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const checks: Record<string, { ok: boolean; message: string }> = {};

  // Check env vars
  checks.supabase_url = {
    ok: !!process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("your-project"),
    message: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "not set",
  };

  checks.supabase_anon_key = {
    ok: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.length > 20,
    message: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "set" : "not set",
  };

  checks.service_role_key = {
    ok:
      !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY !== "your-service-role-key-here",
    message:
      process.env.SUPABASE_SERVICE_ROLE_KEY === "your-service-role-key-here"
        ? "still placeholder — update in .env.local"
        : process.env.SUPABASE_SERVICE_ROLE_KEY
        ? "set"
        : "not set",
  };

  checks.openai_key = {
    ok:
      !!process.env.OPENAI_API_KEY &&
      process.env.OPENAI_API_KEY !== "sk-..." &&
      process.env.OPENAI_API_KEY.length > 10,
    message:
      process.env.OPENAI_API_KEY === "sk-..."
        ? "still placeholder — update in .env.local"
        : process.env.OPENAI_API_KEY
        ? "set"
        : "not set",
  };

  // Try DB connection if service role key is set
  let dbConnected = false;
  let dbError = "";
  if (checks.service_role_key.ok) {
    try {
      const supabase = createServiceClient();
      const { error } = await supabase.from("participants").select("id").limit(1);
      if (error) {
        dbError = error.message;
        // Schema not applied is a common error
        if (error.message.includes("relation") || error.message.includes("does not exist")) {
          dbError = "Schema not applied — run supabase/migrations/001_initial.sql in your Supabase SQL editor";
        }
      } else {
        dbConnected = true;
      }
    } catch (e) {
      dbError = e instanceof Error ? e.message : "connection failed";
    }
  }

  checks.db_connection = {
    ok: dbConnected,
    message: dbConnected ? "connected" : dbError || "not checked (service role key missing)",
  };

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json({ ok: allOk, checks });
}
