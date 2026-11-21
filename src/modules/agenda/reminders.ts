import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Un solo promemoria per attività/appuntamento: quelli ancora in attesa vengono annullati e, se richiesto, ne viene creato uno nuovo
 * `offsetMinutes` prima dell'istante di riferimento. Se il promemoria è già nel passato diventa subito esigibile (notifica alla prima apertura).
 */
export async function setReminder(db: SupabaseClient, orgId: string, target: { taskId: string } | { appointmentId: string }, anchorIso: string | null, offsetMinutes: number | null) {
  const key = "taskId" in target ? "task_id" : "appointment_id";
  const id = "taskId" in target ? target.taskId : target.appointmentId;
  await db.from("reminders").update({ status: "cancelled" }).eq("organization_id", orgId).eq(key, id).eq("status", "pending");
  if (offsetMinutes === null || !anchorIso) return { ok: true as const };
  const remindAt = new Date(new Date(anchorIso).getTime() - offsetMinutes * 60_000).toISOString();
  const { error } = await db.from("reminders").insert({ organization_id: orgId, [key]: id, remind_at: remindAt, offset_minutes: offsetMinutes, channel: "in_app" });
  return error ? { ok: false as const } : { ok: true as const };
}

/** Promemoria attivo (se c'è) con il suo scarto, per precompilare i moduli di modifica. */
export async function getReminderOffset(db: SupabaseClient, orgId: string, target: { taskId: string } | { appointmentId: string }): Promise<number | null> {
  const key = "taskId" in target ? "task_id" : "appointment_id";
  const id = "taskId" in target ? target.taskId : target.appointmentId;
  const { data } = await db.from("reminders").select("offset_minutes").eq("organization_id", orgId).eq(key, id).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? ((data.offset_minutes as number | null) ?? 0) : null;
}
