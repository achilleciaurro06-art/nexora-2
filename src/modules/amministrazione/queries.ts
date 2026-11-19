import "server-only";
import { createAdminClient } from "@/server/supabase/admin";

export type ActivationCodeRow = { id: string; bound_email: string | null; note: string | null; expires_at: string; used_count: number; max_uses: number };
export type OrgRow = { id: string; name: string; status: string; created_at: string };

export async function loadPlatformOverview() {
  const admin = createAdminClient();
  const [codes, orgs] = await Promise.all([
    admin.rpc("rpc_list_activation_codes"),
    admin.from("organizations").select("id, name, status, created_at").order("created_at", { ascending: false }).limit(200),
  ]);
  return { codes: (codes.data ?? []) as ActivationCodeRow[], orgs: (orgs.data ?? []) as OrgRow[] };
}
