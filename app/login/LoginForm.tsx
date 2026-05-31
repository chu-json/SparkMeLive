"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

interface LoginFormProps {
  defaultStudyId?: string;
  /**
   * When true, the form auto-submits as soon as it mounts. Used by the admin
   * "Login as" flow — the admin already chose the participant via the
   * dashboard, so a second click on this page is just friction.
   */
  autoSubmit?: boolean;
}

export function LoginForm({ defaultStudyId = "", autoSubmit = false }: LoginFormProps) {
  const [studyId, setStudyId]   = useState(defaultStudyId);
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const router = useRouter();

  const submitLockRef = useRef(false);

  const doLogin = async (id: string) => {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setError(null);

    if (!id.trim()) {
      setError("Please enter your participant ID.");
      submitLockRef.current = false;
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ study_id: id.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Login failed. Please try again.");
        return;
      }

      // setSession() REPLACES whatever session the browser currently holds —
      // important for the admin "Login as" flow where we're switching out of
      // a different participant's session.
      const supabase = createClient();
      await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });

      router.push(`/interview/${data.interview_id}`);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
      submitLockRef.current = false;
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    void doLogin(studyId);
  };

  // Auto-submit when an ID has been pre-filled via ?id= (admin "Login as").
  // Fires exactly once per mount thanks to submitLockRef.
  useEffect(() => {
    if (!autoSubmit) return;
    if (!defaultStudyId.trim()) return;
    void doLogin(defaultStudyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While auto-submitting, show a friendlier "Signing in as X…" panel instead
  // of the empty form, so the admin understands what is happening.
  if (autoSubmit && defaultStudyId.trim() && !error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg bg-stone-100 px-4 py-3
                        border border-stone-200">
          <Spinner className="w-4 h-4 text-stone-500" />
          <p className="text-sm text-stone-700">
            Signing in as <span className="font-mono font-semibold">{defaultStudyId}</span>…
          </p>
        </div>
        <p className="text-xs text-stone-400 text-center">
          Switching sessions from the admin dashboard.
        </p>
      </div>
    );
  }

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

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? ""}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 01-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
