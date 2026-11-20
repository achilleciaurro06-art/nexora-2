import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Invoice = {
  id: string; quote_id: string | null; customer_id: string; amount_cents: number; taxable_cents: number | null; vat_cents: number | null;
  billed_at: string; reference: string | null; note: string | null; payment_status: "unpaid" | "paid"; paid_at: string | null; created_at: string;
};
const COLS = "id, quote_id, customer_id, amount_cents, taxable_cents, vat_cents, billed_at, reference, note, payment_status, paid_at, created_at";

export async function listInvoices(db: SupabaseClient, orgId: string, filter: { customerId?: string; quoteId?: string }): Promise<Invoice[]> {
  let q = db.from("quote_billings").select(COLS).eq("organization_id", orgId).order("billed_at", { ascending: false }).order("created_at", { ascending: false }).limit(500);
  if (filter.customerId) q = q.eq("customer_id", filter.customerId);
  if (filter.quoteId) q = q.eq("quote_id", filter.quoteId);
  const { data } = await q;
  return (data ?? []) as Invoice[];
}
