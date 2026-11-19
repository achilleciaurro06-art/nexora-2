import { describe, expect, it } from "vitest";
import { formatEur, lineNetCents, parseEuroToCents, quoteTotals } from "@/lib/money";

describe("money", () => {
  it("parses italian and english formats", () => {
    expect(parseEuroToCents("1.234,56")).toBe(123456);
    expect(parseEuroToCents("1234.5")).toBe(123450);
    expect(parseEuroToCents("12")).toBe(1200);
    expect(parseEuroToCents("abc")).toBeNull();
    expect(parseEuroToCents("")).toBeNull();
  });
  it("formats euro cents", () => {
    expect(formatEur(1234567)).toContain("12.345,67");
    expect(formatEur(109800)).toContain("1.098,00"); // anche a 4 cifre, coerente con i numeri più grandi
    expect(formatEur(98765)).toContain("987,65");
  });
  it("matches the database formulas (same as RLS test fixture)", () => {
    // 2 x 100,00 con sconto 10% = 180,00 netto; 1 x 50,00 = 50,00 netto
    expect(lineNetCents({ quantity: 2, unitPriceCents: 10000, discountPercent: 10, vatRate: 22 })).toBe(18000);
    const t = quoteTotals([
      { quantity: 2, unitPriceCents: 10000, discountPercent: 10, vatRate: 22 },
      { quantity: 1, unitPriceCents: 5000, discountPercent: 0, vatRate: 10 },
    ]);
    expect(t).toEqual({ subtotalCents: 23000, vatCents: 3960 + 500, totalCents: 27460 });
  });
});
