"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { setReminder } from "@/modules/agenda/reminders";
import { appointmentSchema } from "./schemas";

function refresh(customerId?: string | null, id?: string) {
  for (const p of ["/appuntamenti", "/promemoria", "/dashboard"]) revalidatePath(p);
  if (customerId) revalidatePath(`/clienti/${customerId}`);
  if (id) revalidatePath(`/appuntamenti/${id}`);
}
function dbError(code?: string, message?: string) {
  if (code === "23514") {
    if (message?.includes("archived")) return "Il cliente è archiviato: ripristinalo prima di fissare nuovi appuntamenti";
    if (message?.includes("contact")) return "Il referente scelto non appartiene a questo cliente";
    return "Responsabile o partecipante non fanno parte dell'organizzazione, oppure la durata supera 24 ore";
  }
  return "Impossibile salvare l'appuntamento";
}
const participantsOf = (fd: FormData) => [...new Set(fd.getAll("participants").map(String).filter(isUuid))];

export async function createAppointmentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  const parsed = appointmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Controlla i campi", fieldErrors(parsed.error));
  const d = parsed.data;
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data, error } = await db.from("appointments").insert({
    organization_id: orgId, title: d.title, description: d.description, customer_id: d.customerId, contact_id: d.contactId, starts_at: d.startsAt, ends_at: d.endsAt,
    location: d.location, assignee_id: d.assigneeId ?? ctx.userId, notes: d.notes, created_by: ctx.userId,
  }).select("id").single();
  if (error || !data) return fail(dbError(error?.code, error?.message));
  const id = data.id as string;
  const people = participantsOf(formData);
  if (people.length) {
    const { error: pe } = await db.from("appointment_participants").insert(people.map((u) => ({ appointment_id: id, organization_id: orgId, user_id: u })));
    if (pe) return fail("Appuntamento creato, ma alcuni partecipanti non fanno parte dell'organizzazione: riaprilo e correggi");
  }
  if (d.reminder !== null) await setReminder(db, orgId, { appointmentId: id }, d.startsAt, d.reminder);
  refresh(d.customerId);
  redirect(`/appuntamenti/${id}`);
}

export async function updateAppointmentAction(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Appuntamento non valido");
  const parsed = appointmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Controlla i campi", fieldErrors(parsed.error));
  const d = parsed.data;
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data, error } = await db.from("appointments").update({
    title: d.title, description: d.description, customer_id: d.customerId, contact_id: d.contactId, starts_at: d.startsAt, ends_at: d.endsAt,
    location: d.location, assignee_id: d.assigneeId, notes: d.notes,
  }).eq("organization_id", orgId).eq("id", id).is("deleted_at", null).select("id");
  if (error) return fail(dbError(error.code, error.message));
  if (!data?.length) return fail("Appuntamento non trovato");
  await db.from("appointment_participants").delete().eq("organization_id", orgId).eq("appointment_id", id);
  const people = participantsOf(formData);
  if (people.length) {
    const { error: pe } = await db.from("appointment_participants").insert(people.map((u) => ({ appointment_id: id, organization_id: orgId, user_id: u })));
    if (pe) return fail("Alcuni partecipanti non fanno parte dell'organizzazione");
  }
  if (d.reminder !== undefined) await setReminder(db, orgId, { appointmentId: id }, d.startsAt, d.reminder);
  refresh(d.customerId, id);
  return { ok: true };
}

const statusSchema = z.enum(["scheduled", "completed", "cancelled"]);
export async function setAppointmentStatusAction(id: string, formData: FormData) {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return;
  const status = statusSchema.safeParse(formData.get("status"));
  if (!status.success) return;
  const { data } = await (await createClient()).from("appointments").update({ status: status.data }).eq("organization_id", ctx.org.organizationId).eq("id", id).is("deleted_at", null).select("customer_id");
  refresh(data?.[0]?.customer_id as string | null | undefined, id);
}

export async function deleteAppointmentAction(id: string, _prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:delete");
  if (!isUuid(id)) return fail("Appuntamento non valido");
  const { data, error } = await (await createClient()).from("appointments").update({ deleted_at: new Date().toISOString() }).eq("organization_id", ctx.org.organizationId).eq("id", id).select("customer_id");
  if (error || !data?.length) return fail("Impossibile eliminare l'appuntamento");
  refresh(data[0]!.customer_id as string | null);
  redirect("/appuntamenti");
}
