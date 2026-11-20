import { addDays } from "@/lib/datetime";

export type CalView = "mese" | "settimana" | "giorno";
export const CAL_VIEWS: { key: CalView; label: string }[] = [{ key: "mese", label: "Mese" }, { key: "settimana", label: "Settimana" }, { key: "giorno", label: "Giorno" }];
export const parseCalView = (v: string | undefined): CalView => (CAL_VIEWS.find((x) => x.key === v)?.key ?? "mese");
export const isDateStr = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

/** 0 = lunedì … 6 = domenica */
const weekdayMon = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
export const startOfWeek = (date: string) => addDays(date, -weekdayMon(date));
export const startOfMonth = (date: string) => `${date.slice(0, 7)}-01`;
export function addMonths(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12), nm = (t % 12) + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(+date.slice(8, 10), dim)).padStart(2, "0")}`;
}

export function weekDays(date: string): string[] { const s = startOfWeek(date); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
/** Settimane (lunedì–domenica) che coprono il mese, con i giorni dei mesi adiacenti. */
export function monthGrid(date: string): string[][] {
  const first = startOfMonth(date);
  const start = startOfWeek(first);
  const lastDay = addDays(addMonths(first, 1), -1);
  const weeks: string[][] = [];
  for (let s = start; s <= lastDay; s = addDays(s, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(s, i)));
  return weeks;
}

/** Intervallo di date visibile: [from, to) */
export function visibleRange(view: CalView, date: string): { from: string; to: string } {
  if (view === "giorno") return { from: date, to: addDays(date, 1) };
  if (view === "settimana") { const s = startOfWeek(date); return { from: s, to: addDays(s, 7) }; }
  const g = monthGrid(date);
  return { from: g[0]![0]!, to: addDays(g[g.length - 1]![6]!, 1) };
}
export function shiftDate(view: CalView, date: string, dir: -1 | 1): string {
  return view === "giorno" ? addDays(date, dir) : view === "settimana" ? addDays(date, 7 * dir) : addMonths(date, dir);
}
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
export function titleFor(view: CalView, date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  if (view === "mese") return `${MONTHS[m - 1]} ${y}`;
  if (view === "giorno") return `${d} ${MONTHS[m - 1]} ${y}`;
  const days = weekDays(date); const a = days[0]!, b = days[6]!;
  return `${+a.slice(8)} ${MONTHS[+a.slice(5, 7) - 1]} – ${+b.slice(8)} ${MONTHS[+b.slice(5, 7) - 1]} ${b.slice(0, 4)}`;
}
