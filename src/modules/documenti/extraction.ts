import { z } from "zod";

/* ------------------------------------------------------------------ schema (v2)
 * L'output del modello è un dato NON attendibile: viene sempre validato, normalizzato e controllato
 * lato server prima di essere mostrato all'utente. Nulla viene creato senza revisione. */

const str = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined), z.string().optional());
const num = (max = 1e9) =>
  z.preprocess((v) => {
    let n: number | undefined;
    if (typeof v === "string") { const x = Number(v.replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")); n = Number.isFinite(x) ? x : undefined; }
    else if (typeof v === "number" && Number.isFinite(v)) n = v;
    // valori negativi o fuori scala vengono scartati (non si corregge né si inventa)
    return n !== undefined && n >= 0 && n <= max ? n : undefined;
  }, z.number().optional());
const date = z.preprocess((v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined), z.string().optional());

export const extractedItemSchema = z.object({
  description: z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, 500) : ""), z.string().min(1)),
  quantity: num(1_000_000),
  unit_price: num(),
  discount_percent: num(100),
  vat_rate: num(100),
  line_total: num(),
});

export const extractedDataSchema = z.object({
  document_type: str(60),
  client: z.object({ name: str(200), vat_number: str(32), tax_code: str(32), email: str(200), phone: str(40), address: str(300) }).default({}),
  quote: z.object({
    number: str(60), title: str(200), issue_date: date, valid_until: date, subtotal: num(), vat_amount: num(), total: num(),
    payment_terms: str(1000), notes: str(2000),
  }).default({}),
  items: z.array(z.unknown()).max(100).default([]).transform((arr) =>
    arr.flatMap((x) => { const r = extractedItemSchema.safeParse(x); return r.success ? [r.data] : []; })),
});
export type ExtractedData = z.infer<typeof extractedDataSchema>;

/** Risposta del modello: dati + distinzione tra ciò che è esplicito nel documento e ciò che è dedotto/mancante. */
export const aiExtractionSchema = z.object({
  data: extractedDataSchema,
  inferred_fields: z.array(z.string().max(60)).max(40).default([]),
  missing_fields: z.array(z.string().max(60)).max(40).default([]),
  ai_notes: str(600),
});

export type Duplicate = { type: "document" | "quote" | "suggestion"; id: string; label: string };
export type ExtractionPayload = {
  schema_version: 2;
  document_id: string | null;
  data: ExtractedData;
  inferred_fields: string[];
  missing_fields: string[];
  ai_notes?: string;
  checks: { warnings: string[]; duplicates: Duplicate[] };
};

/** JSON Schema inviato a Gemini (i campi sconosciuti vanno omessi, non inventati). */
export const AI_JSON_SCHEMA = {
  type: "object",
  properties: {
    data: {
      type: "object",
      properties: {
        document_type: { type: "string" },
        client: { type: "object", properties: { name: { type: "string" }, vat_number: { type: "string" }, tax_code: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, address: { type: "string" } } },
        quote: { type: "object", properties: {
          number: { type: "string" }, title: { type: "string" }, issue_date: { type: "string" }, valid_until: { type: "string" },
          subtotal: { type: "number" }, vat_amount: { type: "number" }, total: { type: "number" }, payment_terms: { type: "string" }, notes: { type: "string" },
        } },
        items: { type: "array", items: { type: "object", properties: {
          description: { type: "string" }, quantity: { type: "number" }, unit_price: { type: "number" },
          discount_percent: { type: "number" }, vat_rate: { type: "number" }, line_total: { type: "number" },
        }, required: ["description"] } },
      },
    },
    inferred_fields: { type: "array", items: { type: "string" } },
    missing_fields: { type: "array", items: { type: "string" } },
    ai_notes: { type: "string" },
  },
  required: ["data"],
};

/* ------------------------------------------------------------------ controlli deterministici */

const near = (a: number, b: number, abs = 0.05, rel = 0.005) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel);
export const itemNet = (i: { quantity?: number; unit_price?: number; discount_percent?: number }) =>
  (i.quantity ?? 1) * (i.unit_price ?? 0) * (1 - (i.discount_percent ?? 0) / 100);

export function checkExtraction(d: ExtractedData): string[] {
  const w: string[] = [];
  if (!d.client.name) w.push("Il nome del cliente non è stato individuato.");
  if (d.items.length === 0) w.push("Nessuna riga di prestazione è stata estratta.");
  d.items.forEach((it, n) => {
    if (it.unit_price === undefined && it.line_total === undefined) w.push(`Riga ${n + 1}: manca il prezzo.`);
    if (it.quantity !== undefined && it.unit_price !== undefined && it.line_total !== undefined && !near(itemNet(it), it.line_total)) {
      w.push(`Riga ${n + 1}: il totale riga (${it.line_total.toFixed(2)}) non coincide con quantità × prezzo (${itemNet(it).toFixed(2)}).`);
    }
    if (it.vat_rate !== undefined && ![0, 4, 5, 10, 22].includes(it.vat_rate)) w.push(`Riga ${n + 1}: aliquota IVA inusuale (${it.vat_rate}%).`);
  });
  const lineSum = d.items.reduce((s, i) => s + (i.line_total ?? itemNet(i)), 0);
  if (d.quote.subtotal !== undefined && d.items.length > 0 && !near(lineSum, d.quote.subtotal)) {
    w.push(`La somma delle righe (${lineSum.toFixed(2)}) non coincide con l'imponibile indicato (${d.quote.subtotal.toFixed(2)}).`);
  }
  if (d.quote.subtotal !== undefined && d.quote.vat_amount !== undefined && d.quote.total !== undefined && !near(d.quote.subtotal + d.quote.vat_amount, d.quote.total)) {
    w.push(`Imponibile + IVA (${(d.quote.subtotal + d.quote.vat_amount).toFixed(2)}) non coincide con il totale (${d.quote.total.toFixed(2)}).`);
  }
  if (d.quote.issue_date && d.quote.valid_until && d.quote.valid_until < d.quote.issue_date) w.push("La data di validità è precedente alla data del documento.");
  return w;
}

