"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { parseEuroToCents } from "@/lib/money";
import { fieldDefSchema, priceListSchema, productSchema, sectorSchema, templateSchema } from "./schemas";
import { SECTORS } from "./presets";
import { slugKey } from "./custom-fields";
import { termsToStore } from "./terms";
import { listFieldDefs } from "./queries";

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Controlla i campi";

/* ---------------------------------------------------------------- settore e terminologia */
export async function updateSectorAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("settings:manage");
  const parsed = sectorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(first(parsed.error), fieldErrors(parsed.error));
  const { sector, ...terms } = parsed.data;
  const { error } = await (await createClient()).from("organizations").update({ sector, terminology: termsToStore(terms) }).eq("id", ctx.org.organizationId);
  if (error) return fail("Impossibile salvare il settore");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Aggiunge i campi e i modelli proposti per il settore scelto, senza toccare né duplicare ciò che esiste già. */
export async function applyPresetAction(_prev: ActionResult<string> | null, _formData: FormData): Promise<ActionResult<string>> {
  const ctx = await requirePermission("settings:manage");
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data: org } = await db.from("organizations").select("sector").eq("id", orgId).maybeSingle();
  const preset = SECTORS[(org?.sector as keyof typeof SECTORS) ?? "generic"] ?? SECTORS.generic;
  const existing = await listFieldDefs(db, orgId);
  const have = new Set(existing.map((d) => `${d.entity}.${d.key}`));
  const rows = preset.fields.filter((f) => !have.has(`${f.entity}.${f.key}`)).map((f, i) => ({
    organization_id: orgId, entity: f.entity, key: f.key, label: f.label, field_type: f.field_type, options: f.options ?? [], required: f.required ?? false, position: existing.length + i,
  }));
  if (rows.length) { const { error } = await db.from("custom_field_definitions").insert(rows); if (error) return fail("Impossibile aggiungere i campi proposti"); }
  const { data: tpls } = await db.from("quote_templates").select("name").eq("organization_id", orgId).is("deleted_at", null);
  const haveT = new Set((tpls ?? []).map((t) => String(t.name).toLowerCase()));
  const newT = preset.templates.filter((t) => !haveT.has(t.name.toLowerCase())).map((t) => ({
    organization_id: orgId, name: t.name, description: t.description, title: t.title, terms: t.terms, items: t.items, created_by: ctx.userId,
  }));
  if (newT.length) { const { error } = await db.from("quote_templates").insert(newT); if (error) return fail("Impossibile aggiungere i modelli proposti"); }
  revalidatePath("/impostazioni/settore"); revalidatePath("/catalogo/modelli");
  return { ok: true, data: `Aggiunti ${rows.length} campi e ${newT.length} modelli (quelli già presenti non vengono toccati).` };
}

/* ---------------------------------------------------------------- campi personalizzati */
export async function createFieldAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("settings:manage");
  const parsed = fieldDefSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(first(parsed.error), fieldErrors(parsed.error));
  const db = await createClient();
  const existing = await listFieldDefs(db, ctx.org.organizationId, parsed.data.entity);
  if (existing.length >= 30) return fail("Massimo 30 campi per ambito");
  const key = slugKey(parsed.data.label, existing.map((d) => d.key));
  const { error } = await db.from("custom_field_definitions").insert({
    organization_id: ctx.org.organizationId, entity: parsed.data.entity, key, label: parsed.data.label, field_type: parsed.data.field_type,
    options: parsed.data.field_type === "select" ? parsed.data.options : [], required: parsed.data.field_type === "boolean" ? false : parsed.data.required, position: existing.length,
  });
  if (error) return fail("Impossibile creare il campo");
  revalidatePath("/impostazioni/settore");
  return { ok: true };
}

export async function toggleFieldAction(id: string, active: boolean) {
  const ctx = await requirePermission("settings:manage");
  if (!isUuid(id)) return;
  await (await createClient()).from("custom_field_definitions").update({ active }).eq("organization_id", ctx.org.organizationId).eq("id", id);
  revalidatePath("/impostazioni/settore");
}

export async function renameFieldAction(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("settings:manage");
  if (!isUuid(id)) return fail("Campo non valido");
  const label = String(formData.get("label") ?? "").trim();
  if (!label || label.length > 80) return fail("Nome non valido (1–80 caratteri)");
  const { error } = await (await createClient()).from("custom_field_definitions").update({ label }).eq("organization_id", ctx.org.organizationId).eq("id", id);
  if (error) return fail("Impossibile rinominare il campo");
  revalidatePath("/impostazioni/settore");
  return { ok: true };
}

