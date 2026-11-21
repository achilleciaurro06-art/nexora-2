/**
 * Analisi dei prezzi — parte deterministica.
 * Tutti i numeri (confronti, statistiche, verdetto, prezzo suggerito) derivano ESCLUSIVAMENTE dallo storico
 * dell'azienda. Nessun dato di mercato, costo o margine viene ipotizzato. L'AI non modifica questi numeri.
 */

const STOPWORDS = new Set([
  "per", "con", "del", "della", "dello", "dei", "degli", "delle", "dal", "dalla", "nel", "nella", "sul", "sulla", "una", "uno", "the", "and",
  "gli", "alle", "agli", "tra", "fra", "che", "non", "più", "piu", "anno", "mese",
]);

export function descriptionTokens(s: string): Set<string> {
  const norm = s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]+/g, " ");
  return new Set(norm.split(/\s+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t)));
}

/** Somiglianza tra descrizioni: Jaccard, o contenimento quasi totale (voce breve contenuta in una più lunga). */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const jaccard = inter / (a.size + b.size - inter);
  const containment = Math.min(a.size, b.size) >= 2 ? (inter / Math.min(a.size, b.size)) * 0.9 : 0;
  return Math.max(jaccard, containment);
}

export type HistoryItem = {
  description: string;
  unitPriceCents: number; // prezzo unitario netto di sconto
  status: string;
  quoteId: string;
  issueDate?: string;
  quoteNumber?: string;
};

export type Comparable = HistoryItem & { score: number };
export const SIMILARITY_THRESHOLD = 0.6;
export const MIN_SAMPLES = 3;

export function findComparables(description: string, history: HistoryItem[], excludeQuoteId?: string, limit = 50): Comparable[] {
  const tokens = descriptionTokens(description);
  if (tokens.size === 0) return [];
  return history
    .filter((h) => h.quoteId !== excludeQuoteId && h.unitPriceCents > 0)
    .map((h) => ({ ...h, score: similarity(tokens, descriptionTokens(h.description)) }))
    .filter((h) => h.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export type PriceStats = { n: number; min: number; max: number; median: number; mean: number; q1: number; q3: number; nAccepted: number; medianAccepted: number | null };

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function priceStats(comparables: { unitPriceCents: number; status: string }[]): PriceStats | null {
  if (comparables.length === 0) return null;
  const v = comparables.map((c) => c.unitPriceCents).sort((a, b) => a - b);
  const acc = comparables.filter((c) => c.status === "accepted").map((c) => c.unitPriceCents).sort((a, b) => a - b);
  return {
    n: v.length, min: v[0]!, max: v[v.length - 1]!, median: Math.round(quantile(v, 0.5)),
    mean: Math.round(v.reduce((s, x) => s + x, 0) / v.length), q1: Math.round(quantile(v, 0.25)), q3: Math.round(quantile(v, 0.75)),
    nAccepted: acc.length, medianAccepted: acc.length >= MIN_SAMPLES ? Math.round(quantile(acc, 0.5)) : null,
  };
}

export type Verdict = "low" | "high" | "ok" | "insufficient_data";
export type Assessment = { verdict: Verdict; suggestedUnitPriceCents: number | null; deviationPct: number | null };

/**
 * Regole (spiegabili all'utente):
 *  - meno di 3 voci comparabili → dati insufficienti, nessun giudizio;
 *  - "basso": almeno 20% sotto la mediana storica E sotto il primo quartile;
 *  - "alto": almeno 25% sopra la mediana storica E sopra il terzo quartile;
 *  - prezzo suggerito (solo se anomalo) = mediana storica.
 */
export function assessPrice(priceCents: number, stats: PriceStats | null): Assessment {
  if (!stats || stats.n < MIN_SAMPLES || stats.median <= 0) return { verdict: "insufficient_data", suggestedUnitPriceCents: null, deviationPct: null };
  const deviationPct = Math.round(((priceCents - stats.median) / stats.median) * 1000) / 10;
  if (deviationPct <= -20 && priceCents < stats.q1) return { verdict: "low", suggestedUnitPriceCents: stats.median, deviationPct };
  if (deviationPct >= 25 && priceCents > stats.q3) return { verdict: "high", suggestedUnitPriceCents: stats.median, deviationPct };
  return { verdict: "ok", suggestedUnitPriceCents: null, deviationPct };
}

export const netUnitCents = (unitPriceCents: number, discountPercent: number) => Math.round(unitPriceCents * (1 - discountPercent / 100));

export type ItemAnalysis = {
  item_id: string;
  description: string;
  current_unit_price_cents: number;
  verdict: Verdict;
  suggested_unit_price_cents: number | null;
  deviation_pct: number | null;
  stats: PriceStats | null;
  samples: { description: string; unit_price_cents: number; quote_number?: string; status: string }[];
  rationale: string;
};

/** Motivazione deterministica (usata se l'AI non è disponibile o produce testo non conforme). */
export function templateRationale(a: Pick<ItemAnalysis, "verdict" | "deviation_pct" | "stats">): string {
  const n = a.stats?.n ?? 0;
  switch (a.verdict) {
    case "insufficient_data":
      return n === 0
        ? "Nessuna voce simile nello storico dei tuoi preventivi: non è possibile valutare il prezzo."
        : `Nello storico ci sono solo ${n} voci simili: ne servono almeno ${MIN_SAMPLES} per una valutazione attendibile.`;
    case "low": return `Prezzo inferiore alla fascia abituale dei tuoi preventivi per voci simili (${n} confronti): potresti stare vendendo sotto il tuo prezzo storico.`;
    case "high": return `Prezzo superiore alla fascia abituale dei tuoi preventivi per voci simili (${n} confronti): potrebbe ridurre le probabilità di accettazione.`;
    default: return `Prezzo in linea con lo storico dei tuoi preventivi per voci simili (${n} confronti).`;
  }
}

export function analyzeItem(
  item: { id: string; description: string; unitPriceCents: number; discountPercent: number },
  history: HistoryItem[], excludeQuoteId?: string,
): ItemAnalysis {
  const net = netUnitCents(item.unitPriceCents, item.discountPercent);
  const comps = findComparables(item.description, history, excludeQuoteId);
  const stats = priceStats(comps);
  const a = assessPrice(net, stats);
  const base = {
    item_id: item.id, description: item.description, current_unit_price_cents: net, verdict: a.verdict,
    suggested_unit_price_cents: a.suggestedUnitPriceCents, deviation_pct: a.deviationPct, stats,
    samples: comps.slice(0, 5).map((c) => ({ description: c.description, unit_price_cents: c.unitPriceCents, quote_number: c.quoteNumber, status: c.status })),
  };
  return { ...base, rationale: templateRationale(base) };
}

/** Un testo generato dall'AI è accettato solo se qualitativo: nessuna cifra (i numeri sono mostrati a parte). */
export function isSafeRationale(text: unknown): text is string {
  return typeof text === "string" && text.trim().length >= 10 && text.length <= 400 && !/\d/.test(text) && !/[€$%]/.test(text);
}
