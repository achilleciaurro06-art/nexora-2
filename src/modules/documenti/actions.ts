"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { optionalText } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { ALLOWED_DOCUMENT_MIMES } from "@/lib/documents";

const MAX_BYTES = 15 * 1024 * 1024;

function safeName(name: string) {
  return name.normalize("NFKD").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-120) || "file";
}

export async function uploadDocumentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Seleziona un file");
  if (file.size > MAX_BYTES) return fail("File troppo grande (max 15 MB)");
  if (!ALLOWED_DOCUMENT_MIMES.has(file.type)) return fail("Tipo di file non consentito (PDF, Word, Excel, immagini, testo)");
  const customerRaw = String(formData.get("customerId") ?? "");
  if (customerRaw && !isUuid(customerRaw)) return fail("Cliente non valido");

  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");

  // lo stesso file non va archiviato due volte nella stessa organizzazione
  const { data: dup } = await db.from("documents").select("id, name").eq("organization_id", orgId).eq("content_hash", hash).is("deleted_at", null).limit(1).maybeSingle();
  if (dup) return fail(`Questo file è già in archivio come «${dup.name as string}».`);

  const id = randomUUID();
  const path = `${orgId}/${id}/${safeName(file.name)}`;
  const { error: upErr } = await db.storage.from("documents").upload(path, bytes, { contentType: file.type, upsert: false });
  if (upErr) return fail("Caricamento non riuscito");
  const { error } = await db.from("documents").insert({
    id, organization_id: orgId, name: file.name.slice(0, 200), storage_path: path, mime_type: file.type, size_bytes: file.size,
    customer_id: customerRaw || null, uploaded_by: ctx.userId, content_hash: hash,
  });
  if (error) {
    await db.storage.from("documents").remove([path]);
    return fail("Impossibile registrare il documento");
  }
  revalidatePath("/documenti");
  if (customerRaw) revalidatePath(`/clienti/${customerRaw}`);
  return { ok: true };
}

const metadataSchema = z.object({
  name: z.string().trim().min(1, "Inserisci un nome").max(200),
  description: optionalText(1000),
  customerId: z.uuid().optional().or(z.literal("")).transform((v) => v || null),
});

/** Modifica dei metadati: il file originale in archivio non viene toccato. */
export async function updateDocumentMetadataAction(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Documento non valido");
  const parsed = metadataSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Controlla i campi");
  const { error } = await (await createClient()).from("documents")
    .update({ name: parsed.data.name, description: parsed.data.description, customer_id: parsed.data.customerId })
    .eq("organization_id", ctx.org.organizationId).eq("id", id);
  if (error) return fail("Impossibile salvare le modifiche");
  revalidatePath("/documenti"); revalidatePath(`/documenti/${id}`);
  if (parsed.data.customerId) revalidatePath(`/clienti/${parsed.data.customerId}`);
  return { ok: true };
}

export async function deleteDocumentAction(id: string) {
  const ctx = await requirePermission("data:delete");
  if (!isUuid(id)) return;
  const db = await createClient();
  const { data } = await db.from("documents").select("storage_path").eq("organization_id", ctx.org.organizationId).eq("id", id).maybeSingle();
  if (!data) return;
  await db.storage.from("documents").remove([data.storage_path as string]);
  await db.from("documents").update({ deleted_at: new Date().toISOString() }).eq("organization_id", ctx.org.organizationId).eq("id", id);
  revalidatePath("/documenti");
}
