import { QUOTE_STATUS_LABEL, type QuoteStatus } from "@/types/domain";
import { ICON, StatusChip, TONE_BAR, type Tone } from "./status-chip";

/** Tono e icona di ogni stato del preventivo (stessa semantica del resto dell'app). */
export const QUOTE_STATUS_TONE: Record<QuoteStatus, Tone> = { draft: "warning", sent: "warning", accepted: "success", rejected: "danger", expired: "neutral" };
export const QUOTE_STATUS_ICON = { draft: ICON.draft, sent: ICON.sent, accepted: undefined, rejected: undefined, expired: ICON.closed } as const;
export const quoteStatusBar = (s: QuoteStatus) => TONE_BAR[QUOTE_STATUS_TONE[s]];

/** Stato del preventivo con colore: il testo e l'icona restano sempre presenti (il colore non è l'unico segnale). */
export function StatusBadge({ status, className }: { status: QuoteStatus; className?: string }) {
  return <StatusChip data-status={status} tone={QUOTE_STATUS_TONE[status]} icon={QUOTE_STATUS_ICON[status]} className={className}>{QUOTE_STATUS_LABEL[status]}</StatusChip>;
}
