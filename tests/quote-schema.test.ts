import { describe, expect, it } from "vitest";
import { quoteSchema } from "@/modules/preventivi/schemas";

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
