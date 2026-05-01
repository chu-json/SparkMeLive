"use client";

import { useState, useEffect } from "react";
import type { Participant, Interview, InterviewExport } from "@/lib/types";
import { Button } from "@/components/ui/Button";

interface AdminContentProps {
  participants: Participant[];
  interviews: Interview[];
  exports: InterviewExport[];
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
  interviews,
  exports: exportRecords,
}: AdminContentProps) {
  const [participants, setParticipants] = useState<Participant[]>(initialParticipants);
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [newStudyId, setNewStudyId] = useState("TEST001");
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportUrls, setExportUrls] = useState<Record<string, { json?: string; txt?: string }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/admin/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => null);
  }, []);

  const handleCreateParticipant = async () => {
    if (!newStudyId.trim()) return;
    setCreating(true);
    setCreateResult(null);

    try {
      const res = await fetch("/api/admin/participant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ study_id: newStudyId.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setCreateResult(`Error: ${data.error}`);
      } else if (data.created) {
        setCreateResult(`Created participant "${data.participant.study_id}" successfully.`);
        setParticipants((prev) => [data.participant, ...prev]);
      } else {
        setCreateResult(`Participant "${data.participant.study_id}" already exists.`);
      }
    } catch {
      setCreateResult("Request failed. Is the dev server running?");
    } finally {
      setCreating(false);
    }
  };

  const handleGenerateExport = async (interviewId: string) => {
    setExportingId(interviewId);
    setErrors((prev) => ({ ...prev, [interviewId]: "" }));

    try {
      const res = await fetch("/api/interview/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interview_id: interviewId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Export failed");

      setExportUrls((prev) => ({
        ...prev,
        [interviewId]: { json: data.json_url, txt: data.txt_url },
      }));
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [interviewId]: err instanceof Error ? err.message : "Export failed",
      }));
    } finally {
      setExportingId(null);
    }
  };

  const getInterviewsByParticipant = (participantId: string) =>
    interviews.filter((i) => i.participant_id === participantId);

  const getExportForInterview = (interviewId: string) =>
    exportRecords.find((e) => e.interview_id === interviewId);

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-stone-900">AVP Interview Admin</h1>
            <p className="text-xs text-stone-400 mt-0.5">Internal developer dashboard</p>
          </div>
          <div className="flex gap-4 text-sm text-stone-500">
            <span>{participants.length} participants</span>
            <span>{interviews.length} interviews</span>
            <span>{interviews.filter((i) => i.completed).length} completed</span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Configuration Status */}
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100">
            <h2 className="text-sm font-semibold text-stone-800">Configuration Status</h2>
          </div>
          <div className="px-6 py-4">
            {!status ? (
              <p className="text-sm text-stone-400">Checking...</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(status.checks).map(([key, check]) => (
                  <div key={key} className="flex items-start gap-3 text-sm">
                    <span className={`mt-0.5 flex-shrink-0 text-base ${check.ok ? "text-emerald-500" : "text-red-500"}`}>
                      {check.ok ? "✓" : "✗"}
                    </span>
                    <div>
                      <span className="font-mono text-xs text-stone-500">
                        {key.replace(/_/g, " ")}
                      </span>
                      {!check.ok && (
                        <p className="text-xs text-red-600 mt-0.5">{check.message}</p>
                      )}
                      {check.ok && key === "db_connection" && (
                        <p className="text-xs text-emerald-600 mt-0.5">Database connected</p>
                      )}
                    </div>
                  </div>
                ))}

                {!status.ok && (
                  <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                    <p className="font-medium mb-1">Setup required:</p>
                    <ol className="list-decimal ml-4 space-y-1 text-xs">
                      <li>
                        Get your <strong>Service Role Key</strong> from{" "}
                        <a
                          href="https://supabase.com/dashboard"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          Supabase Dashboard
                        </a>{" "}
                        → Settings → API → <code>service_role</code> key
                      </li>
                      <li>
                        Add it to <code>.env.local</code>:{" "}
                        <code>SUPABASE_SERVICE_ROLE_KEY=eyJ...</code>
                      </li>
                      <li>
                        Apply the schema: paste{" "}
                        <code>supabase/migrations/001_initial.sql</code> into Supabase SQL
                        Editor and run it
                      </li>
                      <li>
                        Create Storage buckets named <code>audio</code> and{" "}
                        <code>exports</code> (Supabase → Storage → New bucket)
                      </li>
                      <li>Restart the dev server after updating .env.local</li>
                    </ol>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Create Participant */}
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100">
            <h2 className="text-sm font-semibold text-stone-800">Create Participant</h2>
            <p className="text-xs text-stone-400 mt-0.5">
              Add a new study ID. The participant can then log in at /login.
            </p>
          </div>
          <div className="px-6 py-4">
            <div className="flex gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">
                  Study ID
                </label>
                <input
                  type="text"
                  value={newStudyId}
                  onChange={(e) => setNewStudyId(e.target.value.toUpperCase())}
                  placeholder="e.g. P001"
                  className="
                    rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono
                    text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-400
                    w-36
                  "
                  onKeyDown={(e) => e.key === "Enter" && handleCreateParticipant()}
                />
              </div>
              <Button
                size="md"
                loading={creating}
                onClick={handleCreateParticipant}
                disabled={!newStudyId.trim()}
              >
                Create
              </Button>
            </div>
            {createResult && (
              <p
                className={`mt-3 text-sm ${
                  createResult.startsWith("Error") ? "text-red-600" : "text-emerald-600"
                }`}
              >
                {createResult}
              </p>
            )}
          </div>
        </div>

        {/* Participants & Interviews */}
        <div>
          <h2 className="text-sm font-semibold text-stone-700 mb-3 px-1">Participants</h2>
          {participants.length === 0 ? (
            <div className="bg-white rounded-xl border border-stone-200 p-10 text-center">
              <p className="text-stone-400 text-sm">
                No participants yet. Create one above or run{" "}
                <code className="font-mono bg-stone-100 px-1.5 py-0.5 rounded text-xs">
                  npm run seed
                </code>
                .
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {participants.map((participant) => {
                const pInterviews = getInterviewsByParticipant(participant.id);
                return (
                  <div
                    key={participant.id}
                    className="bg-white rounded-xl border border-stone-200 overflow-hidden"
                  >
                    <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-semibold text-stone-800">
                          {participant.study_id}
                        </span>
                        <span className="text-xs text-stone-300">{participant.id.slice(0, 8)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={participant.status} />
                        <span className="text-xs text-stone-400">
                          {new Date(participant.created_at).toLocaleDateString()}
                        </span>
                        <a
                          href={`/login`}
                          className="text-xs text-stone-500 hover:text-stone-800 underline underline-offset-2"
                        >
                          Login as this participant →
                        </a>
                      </div>
                    </div>

                    {pInterviews.length === 0 ? (
                      <div className="px-6 py-4 text-sm text-stone-400">
                        No interviews yet — participant must log in to start one.
                      </div>
                    ) : (
                      <div className="divide-y divide-stone-100">
                        {pInterviews.map((interview) => {
                          const existingExport = getExportForInterview(interview.id);
                          const urls = exportUrls[interview.id];
                          const isExporting = exportingId === interview.id;
                          const exportError = errors[interview.id];

                          return (
                            <div key={interview.id} className="px-6 py-4">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-mono text-xs text-stone-500">
                                      {interview.id.slice(0, 8)}
                                    </span>
                                    <InterviewStatusBadge completed={interview.completed} />
                                    <span className="text-xs text-stone-400 uppercase tracking-wide">
                                      {interview.mode}
                                    </span>
                                  </div>
                                  <div className="text-xs text-stone-400 space-x-3">
                                    {interview.started_at && (
                                      <span>
                                        Started:{" "}
                                        {new Date(interview.started_at).toLocaleString()}
                                      </span>
                                    )}
                                    {interview.ended_at && (
                                      <span>
                                        Ended:{" "}
                                        {new Date(interview.ended_at).toLocaleString()}
                                      </span>
                                    )}
                                    {interview.audio_path && (
                                      <span className="text-emerald-600">Audio saved</span>
                                    )}
                                  </div>
                                  {exportError && (
                                    <p className="mt-2 text-xs text-red-600">{exportError}</p>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <a
                                    href={`/interview/${interview.id}`}
                                    className="text-xs text-stone-500 hover:text-stone-800 underline underline-offset-2"
                                  >
                                    Open
                                  </a>
                                  {(urls?.txt || existingExport?.txt_path) && (
                                    <a
                                      href={urls?.txt ?? "#"}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-stone-500 hover:text-stone-800 underline underline-offset-2"
                                    >
                                      .txt
                                    </a>
                                  )}
                                  {(urls?.json || existingExport?.json_path) && (
                                    <a
                                      href={urls?.json ?? "#"}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-stone-500 hover:text-stone-800 underline underline-offset-2"
                                    >
                                      .json
                                    </a>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    loading={isExporting}
                                    onClick={() => handleGenerateExport(interview.id)}
                                  >
                                    {isExporting ? "Exporting..." : "Export"}
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

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700",
    completed: "bg-blue-100 text-blue-700",
    withdrawn: "bg-stone-100 text-stone-500",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? colors.active}`}
    >
      {status}
    </span>
  );
}

function InterviewStatusBadge({ completed }: { completed: boolean }) {
  return completed ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
      completed
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
      in progress
    </span>
  );
}
