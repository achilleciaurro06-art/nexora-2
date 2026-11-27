import { StatusChip, type Tone } from "@/components/ui/status-chip";
import { AlertTriangle, Check, CircleDot, Clock, Hourglass, Minus, Play } from "lucide-react";
import { FOLLOW_UP_LABEL, type FollowUpStatus } from "../states";

/** Da gestire / in attesa = ambra; programmato / in corso = blu; fatto = verde; annullato = grigio; in ritardo = rosso. */
const TONE: Record<FollowUpStatus, { tone: Tone; icon: typeof Clock }> = {
  todo: { tone: "warning", icon: Clock },
  scheduled: { tone: "info", icon: CircleDot },
  in_progress: { tone: "info", icon: Play },
  waiting: { tone: "warning", icon: Hourglass },
  done: { tone: "success", icon: Check },
  cancelled: { tone: "neutral", icon: Minus },
};

/** Stato del follow-up; testo e icona sempre presenti (il colore non è l'unico segnale). */
export function FollowUpBadge({ status, overdue, className }: { status: FollowUpStatus; overdue?: boolean; className?: string }) {
  const t = TONE[status];
  return (
    <span className="inline-flex items-center gap-1">
      <StatusChip data-status={status} round tone={t.tone} icon={t.icon} className={className}>{FOLLOW_UP_LABEL[status]}</StatusChip>
      {overdue && <StatusChip data-overdue round tone="danger" icon={AlertTriangle}>In ritardo</StatusChip>}
    </span>
  );
}
