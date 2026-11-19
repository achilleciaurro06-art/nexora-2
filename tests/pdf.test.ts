import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildQuotePdf, pdfSafe, quotePdfFilename, type QuotePdfData } from "@/modules/preventivi/pdf";

const base: QuotePdfData = {
  organization: { name: "Società Ñandú S.r.l.", vatNumber: "IT01234567890" },
  quote: { number: "2026/0007", title: "Sito web più manutenzione — perché sì", status: "sent", issueDate: "2026-03-01", validUntil: "2026-04-01",
    subtotalCents: 123400, vatCents: 27148, totalCents: 150548, notes: "Pagamento a 30 giorni.\nGrazie 😀", terms: "Condizioni standard." },
  customer: { name: "Rossi & Figli", vatNumber: "IT09876543210", email: "info@rossi.it", address: "Via Roma 1, 10100 Torino (TO)" },
  items: [{ description: "Progettazione e sviluppo sito web", quantity: 1, unitPriceCents: 123400, discountPercent: 0, vatRate: 22, lineNetCents: 123400 }],
};

// PNG 2x2 valido (rosso), usato come logo di prova
const PNG_2X2 = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4EIwESMolGFDAwANBABAg6C0lUAAAAASUVORK5CYII="), (c) => c.charCodeAt(0));

describe("quote PDF", () => {
  it("includes the company profile, logo and footer without errors", async () => {
    const withProfile: QuotePdfData = { ...base, organization: { ...base.organization, taxCode: "RSSMRA80A01L219X", address: "Via Roma 1, Torino", email: "info@alfa.it", phone: "011 123", website: "https://alfa.it", footer: "IBAN IT00X0000000000000000000000", logo: { bytes: PNG_2X2, type: "png" } } };
    const bytes = await buildQuotePdf(withProfile);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it("falls back to name only when the logo is corrupt", async () => {
    const bytes = await buildQuotePdf({ ...base, organization: { ...base.organization, logo: { bytes: new Uint8Array([1, 2, 3]), type: "png" } } });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
  it("generates a valid PDF with accents, euro sign and emoji (sanitised)", async () => {
    const bytes = await buildQuotePdf(base);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Preventivo 2026/0007");
  });
  it("paginates long quotes and handles very long unbroken words", async () => {
    const items = Array.from({ length: 80 }, (_, i) => ({
      description: `Voce ${i} ` + "descrizione molto lunga ".repeat(6) + "X".repeat(120),
      quantity: 2.5, unitPriceCents: 1999, discountPercent: 10, vatRate: 22, lineNetCents: 4498,
    }));
    const bytes = await buildQuotePdf({ ...base, items });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(2);
  });
  it("works without customer, notes and title", async () => {
    const bytes = await buildQuotePdf({ ...base, customer: null, quote: { ...base.quote, title: null, notes: null, terms: null } });
    expect(bytes.length).toBeGreaterThan(1000);
  });
  it("sanitises unsupported characters and builds safe file names", () => {
    expect(pdfSafe("ok àèì € 😀 日本")).toBe("ok àèì € ? ??");
    expect(pdfSafe("— “virgolette” – …")).toBe("— “virgolette” – …");
    expect(quotePdfFilename("2026/0007")).toBe("Preventivo-2026-0007.pdf");
  });
});
