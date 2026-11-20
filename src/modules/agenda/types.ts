export const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
export type Priority = keyof typeof PRIORITY_ORDER;

export const CALL_OUTCOMES = [
  { key: "answered", label: "Risposto" }, { key: "no_answer", label: "Nessuna risposta" }, { key: "busy", label: "Occupato" },
  { key: "callback", label: "Da richiamare" }, { key: "interested", label: "Interessato" }, { key: "not_interested", label: "Non interessato" }, { key: "other", label: "Altro" },
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number]["key"];
export const CALL_OUTCOME_LABEL = Object.fromEntries(CALL_OUTCOMES.map((o) => [o.key, o.label])) as Record<CallOutcome, string>;
export const CALL_DIRECTION_LABEL = { inbound: "In entrata", outbound: "In uscita" } as const;

export const APPOINTMENT_STATUS_LABEL = { scheduled: "Programmato", completed: "Completato", cancelled: "Annullato" } as const;
export type AppointmentStatus = keyof typeof APPOINTMENT_STATUS_LABEL;

/** Quando ricevere il promemoria (minuti prima). "" = nessun promemoria. */
export const REMINDER_OFFSETS = [
  { value: "", label: "Nessun promemoria", minutes: null }, { value: "0", label: "All'ora stabilita", minutes: 0 }, { value: "15", label: "15 minuti prima", minutes: 15 },
  { value: "60", label: "1 ora prima", minutes: 60 }, { value: "1440", label: "1 giorno prima", minutes: 1440 }, { value: "2880", label: "2 giorni prima", minutes: 2880 },
] as const;
export function parseReminderOffset(v: unknown): number | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  const found = REMINDER_OFFSETS.find((o) => o.value === String(v));
  return found ? found.minutes : "invalid";
}
