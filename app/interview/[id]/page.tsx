import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InterviewClient } from "./InterviewClient";
import type { TranscriptTurn, Interview, Participant } from "@/lib/types";

interface InterviewPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: InterviewPageProps) {
  const { id } = await params;
  return { title: `Interview ${id.slice(0, 8)}... — AVP Life Story` };
}

export default async function InterviewPage({ params }: InterviewPageProps) {
  const { id: interviewId } = await params;

  const supabase = await createClient();

  // Verify auth
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Load interview
  const { data: interview, error: iError } = await supabase
    .from("interviews")
    .select("*")
    .eq("id", interviewId)
    .single();

  if (iError || !interview) notFound();

  // If completed, redirect to completion page
  if ((interview as Interview).completed) {
    redirect(`/complete?interview_id=${interviewId}`);
  }

  // Load participant for display
  const { data: participant } = await supabase
    .from("participants")
    .select("study_id")
    .eq("id", (interview as Interview).participant_id)
    .single();

  // Load existing transcript turns
  const { data: turns } = await supabase
    .from("transcript_turns")
    .select("*")
    .eq("interview_id", interviewId)
    .order("turn_index", { ascending: true });

  return (
    <InterviewClient
      interview={interview as Interview}
      initialTurns={(turns ?? []) as TranscriptTurn[]}
      studyId={(participant as Participant | null)?.study_id ?? ""}
    />
  );
}
