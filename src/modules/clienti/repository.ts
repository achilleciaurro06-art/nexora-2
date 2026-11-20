import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Customer } from "@/types/domain";
import type { CustomerInput } from "./schemas";

type WithCustom = CustomerInput & { custom_values?: Record<string, string | number | boolean> };

export type CustomerListOptions = { q?: string; archived?: boolean; status?: string; type?: string };

/** Elenco clienti: di default SOLO gli attivi. Gli archiviati si vedono solo chiedendoli (`archived: true`). */
export async function listCustomers(db: SupabaseClient, orgId: string, opts: string | CustomerListOptions = {}): Promise<Customer[]> {
  const o: CustomerListOptions = typeof opts === "string" ? { q: opts } : opts;
  let query = db.from("customers").select("*").eq("organization_id", orgId).is("deleted_at", null).order("name").limit(200);
  query = o.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (o.q) { const s = o.q.replace(/[%_,()]/g, ""); if (s) query = query.or(`name.ilike.%${s}%,vat_number.ilike.%${s}%,email.ilike.%${s}%,city.ilike.%${s}%`); }
  if (o.status && ["lead", "active", "inactive"].includes(o.status)) query = query.eq("status", o.status);
  if (o.type && ["company", "private", "public", "other"].includes(o.type)) query = query.eq("customer_type", o.type);
  const { data } = await query;
  return (data ?? []) as Customer[];
}

/** Selettore clienti: solo attivi, più (se serve) il cliente già collegato al record che si sta modificando, anche se archiviato. */
export async function listCustomerOptions(db: SupabaseClient, orgId: string, includeId?: string | null): Promise<Customer[]> {
  const list = await listCustomers(db, orgId);
  if (includeId && !list.some((c) => c.id === includeId)) {
    const { data } = await db.from("customers").select("*").eq("organization_id", orgId).eq("id", includeId).is("deleted_at", null).maybeSingle();
    if (data) list.push(data as Customer);
  }
  return list;
}

/** Scheda cliente: include gli archiviati (si consultano e si ripristinano), esclude i rimossi. */
export async function getCustomer(db: SupabaseClient, orgId: string, id: string): Promise<Customer | null> {
  const { data } = await db.from("customers").select("*").eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  return (data as Customer | null) ?? null;
}

export async function countArchivedCustomers(db: SupabaseClient, orgId: string): Promise<number> {
  const { count } = await db.from("customers").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null).not("archived_at", "is", null);
  return count ?? 0;
}

/** Data e autore dell'archiviazione sono impostati dal database. */
export async function setCustomerArchived(db: SupabaseClient, orgId: string, id: string, archived: boolean) {
  return db.from("customers").update({ archived_at: archived ? new Date().toISOString() : null }).eq("organization_id", orgId).eq("id", id).is("deleted_at", null).select("id");
}

export type CommercialSummary = {
  issued_count: number; issued_cents: number; accepted_count: number; accepted_cents: number; rejected_count: number; rejected_cents: number;
  expired_count: number; expired_cents: number; open_count: number; open_cents: number; draft_count: number; draft_cents: number;
  avg_issued_cents: number; conversion_pct: number | null; invoiced_count: number; invoiced_cents: number; collected_cents: number;
  accepted_invoiced_cents: number; last_activity_at: string | null; last_contact_at: string | null;
};
/** UNICA fonte dei calcoli commerciali per cliente: la funzione SQL customer_commercial_summary. */
export async function getCommercialSummary(db: SupabaseClient, customerId: string): Promise<CommercialSummary | null> {
  const { data } = await db.rpc("customer_commercial_summary", { p_customer: customerId });
  return (data as CommercialSummary | null) ?? null;
}

export type DeleteBlockers = { quotes: number; invoices: number; documents: number; tasks: number; appointments: number; calls: number; follow_ups: number; contacts: number; notes: number };
export async function getDeleteBlockers(db: SupabaseClient, customerId: string): Promise<DeleteBlockers | null> {
  const { data } = await db.rpc("customer_delete_blockers", { p_customer: customerId });
  return (data as DeleteBlockers | null) ?? null;
}

export async function insertCustomer(db: SupabaseClient, orgId: string, userId: string, input: WithCustom) {
  return db.from("customers").insert({ ...input, organization_id: orgId, created_by: userId }).select("id").single();
}

export async function updateCustomer(db: SupabaseClient, orgId: string, id: string, input: WithCustom) {
  return db.from("customers").update(input).eq("organization_id", orgId).eq("id", id);
}
