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
  // email (tutto facoltativo: senza queste variabili i relativi collegamenti risultano "non configurati")
  EMAIL_ENCRYPTION_KEY: optional(z.string().min(32)),
  GOOGLE_OAUTH_CLIENT_ID: optional(z.string().min(10)),
  GOOGLE_OAUTH_CLIENT_SECRET: optional(z.string().min(10)),
  MS_OAUTH_CLIENT_ID: optional(z.string().min(10)),
  MS_OAUTH_CLIENT_SECRET: optional(z.string().min(10)),
  MS_OAUTH_TENANT: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("common")),
  EMAIL_ALLOW_PRIVATE_HOSTS: optional(z.enum(["true", "false"])),
  CRON_SECRET: optional(z.string().min(16)),
  // SOLO test: "mock" usa il provider simulato (mai attivo su Vercel produzione, vedi getAiProvider)
  AI_PROVIDER: optional(z.enum(["gemini", "mock"])),
  // richieste Copilot per utente ogni 10 minuti (default 20)
  AI_RATE_LIMIT_PER_10MIN: optional(z.coerce.number().int().min(1).max(1000)),
  NEXT_PUBLIC_APP_URL: optional(z.url()),
});

let cached: z.infer<typeof schema> | undefined;

export function env() {
  cached ??= schema.parse(process.env);
  return cached;
}
