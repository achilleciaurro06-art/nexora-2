"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { customerSchema } from "./schemas";
import { insertCustomer, updateCustomer } from "./repository";

export async function createCustomerAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Controlla i campi", fieldErrors(parsed.error));
  const { data, error } = await insertCustomer(await createClient(), ctx.org.organizationId, ctx.userId, parsed.data);
  if (error || !data) return fail("Impossibile salvare il cliente");
  revalidatePath("/clienti");
  redirect(`/clienti/${data.id}`);
}

export async function updateCustomerAction(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Cliente non valido");
  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Controlla i campi", fieldErrors(parsed.error));
  const { error } = await updateCustomer(await createClient(), ctx.org.organizationId, id, parsed.data);
  if (error) return fail("Impossibile salvare le modifiche");
  revalidatePath("/clienti");
  return { ok: true };
}

/**
 * Rimuove il cliente (archiviazione, nessuna cancellazione fisica) e i suoi preventivi ancora aperti, in modo atomico.
 * Il ruolo owner/admin è verificato sia qui sia nel database.
 */
export async function deleteCustomerAction(id: string, _prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  await requirePermission("data:delete");
  if (!isUuid(id)) return fail("Cliente non valido");
  const { error } = await (await createClient()).rpc("remove_customer", { p_customer: id });
  if (error) {
    if (error.code === "42501") return fail("Non hai i permessi per rimuovere questo cliente");
    if (error.code === "P0002") return fail("Cliente non trovato o già rimosso");
    return fail("Impossibile rimuovere il cliente");
  }
  revalidatePath("/clienti"); revalidatePath("/preventivi"); revalidatePath("/dashboard"); revalidatePath("/attivita"); revalidatePath("/promemoria");
  redirect("/clienti");
}
