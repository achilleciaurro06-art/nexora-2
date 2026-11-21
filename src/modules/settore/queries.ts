import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomFieldDef } from "./custom-fields";
import { resolveTerms, type Terms } from "./terms";
import { isSector, type SectorKey } from "./presets";

export type Product = { id: string; kind: "product" | "service"; code: string | null; name: string; description: string | null; category: string | null; unit: string; unit_price_cents: number; vat_rate: number; active: boolean };
export type PriceList = { id: string; name: string; description: string | null; active: boolean };
export type TemplateRow = { id: string; name: string; description: string | null; title: string | null; notes: string | null; terms: string | null; active: boolean; items: { description: string; quantity: number; unit_price_cents: number; discount_percent: number; vat_rate: number }[] };

export async function getSector(db: SupabaseClient, orgId: string): Promise<{ sector: SectorKey; terms: Terms; rawTerms: Record<string, string> }> {
  const { data } = await db.from("organizations").select("sector, terminology").eq("id", orgId).maybeSingle();
  const raw = (data?.terminology && typeof data.terminology === "object" ? data.terminology : {}) as Record<string, string>;
  return { sector: isSector(data?.sector) ? data.sector : "generic", terms: resolveTerms(raw), rawTerms: raw };
}

export async function listFieldDefs(db: SupabaseClient, orgId: string, entity?: "customer" | "quote", onlyActive = false): Promise<CustomFieldDef[]> {
  let q = db.from("custom_field_definitions").select("id, entity, key, label, field_type, options, required, position, active").eq("organization_id", orgId).order("position").order("created_at");
  if (entity) q = q.eq("entity", entity);
  if (onlyActive) q = q.eq("active", true);
  const { data } = await q.limit(200);
  return (data ?? []) as CustomFieldDef[];
}

export async function listProducts(db: SupabaseClient, orgId: string, opts: { search?: string; onlyActive?: boolean } = {}): Promise<Product[]> {
  let q = db.from("products").select("id, kind, code, name, description, category, unit, unit_price_cents, vat_rate, active").eq("organization_id", orgId).is("deleted_at", null).order("name").limit(500);
  if (opts.onlyActive) q = q.eq("active", true);
  if (opts.search) { const s = opts.search.replace(/[%_,()]/g, ""); if (s) q = q.or(`name.ilike.%${s}%,code.ilike.%${s}%,category.ilike.%${s}%`); }
  const { data } = await q;
  return (data ?? []) as Product[];
}

export async function listPriceLists(db: SupabaseClient, orgId: string): Promise<PriceList[]> {
  const { data } = await db.from("price_lists").select("id, name, description, active").eq("organization_id", orgId).order("name").limit(100);
  return (data ?? []) as PriceList[];
}

export async function listTemplates(db: SupabaseClient, orgId: string, onlyActive = false): Promise<TemplateRow[]> {
  let q = db.from("quote_templates").select("id, name, description, title, notes, terms, active, items").eq("organization_id", orgId).is("deleted_at", null).order("name").limit(200);
  if (onlyActive) q = q.eq("active", true);
  const { data } = await q;
  return (data ?? []) as TemplateRow[];
}

/** Tutto ciò che serve al modulo preventivo per usare catalogo, listini, modelli e campi personalizzati. */
export async function loadQuoteCatalog(db: SupabaseClient, orgId: string) {
  const [products, lists, templates, fields, customers, items] = await Promise.all([
    listProducts(db, orgId, { onlyActive: true }),
    listPriceLists(db, orgId),
    listTemplates(db, orgId, true),
    listFieldDefs(db, orgId, "quote", true),
    db.from("customers").select("id, price_list_id").eq("organization_id", orgId).is("deleted_at", null).not("price_list_id", "is", null).limit(5000),
    db.from("price_list_items").select("price_list_id, product_id, unit_price_cents").eq("organization_id", orgId).limit(20000),
  ]);
  const activeLists = new Set(lists.filter((l) => l.active).map((l) => l.id));
  const listPrices: Record<string, Record<string, number>> = {};
  for (const i of items.data ?? []) {
    if (!activeLists.has(i.price_list_id as string)) continue;
    (listPrices[i.price_list_id as string] ??= {})[i.product_id as string] = Number(i.unit_price_cents);
  }
  const customerLists: Record<string, string> = {};
  for (const c of customers.data ?? []) if (activeLists.has(c.price_list_id as string)) customerLists[c.id as string] = c.price_list_id as string;
  return { products, templates, fields, listPrices, customerLists, listNames: Object.fromEntries(lists.map((l) => [l.id, l.name])) };
}
export type QuoteCatalog = Awaited<ReturnType<typeof loadQuoteCatalog>>;
