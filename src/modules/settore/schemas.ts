import { z } from "zod";
import { optionalText } from "@/lib/forms";
import { parseEuroToCents } from "@/lib/money";
import { SECTOR_KEYS } from "./presets";
import { TERM_KEYS } from "./terms";

const termField = z.string().trim().max(30, "Massimo 30 caratteri").regex(/^[^<>{}]*$/, "Caratteri non ammessi").optional().default("");
export const sectorSchema = z.object({
  sector: z.enum(SECTOR_KEYS, "Settore non valido"),
  ...Object.fromEntries(TERM_KEYS.map((k) => [k, termField])) as Record<(typeof TERM_KEYS)[number], typeof termField>,
});

export const fieldDefSchema = z.object({
  entity: z.enum(["customer", "quote"], "Ambito non valido"),
  label: z.string().trim().min(1, "Inserisci il nome del campo").max(80, "Massimo 80 caratteri"),
  field_type: z.enum(["text", "number", "date", "select", "boolean"], "Tipo non valido"),
  options: z.string().optional().default("").transform((v) => [...new Set(v.split(/[\n,;]/).map((s) => s.trim()).filter(Boolean))].slice(0, 50)),
  required: z.preprocess((v) => v === "on", z.boolean()),
}).superRefine((v, ctx) => {
  if (v.field_type === "select" && v.options.length === 0) ctx.addIssue({ code: "custom", path: ["options"], message: "Indica almeno una scelta (una per riga)" });
  if (v.options.some((o) => o.length > 60)) ctx.addIssue({ code: "custom", path: ["options"], message: "Ogni scelta: massimo 60 caratteri" });
});

const euro = (msg: string) => z.string().transform((v, ctx) => {
  const c = parseEuroToCents(v === "" ? "0" : v);
  if (c === null || c < 0 || c > 100_000_000_000) { ctx.addIssue({ code: "custom", message: msg }); return z.NEVER; }
  return c;
});

export const productSchema = z.object({
  kind: z.enum(["product", "service"], "Tipo non valido"),
  code: optionalText(40),
  name: z.string().trim().min(1, "Inserisci il nome").max(200),
  description: optionalText(1000),
  category: optionalText(80),
  unit: z.string().trim().min(1, "Indica l'unità").max(12, "Unità: massimo 12 caratteri"),
  unit_price_cents: euro("Prezzo non valido"),
  vat_rate: z.coerce.number("IVA non valida").min(0, "IVA non valida").max(100, "IVA non valida"),
  active: z.preprocess((v) => v === "on", z.boolean()),
});

export const priceListSchema = z.object({
  name: z.string().trim().min(1, "Inserisci il nome").max(100),
  description: optionalText(500),
  active: z.preprocess((v) => v === "on", z.boolean()),
});

export const templateItemSchema = z.object({
  description: z.string().trim().min(1, "Descrizione obbligatoria").max(500),
  quantity: z.number().min(0).max(1_000_000),
  unit_price_cents: z.number().int().min(0).max(1_000_000_000),
  discount_percent: z.number().min(0).max(100),
  vat_rate: z.number().min(0).max(100),
});
export const templateSchema = z.object({
  name: z.string().trim().min(1, "Inserisci il nome del modello").max(100),
  description: optionalText(500),
  title: optionalText(200),
  notes: optionalText(4000),
  terms: optionalText(4000),
  active: z.preprocess((v) => v === "on", z.boolean()),
  items: z.array(templateItemSchema).max(100, "Massimo 100 righe"),
});
