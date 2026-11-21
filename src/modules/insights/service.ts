import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimInsightsRun, setInsightStatus, syncInsights } from "@/server/ai/privileged";
import { loadSnapshot } from "./snapshot";
import { generateInsights } from "./rules";
import type { InsightRow, InsightDraft, Snapshot } from "./types";

/** Frequenza minima di rigenerazione all'apertura della dashboard (nessuno scheduler esterno, nessun costo AI). */
export const INSIGHT_MIN_INTERVAL_S = 30 * 60;

export function toSyncPayload(drafts: InsightDraft[], now: Date) {
  return drafts.map((d) => ({
    dedupe_key: d.dedupe_key, rule: d.rule, category: d.category, priority: d.priority, title: d.title.slice(0, 200), description: d.description.slice(0, 800), reason: d.reason.slice(0, 800),
    evidence: d.evidence.slice(0, 8), action_label: d.action_label ?? null, action_href: d.action_href ?? null, copilot_question: d.copilot_question?.slice(0, 500) ?? null,
    expires_at: new Date(now.getTime() + d.ttl_hours * 3_600_000).toISOString(),
  }));
}

/**
 * Genera gli insight se l'ultima generazione è più vecchia dell'intervallo. La prenotazione è atomica nel database:
 * due aperture simultanee della dashboard non generano due volte. Il caricamento dei dati usa il client dell'utente (RLS).
 */
export async function ensureInsights(db: SupabaseClient, orgId: string, now = new Date(), minIntervalS = INSIGHT_MIN_INTERVAL_S, snapshot?: Snapshot): Promise<{ ran: boolean; result?: Record<string, number>; error?: string }> {
  const claimed = await claimInsightsRun(orgId, minIntervalS);
  if (claimed === null) return { ran: false, error: "claim" };
  if (!claimed) return { ran: false };
  try {
    const snap = snapshot ?? (await loadSnapshot(db, orgId, now));
    const drafts = generateInsights(snap);
    const result = await syncInsights(orgId, toSyncPayload(drafts, now));
    if (!result) return { ran: true, error: "sync" };
    return { ran: true, result };
  } catch (e) {
    console.error("insights generation failed", e instanceof Error ? e.message.slice(0, 200) : "unknown");
    return { ran: true, error: "generation" };
  }
}

export async function listInsights(db: SupabaseClient, orgId: string, opts: { includeResolved?: boolean; limit?: number } = {}): Promise<InsightRow[]> {
  let q = db.from("ai_insights").select("id, dedupe_key, rule, category, priority, title, description, reason, evidence, action_label, action_href, copilot_question, status, generated_at, refreshed_at, expires_at")
    .eq("organization_id", orgId).gt("expires_at", new Date().toISOString()).limit(opts.limit ?? 40);
  if (!opts.includeResolved) q = q.in("status", ["new", "seen"]);
  const { data } = await q;
  const rank = { high: 0, normal: 1, low: 2 } as const;
  return ((data ?? []) as InsightRow[]).sort((a, b) => rank[a.priority] - rank[b.priority] || b.generated_at.localeCompare(a.generated_at));
}

/** «Visualizzato»: gli insight mostrati passano da nuovo a visualizzato (la scheda "Nuovo" resta visibile in questa apertura). */
export async function markSeen(orgId: string, userId: string, rows: InsightRow[]): Promise<void> {
  await Promise.all(rows.filter((r) => r.status === "new").slice(0, 12).map((r) => setInsightStatus(orgId, r.id, "seen", userId)));
}
