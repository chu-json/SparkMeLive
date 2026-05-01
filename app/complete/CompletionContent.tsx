"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

interface ExportState {
  json_url?: string;
  txt_url?: string;
  generating: boolean;
  error: string | null;
}

export function CompletionContent() {
  const searchParams = useSearchParams();
  const interviewId = searchParams.get("interview_id");

  const [exportState, setExportState] = useState<ExportState>({
    generating: false,
    error: null,
  });

  useEffect(() => {
    if (interviewId) {
      checkExistingExport();
    }
  }, [interviewId]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkExistingExport = async () => {
    if (!interviewId) return;

    try {
      const res = await fetch(`/api/interview/export?interview_id=${interviewId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.exists && (data.json_url || data.txt_url)) {
          setExportState({
            json_url: data.json_url,
            txt_url: data.txt_url,
            generating: false,
            error: null,
          });
        }
      }
    } catch {
      // Ignore — user can generate manually
    }
  };

  const generateExport = async () => {
    if (!interviewId) return;

    setExportState((prev) => ({ ...prev, generating: true, error: null }));

    try {
      const res = await fetch("/api/interview/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interview_id: interviewId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Export failed");
      }

      const data = await res.json();
      setExportState({
        json_url: data.json_url,
        txt_url: data.txt_url,
        generating: false,
        error: null,
      });
    } catch (err) {
      setExportState({
        generating: false,
        error: err instanceof Error ? err.message : "Export failed",
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-stone-50">
      <div className="w-full max-w-lg">
        {/* Completion card */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-10 text-center">
          {/* Icon */}
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 mb-6">
            <svg
              className="w-6 h-6 text-emerald-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <h1 className="text-2xl font-semibold text-stone-900 mb-3">
            Interview Complete
          </h1>
          <p className="text-stone-500 text-sm leading-relaxed mb-8 max-w-sm mx-auto">
            Thank you for taking the time to share your story. Your responses
            have been saved and will contribute to the research.
          </p>

          {/* Export section */}
          <div className="border-t border-stone-100 pt-6">
            <h2 className="text-sm font-medium text-stone-700 mb-4">
              Download Transcript
            </h2>

            {exportState.error && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-700">{exportState.error}</p>
              </div>
            )}

            {exportState.json_url || exportState.txt_url ? (
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                {exportState.txt_url && (
                  <a
                    href={exportState.txt_url}
                    download={`interview-${interviewId?.slice(0, 8)}.txt`}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-stone-300 text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors"
                  >
                    <DownloadIcon className="w-4 h-4" />
                    Transcript (.txt)
                  </a>
                )}
                {exportState.json_url && (
                  <a
                    href={exportState.json_url}
                    download={`interview-${interviewId?.slice(0, 8)}.json`}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-stone-300 text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors"
                  >
                    <DownloadIcon className="w-4 h-4" />
                    Data export (.json)
                  </a>
                )}
              </div>
            ) : (
              <Button
                variant="secondary"
                onClick={generateExport}
                loading={exportState.generating}
                disabled={!interviewId}
              >
                {exportState.generating ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    Generating export...
                  </>
                ) : (
                  "Generate & Download Transcript"
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Footer note */}
        <p className="mt-6 text-center text-xs text-stone-400 leading-relaxed">
          Your interview data is stored securely. If you have any questions,
          please contact the research team.
        </p>
      </div>
    </div>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}
