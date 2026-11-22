import { cn } from "@/lib/utils";
import { FOLLOW_UP_LABEL, type FollowUpStatus } from "../states";

const TONE: Record<FollowUpStatus, string> = {
  todo: "border-danger/30 bg-danger/10 text-danger",
  scheduled: "border-primary/30 bg-primary/10 text-primary",
  in_progress: "border-warning/30 bg-warning/10 text-warning",
  waiting: "border-border bg-foreground/[0.05] text-foreground/80",
  done: "border-success/30 bg-success/10 text-success",
  cancelled: "border-border bg-foreground/[0.05] text-muted",
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
