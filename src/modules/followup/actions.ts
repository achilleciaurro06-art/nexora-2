"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { followUpEditSchema, followUpSchema, rescheduleSchema, statusChangeSchema } from "./schemas";

function refresh(customerId?: string | null, id?: string) {
  for (const p of ["/followup", "/promemoria", "/dashboard"]) revalidatePath(p);
  if (customerId) revalidatePath(`/clienti/${customerId}`);
  if (id) revalidatePath(`/followup/${id}`);
}

function dbError(code?: string, message?: string): string {
  if (code === "23514") {
    if (message?.includes("archived")) return "Il cliente è archiviato: ripristinalo prima di creare nuovi follow-up";
    if (message?.includes("contact")) return "Il referente scelto non appartiene a questo cliente";
    if (message?.includes("quote")) return "Il preventivo scelto non appartiene a questo cliente";
    if (message?.includes("closed")) return "Un follow-up chiuso si può solo riaprire (stato «Da fare»)";
    return "L'assegnatario non fa parte dell'organizzazione";
  }
  if (code === "P0002") return "Follow-up non trovato o già chiuso";
  return "Operazione non riuscita";
}

export async function createFollowUpAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  const parsed = followUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Controlla i campi", fieldErrors(parsed.error));
  const d = parsed.data;
  const { data, error } = await (await createClient()).from("follow_ups").insert({
    organization_id: ctx.org.organizationId, customer_id: d.customerId, contact_id: d.contactId, quote_id: d.quoteId, title: d.title, description: d.description,
    reason: d.reason, due_on: d.dueOn, assignee_id: d.assigneeId ?? ctx.userId, priority: d.priority, notes: d.notes, status: d.status,
    source_task_id: d.sourceTaskId, created_by: ctx.userId,
  }).select("id").single();
  if (error || !data) return fail(dbError(error?.code, error?.message));
  refresh(d.customerId);
  redirect(`/followup/${data.id as string}`);
}

export async function updateFollowUpAction(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Follow-up non valido");
  const parsed = followUpEditSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Controlla i campi", fieldErrors(parsed.error));
  const d = parsed.data;
  const { data, error } = await (await createClient()).from("follow_ups").update({
    contact_id: d.contactId, quote_id: d.quoteId, title: d.title, description: d.description, reason: d.reason,
    assignee_id: d.assigneeId, priority: d.priority, notes: d.notes,
  }).eq("organization_id", ctx.org.organizationId).eq("id", id).is("deleted_at", null).select("customer_id");
  if (error) return fail(dbError(error.code, error.message));
  if (!data?.length) return fail("Follow-up non trovato");
  refresh(data[0]!.customer_id as string, id);
  return { ok: true };
}

export async function changeFollowUpStatusAction(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Follow-up non valido");
  const parsed = statusChangeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Stato non valido");
  const db = await createClient();
  const { error } = await db.rpc("set_follow_up_status", { p_id: id, p_status: parsed.data.status, p_note: parsed.data.note });
  if (error) return fail(dbError(error.code, error.message));
  const { data } = await db.from("follow_ups").select("customer_id").eq("organization_id", ctx.org.organizationId).eq("id", id).maybeSingle();
  refresh(data?.customer_id as string | undefined, id);
  return { ok: true };
}

export async function rescheduleFollowUpAction(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Follow-up non valido");
  const parsed = rescheduleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data non valida");
  const db = await createClient();
  const { error } = await db.rpc("reschedule_follow_up", { p_id: id, p_new_date: parsed.data.dueOn, p_note: parsed.data.note });
  if (error) return fail(dbError(error.code, error.message));
  const { data } = await db.from("follow_ups").select("customer_id").eq("organization_id", ctx.org.organizationId).eq("id", id).maybeSingle();
  refresh(data?.customer_id as string | undefined, id);
  return { ok: true };
}

/** Eliminazione (archiviazione logica) riservata a titolare/amministratori; la cronologia resta nel database. */
export async function deleteFollowUpAction(id: string, _prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:delete");
  if (!isUuid(id)) return fail("Follow-up non valido");
  const { data, error } = await (await createClient()).from("follow_ups").update({ deleted_at: new Date().toISOString() }).eq("organization_id", ctx.org.organizationId).eq("id", id).select("customer_id");
  if (error || !data?.length) return fail("Impossibile eliminare il follow-up");
  refresh(data[0]!.customer_id as string);
  redirect("/followup");
}

/** Azione rapida (liste e Promemoria): completa il follow-up. */
export async function completeFollowUpQuickAction(id: string) {
  await requirePermission("data:write");
  if (!isUuid(id)) return;
  const { error } = await (await createClient()).rpc("set_follow_up_status", { p_id: id, p_status: "done", p_note: null });
  if (!error) refresh(null, id);
}
