import { z } from "zod";

export const TERM_KEYS = ["customer_singular", "customer_plural", "quote_singular", "quote_plural"] as const;
export type TermKey = (typeof TERM_KEYS)[number];
export type Terms = Record<TermKey, string>;

export const DEFAULT_TERMS: Terms = { customer_singular: "Cliente", customer_plural: "Clienti", quote_singular: "Preventivo", quote_plural: "Preventivi" };

const term = z.string().trim().max(30).regex(/^[^<>{}]*$/, "Caratteri non ammessi");
export const termsSchema = z.object({
  customer_singular: term, customer_plural: term, quote_singular: term, quote_plural: term,
}).partial();

/** Lettura tollerante: i termini mancanti, vuoti o non validi tornano a quelli predefiniti. */
export function resolveTerms(raw: unknown): Terms {
  const out = { ...DEFAULT_TERMS };
  if (!raw || typeof raw !== "object") return out;
  for (const k of TERM_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "string") {
      const parsed = term.safeParse(v);
      if (parsed.success && parsed.data) out[k] = parsed.data;
    }
  }
  return out;
}

/** Salva solo i termini diversi dal predefinito (così cambiare i predefiniti in futuro non lascia residui). */
export function termsToStore(input: Partial<Record<TermKey, string>>): Partial<Terms> {
  const out: Partial<Terms> = {};
  for (const k of TERM_KEYS) {
    const v = (input[k] ?? "").trim();
    if (v && v !== DEFAULT_TERMS[k]) out[k] = v;
  }
  return out;
}
