import { z } from "zod";
import { optionalText } from "@/lib/forms";

export const organizationProfileSchema = z.object({
  name: z.string().trim().min(2, "Almeno 2 caratteri").max(120),
  vat_number: optionalText(32),
  tax_code: optionalText(32),
  address: optionalText(300),
  email: z.union([z.literal(""), z.email("Email non valida")]).optional().transform((v) => (v ? v.toLowerCase() : null)),
  phone: optionalText(40),
  website: z.string().trim().max(200).optional().transform((v) => (v ? v : null))
    .refine((v) => v === null || /^(https?:\/\/)?[^\s/$.?#][^\s]*\.[^\s]{2,}$/i.test(v), "Indirizzo web non valido"),
  quote_footer: optionalText(2000),
  quote_default_terms: optionalText(4000),
});
export type OrganizationProfileInput = z.infer<typeof organizationProfileSchema>;

export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_TYPES = { "image/png": "png", "image/jpeg": "jpg" } as const;
