"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Participant, Interview, InterviewExport } from "@/lib/types";
import { Button } from "@/components/ui/Button";

interface AdminContentProps {
  participants: Participant[];
  interviews: Interview[];
  exports: InterviewExport[];
  turnCounts: Record<string, number>;
  /**
   * The study_id this browser session is currently authenticated as, if any.
   * Used to make the "Login as" flow transparent — the admin can see at a
   * glance which participant their cookies are pointing at.
   */
  currentSignedInAs?: string | null;
}

interface StatusCheck {
  ok: boolean;
  message: string;
}

interface StatusResult {
  ok: boolean;
  checks: Record<string, StatusCheck>;
}

export function AdminContent({
  participants: initialParticipants,
  interviews: initialInterviews,
  exports: exportRecords,
  turnCounts,
  currentSignedInAs,
}: AdminContentProps) {
  const router = useRouter();

  const [participants, setParticipants]   = useState<Participant[]>(initialParticipants);
  const [interviews, setInterviews]       = useState<Interview[]>(initialInterviews);
  const [status, setStatus]               = useState<StatusResult | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // Create participant state
  const [newStudyId, setNewStudyId]       = useState("TEST001");
  const [creating, setCreating]           = useState(false);
  const [createResult, setCreateResult]   = useState<{ ok: boolean; msg: string } | null>(null);

  // Bulk seed state
  const [seeding, setSeeding]             = useState(false);
  const [seedResult, setSeedResult]       = useState<{ ok: boolean; msg: string } | null>(null);

  // Delete confirmation — stores the participant id being confirmed
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting]               = useState(false);

  // Export state
  const [exportingId, setExportingId]     = useState<string | null>(null);
  const [exportUrls, setExportUrls]       = useState<Record<string, { json?: string; txt?: string }>>({});
  const [exportErrors, setExportErrors]   = useState<Record<string, string>>({});

  // ── Status check ────────────────────────────────────────────────────────────

  const handleCheckStatus = async () => {
    setStatusLoading(true);
    try {
      const r = await fetch("/api/admin/status");
      setStatus(await r.json());
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  };

  // ── Create participant ───────────────────────────────────────────────────────

  const handleCreateParticipant = async () => {
    if (!newStudyId.trim()) return;
    setCreating(true);
    setCreateResult(null);

    try {
      const res  = await fetch("/api/admin/participant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ study_id: newStudyId.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setCreateResult({ ok: false, msg: data.error ?? "Unknown error" });
      } else if (data.created) {
        setCreateResult({ ok: true, msg: `Created "${data.participant.study_id}"` });
        setParticipants((prev) => [data.participant as Participant, ...prev]);
        setNewStudyId("");
      } else {
        setCreateResult({ ok: false, msg: `"${data.participant.study_id}" already exists` });
      }
    } catch {
      setCreateResult({ ok: false, msg: "Request failed — is the dev server running?" });
    } finally {
      setCreating(false);
    }
  };

  // ── Bulk seed ────────────────────────────────────────────────────────────────

  const handleSeedTestParticipants = async () => {
    setSeeding(true);
    setSeedResult(null);
    const ids = Array.from({ length: 10 }, (_, i) => `TEST${String(i + 1).padStart(3, "0")}`);
    let created = 0;
    let skipped = 0;

    for (const id of ids) {
      try {
        const res  = await fetch("/api/admin/participant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ study_id: id }),
        });
        const data = await res.json();
        if (!res.ok) {
          setSeedResult({ ok: false, msg: `Error creating ${id}: ${data.error}` });
          setSeeding(false);
          return;
        }
        if (data.created) {
          created++;
          setParticipants((prev) => [data.participant as Participant, ...prev]);
        } else {
          skipped++;
        }
      } catch {
        setSeedResult({ ok: false, msg: "Request failed — is the dev server running?" });
        setSeeding(false);
        return;
      }
    }

    setSeedResult({
      ok: true,
      msg: created > 0
        ? `Created ${created}${skipped > 0 ? `, ${skipped} already existed` : ""}`
        : `All ${skipped} already exist`,
    });
    setSeeding(false);
  };

  // ── Delete participant ───────────────────────────────────────────────────────

  const handleDeleteParticipant = async (participantId: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/participant?id=${participantId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(`Delete failed: ${data.error ?? "unknown error"}`);
        return;
      }
      // Remove from both local states
      setParticipants((prev) => prev.filter((p) => p.id !== participantId));
      setInterviews((prev) => prev.filter((i) => i.participant_id !== participantId));
      setConfirmDeleteId(null);
      // Refresh server data to stay in sync
      router.refresh();
    } catch {
      alert("Delete request failed.");
    } finally {
      setDeleting(false);
    }
  };

  // ── Export ───────────────────────────────────────────────────────────────────

  const triggerBlobDownload = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerateExport = async (interviewId: string, studyId: string) => {
    setExportingId(interviewId);
    setExportErrors((prev) => ({ ...prev, [interviewId]: "" }));

    try {
      const res  = await fetch("/api/interview/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interview_id: interviewId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Export failed");

      // Always download directly from response content (no Storage required)
      const slug = `${studyId}-${interviewId.slice(0, 8)}`;
      if (data.txt_content) {
        triggerBlobDownload(data.txt_content, `transcript-${slug}.txt`, "text/plain");
      }
      if (data.json_content) {
        triggerBlobDownload(data.json_content, `transcript-${slug}.json`, "application/json");
      }

      // Store signed URLs if storage returned them (bonus)
      if (data.txt_url || data.json_url) {
        setExportUrls((prev) => ({
          ...prev,
          [interviewId]: { json: data.json_url || undefined, txt: data.txt_url || undefined },
        }));
      }
    } catch (err) {
      setExportErrors((prev) => ({
        ...prev,
        [interviewId]: err instanceof Error ? err.message : "Export failed",
      }));
    } finally {
      setExportingId(null);
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const getInterviewsByParticipant = (participantId: string) =>
    interviews.filter((i) => i.participant_id === participantId);

  const getExportForInterview = (interviewId: string) =>
    exportRecords.find((e) => e.interview_id === interviewId);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-stone-50">

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-stone-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-stone-900">Interview Admin</h1>
            <p className="text-xs text-stone-400 mt-0.5">Internal developer dashboard</p>
          </div>
          <div className="flex items-center gap-5">
            {currentSignedInAs && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full
                              bg-emerald-50 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-[11px] text-emerald-700">
                  Signed in as <span className="font-mono font-semibold">{currentSignedInAs}</span>
                </span>
              </div>
            )}
            <div className="flex gap-4 text-xs text-stone-500">
              <span>{participants.length} participants</span>
              <span>{interviews.length} interviews</span>
              <span>{interviews.filter((i) => i.completed).length} completed</span>
            </div>
            <button
              onClick={() => router.refresh()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200
                         text-xs text-stone-500 hover:text-stone-800 hover:bg-stone-50
                         transition-colors"
            >
              <RefreshIcon className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* ── Config status ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-6 py-3.5 border-b border-stone-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-stone-800">Configuration Status</h2>
            <button
              onClick={handleCheckStatus}
              disabled={statusLoading}
              className="text-xs text-stone-400 hover:text-stone-700 transition-colors disabled:opacity-50"
            >
              {statusLoading ? "Checking…" : status ? "Re-check" : "Check now"}
            </button>
          </div>
          <div className="px-6 py-4">
            {!status ? (
              <p className="text-sm text-stone-400">
                Click &ldquo;Check now&rdquo; to verify your configuration.
              </p>
            ) : (
              <div className="space-y-2">
                {Object.entries(status.checks).map(([key, check]) => (
                  <div key={key} className="flex items-start gap-3 text-sm">
                    <span className={`mt-0.5 flex-shrink-0 ${check.ok ? "text-emerald-500" : "text-red-500"}`}>
                      {check.ok ? "✓" : "✗"}
                    </span>
                    <div>
                      <span className="font-mono text-xs text-stone-500">
                        {key.replace(/_/g, " ")}
                      </span>
                      {!check.ok && (
                        <p className="text-xs text-red-600 mt-0.5">{check.message}</p>
                      )}
                    </div>
                  </div>
                ))}
                {!status.ok && (
                  <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
                    One or more configuration issues detected — see above.
                  </div>
                )}
                {status.ok && (
                  <p className="text-xs text-emerald-600 mt-1">All checks passed.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Create participant ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-6 py-3.5 border-b border-stone-100">
            <h2 className="text-sm font-semibold text-stone-800">Create Participant</h2>
            <p className="text-xs text-stone-400 mt-0.5">
              Add a new study ID. The participant logs in at /login.
            </p>
          </div>
          <div className="px-6 py-4">
            <div className="flex flex-wrap gap-3 items-end">
              {/* Single create */}
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Study ID</label>
                <input
                  type="text"
                  value={newStudyId}
                  onChange={(e) => { setNewStudyId(e.target.value.toUpperCase()); setCreateResult(null); }}
                  placeholder="e.g. P001"
                  className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono
                             text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-400 w-36"
                  onKeyDown={(e) => e.key === "Enter" && handleCreateParticipant()}
                />
              </div>
              <Button size="md" loading={creating} onClick={handleCreateParticipant} disabled={!newStudyId.trim()}>
                Create
              </Button>

              <div className="h-8 w-px bg-stone-200 mx-1 self-center" />

              {/* Bulk seed */}
              <div>
                <Button size="md" variant="secondary" loading={seeding} onClick={handleSeedTestParticipants}>
                  {seeding ? "Creating…" : "Seed TEST001–TEST010"}
                </Button>
                <p className="text-[11px] text-stone-400 mt-1">Idempotent — skips existing</p>
              </div>
            </div>

            {createResult && (
              <p className={`mt-3 text-sm font-medium ${createResult.ok ? "text-emerald-600" : "text-red-600"}`}>
                {createResult.ok ? "✓ " : "✗ "}{createResult.msg}
              </p>
            )}
            {seedResult && (
              <p className={`mt-3 text-sm font-medium ${seedResult.ok ? "text-emerald-600" : "text-red-600"}`}>
                {seedResult.ok ? "✓ " : "✗ "}{seedResult.msg}
              </p>
            )}
          </div>
        </div>

        {/* ── Participant list ────────────────────────────────────────────────── */}
        <div>
          <h2 className="text-sm font-semibold text-stone-700 mb-3 px-1">
            Participants ({participants.length})
          </h2>

          {participants.length === 0 ? (
            <div className="bg-white rounded-xl border border-stone-200 p-10 text-center">
              <p className="text-stone-400 text-sm">
                No participants yet. Create one above.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {participants.map((participant) => {
                const pInterviews    = getInterviewsByParticipant(participant.id);
                const isConfirming   = confirmDeleteId === participant.id;

                return (
                  <div
                    key={participant.id}
                    className="bg-white rounded-xl border border-stone-200 overflow-hidden"
                  >
                    {/* Participant header row */}
                    <div className="px-5 py-3.5 flex items-center justify-between gap-4
                                    border-b border-stone-100">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-sm font-semibold text-stone-800">
                          {participant.study_id}
                        </span>
                        <span className="text-[11px] text-stone-300 font-mono hidden sm:block">
                          {participant.id.slice(0, 8)}
                        </span>
                        <StatusBadge status={participant.status} />
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs text-stone-400 hidden sm:block">
                          {new Date(participant.created_at).toLocaleDateString()}
                        </span>

                        {/* Login link pre-filled with study_id.
                            When the admin is already signed in as this
                            participant we render it as an "Open" link so it
                            doesn't masquerade as an action that does nothing. */}
                        {currentSignedInAs === participant.study_id ? (
                          <span className="text-xs text-emerald-700 font-medium
                                           flex items-center gap-1">
                            <span className="w-1 h-1 rounded-full bg-emerald-500" />
                            Active session
                          </span>
                        ) : (
                          <a
                            href={`/login?id=${encodeURIComponent(participant.study_id)}`}
                            className="text-xs text-stone-700 hover:text-stone-900
                                       underline underline-offset-2 transition-colors
                                       font-medium"
                            title={
                              currentSignedInAs
                                ? `Switch from ${currentSignedInAs} to ${participant.study_id}`
                                : `Sign in as ${participant.study_id}`
                            }
                          >
                            Login as →
                          </a>
                        )}

                        {/* Delete / Confirm */}
                        {isConfirming ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-red-600 font-medium">Delete all data?</span>
                            <button
                              onClick={() => handleDeleteParticipant(participant.id)}
                              disabled={deleting}
                              className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-xs
                                         font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
                            >
                              {deleting ? "Deleting…" : "Yes, delete"}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2.5 py-1 rounded-lg border border-stone-200
                                         text-xs text-stone-500 hover:bg-stone-50 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(participant.id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border
                                       border-stone-200 text-xs text-stone-400 hover:text-red-600
                                       hover:border-red-200 hover:bg-red-50 transition-colors"
                          >
                            <TrashIcon className="w-3 h-3" />
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Interviews for this participant */}
                    {pInterviews.length === 0 ? (
                      <div className="px-5 py-3 text-xs text-stone-400">
                        No interviews yet — participant must log in to start one.
                      </div>
                    ) : (
                      <div className="divide-y divide-stone-100">
                        {pInterviews.map((interview) => {
                          const urls        = exportUrls[interview.id];
                          const isExporting = exportingId === interview.id;
                          const exportError = exportErrors[interview.id];
                          const turns       = turnCounts[interview.id] ?? 0;
                          const aiTurns     = Math.ceil(turns / 2);

                          return (
                            <div key={interview.id} className="px-5 py-3">
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3 min-w-0 flex-wrap">
                                  <span className="font-mono text-xs text-stone-400">
                                    {interview.id.slice(0, 8)}
                                  </span>
                                  <InterviewStatusBadge completed={interview.completed} />
                                  {turns > 0 && (
                                    <span className="text-xs text-stone-500">
                                      {aiTurns} Q asked · {turns} turns
                                    </span>
                                  )}
                                  {interview.started_at && (
                                    <span className="text-xs text-stone-400">
                                      {new Date(interview.started_at).toLocaleString()}
                                    </span>
                                  )}
                                  {exportError && (
                                    <span className="text-xs text-red-600">{exportError}</span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <a
                                    href={`/interview/${interview.id}`}
                                    className="text-xs text-stone-500 hover:text-stone-800
                                               underline underline-offset-2 transition-colors"
                                  >
                                    Open
                                  </a>
                                  {urls?.txt && (
                                    <a
                                      href={urls.txt}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-stone-500 hover:text-stone-800
                                                 underline underline-offset-2"
                                    >
                                      .txt
                                    </a>
                                  )}
                                  {urls?.json && (
                                    <a
                                      href={urls.json}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-stone-500 hover:text-stone-800
                                                 underline underline-offset-2"
                                    >
                                      .json
                                    </a>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    loading={isExporting}
                                    onClick={() => handleGenerateExport(interview.id, participant.study_id)}
                                  >
                                    {isExporting ? "Exporting…" : "Export"}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active:    "bg-emerald-100 text-emerald-700",
    completed: "bg-blue-100 text-blue-700",
    withdrawn: "bg-stone-100 text-stone-500",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium
                      ${colors[status] ?? colors.active}`}>
      {status}
    </span>
  );
}

function InterviewStatusBadge({ completed }: { completed: boolean }) {
  return completed ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium
                     bg-blue-100 text-blue-700">
      completed
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium
                     bg-amber-100 text-amber-700">
      in progress
    </span>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}
