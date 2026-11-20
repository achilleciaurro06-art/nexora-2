import { z } from "zod";

/* ------------------------------------------------------------------ IBAN */
export function normalizeIban(v: string): string {
  return v.replace(/[\s.-]/g, "").toUpperCase();
}
/** Controllo formale (lunghezza di base + cifra di controllo mod 97). Non verifica che il conto esista. */
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban) || iban.length > 34) return false;
  if (iban.startsWith("IT") && iban.length !== 27) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}
export function formatIban(raw: string): string {
  return normalizeIban(raw).replace(/(.{4})/g, "$1 ").trim();
}

/* ------------------------------------------------------------------ impostazioni dell'organizzazione (organizations.settings) */
const text = (max: number) => z.string().trim().max(max).default("");

export const orgSettingsSchema = z.object({
  quotes: z.object({
    default_vat_rate: z.number().min(0).max(100).default(22),
    default_validity_days: z.number().int().min(0).max(365).default(30),
    pdf_template: z.enum(["classic", "minimal"]).default("classic"),
    pdf_accent: z.enum(["indigo", "green", "slate", "orange", "red"]).default("indigo"),
    pdf_show_logo: z.boolean().default(true),
    pdf_show_payment: z.boolean().default(true),
    pdf_show_brand: z.boolean().default(true),
  }).default({ default_vat_rate: 22, default_validity_days: 30, pdf_template: "classic", pdf_accent: "indigo", pdf_show_logo: true, pdf_show_payment: true, pdf_show_brand: true }),
  ai: z.object({
    context: text(1500),
    tone: z.enum(["concise", "detailed"]).default("concise"),
  }).default({ context: "", tone: "concise" }),
  email: z.object({
    sender_name: text(120),
    reply_to: z.union([z.literal(""), z.email()]).default(""),
    signature: text(1000),
  }).default({ sender_name: "", reply_to: "", signature: "" }),
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

/** Lettura tollerante: valori mancanti o non validi tornano ai default, senza mai far fallire una pagina. */
export function parseOrgSettings(raw: unknown): OrgSettings {
  const base = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = orgSettingsSchema.safeParse(base);
  if (out.success) return out.data;
  // sezione per sezione: una sezione corrotta non azzera le altre
  const sh = orgSettingsSchema.shape;
  const q = sh.quotes.safeParse(base.quotes), a = sh.ai.safeParse(base.ai), e = sh.email.safeParse(base.email);
  return {
    quotes: q.success ? q.data : sh.quotes.parse(undefined),
    ai: a.success ? a.data : sh.ai.parse(undefined),
    email: e.success ? e.data : sh.email.parse(undefined),
  };
}

/** Unisce una sezione nelle impostazioni esistenti, mantenendo le altre chiavi. */
export function mergeOrgSettings(current: unknown, section: keyof OrgSettings, value: unknown): Record<string, unknown> {
  const base = (current && typeof current === "object" && !Array.isArray(current) ? current : {}) as Record<string, unknown>;
  return { ...base, [section]: value };
}

/* ------------------------------------------------------------------ preferenze personali (profiles.preferences) */
export const NOTIFICATION_KINDS = [
  { key: "task_due_soon", label: "Attività in scadenza" },
  { key: "task_overdue", label: "Attività scadute" },
  { key: "quote_followup", label: "Follow-up dei preventivi" },
  { key: "reminder", label: "Promemoria programmati" },
  { key: "task_assigned", label: "Attività assegnate a me" },
  { key: "followup", label: "Follow-up da eseguire" },
  { key: "appointment", label: "Appuntamenti imminenti" },
] as const;

export const userPrefsSchema = z.object({
  notifications: z.object({
    task_due_soon: z.boolean().default(true), task_overdue: z.boolean().default(true), quote_followup: z.boolean().default(true),
    reminder: z.boolean().default(true), task_assigned: z.boolean().default(true), followup: z.boolean().default(true), appointment: z.boolean().default(true),
    due_soon_hours: z.number().int().min(1).max(168).default(24),
  }).default({ task_due_soon: true, task_overdue: true, quote_followup: true, reminder: true, task_assigned: true, followup: true, appointment: true, due_soon_hours: 24 }),
  appearance: z.object({
    dashboard_range: z.enum(["30", "90", "365", "all"]).default("365"),
  }).default({ dashboard_range: "365" }),
});
export type UserPrefs = z.infer<typeof userPrefsSchema>;

export function parseUserPrefs(raw: unknown): UserPrefs {
  const base = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = userPrefsSchema.safeParse(base);
  if (out.success) return out.data;
  const sh = userPrefsSchema.shape;
  const n = sh.notifications.safeParse(base.notifications), ap = sh.appearance.safeParse(base.appearance);
  return { notifications: n.success ? n.data : sh.notifications.parse(undefined), appearance: ap.success ? ap.data : sh.appearance.parse(undefined) };
}

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

/** Verifica della firma del file: il tipo dichiarato dal browser non basta. */
export function sniffImage(head: Uint8Array): "png" | "jpg" | "webp" | null {
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "png";
  if (head[0] === 0xff && head[1] === 0xd8) return "jpg";
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return "webp";
  return null;
}
