import { z } from "zod";
import { optionalText } from "@/lib/forms";

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Inserisci il nome").max(200),
  vat_number: optionalText(32),
  tax_code: optionalText(32),
  email: z.union([z.literal(""), z.email("Email non valida")]).optional().transform((v) => (v ? v.toLowerCase() : null)),
  phone: optionalText(40),
  address_line: optionalText(200),
  city: optionalText(100),
  province: optionalText(4),
  postal_code: optionalText(10),
  status: z.enum(["lead", "active", "inactive"]).default("active"),
  notes: optionalText(4000),
});
export type CustomerInput = z.infer<typeof customerSchema>;
