import { z } from "zod";
import { optionalText } from "@/lib/forms";
import { zonedToUtcIso } from "@/lib/datetime";
import { parseReminderOffset } from "@/modules/agenda/types";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data non valida").optional().or(z.literal("")).transform((v) => v || null);
const optUuid = z.uuid("Valore non valido").optional().or(z.literal("")).transform((v) => v || null);

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Inserisci un titolo").max(200),
  description: optionalText(2000),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  status: z.enum(["todo", "in_progress", "done", "cancelled"]).default("todo"),
  dueDate: date,
  assigneeId: optUuid,
  customerId: optUuid,
  quoteId: optUuid,
  contactId: optUuid,
  typeId: optUuid,
  notes: optionalText(4000),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ora non valida").optional().or(z.literal("")).transform((v) => v || null),
  durationMinutes: z.string().optional().transform((v) => (v && v.trim() ? Number(v.trim()) : null)).refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 1440), "Durata non valida (1–1440 minuti)"),
  reminder: z.string().optional().transform((v, ctx) => {
    const r = parseReminderOffset(v);
    if (r === "invalid") { ctx.addIssue({ code: "custom", message: "Promemoria non valido" }); return z.NEVER; }
    return r;
  }),
  remind: z.literal("on").optional(),
}).superRefine((v, ctx) => {
  if (v.dueTime && !v.dueDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Indica anche la data di scadenza" });
});
export type TaskInput = z.infer<typeof taskSchema>;

export const PRIORITY_LABEL = { low: "Bassa", normal: "Normale", high: "Alta", urgent: "Urgente" } as const;
export const STATUS_LABEL = { todo: "Da fare", in_progress: "In corso", done: "Completata", cancelled: "Annullata" } as const;

/** Scadenza: ora indicata (ora locale dell'azienda) oppure 09:00 del giorno scelto. Il fuso è sempre quello dell'azienda, mai quello del server. */
export function dueAtFromParts(date: string | null, time: string | null): { dueAt: string | null; hasTime: boolean } {
  if (!date) return { dueAt: null, hasTime: false };
  return { dueAt: zonedToUtcIso(`${date}T${time ?? "09:00"}`), hasTime: time !== null };
}
