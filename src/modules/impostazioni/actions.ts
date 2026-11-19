"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors } from "@/lib/forms";
import { LOGO_MAX_BYTES, LOGO_TYPES, organizationProfileSchema } from "./schemas";

export async function updateOrganizationProfileAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("settings:manage");
  const parsed = organizationProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Controlla i campi", fieldErrors(parsed.error));
  const { error } = await (await createClient()).from("organizations").update(parsed.data).eq("id", ctx.org.organizationId);
  if (error) return fail("Impossibile salvare le impostazioni");
  revalidatePath("/impostazioni");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Il logo vive in {org}/_branding/: la policy Storage lo rende scrivibile solo a owner/admin. */
export async function uploadLogoAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("settings:manage");
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return fail("Seleziona un file");
  const ext = LOGO_TYPES[file.type as keyof typeof LOGO_TYPES];
  if (!ext) return fail("Il logo deve essere un PNG o un JPEG");
  if (file.size > LOGO_MAX_BYTES) return fail("Il logo non può superare 1 MB");

  // verifica della firma del file: il tipo dichiarato dal browser non basta
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isJpg = head[0] === 0xff && head[1] === 0xd8;
  if ((ext === "png" && !isPng) || (ext === "jpg" && !isJpg)) return fail("Il file non è un'immagine valida");

  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const path = `${orgId}/_branding/logo-${Date.now()}.${ext}`;
  const { error: upErr } = await db.storage.from("documents").upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return fail("Caricamento non riuscito");
  const { data: org } = await db.from("organizations").select("logo_path").eq("id", orgId).maybeSingle();
  const { error } = await db.from("organizations").update({ logo_path: path }).eq("id", orgId);
  if (error) {
    await db.storage.from("documents").remove([path]);
    return fail("Impossibile salvare il logo");
  }
  if (org?.logo_path) await db.storage.from("documents").remove([org.logo_path as string]);
  revalidatePath("/impostazioni");
  return { ok: true };
}

export async function removeLogoAction() {
  const ctx = await requirePermission("settings:manage");
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data: org } = await db.from("organizations").select("logo_path").eq("id", orgId).maybeSingle();
  await db.from("organizations").update({ logo_path: null }).eq("id", orgId);
  if (org?.logo_path) await db.storage.from("documents").remove([org.logo_path as string]);
  revalidatePath("/impostazioni");
}