/* ---------------------------------------------------------------- catalogo */
export async function saveProductAction(id: string | null, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (id !== null && !isUuid(id)) return fail("Prodotto non valido");
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(first(parsed.error), fieldErrors(parsed.error));
  const db = await createClient();
  const res = id
    ? await db.from("products").update(parsed.data).eq("organization_id", ctx.org.organizationId).eq("id", id)
    : await db.from("products").insert({ ...parsed.data, organization_id: ctx.org.organizationId, created_by: ctx.userId });
  if (res.error) return fail(res.error.code === "23505" ? "Esiste già un prodotto con questo codice" : "Impossibile salvare il prodotto");
  revalidatePath("/catalogo");
  if (!id) redirect("/catalogo");
  return { ok: true };
}

export async function archiveProductAction(id: string, _prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Prodotto non valido");
  const { error } = await (await createClient()).from("products").update({ deleted_at: new Date().toISOString() }).eq("organization_id", ctx.org.organizationId).eq("id", id);
  if (error) return fail("Impossibile archiviare il prodotto");
  revalidatePath("/catalogo");
  redirect("/catalogo");
}

/* ---------------------------------------------------------------- listini */
export async function savePriceListAction(id: string | null, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("settings:manage");
  if (id !== null && !isUuid(id)) return fail("Listino non valido");
  const parsed = priceListSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(first(parsed.error), fieldErrors(parsed.error));
  const db = await createClient();
  const res = id
    ? await db.from("price_lists").update(parsed.data).eq("organization_id", ctx.org.organizationId).eq("id", id)
    : await db.from("price_lists").insert({ ...parsed.data, organization_id: ctx.org.organizationId }).select("id").single();
  if (res.error) return fail(res.error.code === "23505" ? "Esiste già un listino con questo nome" : "Impossibile salvare il listino");
  revalidatePath("/catalogo/listini");
  if (!id) redirect(`/catalogo/listini/${(res.data as { id: string }).id}`);
  return { ok: true };
}

/** Salva in blocco i prezzi del listino: campo vuoto = il prodotto non è in questo listino (vale il prezzo base). */
export async function savePriceListItemsAction(listId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("settings:manage");
  if (!isUuid(listId)) return fail("Listino non valido");
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const upserts: { organization_id: string; price_list_id: string; product_id: string; unit_price_cents: number }[] = [];
  const removes: string[] = [];
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("price_")) continue;
    const pid = k.slice(6);
    if (!isUuid(pid)) continue;
    const s = String(v).trim();
    if (s === "") { removes.push(pid); continue; }
    const c = parseEuroToCents(s);
    if (c === null || c < 0 || c > 100_000_000_000) return fail(`Prezzo non valido: «${s}»`);
    upserts.push({ organization_id: orgId, price_list_id: listId, product_id: pid, unit_price_cents: c });
  }
  if (upserts.length) { const { error } = await db.from("price_list_items").upsert(upserts, { onConflict: "price_list_id,product_id" }); if (error) return fail("Impossibile salvare i prezzi"); }
  if (removes.length) { const { error } = await db.from("price_list_items").delete().eq("organization_id", orgId).eq("price_list_id", listId).in("product_id", removes); if (error) return fail("Impossibile aggiornare i prezzi"); }
  revalidatePath(`/catalogo/listini/${listId}`);
  return { ok: true };
}

export async function deletePriceListAction(id: string, _prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:delete");
  if (!isUuid(id)) return fail("Listino non valido");
  const { error } = await (await createClient()).from("price_lists").delete().eq("organization_id", ctx.org.organizationId).eq("id", id);
  if (error) return fail("Impossibile eliminare il listino");
  revalidatePath("/catalogo/listini");
  redirect("/catalogo/listini");
}

/* ---------------------------------------------------------------- modelli di preventivo */
export async function saveTemplateAction(id: string | null, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (id !== null && !isUuid(id)) return fail("Modello non valido");
  let items: unknown = [];
  try { items = JSON.parse(String(formData.get("items") ?? "[]")); } catch { items = []; }
  const parsed = templateSchema.safeParse({ ...Object.fromEntries(formData), items });
  if (!parsed.success) return fail(first(parsed.error), fieldErrors(parsed.error));
  const db = await createClient();
  const res = id
    ? await db.from("quote_templates").update(parsed.data).eq("organization_id", ctx.org.organizationId).eq("id", id)
    : await db.from("quote_templates").insert({ ...parsed.data, organization_id: ctx.org.organizationId, created_by: ctx.userId });
  if (res.error) return fail("Impossibile salvare il modello");
  revalidatePath("/catalogo/modelli");
  if (!id) redirect("/catalogo/modelli");
  return { ok: true };
}

export async function archiveTemplateAction(id: string, _prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Modello non valido");
  const { error } = await (await createClient()).from("quote_templates").update({ deleted_at: new Date().toISOString() }).eq("organization_id", ctx.org.organizationId).eq("id", id);
  if (error) return fail("Impossibile archiviare il modello");
  revalidatePath("/catalogo/modelli");
  redirect("/catalogo/modelli");
}
