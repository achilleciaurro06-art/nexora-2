import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { DocumentReadError, extractDocxText, extractXlsxText } from "@/modules/documenti/extract-text";
import {
  aiExtractionSchema, checkExtraction, computeMissing, expectedTotalCents, matchCustomer, normalizeName, normalizeSuggestionPayload,
  extractedDataSchema,
} from "@/modules/documenti/extraction";
import { documentCategory, mimesForCategory } from "@/lib/documents";

async function zipOf(files: Record<string, string>): Promise<Uint8Array> {
  const z = new JSZip();
  for (const [n, c] of Object.entries(files)) z.file(n, c);
  return z.generateAsync({ type: "uint8array" });
}

describe("docx / xlsx text extraction", () => {
  it("reads paragraphs, tabs, table cells and entities from a docx", async () => {
    const bytes = await zipOf({ "word/document.xml": `<w:document><w:body>
      <w:p><w:r><w:t>Preventivo n. 12 &amp; allegati</w:t></w:r></w:p>
      <w:p><w:r><w:t>Cliente:</w:t></w:r><w:tab/><w:r><w:t>Rossi Srl</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Sito web</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1.500,00</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>` });
    const t = await extractDocxText(bytes);
    expect(t).toContain("Preventivo n. 12 & allegati");
    expect(t).toContain("Cliente:\tRossi Srl");
    expect(t).toContain("Sito web");
    expect(t).toContain("1.500,00");
    expect(t).not.toContain("<w:");
  });

  it("reads shared strings, numbers and sparse columns from an xlsx", async () => {
    const bytes = await zipOf({
      "xl/workbook.xml": "<workbook/>",
      "xl/sharedStrings.xml": `<sst><si><t>Descrizione</t></si><si><t>Prezzo</t></si><si><r><t>Sito </t></r><r><t>web</t></r></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
        <row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>1500</v></c></row>
        <row r="3"><c r="A3" t="inlineStr"><is><t>Hosting &amp; mail</t></is></c><c r="C3"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>`,
    });
    const t = await extractXlsxText(bytes);
    expect(t).toContain("# Foglio 1");
    expect(t).toContain("Descrizione\t\tPrezzo");
    expect(t).toContain("Sito web\t\t1500");
    expect(t).toContain("Hosting & mail\t\t2");
  });

  it("rejects non-office or corrupt files with a clear error", async () => {
    await expect(extractDocxText(new Uint8Array([1, 2, 3, 4]))).rejects.toBeInstanceOf(DocumentReadError);
    await expect(extractDocxText(await zipOf({ "x.txt": "a" }))).rejects.toBeInstanceOf(DocumentReadError);
    await expect(extractXlsxText(await zipOf({ "x.txt": "a" }))).rejects.toBeInstanceOf(DocumentReadError);
  });
});

