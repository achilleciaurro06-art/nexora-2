import "server-only";
import { createAdminClient } from "@/server/supabase/admin";

export type ActivationCodeRow = { id: string; bound_email: string | null; note: string | null; expires_at: string; used_count: number; max_uses: number };
export type OrgRow = { id: string; name: string; status: string; created_at: string; tokens_used: number; token_limit: number; input_price: number | null; output_price: number | null };

export type PlatformAuditRow = { id: number; actor_id: string | null; action: string; organization_id: string | null; details: Record<string, unknown>; created_at: string };

export async function loadPlatformOverview() {
  const admin = createAdminClient();
  const [codes, orgs, audit] = await Promise.all([
    admin.rpc("rpc_list_activation_codes"),
    admin.from("organizations").select("id, name, status, created_at, ai_quotas(tokens_used, monthly_token_limit, input_price_micro_per_mtok, output_price_micro_per_mtok)").order("created_at", { ascending: false }).limit(200),
    admin.rpc("rpc_list_platform_audit"),
  ]);
  const orgRows: OrgRow[] = (orgs.data ?? []).map((o) => {
    const q = Array.isArray(o.ai_quotas) ? o.ai_quotas[0] : o.ai_quotas;
    return { id: o.id as string, name: o.name as string, status: o.status as string, created_at: o.created_at as string, tokens_used: Number(q?.tokens_used ?? 0), token_limit: Number(q?.monthly_token_limit ?? 0), input_price: q?.input_price_micro_per_mtok == null ? null : Number(q.input_price_micro_per_mtok), output_price: q?.output_price_micro_per_mtok == null ? null : Number(q.output_price_micro_per_mtok) };
  });
  return { codes: (codes.data ?? []) as ActivationCodeRow[], orgs: orgRows, audit: ((audit.data ?? []) as PlatformAuditRow[]).slice(0, 25) };
}