/** Campi attesi ma assenti dal documento (calcolati dal server, uniti a quelli dichiarati dal modello). */
export function computeMissing(d: ExtractedData, declared: string[] = []): string[] {
  const missing = new Set(declared);
  if (!d.client.name) missing.add("client.name");
  if (!d.client.vat_number && !d.client.tax_code) missing.add("client.vat_number");
  if (!d.quote.issue_date) missing.add("quote.issue_date");
  if (!d.quote.valid_until) missing.add("quote.valid_until");
  if (d.quote.total === undefined && d.items.length === 0) missing.add("quote.total");
  if (!d.quote.payment_terms) missing.add("quote.payment_terms");
  if (d.items.length === 0) missing.add("items");
  return [...missing].sort();
}

export const FIELD_LABEL: Record<string, string> = {
  "client.name": "Nome cliente", "client.vat_number": "Partita IVA / codice fiscale cliente", "client.email": "Email cliente",
  "quote.issue_date": "Data del documento", "quote.valid_until": "Validità", "quote.total": "Totale", "quote.subtotal": "Imponibile",
  "quote.vat_amount": "IVA", "quote.payment_terms": "Condizioni di pagamento", "quote.number": "Numero documento", items: "Righe",
};
export const fieldLabel = (k: string) => FIELD_LABEL[k] ?? k;

/** Totale atteso (in centesimi) per il confronto con i preventivi esistenti. */
export function expectedTotalCents(d: ExtractedData): number | null {
  if (d.quote.total !== undefined) return Math.round(d.quote.total * 100);
  if (d.items.length === 0) return null;
  const net = d.items.reduce((s, i) => s + (i.line_total ?? itemNet(i)), 0);
  const vat = d.items.reduce((s, i) => s + (i.line_total ?? itemNet(i)) * ((i.vat_rate ?? 22) / 100), 0);
  return Math.round((net + vat) * 100);
}

/* ------------------------------------------------------------------ cliente: abbinamento prudente */

export function normalizeName(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(s\.?\s?r\.?\s?l\.?s?|s\.?\s?p\.?\s?a\.?|s\.?\s?n\.?\s?c\.?|s\.?\s?a\.?\s?s\.?|societa|di|e|&|ditta|studio)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
const digits = (s: string | null | undefined) => (s ?? "").replace(/^it/i, "").replace(/\D/g, "");

export type CustomerLite = { id: string; name: string; vat_number: string | null };
export function matchCustomer(customers: CustomerLite[], client: ExtractedData["client"]): { customer: CustomerLite; reason: "vat" | "name" } | null {
  const vat = digits(client.vat_number);
  if (vat.length >= 8) {
    const byVat = customers.find((c) => digits(c.vat_number) === vat);
    if (byVat) return { customer: byVat, reason: "vat" };
  }
  if (client.name) {
    const n = normalizeName(client.name);
    if (n.length >= 3) {
      const byName = customers.find((c) => normalizeName(c.name) === n);
      if (byName) return { customer: byName, reason: "name" };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ payload */

/** Supporta anche i suggerimenti salvati prima della v2 (formato piatto). */
export function normalizeSuggestionPayload(raw: unknown): ExtractionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.schema_version === 2) {
    const data = extractedDataSchema.safeParse(r.data);
    if (!data.success) return null;
    const checks = (r.checks ?? {}) as { warnings?: unknown; duplicates?: unknown };
    return {
      schema_version: 2, document_id: typeof r.document_id === "string" ? r.document_id : null, data: data.data,
      inferred_fields: Array.isArray(r.inferred_fields) ? r.inferred_fields.filter((x): x is string => typeof x === "string") : [],
      missing_fields: Array.isArray(r.missing_fields) ? r.missing_fields.filter((x): x is string => typeof x === "string") : [],
      ai_notes: typeof r.ai_notes === "string" ? r.ai_notes : undefined,
      checks: {
        warnings: Array.isArray(checks.warnings) ? checks.warnings.filter((x): x is string => typeof x === "string") : [],
        duplicates: Array.isArray(checks.duplicates) ? (checks.duplicates as Duplicate[]) : [],
      },
    };
  }
  const legacy = extractedDataSchema.safeParse({
    client: { name: r.client_name }, quote: { title: r.quote_title, total: r.amount, notes: r.description },
    items: Array.isArray(r.items) ? r.items : [],
  });
  if (!legacy.success) return null;
  return {
    schema_version: 2, document_id: null, data: legacy.data, inferred_fields: [], missing_fields: computeMissing(legacy.data),
    checks: { warnings: checkExtraction(legacy.data), duplicates: [] },
  };
}
