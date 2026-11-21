import { z } from "zod";
import { optionalText } from "@/lib/forms";
import { zonedToUtcIso } from "@/lib/datetime";
import { parseReminderOffset } from "@/modules/agenda/types";

const optUuid = z.uuid("Valore non valido").optional().or(z.literal("")).transform((v) => v || null);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ora non valida");

export const appointmentSchema = z.object({
  title: z.string().trim().min(1, "Inserisci un titolo").max(200),
  description: optionalText(2000),
  customerId: optUuid,
  contactId: optUuid,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data non valida"),
  startTime: time,
  endTime: time,
  location: optionalText(300),
  assigneeId: optUuid,
  notes: optionalText(4000),
  reminder: z.string().optional().transform((v, ctx) => {
    const r = parseReminderOffset(v);
    if (r === "invalid") { ctx.addIssue({ code: "custom", message: "Promemoria non valido" }); return z.NEVER; }
    return r;
  }),
}).transform((v, ctx) => {
  const startsAt = zonedToUtcIso(`${v.date}T${v.startTime}`);
  const endsAt = zonedToUtcIso(`${v.date}T${v.endTime}`);
  if (!startsAt) { ctx.addIssue({ code: "custom", path: ["date"], message: "Data non valida" }); return z.NEVER; }
  if (!endsAt || v.endTime <= v.startTime) { ctx.addIssue({ code: "custom", path: ["endTime"], message: "L'ora di fine deve essere successiva a quella di inizio" }); return z.NEVER; }
  return { ...v, startsAt, endsAt };
});
export type AppointmentInput = z.output<typeof appointmentSchema>;
