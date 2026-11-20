"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors } from "@/lib/forms";
import { callSchema } from "./schemas";

/** Registro MANUALE delle chiamate (nessuna integrazione telefonica). Chiamata ed eventuale follow-up vengono creati in un'unica transazione. */
export async function logCallAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  const parsed = callSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Controlla i campi", fieldErrors(parsed.error));
  const d = parsed.data;
  const { data, error } = await (await createClient()).rpc("log_call", {
    p_org: ctx.org.organizationId, p_customer: d.customerId, p_contact: d.contactId, p_direction: d.direction, p_user: d.userId ?? ctx.userId,
    p_called_at: d.calledAt, p_duration: d.durationSeconds, p_outcome: d.outcome, p_notes: d.notes, p_next_due: d.nextOn, p_next_assignee: d.nextAssigneeId, p_next_title: d.nextTitle,
  });
  if (error) {
    if (error.code === "23514") {
      if (error.message.includes("archived")) return fail("Il cliente è archiviato: ripristinalo prima di registrare nuove chiamate");
      if (error.message.includes("contact")) return fail("Il referente scelto non appartiene a questo cliente");
      return fail("Dati non coerenti (collaboratore non dell'organizzazione o data nel futuro)");
    }
    return fail("Impossibile registrare la chiamata");
  }
  for (const p of ["/chiamate", "/followup", "/promemoria", "/dashboard", `/clienti/${d.customerId}`]) revalidatePath(p);
  const fu = (data as { follow_up_id: string | null } | null)?.follow_up_id;
  redirect(fu ? `/followup/${fu}` : `/chiamate?registrata=1`);
}
