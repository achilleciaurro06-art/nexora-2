import { describe, expect, it } from "vitest";
import { invoiceAmounts, invoiceSchema, paymentSchema } from "@/modules/fatture/schemas";
import { customerSchema, DELETE_CONFIRM_WORD } from "@/modules/clienti/schemas";

const ok = { quoteId: "", number: "FT-1", billedAt: "2026-04-01", taxable: "1.000,00", vatRate: "22", paidAt: "", note: "" };

describe("importi fattura", () => {
  it("IVA e totale derivano da imponibile e aliquota (arrotondamento al centesimo)", () => {
    expect(invoiceAmounts(100000, 22)).toEqual({ taxableCents: 100000, vatCents: 22000, totalCents: 122000 });
    expect(invoiceAmounts(30050, 22)).toEqual({ taxableCents: 30050, vatCents: 6611, totalCents: 36661 });
    expect(invoiceAmounts(12345, 0)).toEqual({ taxableCents: 12345, vatCents: 0, totalCents: 12345 });
    const a = invoiceAmounts(999, 10);
    expect(a.taxableCents + a.vatCents).toBe(a.totalCents);
  });
});

describe("validazione fattura", () => {
  it("accetta dati validi", () => {
    const r = invoiceSchema.parse(ok);
    expect(r.taxable).toBe(100000);
    expect(r.quoteId).toBeNull();
    expect(r.paid).toBe(false);
  });
  it.each([
    ["numero mancante", { number: " " }], ["imponibile zero", { taxable: "0" }], ["imponibile non numerico", { taxable: "abc" }], ["imponibile negativo", { taxable: "-5" }],
    ["aliquota oltre 100", { vatRate: "101" }], ["aliquota negativa", { vatRate: "-1" }], ["data non valida", { billedAt: "01/04/2026" }], ["data inesistente", { billedAt: "2026-13-45" }],
    ["preventivo non uuid", { quoteId: "abc" }], ["incassata senza data", { paid: "on", paidAt: "" }], ["incasso prima della fattura", { paid: "on", paidAt: "2026-03-01" }],
  ])("rifiuta: %s", (_n, patch) => expect(invoiceSchema.safeParse({ ...ok, ...patch }).success).toBe(false));
  it("accetta incasso valido", () => {
    const r = invoiceSchema.parse({ ...ok, paid: "on", paidAt: "2026-04-10" });
    expect(r.paid).toBe(true);
    expect(r.paidAt).toBe("2026-04-10");
  });
  it("la data di incasso è obbligatoria e valida", () => {
    expect(paymentSchema.safeParse({ paidAt: "2026-04-10" }).success).toBe(true);
    expect(paymentSchema.safeParse({ paidAt: "" }).success).toBe(false);
  });
});

describe("anagrafica cliente estesa", () => {
  const base = { name: "Rossi" };
  it("tipologia di default e valori ammessi", () => {
    expect(customerSchema.parse(base).customer_type).toBe("company");
    expect(customerSchema.parse({ ...base, customer_type: "public" }).customer_type).toBe("public");
    expect(customerSchema.safeParse({ ...base, customer_type: "boh" }).success).toBe(false);
  });
  it("sito web e settore opzionali, limitati in lunghezza", () => {
    expect(customerSchema.parse({ ...base, website: "", industry: "" })).toMatchObject({ website: null, industry: null });
    expect(customerSchema.safeParse({ ...base, website: "x".repeat(201) }).success).toBe(false);
    expect(customerSchema.safeParse({ ...base, industry: "x".repeat(101) }).success).toBe(false);
  });
  it("la parola di conferma dell'eliminazione definitiva è esplicita", () => expect(DELETE_CONFIRM_WORD).toBe("ELIMINA"));
});