describe("extraction validation (model output is untrusted)", () => {
  it("coerces numbers/dates, drops invalid items and nulls", () => {
    const d = extractedDataSchema.parse({
      client: { name: " Rossi Srl ", vat_number: null },
      quote: { total: "1.220,00", issue_date: "01/02/2026", valid_until: "2026-03-01" },
      items: [{ description: "Sito", quantity: "2", unit_price: "500,00" }, { description: "" }, 42, { quantity: 3 }],
    });
    expect(d.client.name).toBe("Rossi Srl");
    expect(d.client.vat_number).toBeUndefined();
    expect(d.quote.total).toBe(1220);
    expect(d.quote.issue_date).toBeUndefined();
    expect(d.quote.valid_until).toBe("2026-03-01");
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ description: "Sito", quantity: 2, unit_price: 500 });
  });

  it("rejects negative or absurd amounts instead of trusting them", () => {
    const d = extractedDataSchema.parse({ quote: { total: -5, subtotal: 1e12 }, items: [{ description: "x", unit_price: -1 }] });
    expect(d.quote.total).toBeUndefined();
    expect(d.quote.subtotal).toBeUndefined();
    expect(d.items[0]?.unit_price).toBeUndefined();
  });

  it("flags inconsistent totals, odd VAT rates and bad dates; stays quiet on consistent data", () => {
    const bad = extractedDataSchema.parse({
      client: { name: "X" },
      quote: { subtotal: 1000, vat_amount: 220, total: 1300, issue_date: "2026-05-01", valid_until: "2026-04-01" },
      items: [{ description: "a", quantity: 2, unit_price: 400, line_total: 700, vat_rate: 21 }],
    });
    const w = checkExtraction(bad).join(" | ");
    expect(w).toMatch(/totale riga/);
    expect(w).toMatch(/aliquota IVA inusuale/);
    expect(w).toMatch(/somma delle righe/);
    expect(w).toMatch(/Imponibile \+ IVA/);
    expect(w).toMatch(/precedente alla data/);
    const good = extractedDataSchema.parse({
      client: { name: "X" }, quote: { subtotal: 800, vat_amount: 176, total: 976 },
      items: [{ description: "a", quantity: 2, unit_price: 400, line_total: 800, vat_rate: 22 }],
    });
    expect(checkExtraction(good)).toEqual([]);
  });

  it("computes missing fields and merges the ones declared by the model", () => {
    const d = extractedDataSchema.parse({ client: { name: "X" }, items: [{ description: "a", unit_price: 1 }] });
    const m = computeMissing(d, ["quote.number"]);
    expect(m).toEqual(expect.arrayContaining(["client.vat_number", "quote.issue_date", "quote.valid_until", "quote.payment_terms", "quote.number"]));
    expect(m).not.toContain("items");
  });

  it("expected total uses the stated total, else rows + VAT", () => {
    expect(expectedTotalCents(extractedDataSchema.parse({ quote: { total: 976.5 } }))).toBe(97650);
    expect(expectedTotalCents(extractedDataSchema.parse({ items: [{ description: "a", quantity: 1, unit_price: 100, vat_rate: 22 }] }))).toBe(12200);
    expect(expectedTotalCents(extractedDataSchema.parse({}))).toBeNull();
  });

  it("validates the full model response and tolerates missing sections", () => {
    const r = aiExtractionSchema.parse({ data: { items: [{ description: "x" }] }, inferred_fields: ["quote.vat_amount"] });
    expect(r.missing_fields).toEqual([]);
    expect(r.data.client).toEqual({});
    expect(aiExtractionSchema.safeParse({}).success).toBe(false);
  });

  it("migrates legacy flat suggestions and rejects garbage", () => {
    const p = normalizeSuggestionPayload({ client_name: "Rossi", quote_title: "Sito", amount: 1500, items: [{ description: "sito", quantity: 1, unit_price: 1500 }] });
    expect(p?.schema_version).toBe(2);
    expect(p?.data.client.name).toBe("Rossi");
    expect(p?.data.quote.total).toBe(1500);
    expect(normalizeSuggestionPayload(null)).toBeNull();
    expect(normalizeSuggestionPayload("x")).toBeNull();
  });
});

describe("customer matching", () => {
  const customers = [
    { id: "1", name: "Rossi & Figli S.n.c.", vat_number: "IT01234567890" },
    { id: "2", name: "Bianchi S.r.l.", vat_number: null },
  ];
  it("matches by VAT first (ignoring IT prefix and spaces), then by normalized name", () => {
    expect(matchCustomer(customers, { vat_number: "01234567890" })?.reason).toBe("vat");
    expect(matchCustomer(customers, { vat_number: "IT 01234567890" })?.customer.id).toBe("1");
    expect(matchCustomer(customers, { name: "BIANCHI srl" })?.customer.id).toBe("2");
    expect(normalizeName("Rossi & Figli S.n.c.")).toBe(normalizeName("rossi figli snc"));
  });
  it("does not guess on weak or absent evidence", () => {
    expect(matchCustomer(customers, { name: "Rossi" })).toBeNull();
    expect(matchCustomer(customers, { vat_number: "123" })).toBeNull();
    expect(matchCustomer(customers, {})).toBeNull();
  });
});

describe("document categories", () => {
  it("maps mime types to categories and filters", () => {
    expect(documentCategory("application/pdf")).toBe("pdf");
    expect(documentCategory("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("excel");
    expect(documentCategory("image/png")).toBe("image");
    expect(documentCategory("application/x-unknown")).toBe("other");
    expect(mimesForCategory("image")?.sort()).toEqual(["image/jpeg", "image/png"]);
    expect(mimesForCategory("all")).toBeNull();
    expect(mimesForCategory("'; drop")).toBeNull();
  });
});
