import { z } from "zod";
import { optionalText } from "@/lib/forms";
import { parseEuroToCents } from "@/lib/money";

export const quoteItemSchema = z.object({
  description: z.string().trim().min(1, "Descrizione obbligatoria").max(500),
  quantity: z.number().min(0).max(1_000_000),
  unitPriceCents: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  discountPercent: z.number().min(0).max(100),
  vatRate: z.number().min(0).max(100),
});

export const quoteSchema = z.object({
  customerId: z.uuid("Seleziona un cliente"),
  title: optionalText(200),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null),
  notes: optionalText(4000),
  terms: optionalText(4000),
  items: z.array(quoteItemSchema).min(1, "Aggiungi almeno una riga").max(200),
});
export type QuoteInput = z.infer<typeof quoteSchema>;

export const billingSchema = z.object({
  amount: z.string().transform((v, ctx) => {
    const c = parseEuroToCents(v);
    if (c === null || c <= 0 || c > 100_000_000_000) { ctx.addIssue({ code: "custom", message: "Importo non valido" }); return z.NEVER; }
    return c;
  }),
  billedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data non valida"),
  reference: optionalText(80),
  note: optionalText(500),
});

export const quoteStatusSchema = z.enum(["draft", "sent", "accepted", "rejected", "expired"]);
