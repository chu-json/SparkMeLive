import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Find the participant record linked to this auth user
  const { data: participant } = await supabase
    .from("participants")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!participant) {
    // Auth user exists but no matching participant row (orphaned/stale session,
    // e.g. after a DB reseed). Clear the cookies via the logout route instead of
    // bouncing to /login — otherwise middleware sees the still-valid user and
    // redirects back to "/", creating an infinite loop.
    redirect("/api/auth/logout");
  }

  // Find their most recent interview
  const { data: interview } = await supabase
    .from("interviews")
    .select("id, completed")
    .eq("participant_id", participant.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!interview) {
    // Participant exists but has no interview row — same loop risk as above.
    // Clear the session so re-login through the API recreates a fresh interview.
    redirect("/api/auth/logout");
  }

  if (interview.completed) {
    redirect(`/complete?interview_id=${interview.id}`);
  }

  redirect(`/interview/${interview.id}`);
}
