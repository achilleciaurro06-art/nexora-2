import "server-only";
import { z } from "zod";

/** Una variabile impostata ma vuota equivale a "non impostata". */
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  GEMINI_API_KEY: optional(z.string().min(10)),
  GEMINI_MODEL: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("gemini-3.5-flash-lite")),
  GEMINI_FALLBACK_MODEL: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("gemini-3.8-flash")),
});

let cached: z.infer<typeof schema> | undefined;

export function env() {
  cached ??= schema.parse(process.env);
  return cached;
}
