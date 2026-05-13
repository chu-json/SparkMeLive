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
    // Auth user exists but no participant row — clear session and go to login
    redirect("/login");
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
    redirect("/login");
  }

  if (interview.completed) {
    redirect(`/complete?interview_id=${interview.id}`);
  }

  redirect(`/interview/${interview.id}`);
}
