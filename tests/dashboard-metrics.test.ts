import { describe, expect, it } from "vitest";
import { countByMonth, monthBuckets, parseRange, periodSummary, quotesByMonth, rangeStart } from "@/modules/dashboard/metrics";

const now = new Date("2026-06-15T10:00:00Z");

describe("dashboard ranges", () => {
  it("falls back to 12 months on unknown input", () => {
    expect(parseRange("90").days).toBe(90);
    expect(parseRange("x; DROP").key).toBe("365");
    expect(parseRange(undefined).key).toBe("365");
  });
  it("computes the period start", () => {
    expect(rangeStart(30, now).toISOString()).toBe("2026-05-16T00:00:00.000Z");
    expect(rangeStart(null, now).toISOString()).toBe("2025-06-01T00:00:00.000Z");
  });
  it("builds contiguous month buckets across years", () => {
    const b = monthBuckets(new Date("2025-11-20T00:00:00Z"), now);
    expect(b.map((x) => x.key)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
  });
});

describe("aggregations", () => {
  const buckets = monthBuckets(new Date("2026-04-01T00:00:00Z"), now);
  const quotes = [
    { status: "accepted", total_cents: 100000, issue_date: "2026-04-10" }, { status: "rejected", total_cents: 50000, issue_date: "2026-04-20" },
    { status: "sent", total_cents: 30000, issue_date: "2026-05-03" }, { status: "accepted", total_cents: 70000, issue_date: "2026-06-01" },
    { status: "draft", total_cents: 999, issue_date: "2025-01-01" }, // fuori periodo: ignorato nei bucket
  ];
  it("groups quotes per month with value and accepted value", () => {
    const r = quotesByMonth(quotes, buckets);
    expect(r.map((x) => x.count)).toEqual([2, 1, 1]);
    expect(r[0]).toMatchObject({ valueCents: 150000, acceptedCents: 100000 });
    expect(r[2]).toMatchObject({ valueCents: 70000, acceptedCents: 70000 });
  });
  it("counts items per month, ignoring out-of-range dates", () => {
    expect(countByMonth(["2026-04-02T00:00:00Z", "2026-04-30T00:00:00Z", "2026-06-02T00:00:00Z", "2020-01-01T00:00:00Z"], buckets).map((x) => x.count)).toEqual([2, 0, 1]);
  });
  it("conversion is computed on decided quotes only, null when none", () => {
    const s = periodSummary(quotes.slice(0, 4));
    expect(s).toMatchObject({ count: 4, totalCents: 250000, acceptedCents: 170000, decided: 3, conversionPct: 67 });
    expect(s.byStatus).toMatchObject({ accepted: 2, rejected: 1, sent: 1 });
    expect(periodSummary([{ status: "draft", total_cents: 1, issue_date: "2026-06-01" }]).conversionPct).toBeNull();
    expect(periodSummary([]).count).toBe(0);
  });
});
