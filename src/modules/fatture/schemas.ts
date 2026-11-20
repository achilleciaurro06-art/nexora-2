import { z } from "zod";
import { optionalText } from "@/lib/forms";
import { parseEuroToCents } from "@/lib/money";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data non valida").refine((v) => !Number.isNaN(Date.parse(v)), "Data non valida");

/** IVA e totale sono SEMPRE calcolati dal server a partire da imponibile e aliquota (nessun importo incoerente). */
export function invoiceAmounts(taxableCents: number, vatRate: number) {
  const vat = Math.round((taxableCents * vatRate) / 100);
  return { taxableCents, vatCents: vat, totalCents: taxableCents + vat };
}

export const invoiceSchema = z.object({
  quoteId: z.union([z.literal(""), z.uuid()]).optional().transform((v) => (v ? v : null)),
  number: z.string().trim().min(1, "Inserisci il numero fattura").max(60, "Numero fattura: massimo 60 caratteri"),
  billedAt: date,
  taxable: z.string().transform((v, ctx) => {
    const c = parseEuroToCents(v);
    if (c === null || c <= 0 || c > 100_000_000_000) { ctx.addIssue({ code: "custom", message: "Imponibile non valido" }); return z.NEVER; }
    return c;
  }),
  vatRate: z.coerce.number("Aliquota IVA non valida").min(0, "Aliquota IVA non valida").max(100, "Aliquota IVA non valida"),
  paid: z.preprocess((v) => v === "on", z.boolean()),
  paidAt: z.union([z.literal(""), date]).optional().transform((v) => (v ? v : null)),
  note: optionalText(500),
}).superRefine((v, ctx) => {
  if (v.paid && !v.paidAt) ctx.addIssue({ code: "custom", path: ["paidAt"], message: "Indica la data di incasso" });
  if (v.paid && v.paidAt && v.paidAt < v.billedAt) ctx.addIssue({ code: "custom", path: ["paidAt"], message: "L'incasso non può precedere la fattura" });
});
export type InvoiceInput = z.infer<typeof invoiceSchema>;

export const paymentSchema = z.object({ paidAt: date });
