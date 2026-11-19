"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { requireContext, requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors } from "@/lib/forms";
import {
  LOGO_MAX_BYTES, LOGO_TYPES, aiSettingsSchema, appearanceSchema, companySchema, emailSettingsSchema, notificationPrefsSchema,
  profileSchema, quoteSettingsSchema, quoteTextsSchema,
} from "./schemas";
import { AVATAR_MAX_BYTES, AVATAR_TYPES, NOTIFICATION_KINDS, mergeOrgSettings, parseUserPrefs, sniffImage, type OrgSettings } from "./settings";

const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Controlla i campi";

/* ---------------------------------------------------------------- azienda */
export async function updateCompanyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("settings:manage");
  const parsed = companySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstError(parsed.error), fieldErrors(parsed.error));
  const { error } = await (await createClient()).from("organizations").update(parsed.data).eq("id", ctx.org.organizationId);
  if (error) return fail("Impossibile salvare i dati aziendali");
  revalidatePath("/impostazioni/azienda"); revalidatePath("/", "layout");
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
  const sniffed = sniffImage(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (sniffed !== ext) return fail("Il file non è un'immagine valida");

  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const path = `${orgId}/_branding/logo-${Date.now()}.${ext}`;
  const { error: upErr } = await db.storage.from("documents").upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return fail("Caricamento non riuscito");
  const { data: org } = await db.from("organizations").select("logo_path").eq("id", orgId).maybeSingle();
  const { error } = await db.from("organizations").update({ logo_path: path }).eq("id", orgId);
  if (error) { await db.storage.from("documents").remove([path]); return fail("Impossibile salvare il logo"); }
  if (org?.logo_path) await db.storage.from("documents").remove([org.logo_path as string]);
  revalidatePath("/impostazioni/azienda");
  return { ok: true };
}

export async function removeLogoAction() {
  const ctx = await requirePermission("settings:manage");
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data: org } = await db.from("organizations").select("logo_path").eq("id", orgId).maybeSingle();
  await db.from("organizations").update({ logo_path: null }).eq("id", orgId);
  if (org?.logo_path) await db.storage.from("documents").remove([org.logo_path as string]);
  revalidatePath("/impostazioni/azienda");
}

/* ---------------------------------------------------------------- impostazioni a chiave dell'organizzazione */
async function saveOrgSection(orgId: string, section: keyof OrgSettings, value: unknown): Promise<boolean> {
  const db = await createClient();
  const { data } = await db.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const { error } = await db.from("organizations").update({ settings: mergeOrgSettings(data?.settings, section, value) }).eq("id", orgId);
  return !error;
}

export async function updateQuoteSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("settings:manage");
  const raw = Object.fromEntries(formData);
  const settings = quoteSettingsSchema.safeParse(raw);
  const texts = quoteTextsSchema.safeParse(raw);
  if (!settings.success) return fail(firstError(settings.error));
  if (!texts.success) return fail(firstError(texts.error));
  const orgId = ctx.org.organizationId;
  if (!(await saveOrgSection(orgId, "quotes", settings.data))) return fail("Impossibile salvare le impostazioni dei preventivi");
  const { error } = await (await createClient()).from("organizations").update(texts.data).eq("id", orgId);
  if (error) return fail("Impossibile salvare le condizioni");
  revalidatePath("/impostazioni/preventivi"); revalidatePath("/preventivi", "layout");
  return { ok: true };
}

export async function updateAiSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("settings:manage");
  const parsed = aiSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstError(parsed.error));
  if (!(await saveOrgSection(ctx.org.organizationId, "ai", parsed.data))) return fail("Impossibile salvare le preferenze AI");
  revalidatePath("/impostazioni/ai");
  return { ok: true };
}

export async function updateEmailSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("settings:manage");
  const parsed = emailSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstError(parsed.error));
  if (!(await saveOrgSection(ctx.org.organizationId, "email", parsed.data))) return fail("Impossibile salvare le preferenze email");
  revalidatePath("/impostazioni/email");
  return { ok: true };
}

/* ---------------------------------------------------------------- profilo e preferenze personali */
export async function updateProfileAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstError(parsed.error));
  const { error } = await (await createClient()).from("profiles").update(parsed.data).eq("id", ctx.userId);
  if (error) return fail("Impossibile salvare il profilo");
  revalidatePath("/impostazioni/profilo"); revalidatePath("/", "layout");
  return { ok: true };
}

/** Avatar: cartella personale {user_id}/ (la policy Storage impedisce di scrivere altrove). */
export async function uploadAvatarAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return fail("Seleziona un'immagine");
  const ext = AVATAR_TYPES[file.type as keyof typeof AVATAR_TYPES];
  if (!ext) return fail("L'immagine deve essere PNG, JPEG o WebP");
  if (file.size > AVATAR_MAX_BYTES) return fail("L'immagine non può superare 2 MB");
  if (sniffImage(new Uint8Array(await file.slice(0, 12).arrayBuffer())) !== ext) return fail("Il file non è un'immagine valida");

  const db = await createClient();
  const path = `${ctx.userId}/avatar-${Date.now()}.${ext}`;
  const { error: upErr } = await db.storage.from("avatars").upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return fail("Caricamento non riuscito");
  const { data: prof } = await db.from("profiles").select("avatar_path").eq("id", ctx.userId).maybeSingle();
  const { error } = await db.from("profiles").update({ avatar_path: path }).eq("id", ctx.userId);
  if (error) { await db.storage.from("avatars").remove([path]); return fail("Impossibile salvare l'immagine"); }
  if (prof?.avatar_path) await db.storage.from("avatars").remove([prof.avatar_path as string]);
  revalidatePath("/impostazioni/profilo"); revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeAvatarAction() {
  const ctx = await requireContext();
  const db = await createClient();
  const { data: prof } = await db.from("profiles").select("avatar_path").eq("id", ctx.userId).maybeSingle();
  await db.from("profiles").update({ avatar_path: null }).eq("id", ctx.userId);
  if (prof?.avatar_path) await db.storage.from("avatars").remove([prof.avatar_path as string]);
  revalidatePath("/impostazioni/profilo"); revalidatePath("/", "layout");
}

async function savePrefs(userId: string, patch: (current: ReturnType<typeof parseUserPrefs>) => Record<string, unknown>): Promise<boolean> {
  const db = await createClient();
  const { data } = await db.from("profiles").select("preferences").eq("id", userId).maybeSingle();
  const current = parseUserPrefs(data?.preferences);
  const raw = (data?.preferences && typeof data.preferences === "object" ? data.preferences : {}) as Record<string, unknown>;
  const { error } = await db.from("profiles").update({ preferences: { ...raw, ...patch(current) } }).eq("id", userId);
  return !error;
}

export async function updateNotificationPrefsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const hours = notificationPrefsSchema.safeParse(Object.fromEntries(formData));
  if (!hours.success) return fail(firstError(hours.error));
  const kinds = Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k.key, formData.get(k.key) === "on"]));
  if (!(await savePrefs(ctx.userId, () => ({ notifications: { ...kinds, due_soon_hours: hours.data.due_soon_hours } })))) return fail("Impossibile salvare le preferenze");
  revalidatePath("/impostazioni/notifiche"); revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateAppearanceAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = appearanceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Periodo non valido");
  if (!(await savePrefs(ctx.userId, (cur) => ({ appearance: { ...cur.appearance, dashboard_range: parsed.data.dashboard_range } })))) return fail("Impossibile salvare le preferenze");
  revalidatePath("/impostazioni/aspetto"); revalidatePath("/dashboard");
  return { ok: true };
}
