import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Quote, QuoteItem, QuoteStatus } from "@/types/domain";
import type { QuoteInput } from "./schemas";

export type QuoteRow = Quote & { customers: { name: string } | { name: string }[] | null };

export async function listQuotes(db: SupabaseClient, orgId: string, status?: string): Promise<QuoteRow[]> {
  let q = db.from("quotes").select("*, customers(name)").eq("organization_id", orgId).is("deleted_at", null)
    .order("year", { ascending: false }).order("seq", { ascending: false }).limit(200);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return (data ?? []) as QuoteRow[];
}

export async function getQuote(db: SupabaseClient, orgId: string, id: string) {
  const { data: quote } = await db.from("quotes").select("*, customers(*)").eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!quote) return null;
  const { data: items } = await db.from("quote_items").select("*").eq("organization_id", orgId).eq("quote_id", id).order("position");
  return { quote: quote as Quote & { customers: Record<string, string | null> | null }, items: (items ?? []) as QuoteItem[] };
}

/** Salvataggio atomico (testata + righe) tramite la funzione SQL save_quote. */
export async function saveQuote(db: SupabaseClient, orgId: string, quoteId: string | null, input: QuoteInput) {
  return db.rpc("save_quote", {
    p_quote: quoteId, p_org: orgId, p_customer: input.customerId, p_title: input.title,
    p_issue_date: input.issueDate, p_valid_until: input.validUntil, p_notes: input.notes, p_terms: input.terms, p_follow_up: input.followUpDate,
    p_items: input.items.map((i) => ({
      description: i.description, quantity: i.quantity, unit_price_cents: i.unitPriceCents,
      discount_percent: i.discountPercent, vat_rate: i.vatRate,
    })),
  });
}

export async function setQuoteStatus(db: SupabaseClient, orgId: string, id: string, status: QuoteStatus) {
  return db.from("quotes").update({ status }).eq("organization_id", orgId).eq("id", id);
}

export async function softDeleteQuote(db: SupabaseClient, orgId: string, id: string) {
  return db.from("quotes").update({ deleted_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", id);
}
