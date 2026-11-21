import "server-only";
import { createAdminClient } from "@/server/supabase/admin";

/**
 * Operazioni AI privilegiate (service_role). Sono l'UNICO punto in cui i moduli applicativi toccano le funzioni riservate:
 * ogni chiamata richiede l'organizzazione già verificata dal chiamante (sessione/ruolo) e passa da funzioni SQL che la ricontrollano.
 */
export type ClaimedAction = { id: string; kind: string; payload: unknown } | null;

export async function claimAction(orgId: string, id: string, userId: string): Promise<{ ok: true; row: ClaimedAction } | { ok: false }> {
  const { data, error } = await createAdminClient().rpc("rpc_ai_claim_action", { p_org: orgId, p_id: id, p_user: userId });
  if (error) return { ok: false };
  const row = (Array.isArray(data) ? data[0] : data) as { id?: string; kind: string; payload: unknown } | null;
  return { ok: true, row: row?.id ? { id: row.id, kind: row.kind, payload: row.payload } : null };
}
export async function finishAction(orgId: string, id: string, userId: string, ok: boolean, result: Record<string, unknown>): Promise<void> {
  await createAdminClient().rpc("rpc_ai_finish_action", { p_org: orgId, p_id: id, p_user: userId, p_ok: ok, p_result: result });
}
export async function claimInsightsRun(orgId: string, minSeconds: number): Promise<boolean | null> {
  const { data, error } = await createAdminClient().rpc("rpc_ai_insights_claim", { p_org: orgId, p_min_seconds: minSeconds });
  return error ? null : data === true;
}
export async function syncInsights(orgId: string, items: unknown[]): Promise<Record<string, number> | null> {
  const { data, error } = await createAdminClient().rpc("rpc_ai_insights_sync", { p_org: orgId, p_items: items });
  return error ? null : (data as Record<string, number>);
}
export async function setInsightStatus(orgId: string, id: string, status: string, userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("rpc_ai_insight_set_status", { p_org: orgId, p_id: id, p_status: status, p_user: userId });
  return !error && data === true;
}
