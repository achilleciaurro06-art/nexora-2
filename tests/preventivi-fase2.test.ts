import { describe, expect, it } from "vitest";
import { billingSchema } from "@/modules/preventivi/schemas";
import { nextQuoteNumberSchema, quoteNumberingSchema, quoteSettingsSchema } from "@/modules/impostazioni/schemas";
import { parseOrgSettings } from "@/modules/impostazioni/settings";
import { buildQuotePdf, DEFAULT_PDF_OPTIONS } from "@/modules/preventivi/pdf";

describe("fatturato registrato", () => {
  const ok = { amount: "1.234,56", billedAt: "2026-04-01", reference: "", note: "" };
  it("converte l'importo in centesimi", () => {
    const r = billingSchema.parse(ok);
    expect(r.amount).toBe(123456);
  });
  it.each(["0", "-5", "abc", "", "1e6"])("rifiuta l'importo %s", (amount) => {
    expect(billingSchema.safeParse({ ...ok, amount }).success).toBe(false);
  });
  it("rifiuta date non valide", () => expect(billingSchema.safeParse({ ...ok, billedAt: "1/4/2026" }).success).toBe(false));
});

describe("numerazione", () => {
  it("accetta prefisso sicuro e cifre 3-8", () => {
    expect(quoteNumberingSchema.parse({ prefix: "PRV-", digits: "5", yearly: "on" })).toEqual({ prefix: "PRV-", digits: 5, yearly: true });
    expect(quoteNumberingSchema.parse({ prefix: "", digits: "4" }).yearly).toBe(false);
  });
  it.each([{ prefix: "a b", digits: "4" }, { prefix: "x".repeat(11), digits: "4" }, { prefix: "", digits: "2" }, { prefix: "", digits: "9" }, { prefix: "<b>", digits: "4" }])("rifiuta %j", (v) => {
    expect(quoteNumberingSchema.safeParse(v).success).toBe(false);
  });
  it("il prossimo numero è un intero positivo", () => {
    expect(nextQuoteNumberSchema.parse({ next: "250" }).next).toBe(250);
    for (const next of ["0", "-1", "1.5", "x", "100000000"]) expect(nextQuoteNumberSchema.safeParse({ next }).success).toBe(false);
  });
});

describe("opzioni PDF nelle impostazioni", () => {
  it("default per le impostazioni esistenti senza le nuove chiavi", () => {
    const s = parseOrgSettings({ quotes: { default_vat_rate: 10, default_validity_days: 15 } }).quotes;
    expect(s.pdf_template).toBe("classic");
    expect(s.pdf_show_logo && s.pdf_show_payment && s.pdf_show_brand).toBe(true);
    expect(s.default_vat_rate).toBe(10);
  });
  it("checkbox non spuntati = false, valori fuori elenco rifiutati", () => {
    const base = { default_vat_rate: "22", default_validity_days: "30", pdf_template: "minimal", pdf_accent: "green" };
    const r = quoteSettingsSchema.parse({ ...base, pdf_show_logo: "on" });
    expect(r.pdf_show_logo).toBe(true);
    expect(r.pdf_show_payment).toBe(false);
    expect(quoteSettingsSchema.safeParse({ ...base, pdf_accent: "fucsia" }).success).toBe(false);
  });
});

describe("PDF con opzioni", () => {
  const data = {
    organization: { name: "Azienda", iban: "IT60X0542811101000000123456", bankName: "Banca" },
    quote: { number: "PRV-00001", title: "T", status: "draft", issueDate: "2026-01-01", validUntil: null, subtotalCents: 1000, vatCents: 220, totalCents: 1220, notes: null, terms: null },
    customer: { name: "Cliente" },
    items: [{ description: "Voce", quantity: 1, unitPriceCents: 1000, discountPercent: 0, vatRate: 22, lineNetCents: 1000 }],
  };
  it("genera PDF validi in ogni combinazione e senza IBAN/marchio quando esclusi", async () => {
    const full = await buildQuotePdf({ ...data, options: DEFAULT_PDF_OPTIONS });
    const lean = await buildQuotePdf({ ...data, options: { template: "minimal", accent: "red", showLogo: false, showPayment: false, showBrand: false } });
    expect(Buffer.from(full.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(Buffer.from(lean.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(lean.length).not.toBe(full.length);
  });
});
