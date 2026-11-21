/**
 * Date e orari con fuso orario ESPLICITO (mai quello del server o del browser).
 * Gli istanti si salvano in UTC (timestamptz); l'utente inserisce e vede l'ora locale dell'azienda.
 */
export const APP_TIMEZONE = "Europe/Rome";

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function parts(ms: number, tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    dtfCache.set(tz, f);
  }
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Scarto (ms) del fuso rispetto a UTC in un dato istante. */
export function tzOffsetMs(ms: number, tz: string = APP_TIMEZONE): number {
  const p = parts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/;

/** "2026-05-01T10:30" (ora locale del fuso) -> istante UTC (ISO). Ritorna null se non valido. Gli orari inesistenti (cambio ora legale) scorrono in avanti. */
export function zonedToUtcIso(local: string, tz: string = APP_TIMEZONE): string | null {
  const m = LOCAL_RE.exec(local);
  if (!m) return null;
  const [y, mo, d, h = "00", mi = "00"] = m.slice(1) as [string, string, string, string?, string?];
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  const check = new Date(asUtc);
  if (check.getUTCFullYear() !== +y || check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +d || +h > 23 || +mi > 59) return null;
  let guess = asUtc - tzOffsetMs(asUtc, tz);
  const off2 = tzOffsetMs(guess, tz);
  if (off2 !== tzOffsetMs(asUtc, tz)) guess = asUtc - off2;
  return new Date(guess).toISOString();
}

/** Istante -> { date: "YYYY-MM-DD", time: "HH:mm" } nel fuso indicato. */
export function utcToZonedParts(iso: string | Date, tz: string = APP_TIMEZONE): { date: string; time: string } {
  const p = parts(new Date(iso).getTime(), tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** Data odierna ("YYYY-MM-DD") nel fuso dell'azienda. */
export function todayIn(now: Date, tz: string = APP_TIMEZONE): string {
  return utcToZonedParts(now, tz).date;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Intervallo UTC [da, a) di un giorno locale (gestisce i giorni da 23/25 ore). */
export function dayRangeUtc(date: string, tz: string = APP_TIMEZONE): { from: string; to: string } {
  return { from: zonedToUtcIso(`${date}T00:00`, tz)!, to: zonedToUtcIso(`${addDays(date, 1)}T00:00`, tz)! };
}

const dfmt = (tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("it-IT", { timeZone: tz, ...o });
export const fmtDate = (iso: string | Date, tz: string = APP_TIMEZONE) => dfmt(tz, { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
export const fmtTime = (iso: string | Date, tz: string = APP_TIMEZONE) => dfmt(tz, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
export const fmtDateTime = (iso: string | Date, tz: string = APP_TIMEZONE) => `${fmtDate(iso, tz)} ${fmtTime(iso, tz)}`;
export const fmtLongDay = (iso: string | Date, tz: string = APP_TIMEZONE) => dfmt(tz, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
/** Una data pura "YYYY-MM-DD" (senza orario) mostrata senza spostamenti di fuso. */
export const fmtDay = (date: string) => { const [y, m, d] = date.split("-"); return `${d}/${m}/${y}`; };
