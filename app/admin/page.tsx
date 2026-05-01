// =============================================================================
// /admin — Internal developer dashboard
//
// Security note: This route has NO authentication in MVP.
// Before any shared or public deployment, add an env-var-based password
// check or restrict to localhost. Example:
//   if (process.env.ADMIN_ENABLED !== "true") return notFound()
//
// This page is for David and the research team to inspect sessions,
// view transcripts, and download exports during testing.
// =============================================================================

import { createServiceClient } from "@/lib/supabase/server";
import { AdminContent } from "./AdminContent";
import type { Participant, Interview, InterviewExport } from "@/lib/types";

export const metadata = {
  title: "Admin — AVP Interview System",
  robots: "noindex, nofollow",
};

export default async function AdminPage() {
  const supabase = createServiceClient();

  // Load participants with their interviews
  const { data: participants } = await supabase
    .from("participants")
    .select("*")
    .order("created_at", { ascending: false });

  const { data: interviews } = await supabase
    .from("interviews")
    .select("*")
    .order("created_at", { ascending: false });

  const { data: exports } = await supabase
    .from("interview_exports")
    .select("*");

  return (
    <AdminContent
      participants={(participants ?? []) as Participant[]}
      interviews={(interviews ?? []) as Interview[]}
      exports={(exports ?? []) as InterviewExport[]}
    />
  );
}
