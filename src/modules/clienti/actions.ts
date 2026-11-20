"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { customerSchema, DELETE_CONFIRM_WORD } from "./schemas";
import { insertCustomer, setCustomerArchived, updateCustomer } from "./repository";
import { listFieldDefs } from "@/modules/settore/queries";
import { parseCustomValues } from "@/modules/settore/custom-fields";

export async function createCustomerAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Controlla i campi", fieldErrors(parsed.error));
  const db = await createClient();
  const cv = parseCustomValues(await listFieldDefs(db, ctx.org.organizationId, "customer"), Object.fromEntries(formData));
  if (!cv.ok) return fail(cv.error);
  const { data, error } = await insertCustomer(db, ctx.org.organizationId, ctx.userId, { ...parsed.data, custom_values: cv.values });
  if (error || !data) return fail("Impossibile salvare il cliente");
  revalidatePath("/clienti");
  redirect(`/clienti/${data.id}`);
}

export async function updateCustomerAction(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Cliente non valido");
  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Controlla i campi", fieldErrors(parsed.error));
  const db = await createClient();
  const { data: current } = await db.from("customers").select("custom_values").eq("organization_id", ctx.org.organizationId).eq("id", id).maybeSingle();
  const cv = parseCustomValues(await listFieldDefs(db, ctx.org.organizationId, "customer"), Object.fromEntries(formData), current?.custom_values);
  if (!cv.ok) return fail(cv.error);
  const { error } = await updateCustomer(db, ctx.org.organizationId, id, { ...parsed.data, custom_values: cv.values });
  if (error) return fail("Impossibile salvare le modifiche");
  revalidatePath("/clienti");
  return { ok: true };
}

const refresh = () => { for (const p of ["/clienti", "/preventivi", "/dashboard", "/attivita", "/promemoria"]) revalidatePath(p); };

/** Archivia: il cliente esce dagli elenchi attivi, ma tutti i suoi dati e collegamenti restano intatti. Reversibile. */
export async function archiveCustomerAction(id: string, _prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Cliente non valido");
  const { data, error } = await setCustomerArchived(await createClient(), ctx.org.organizationId, id, true);
  if (error || !data?.length) return fail("Impossibile archiviare il cliente");
  refresh();
  redirect("/clienti");
}

export async function restoreCustomerAction(id: string, _prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Cliente non valido");
  const { data, error } = await setCustomerArchived(await createClient(), ctx.org.organizationId, id, false);
  if (error || !data?.length) return fail("Impossibile ripristinare il cliente");
  refresh();
  redirect(`/clienti/${id}`);
}

/**
 * Eliminazione DEFINITIVA, separata dall'archiviazione: solo titolare/amministratori, solo su clienti già archiviati e senza
 * preventivi, fatture, documenti o attività. Il database ricontrolla tutto (e conserva l'audit). Richiede di scrivere ELIMINA.
 */
export async function deleteCustomerPermanentlyAction(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requirePermission("data:delete");
  if (!isUuid(id)) return fail("Cliente non valido");
  if (String(formData.get("confirm") ?? "").trim() !== DELETE_CONFIRM_WORD) return fail(`Per confermare scrivi ${DELETE_CONFIRM_WORD}`);
  const { error } = await (await createClient()).rpc("delete_customer_permanently", { p_customer: id });
  if (error) {
    if (error.code === "42501") return fail("Non hai i permessi per eliminare definitivamente un cliente");
    if (error.code === "P0002") return fail("Cliente non trovato o già eliminato");
    if (error.message.includes("archived first")) return fail("Prima archivia il cliente");
    if (error.message.includes("linked records")) return fail("Il cliente ha dati collegati che vanno conservati: l'eliminazione non è consentita");
    return fail("Impossibile eliminare il cliente");
  }
  refresh();
  redirect("/clienti?stato=archiviati&eliminato=1");
}
