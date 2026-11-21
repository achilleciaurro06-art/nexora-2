import { z } from "zod";
import { optionalText } from "@/lib/forms";
import { FOLLOW_UP_STATUSES } from "./states";

const optUuid = z.uuid("Valore non valido").optional().or(z.literal("")).transform((v) => v || null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data non valida").refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "Data non valida");

export const followUpSchema = z.object({
  customerId: z.uuid("Seleziona un cliente"),
  contactId: optUuid,
  quoteId: optUuid,
  title: z.string().trim().min(1, "Inserisci un titolo").max(200),
  description: optionalText(2000),
  reason: optionalText(300),
  dueOn: date,
  assigneeId: optUuid,
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  notes: optionalText(4000),
  status: z.enum(["todo", "scheduled"]).default("todo"),
  sourceTaskId: optUuid,
});
export type FollowUpInput = z.infer<typeof followUpSchema>;
export const followUpEditSchema = followUpSchema.omit({ customerId: true, dueOn: true, status: true, sourceTaskId: true });

export const statusChangeSchema = z.object({
  status: z.enum(FOLLOW_UP_STATUSES.map((s) => s.key) as [string, ...string[]]),
  note: optionalText(500),
});
export const rescheduleSchema = z.object({ dueOn: date, note: optionalText(500) });
