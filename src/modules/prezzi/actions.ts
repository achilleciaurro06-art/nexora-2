"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { fail, type ActionResult } from "@/lib/result";
import { isUuid } from "@/lib/ids";
import { parseEuroToCents } from "@/lib/money";
import { analyzeQuotePrices } from "./service";

export async function analyzePricesAction(quoteId: string, _prev: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("ai:use");
  if (!isUuid(quoteId)) return fail("Preventivo non valido");
  if (!rateLimit(`prices:${ctx.userId}`, 15, 10 * 60_000)) return fail("Troppe analisi ravvicinate, attendi qualche minuto.");
  const res = await analyzeQuotePrices({ db: await createClient(), orgId: ctx.org.organizationId, userId: ctx.userId, quoteId });
  revalidatePath(`/preventivi/${quoteId}`);
  revalidatePath("/copilot");
  return res.ok ? { ok: true } : fail(res.error);
}

const payloadSchema = z.object({ quote_id: z.uuid(), item_id: z.uuid() });

/**
 * L'utente accetta il prezzo suggerito o ne indica uno diverso: la modifica avviene solo qui, con i suoi permessi,
 * solo su preventivi in bozza. La riga mantiene il proprio sconto (il prezzo indicato è al netto dello sconto).
 */
export async function applyPriceSuggestionAction(suggestionId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(suggestionId)) return fail("Suggerimento non valido");
  const price = parseEuroToCents(String(formData.get("price") ?? ""));
  if (price === null || price < 0 || price > 100_000_000_00) return fail("Inserisci un prezzo valido (es. 1.250,00)");

  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data: sug } = await db.from("ai_suggestions").select("kind, status, payload").eq("organization_id", orgId).eq("id", suggestionId).maybeSingle();
  if (!sug || sug.kind !== "price_review") return fail("Suggerimento non trovato");
  if (sug.status !== "pending") return fail("Questo suggerimento è già stato gestito");
  const p = payloadSchema.safeParse(sug.payload);
  if (!p.success) return fail("Suggerimento non valido");

  const { data: quote } = await db.from("quotes").select("status").eq("organization_id", orgId).eq("id", p.data.quote_id).is("deleted_at", null).maybeSingle();
  if (!quote) return fail("Preventivo non trovato");
  if (quote.status !== "draft") return fail("Il preventivo non è in bozza: riportalo in bozza per modificare i prezzi.");
  const { data: item } = await db.from("quote_items").select("id, discount_percent").eq("organization_id", orgId).eq("quote_id", p.data.quote_id).eq("id", p.data.item_id).maybeSingle();
  if (!item) return fail("La riga non esiste più");

  const discount = Number(item.discount_percent);
  const unit = discount >= 100 ? price : Math.round(price / (1 - discount / 100));
  const { error } = await db.from("quote_items").update({ unit_price_cents: unit }).eq("organization_id", orgId).eq("id", p.data.item_id);
  if (error) return fail("Impossibile aggiornare il prezzo");
  await db.from("ai_suggestions").update({ status: "accepted" }).eq("organization_id", orgId).eq("id", suggestionId);
  revalidatePath(`/preventivi/${p.data.quote_id}`);
  return { ok: true };
}

export async function rejectPriceSuggestionAction(suggestionId: string, quoteId: string) {
  const ctx = await requirePermission("data:write");
  if (!isUuid(suggestionId)) return;
  await (await createClient()).from("ai_suggestions").update({ status: "rejected" }).eq("organization_id", ctx.org.organizationId).eq("id", suggestionId).eq("kind", "price_review").eq("status", "pending");
  if (isUuid(quoteId)) revalidatePath(`/preventivi/${quoteId}`);
}
