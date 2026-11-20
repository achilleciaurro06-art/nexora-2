import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Customer } from "@/types/domain";
import type { CustomerInput } from "./schemas";

type WithCustom = CustomerInput & { custom_values?: Record<string, string | number | boolean> };

export async function listCustomers(db: SupabaseClient, orgId: string, q?: string): Promise<Customer[]> {
  let query = db.from("customers").select("*").eq("organization_id", orgId).is("deleted_at", null).order("name").limit(200);
  if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
  const { data } = await query;
  return (data ?? []) as Customer[];
}

export async function getCustomer(db: SupabaseClient, orgId: string, id: string): Promise<Customer | null> {
  const { data } = await db.from("customers").select("*").eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  return (data as Customer | null) ?? null;
}

export async function insertCustomer(db: SupabaseClient, orgId: string, userId: string, input: WithCustom) {
  return db.from("customers").insert({ ...input, organization_id: orgId, created_by: userId }).select("id").single();
}

export async function updateCustomer(db: SupabaseClient, orgId: string, id: string, input: WithCustom) {
  return db.from("customers").update(input).eq("organization_id", orgId).eq("id", id);
}

export async function softDeleteCustomer(db: SupabaseClient, orgId: string, id: string) {
  return db.from("customers").update({ deleted_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", id);
}
