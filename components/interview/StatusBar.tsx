interface StatusBarProps {
  status: "not_started" | "active" | "completed";
  turnCount: number;
  studyId?: string;
}

const STATUS_LABELS: Record<StatusBarProps["status"], string> = {
  not_started: "Not Started",
  active: "In Progress",
  completed: "Completed",
};

const STATUS_COLORS: Record<StatusBarProps["status"], string> = {
  not_started: "bg-stone-300",
  active: "bg-emerald-400",
  completed: "bg-blue-400",
};

export function StatusBar({ status, turnCount, studyId }: StatusBarProps) {
  const interviewerTurns = Math.ceil(turnCount / 2);

  return (
    <div className="flex items-center justify-between px-4 md:px-8 py-3 border-b border-stone-200 bg-stone-50">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[status]}`} />
          <span className="text-xs font-medium text-stone-600">
            {STATUS_LABELS[status]}
          </span>
        </div>
        {status === "active" && (
          <span className="text-xs text-stone-400">
            {interviewerTurns} question{interviewerTurns !== 1 ? "s" : ""} asked
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {studyId && (
          <span className="text-xs text-stone-400">
            ID: <span className="font-mono text-stone-500">{studyId}</span>
          </span>
        )}
        <span className="text-xs text-stone-400 hidden sm:block">
          AVP Life Story Interview
        </span>
      </div>
    </div>
  );
}
