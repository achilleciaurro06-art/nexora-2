import { describe, expect, it } from "vitest";
import {
  analyzeItem, assessPrice, descriptionTokens, findComparables, isSafeRationale, priceStats, similarity, templateRationale, type HistoryItem,
} from "@/modules/prezzi/stats";

const h = (description: string, cents: number, status = "sent", quoteId = "q"): HistoryItem => ({ description, unitPriceCents: cents, status, quoteId });

describe("description similarity", () => {
  it("ignores stopwords, numbers and accents", () => {
    expect([...descriptionTokens("Sito web per l'azienda — 5 pagine")]).toEqual(expect.arrayContaining(["sito", "web", "azienda", "pagine"]));
    expect(descriptionTokens("Manutenzione ANNUALE del sito").has("annuale")).toBe(true);
  });
  it("scores identical > partial > unrelated", () => {
    const a = descriptionTokens("Sito web aziendale");
    expect(similarity(a, descriptionTokens("sito web aziendale"))).toBe(1);
    expect(similarity(a, descriptionTokens("Sito web aziendale responsive con blog"))).toBeGreaterThanOrEqual(0.6);
    expect(similarity(a, descriptionTokens("Consulenza fiscale"))).toBe(0);
    expect(similarity(new Set(), a)).toBe(0);
  });
});

describe("comparables and statistics", () => {
  const history = [
    h("Sito web aziendale", 100000), h("Sito web aziendale", 120000, "accepted"), h("Sito web aziendale responsive", 110000, "accepted"),
    h("Consulenza fiscale", 5000), h("Sito web aziendale", 0), h("Sito web aziendale", 999999, "sent", "this-quote"),
  ];
  it("excludes the quote under analysis, zero prices and unrelated items", () => {
    const c = findComparables("Sito web aziendale", history, "this-quote");
    expect(c.map((x) => x.unitPriceCents).sort((a, b) => a - b)).toEqual([100000, 110000, 120000]);
  });
  it("computes quartiles, median and the accepted-only median (needs >= 3 accepted)", () => {
    const s = priceStats([1, 2, 3, 4, 5].map((n) => ({ unitPriceCents: n * 1000, status: n <= 3 ? "accepted" : "sent" })))!;
    expect(s).toMatchObject({ n: 5, min: 1000, max: 5000, median: 3000, q1: 2000, q3: 4000, nAccepted: 3, medianAccepted: 2000 });
    expect(priceStats([{ unitPriceCents: 500, status: "accepted" }])!.medianAccepted).toBeNull();
    expect(priceStats([])).toBeNull();
  });
});

describe("price assessment rules", () => {
  const stats = priceStats([100, 100, 110, 120, 130].map((n) => ({ unitPriceCents: n * 100, status: "sent" })))!; // median 110, q1 100, q3 120
  it("declares insufficient data under 3 comparables or without history", () => {
    expect(assessPrice(5000, null).verdict).toBe("insufficient_data");
    expect(assessPrice(5000, priceStats([{ unitPriceCents: 6000, status: "sent" }, { unitPriceCents: 7000, status: "sent" }])).verdict).toBe("insufficient_data");
    expect(assessPrice(5000, null).suggestedUnitPriceCents).toBeNull();
  });
  it("flags low only when >=20% under the median AND under Q1, and suggests the historical median", () => {
    expect(assessPrice(8000, stats)).toMatchObject({ verdict: "low", suggestedUnitPriceCents: 11000 });
    expect(assessPrice(9500, stats).verdict).toBe("ok"); // sotto Q1 ma solo -13%
  });
  it("flags high only when >=25% over the median AND over Q3", () => {
    expect(assessPrice(15000, stats)).toMatchObject({ verdict: "high", suggestedUnitPriceCents: 11000 });
    expect(assessPrice(12500, stats).verdict).toBe("ok");
  });
  it("never suggests a price when the price is in range", () => {
    const a = assessPrice(11000, stats);
    expect(a.verdict).toBe("ok");
    expect(a.suggestedUnitPriceCents).toBeNull();
  });
});

describe("analyzeItem", () => {
  const history = [100000, 105000, 110000, 120000].map((p, i) => h("Sito web aziendale", p, i % 2 ? "accepted" : "sent", `q${i}`));
  it("uses the discounted unit price and the company history only", () => {
    const r = analyzeItem({ id: "i1", description: "Sito web aziendale", unitPriceCents: 100000, discountPercent: 50 }, history);
    expect(r.current_unit_price_cents).toBe(50000);
    expect(r.verdict).toBe("low");
    expect(r.suggested_unit_price_cents).toBe(107500);
    expect(r.stats?.n).toBe(4);
    expect(r.samples.length).toBeGreaterThan(0);
  });
  it("reports insufficient data (and says so) for an item with no similar history", () => {
    const r = analyzeItem({ id: "i2", description: "Servizio fotografico drone", unitPriceCents: 90000, discountPercent: 0 }, history);
    expect(r.verdict).toBe("insufficient_data");
    expect(r.suggested_unit_price_cents).toBeNull();
    expect(r.rationale).toMatch(/non è possibile valutare/);
  });
  it("template rationales never contain invented market data", () => {
    for (const v of ["low", "high", "ok", "insufficient_data"] as const) {
      const t = templateRationale({ verdict: v, deviation_pct: null, stats: { n: 4 } as never });
      expect(t).not.toMatch(/mercato|concorren|margine/i);
    }
  });
});

describe("AI rationale guard", () => {
  it("accepts qualitative text and rejects anything with figures or currency", () => {
    expect(isSafeRationale("Il prezzo risulta nettamente inferiore a quanto applicato di solito per prestazioni analoghe.")).toBe(true);
    expect(isSafeRationale("Il prezzo di mercato è 1.200 euro")).toBe(false);
    expect(isSafeRationale("Sconto eccessivo, ben oltre il 20%")).toBe(false);
    expect(isSafeRationale("Costa 5€ in meno")).toBe(false);
    expect(isSafeRationale("breve")).toBe(false);
    expect(isSafeRationale(42)).toBe(false);
  });
});
