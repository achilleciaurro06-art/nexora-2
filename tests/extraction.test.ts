import { describe, expect, it } from "vitest";
import { extractionSchema } from "@/modules/documenti/analysis";
import { quoteSchema } from "@/modules/preventivi/schemas";

describe("AI extraction schema (output del modello = dato non attendibile)", () => {
  it("accepts a plausible extraction", () => {
    const r = extractionSchema.safeParse({ client_name: "Rossi Srl", amount: 1234.5, items: [{ description: "Consulenza", quantity: 2, unit_price: 100 }] });
    expect(r.success).toBe(true);
  });
  it("rejects absurd or malformed values", () => {
    expect(extractionSchema.safeParse({ amount: -5 }).success).toBe(false);
    expect(extractionSchema.safeParse({ amount: "mille" }).success).toBe(false);
    expect(extractionSchema.safeParse({ items: Array.from({ length: 51 }, () => ({ description: "x" })) }).success).toBe(false);
  });
});

describe("quote schema", () => {
  const base = { customerId: "6f1b2f0e-8b0a-4a3e-9d0a-1c2d3e4f5a6b", items: [{ description: "x", quantity: 1, unitPriceCents: 100, discountPercent: 0, vatRate: 22 }] };
  it("normalises empty optional fields to null", () => {
    const r = quoteSchema.parse({ ...base, title: "", followUpDate: "", notes: "" });
    expect(r.title).toBeNull();
    expect(r.followUpDate).toBeNull();
  });
  it("requires at least one item and a valid customer", () => {
    expect(quoteSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(quoteSchema.safeParse({ ...base, customerId: "nope" }).success).toBe(false);
  });
});
