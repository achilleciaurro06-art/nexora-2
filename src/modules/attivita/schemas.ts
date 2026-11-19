import { z } from "zod";
import { optionalText } from "@/lib/forms";

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
  remind: z.literal("on").optional(),
});
export type TaskInput = z.infer<typeof taskSchema>;

export const PRIORITY_LABEL = { low: "Bassa", normal: "Normale", high: "Alta", urgent: "Urgente" } as const;
export const STATUS_LABEL = { todo: "Da fare", in_progress: "In corso", done: "Completata", cancelled: "Annullata" } as const;

/** Scadenza alle 09:00 del giorno scelto. */
export function dueAtFromDate(date: string | null): string | null {
  return date ? new Date(`${date}T09:00:00`).toISOString() : null;
}
