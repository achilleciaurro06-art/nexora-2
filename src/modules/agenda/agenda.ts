import { addDays, todayIn } from "@/lib/datetime";
import { PRIORITY_ORDER, type Priority } from "./types";

export type AgendaKind = "task" | "follow_up" | "appointment" | "quote_followup";
export type AgendaItem = {
  kind: AgendaKind; id: string; title: string; when_at: string | null; when_date: string | null; has_time: boolean; status: string;
  is_open: boolean; is_done: boolean; priority: Priority; assignee_id: string | null; customer_id: string | null; customer_name: string | null;
  customer_archived: boolean | null; type_key: string; completed_at: string | null; href: string;
};
export const AGENDA_KIND_LABEL: Record<AgendaKind, string> = { task: "Attività", follow_up: "Follow-up", appointment: "Appuntamento", quote_followup: "Follow-up preventivo" };

export type View = "today" | "overdue" | "upcoming" | "done";
export type Filters = { assignee?: string | null; type?: string | null; priority?: string | null };
export const UPCOMING_DAYS = 14;

/**
 * Ogni elemento sta in UNA sola vista: completato; in ritardo (aperto con data precedente a oggi — per un appuntamento significa
 * "passato e non ancora chiuso"); oggi; prossimi (futuri o senza data). "Oggi" è la data odierna nel fuso dell'azienda.
 */
export function viewOf(i: AgendaItem, now: Date, tz?: string): View | "other" {
  if (i.is_done) return "done";
  if (!i.is_open) return "other";
  if (!i.when_date) return "upcoming";
  const today = todayIn(now, tz);
  if (i.when_date < today) return "overdue";
  return i.when_date === today ? "today" : "upcoming";
}

/** Richiede un'azione ora (urgente/in ritardo/oggi) oppure è soltanto programmato. */
export function needsAction(i: AgendaItem, now: Date, tz?: string): boolean {
  const v = viewOf(i, now, tz);
  if (v === "overdue") return true;
  if (v === "today") return !(i.kind === "follow_up" && (i.status === "scheduled" || i.status === "waiting"));
  return false;
}

export function applyFilters(items: AgendaItem[], f: Filters): AgendaItem[] {
  return items.filter((i) =>
    (!f.assignee || (f.assignee === "none" ? i.assignee_id === null : i.assignee_id === f.assignee)) &&
    (!f.type || (["task", "follow_up", "appointment", "quote_followup"].includes(f.type) ? i.kind === f.type : i.kind === "task" && i.type_key === f.type)) &&
    (!f.priority || i.priority === f.priority));
}

const prio = (i: AgendaItem) => PRIORITY_ORDER[i.priority] ?? 2;
const byWhen = (a: AgendaItem, b: AgendaItem) =>
  (a.when_at ?? "9999").localeCompare(b.when_at ?? "9999") || prio(a) - prio(b) || a.title.localeCompare(b.title);

export function bucketAgenda(items: AgendaItem[], now: Date, tz?: string, doneLimit = 50) {
  const out: Record<View, AgendaItem[]> = { today: [], overdue: [], upcoming: [], done: [] };
  const until = addDays(todayIn(now, tz), UPCOMING_DAYS);
  for (const i of items) {
    const v = viewOf(i, now, tz);
    if (v === "other") continue;
    if (v === "upcoming" && i.when_date && i.when_date > until) continue; // oltre l'orizzonte: non è lavoro "prossimo"
    out[v].push(i);
  }
  out.overdue.sort(byWhen); out.today.sort((a, b) => prio(a) - prio(b) || byWhen(a, b)); out.upcoming.sort(byWhen);
  out.done.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  out.done = out.done.slice(0, doneLimit);
  return out;
}

export function agendaCounts(items: AgendaItem[], now: Date, tz?: string) {
  const b = bucketAgenda(items, now, tz);
  return {
    today: b.today.length, overdue: b.overdue.length, upcoming: b.upcoming.length, done: b.done.length,
    urgent: [...b.overdue, ...b.today].filter((i) => i.priority === "urgent").length,
    needsAction: [...b.overdue, ...b.today].filter((i) => needsAction(i, now, tz)).length,
  };
}
