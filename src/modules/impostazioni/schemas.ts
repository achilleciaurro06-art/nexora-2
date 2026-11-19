import { z } from "zod";
import { optionalText } from "@/lib/forms";
import { formatIban, isValidIban } from "./settings";

const emailOpt = z.union([z.literal(""), z.email("Email non valida")]).optional().transform((v) => (v ? v.toLowerCase() : null));

export const companySchema = z.object({
  name: z.string().trim().min(2, "Ragione sociale: almeno 2 caratteri").max(120),
  vat_number: optionalText(32),
  tax_code: optionalText(32),
  address: optionalText(300),
  legal_address: optionalText(300),
  email: emailOpt,
  pec: emailOpt,
  phone: optionalText(40),
  website: z.string().trim().max(200).optional().transform((v) => (v ? v : null))
    .refine((v) => v === null || /^(https?:\/\/)?[^\s/$.?#][^\s]*\.[^\s]{2,}$/i.test(v), "Indirizzo web non valido"),
  bank_name: optionalText(120),
  iban: z.string().trim().max(60).optional().transform((v) => (v ? v : null))
    .refine((v) => v === null || isValidIban(v), "IBAN non valido (controlla le cifre)")
    .transform((v) => (v ? formatIban(v) : null)),
});
export type CompanyInput = z.infer<typeof companySchema>;

export const quoteTextsSchema = z.object({ quote_default_terms: optionalText(4000), quote_footer: optionalText(2000) });
export const quoteSettingsSchema = z.object({
  default_vat_rate: z.coerce.number("IVA non valida").min(0, "IVA non valida").max(100, "IVA non valida"),
  default_validity_days: z.coerce.number("Validità non valida").int("Validità non valida").min(0).max(365, "Massimo 365 giorni"),
  pdf_template: z.enum(["classic", "minimal"], "Modello PDF non valido"),
  pdf_accent: z.enum(["indigo", "green", "slate", "orange", "red"], "Colore non valido"),
  pdf_show_logo: z.preprocess((v) => v === "on", z.boolean()),
  pdf_show_payment: z.preprocess((v) => v === "on", z.boolean()),
  pdf_show_brand: z.preprocess((v) => v === "on", z.boolean()),
});
export const quoteNumberingSchema = z.object({
  prefix: z.string().trim().max(10, "Prefisso: massimo 10 caratteri").regex(/^[A-Za-z0-9._-]*$/, "Prefisso: solo lettere, numeri, punto, trattino"),
  digits: z.coerce.number("Cifre non valide").int().min(3, "Da 3 a 8 cifre").max(8, "Da 3 a 8 cifre"),
  yearly: z.preprocess((v) => v === "on", z.boolean()),
});
export const nextQuoteNumberSchema = z.object({ next: z.coerce.number("Numero non valido").int("Numero non valido").min(1, "Almeno 1").max(99_999_999, "Numero troppo grande") });
export const aiSettingsSchema = z.object({ context: z.string().trim().max(1500, "Massimo 1500 caratteri"), tone: z.enum(["concise", "detailed"]) });
export const emailSettingsSchema = z.object({
  sender_name: z.string().trim().max(120), reply_to: z.union([z.literal(""), z.email("Email di risposta non valida")]), signature: z.string().trim().max(1000, "Massimo 1000 caratteri"),
});
export const profileSchema = z.object({ full_name: z.string().trim().min(2, "Inserisci nome e cognome").max(120), job_title: optionalText(120) });
export const notificationPrefsSchema = z.object({ due_soon_hours: z.coerce.number().int().min(1, "Da 1 a 168 ore").max(168, "Da 1 a 168 ore") });
export const appearanceSchema = z.object({ dashboard_range: z.enum(["30", "90", "365", "all"]) });

export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_TYPES = { "image/png": "png", "image/jpeg": "jpg" } as const;
