// =============================================================================
// /admin — Internal developer dashboard
//
// Security note: This route has NO authentication in MVP.
// Before any shared or public deployment, add an env-var-based password
// check or restrict to localhost.
// =============================================================================

// Force dynamic rendering — admin data must never be served stale from cache.
export const dynamic = "force-dynamic";
// Belt-and-braces: also disable Next's Data Cache for every fetch in this
// render so newly-created participants never appear "missing" after a reload
// just because a stale render slipped through.
export const fetchCache = "force-no-store";
export const revalidate = 0;

import { unstable_noStore as noStore } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { AdminContent } from "./AdminContent";
import type { Participant, Interview, InterviewExport } from "@/lib/types";

export const metadata = {
  title: "Admin — AVP Interview System",
  robots: "noindex, nofollow",
};

export default async function AdminPage() {
  noStore();
  const supabase = createServiceClient();

  // Capture the study_id the admin's browser is *currently* signed in as so
  // the dashboard can show it. This makes the "Login as" flow transparent —
  // you can see at a glance which participant the cookies are pointing at.
  let currentSignedInAs: string | null = null;
  try {
    const ssr = await createClient();
    const { data: { user } } = await ssr.auth.getUser();
    if (user) {
      const { data: me } = await supabase
        .from("participants")
        .select("study_id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      currentSignedInAs = (me as { study_id?: string } | null)?.study_id ?? null;
    }
  } catch {
    // Non-fatal — admin still works without this hint.
  }

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
      currentSignedInAs={currentSignedInAs}
    />
  );
}
