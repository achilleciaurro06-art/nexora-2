import { z } from "zod";

/** Stringa opzionale da form: "" -> null. */
export const optionalText = (max = 500) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));

export function fieldErrors(error: z.ZodError) {
  return z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
}
