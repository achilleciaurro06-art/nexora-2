"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = new Set([
  "application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function safeName(name: string) {
  return name.normalize("NFKD").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-120) || "file";
}

export async function uploadDocumentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Seleziona un file");
  if (file.size > MAX_BYTES) return fail("File troppo grande (max 15 MB)");
  if (!ALLOWED.has(file.type)) return fail("Tipo di file non consentito");

  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const id = randomUUID();
  const path = `${orgId}/${id}/${safeName(file.name)}`;

  const { error: upErr } = await db.storage.from("documents").upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return fail("Caricamento non riuscito");
  const customerId = String(formData.get("customerId") ?? "") || null;
  const { error } = await db.from("documents").insert({
    id, organization_id: orgId, name: file.name.slice(0, 200), storage_path: path, mime_type: file.type,
    size_bytes: file.size, customer_id: customerId, uploaded_by: ctx.userId,
  });
  if (error) {
    await db.storage.from("documents").remove([path]);
    return fail("Impossibile registrare il documento");
  }
  revalidatePath("/documenti");
  return { ok: true };
}

export async function deleteDocumentAction(id: string) {
  const ctx = await requirePermission("data:delete");
  const db = await createClient();
  const { data } = await db.from("documents").select("storage_path").eq("organization_id", ctx.org.organizationId).eq("id", id).maybeSingle();
  if (!data) return;
  await db.storage.from("documents").remove([data.storage_path as string]);
  await db.from("documents").update({ deleted_at: new Date().toISOString() }).eq("organization_id", ctx.org.organizationId).eq("id", id);
  revalidatePath("/documenti");
}
