"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { dueAtFromDate, taskSchema } from "./schemas";

function revalidateTaskViews(customerId?: string | null, quoteId?: string | null) {
  revalidatePath("/attivita");
  revalidatePath("/dashboard");
  revalidatePath("/promemoria");
  if (customerId) revalidatePath(`/clienti/${customerId}`);
  if (quoteId) revalidatePath(`/preventivi/${quoteId}`);
}

/** Coerenza dei collegamenti: se c'è un preventivo, il cliente è quello del preventivo. */
async function resolveLinks(db: Awaited<ReturnType<typeof createClient>>, orgId: string, customerId: string | null, quoteId: string | null) {
  if (!quoteId) return { customerId, quoteId: null as string | null };
  const { data: quote } = await db.from("quotes").select("customer_id").eq("organization_id", orgId).eq("id", quoteId).is("deleted_at", null).maybeSingle();
  if (!quote) return { error: "Preventivo non trovato" };
  if (customerId && quote.customer_id !== customerId) return { error: "Il preventivo scelto non appartiene a questo cliente" };
  return { customerId: quote.customer_id as string, quoteId };
}

export async function createTaskAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  const parsed = taskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Controlla i campi", fieldErrors(parsed.error));
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const links = await resolveLinks(db, orgId, parsed.data.customerId, parsed.data.quoteId);
  if ("error" in links) return fail(links.error ?? "Collegamento non valido");
  const dueAt = dueAtFromDate(parsed.data.dueDate);
  const { data, error } = await db.from("tasks").insert({
    organization_id: orgId, title: parsed.data.title, description: parsed.data.description, priority: parsed.data.priority,
    status: parsed.data.status, completed_at: parsed.data.status === "done" ? new Date().toISOString() : null,
    due_at: dueAt, customer_id: links.customerId, quote_id: links.quoteId, created_by: ctx.userId,
    assignee_id: parsed.data.assigneeId ?? ctx.userId,
  }).select("id").single();
  if (error || !data) return fail(error?.code === "23514" ? "L'assegnatario non fa parte dell'organizzazione" : "Impossibile creare l'attività");
  if (parsed.data.remind && dueAt) {
    await db.from("reminders").insert({ organization_id: orgId, task_id: data.id, remind_at: dueAt, channel: "in_app" });
  }
  revalidateTaskViews(links.customerId, links.quoteId);
  // dal form completo si va alla scheda; dal modulo rapido si resta sulla lista
  if (formData.get("redirect") === "detail") redirect(`/attivita/${data.id as string}`);
  return { ok: true };
}

export async function updateTaskAction(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Attività non valida");
  const parsed = taskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Controlla i campi", fieldErrors(parsed.error));
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const links = await resolveLinks(db, orgId, parsed.data.customerId, parsed.data.quoteId);
  if ("error" in links) return fail(links.error ?? "Collegamento non valido");
  const { data: before } = await db.from("tasks").select("status, completed_at").eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!before) return fail("Attività non trovata");
  const completedAt = parsed.data.status === "done" ? (before.status === "done" ? before.completed_at : new Date().toISOString()) : null;
  const { error } = await db.from("tasks").update({
    title: parsed.data.title, description: parsed.data.description, priority: parsed.data.priority, status: parsed.data.status,
    completed_at: completedAt, due_at: dueAtFromDate(parsed.data.dueDate), assignee_id: parsed.data.assigneeId,
    customer_id: links.customerId, quote_id: links.quoteId,
  }).eq("organization_id", orgId).eq("id", id);
  if (error) return fail(error.code === "23514" ? "L'assegnatario non fa parte dell'organizzazione" : "Impossibile salvare le modifiche");
  revalidateTaskViews(links.customerId, links.quoteId);
  revalidatePath(`/attivita/${id}`);
  return { ok: true };
}

export async function setTaskStatusAction(id: string, formData: FormData) {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return;
  const status = z.enum(["todo", "in_progress", "done", "cancelled"]).safeParse(formData.get("status"));
  if (!status.success) return;
  const { data } = await (await createClient()).from("tasks")
    .update({ status: status.data, completed_at: status.data === "done" ? new Date().toISOString() : null })
    .eq("organization_id", ctx.org.organizationId).eq("id", id).select("customer_id, quote_id").maybeSingle();
  revalidateTaskViews(data?.customer_id as string | null, data?.quote_id as string | null);
  revalidatePath(`/attivita/${id}`);
}

export async function deleteTaskAction(id: string) {
  const ctx = await requirePermission("data:delete");
  if (!isUuid(id)) return;
  const { data } = await (await createClient()).from("tasks").update({ deleted_at: new Date().toISOString() })
    .eq("organization_id", ctx.org.organizationId).eq("id", id).select("customer_id, quote_id").maybeSingle();
  revalidateTaskViews(data?.customer_id as string | null, data?.quote_id as string | null);
  redirect("/attivita");
}
