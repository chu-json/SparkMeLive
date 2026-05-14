// =============================================================================
// /admin — Internal developer dashboard
//
// Security note: This route has NO authentication in MVP.
// Before any shared or public deployment, add an env-var-based password
// check or restrict to localhost.
// =============================================================================

// Force dynamic rendering — admin data must never be served stale from cache.
export const dynamic = "force-dynamic";

import { createServiceClient } from "@/lib/supabase/server";
import { AdminContent } from "./AdminContent";
import type { Participant, Interview, InterviewExport } from "@/lib/types";

export const metadata = {
  title: "Admin — AVP Interview System",
  robots: "noindex, nofollow",
};

export default async function AdminPage() {
  const supabase = createServiceClient();

  const [
    { data: participants },
    { data: interviews },
    { data: exports },
    { data: turnRows },
  ] = await Promise.all([
    supabase
      .from("participants")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("interviews")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("interview_exports")
      .select("*"),
    supabase
      .from("transcript_turns")
      .select("interview_id, speaker"),
  ]);

  // Build turn-count map: interview_id → total turns
  const turnCounts: Record<string, number> = {};
  for (const row of turnRows ?? []) {
    turnCounts[row.interview_id] = (turnCounts[row.interview_id] ?? 0) + 1;
  }

  return (
    <AdminContent
      participants={(participants ?? []) as Participant[]}
      interviews={(interviews ?? []) as Interview[]}
      exports={(exports ?? []) as InterviewExport[]}
      turnCounts={turnCounts}
    />
  );
}
