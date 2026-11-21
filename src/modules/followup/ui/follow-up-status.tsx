import { cn } from "@/lib/utils";
import { FOLLOW_UP_LABEL, type FollowUpStatus } from "../states";

const TONE: Record<FollowUpStatus, string> = {
  todo: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
  scheduled: "border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200",
  in_progress: "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
  waiting: "border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200",
  done: "border-green-300 bg-green-100 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200",
  cancelled: "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

/** Stato del follow-up; il testo è sempre presente (il colore non è l'unico segnale). */
export function FollowUpBadge({ status, overdue, className }: { status: FollowUpStatus; overdue?: boolean; className?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span data-status={status} className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", TONE[status], className)}>{FOLLOW_UP_LABEL[status]}</span>
      {overdue && <span data-overdue className="inline-flex items-center rounded-full border border-danger px-2 py-0.5 text-xs font-medium text-danger">In ritardo</span>}
    </span>
  );
}
