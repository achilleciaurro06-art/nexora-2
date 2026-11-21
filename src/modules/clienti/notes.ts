"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { isUuid } from "@/lib/ids";

const noteSchema = z.object({ body: z.string().trim().min(1).max(4000) });

export async function addNoteAction(customerId: string, formData: FormData) {
  const ctx = await requirePermission("data:write");
  if (!isUuid(customerId)) return;
  const parsed = noteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await (await createClient()).from("customer_notes").insert({
    organization_id: ctx.org.organizationId, customer_id: customerId, body: parsed.data.body, created_by: ctx.userId,
  });
  revalidatePath(`/clienti/${customerId}`);
}

export async function deleteNoteAction(customerId: string, noteId: string) {
  const ctx = await requirePermission("data:write");
  if (!isUuid(customerId) || !isUuid(noteId)) return;
  // la RLS consente l'eliminazione all'autore o a owner/admin
  await (await createClient()).from("customer_notes").delete().eq("organization_id", ctx.org.organizationId).eq("customer_id", customerId).eq("id", noteId);
  revalidatePath(`/clienti/${customerId}`);
}
