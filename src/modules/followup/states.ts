/**
 * I sei stati del follow-up e ciò che significano:
 *  - todo (Da fare): ricontatto da eseguire, richiede azione; stato iniziale e di riapertura.
 *  - scheduled (Programmato): ricontatto fissato per la data indicata, nessuna azione finché non arriva.
 *  - in_progress (In corso): il ricontatto è iniziato (tentativi, trattativa aperta).
 *  - waiting (In attesa): la nostra parte è fatta, si attende risposta del cliente o di terzi; la data è il momento di verifica.
 *  - done (Completato) / cancelled (Annullato): chiusi; la cronologia resta. Si possono solo riaprire in "Da fare".
 */
export const FOLLOW_UP_STATUSES = [
  { key: "todo", label: "Da fare", help: "Ricontatto da eseguire: richiede un'azione." },
  { key: "scheduled", label: "Programmato", help: "Fissato per la data indicata: nessuna azione fino ad allora." },
  { key: "in_progress", label: "In corso", help: "Il ricontatto è iniziato." },
  { key: "waiting", label: "In attesa", help: "Hai fatto la tua parte: attendi una risposta. La data è il momento di verifica." },
  { key: "done", label: "Completato", help: "Concluso. Resta nello storico." },
  { key: "cancelled", label: "Annullato", help: "Non serve più. Resta nello storico." },
] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number]["key"];
export const FOLLOW_UP_LABEL = Object.fromEntries(FOLLOW_UP_STATUSES.map((s) => [s.key, s.label])) as Record<FollowUpStatus, string>;
export const OPEN_STATUSES: readonly FollowUpStatus[] = ["todo", "scheduled", "in_progress", "waiting"];
export const isFollowUpStatus = (v: unknown): v is FollowUpStatus => FOLLOW_UP_STATUSES.some((s) => s.key === v);
export const isOpen = (s: FollowUpStatus) => OPEN_STATUSES.includes(s);

/** Stesse regole del database (trigger follow_ups_guard): gli aperti si muovono liberamente, i chiusi solo verso "Da fare". */
export function allowedTransitions(from: FollowUpStatus): FollowUpStatus[] {
  if (from === "done" || from === "cancelled") return ["todo"];
  return FOLLOW_UP_STATUSES.map((s) => s.key).filter((k) => k !== from);
}

/** In ritardo: aperto e con data prevista precedente a oggi (date pure "YYYY-MM-DD", stesso fuso). */
export function isOverdue(status: FollowUpStatus, dueOn: string, today: string): boolean {
  return isOpen(status) && dueOn < today;
}
/** Richiede azione immediata: da fare o in corso, scaduto o in scadenza oggi. Programmato/in attesa non richiedono azione finché la data non è passata. */
export function needsActionNow(status: FollowUpStatus, dueOn: string, today: string): boolean {
  if (!isOpen(status)) return false;
  if (dueOn < today) return true;
  return dueOn === today && (status === "todo" || status === "in_progress");
}
