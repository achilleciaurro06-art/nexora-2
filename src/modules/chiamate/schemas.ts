import { z } from "zod";
import { optionalText } from "@/lib/forms";
import { zonedToUtcIso } from "@/lib/datetime";
import { CALL_OUTCOMES } from "@/modules/agenda/types";

const optUuid = z.uuid("Valore non valido").optional().or(z.literal("")).transform((v) => v || null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data non valida");

export const callSchema = z.object({
  customerId: z.uuid("Seleziona un cliente"),
  contactId: optUuid,
  direction: z.enum(["inbound", "outbound"], "Indica se la chiamata è in entrata o in uscita"),
  userId: optUuid,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data non valida"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ora non valida"),
  durationMinutes: z.string().optional().transform((v) => (v && v.trim() ? Number(v.trim().replace(",", ".")) : null)).refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 720), "Durata non valida (0–720 minuti)"),
  outcome: z.enum(CALL_OUTCOMES.map((o) => o.key) as [string, ...string[]], "Scegli l'esito della chiamata"),
  notes: optionalText(4000),
  nextOn: z.union([z.literal(""), date]).optional().transform((v) => v || null),
  nextAssigneeId: optUuid,
  nextTitle: optionalText(200),
}).transform((v, ctx) => {
  const calledAt = zonedToUtcIso(`${v.date}T${v.time}`);
  if (!calledAt) { ctx.addIssue({ code: "custom", path: ["date"], message: "Data o ora non valida" }); return z.NEVER; }
  if (new Date(calledAt).getTime() > Date.now() + 10 * 60_000) { ctx.addIssue({ code: "custom", path: ["date"], message: "La chiamata non può essere nel futuro" }); return z.NEVER; }
  return { ...v, calledAt, durationSeconds: v.durationMinutes === null ? null : Math.round(v.durationMinutes * 60) };
});
export type CallInput = z.output<typeof callSchema>;
