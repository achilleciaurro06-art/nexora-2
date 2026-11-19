"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors, optionalText } from "@/lib/forms";

const taskSchema = z.object({
  title: z.string().trim().min(1, "Inserisci un titolo").max(200),
  description: optionalText(2000),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null),
  customerId: z.uuid().optional().or(z.literal("")).transform((v) => v || null),
  remind: z.literal("on").optional(),
});

export async function createTaskAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  const parsed = taskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Controlla i campi", fieldErrors(parsed.error));
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const dueAt = parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T09:00:00`).toISOString() : null;
  const { data, error } = await db.from("tasks").insert({
    organization_id: orgId, title: parsed.data.title, description: parsed.data.description, priority: parsed.data.priority,
    due_at: dueAt, customer_id: parsed.data.customerId, created_by: ctx.userId, assignee_id: ctx.userId,
  }).select("id").single();
  if (error || !data) return fail("Impossibile creare l'attività");
  if (parsed.data.remind && dueAt) {
    await db.from("reminders").insert({ organization_id: orgId, task_id: data.id, remind_at: dueAt, channel: "in_app" });
  }
  revalidatePath("/attivita");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function setTaskStatusAction(id: string, formData: FormData) {
  const ctx = await requirePermission("data:write");
  const status = z.enum(["todo", "in_progress", "done", "cancelled"]).safeParse(formData.get("status"));
  if (!status.success) return;
  await (await createClient()).from("tasks").update({ status: status.data, completed_at: status.data === "done" ? new Date().toISOString() : null })
    .eq("organization_id", ctx.org.organizationId).eq("id", id);
  revalidatePath("/attivita");
  revalidatePath("/dashboard");
}

export async function deleteTaskAction(id: string) {
  const ctx = await requirePermission("data:delete");
  await (await createClient()).from("tasks").update({ deleted_at: new Date().toISOString() }).eq("organization_id", ctx.org.organizationId).eq("id", id);
  revalidatePath("/attivita");
}
