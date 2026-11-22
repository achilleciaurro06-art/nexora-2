import { cn } from "@/lib/utils";
import { QUOTE_STATUS_LABEL, type QuoteStatus } from "@/types/domain";

const TONE: Record<QuoteStatus, string> = {
  draft: "border-border bg-foreground/[0.05] text-foreground/80",
  sent: "border-primary/30 bg-primary/10 text-primary",
  accepted: "border-success/30 bg-success/10 text-success",
  rejected: "border-danger/30 bg-danger/10 text-danger",
  expired: "border-warning/30 bg-warning/10 text-warning",
};

/** Stato del preventivo con colore: il testo resta sempre presente (il colore non è l'unico segnale). */
export function StatusBadge({ status, className }: { status: QuoteStatus; className?: string }) {
  return (
    <span data-status={status} className={cn("inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium", TONE[status], className)}>
      {QUOTE_STATUS_LABEL[status]}
    </span>
  );
}
