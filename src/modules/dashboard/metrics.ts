/** Metriche della dashboard: funzioni pure (testabili), calcolate su dati già filtrati dalla RLS. */

export const RANGES = [
  { key: "30", label: "30 giorni", days: 30 },
  { key: "90", label: "90 giorni", days: 90 },
  { key: "365", label: "12 mesi", days: 365 },
  { key: "all", label: "Tutto", days: null },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];

export function parseRange(v: string | undefined): (typeof RANGES)[number] {
  return RANGES.find((r) => r.key === v) ?? RANGES[2];
}

/** Inizio del periodo (mezzanotte UTC). Per "Tutto" si usa l'inizio dell'anno precedente per leggibilità dei grafici. */
export function rangeStart(days: number | null, now: Date): Date {
  if (days === null) return new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1));
  const d = new Date(now.getTime() - days * 86_400_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export type MonthBucket = { key: string; label: string };
export function monthBuckets(start: Date, now: Date): MonthBucket[] {
  const out: MonthBucket[] = [];
  let y = start.getUTCFullYear(), m = start.getUTCMonth();
  const endY = now.getUTCFullYear(), endM = now.getUTCMonth();
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, label: new Date(Date.UTC(y, m, 1)).toLocaleDateString("it-IT", { month: "short", timeZone: "UTC" }) });
    if (++m > 11) { m = 0; y++; }
  }
  return out;
}
export const monthKey = (iso: string) => iso.slice(0, 7);

export type QuoteLite = { status: string; total_cents: number; issue_date: string };

export function quotesByMonth(quotes: QuoteLite[], buckets: MonthBucket[]) {
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  const rows = buckets.map((b) => ({ ...b, count: 0, valueCents: 0, acceptedCents: 0 }));
  for (const q of quotes) {
    const i = idx.get(monthKey(q.issue_date));
    if (i === undefined) continue;
    const r = rows[i]!;
    r.count++; r.valueCents += Number(q.total_cents);
    if (q.status === "accepted") r.acceptedCents += Number(q.total_cents);
  }
  return rows;
}

export function countByMonth(dates: string[], buckets: MonthBucket[]) {
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  const rows = buckets.map((b) => ({ ...b, count: 0 }));
  for (const d of dates) { const i = idx.get(monthKey(d)); if (i !== undefined) rows[i]!.count++; }
  return rows;
}

export function periodSummary(quotes: QuoteLite[]) {
  const by = { draft: 0, sent: 0, accepted: 0, rejected: 0, expired: 0 } as Record<string, number>;
  let totalCents = 0, acceptedCents = 0;
  for (const q of quotes) {
    by[q.status] = (by[q.status] ?? 0) + 1;
    totalCents += Number(q.total_cents);
    if (q.status === "accepted") acceptedCents += Number(q.total_cents);
  }
  const decided = (by.accepted ?? 0) + (by.rejected ?? 0);
  return {
    count: quotes.length, totalCents, acceptedCents, byStatus: by, decided,
    /** Percentuale di accettazione sui soli preventivi decisi; null se non ce ne sono. */
    conversionPct: decided > 0 ? Math.round(((by.accepted ?? 0) / decided) * 100) : null,
  };
}
