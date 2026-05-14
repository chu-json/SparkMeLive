"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

export function LoginForm({ defaultStudyId = "" }: { defaultStudyId?: string }) {
  const [studyId, setStudyId] = useState(defaultStudyId);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!studyId.trim()) {
      setError("Please enter your participant ID.");
      return;
    }

    setLoading(true);

    try {
      // Call login API
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ study_id: studyId.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Login failed. Please try again.");
        return;
      }

      // Set Supabase session client-side using the returned tokens
      const supabase = createClient();
      await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });

      // Navigate to the interview
      router.push(`/interview/${data.interview_id}`);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label
          htmlFor="study_id"
          className="block text-sm font-medium text-stone-700 mb-1.5"
        >
          Participant ID
        </label>
        <input
          id="study_id"
          type="text"
          value={studyId}
          onChange={(e) => setStudyId(e.target.value)}
          placeholder="e.g. P001"
          autoComplete="off"
          autoFocus
          disabled={loading}
          className="
            w-full rounded-lg border border-stone-300 px-4 py-2.5
            text-stone-900 placeholder-stone-400 text-sm
            focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-transparent
            disabled:opacity-50
          "
        />
        <p className="mt-1.5 text-xs text-stone-400">
          Your participant ID was provided to you by the research team.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <Button
        type="submit"
        loading={loading}
        disabled={!studyId.trim()}
        className="w-full"
        size="lg"
      >
        {loading ? "Signing in..." : "Begin Interview"}
      </Button>
    </form>
  );
}
