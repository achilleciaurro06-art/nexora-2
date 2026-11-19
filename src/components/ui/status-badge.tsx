import { cn } from "@/lib/utils";
import { QUOTE_STATUS_LABEL, type QuoteStatus } from "@/types/domain";

const TONE: Record<QuoteStatus, string> = {
  draft: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200",
  sent: "border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200",
  accepted: "border-green-300 bg-green-100 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200",
  rejected: "border-red-300 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200",
  expired: "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
};

/** Stato del preventivo con colore: il testo resta sempre presente (il colore non è l'unico segnale). */
export function StatusBadge({ status, className }: { status: QuoteStatus; className?: string }) {
  return (
    <span data-status={status} className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", TONE[status], className)}>
      {QUOTE_STATUS_LABEL[status]}
    </span>
  );
}
