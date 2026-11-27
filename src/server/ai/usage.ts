import "server-only";
import { createAdminClient } from "@/server/supabase/admin";

/**
 * Crediti AI (unità: token) — un unico sistema per tutte le funzioni AI.
 * 1. `reserveCredits`: trattiene i token stimati in modo atomico (nessuna richiesta concorrente può superare il limite);
 * 2. `settleCredits`: sostituisce la stima con il consumo reale e registra l'uso (una sola volta per richiesta);
 * 3. `releaseCredits`: rimborsa tutto se la richiesta fallisce o viene interrotta (nessun addebito per consumi inesistenti).
 */
export type ReserveResult = { ok: true; id: string; duplicate: boolean } | { ok: false; reason: "limit" | "no_quota" | "invalid" | "error" };

export async function reserveCredits(a: { orgId: string; userId: string; feature: string; requestKey: string; tokens: number }): Promise<ReserveResult> {
  const { data, error } = await createAdminClient().rpc("rpc_ai_reserve", {
    p_org: a.orgId, p_user: a.userId, p_feature: a.feature, p_key: a.requestKey, p_tokens: Math.max(1, Math.ceil(a.tokens)),
  });
  if (error || !data) return { ok: false, reason: "error" };
  const d = data as { ok: boolean; id?: string; duplicate?: boolean; reason?: string };
  if (d.ok && d.id) return { ok: true, id: d.id, duplicate: Boolean(d.duplicate) };
  return { ok: false, reason: d.reason === "limit" || d.reason === "no_quota" || d.reason === "invalid" ? d.reason : "error" };
}

export type Consumption = { inputTokens: number; outputTokens: number; provider: string; model: string; estimated: boolean };

export async function settleCredits(id: string, c: Consumption): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("rpc_ai_settle", {
    p_id: id, p_input: Math.max(0, Math.round(c.inputTokens)), p_output: Math.max(0, Math.round(c.outputTokens)), p_provider: c.provider, p_model: c.model, p_tokens_estimated: c.estimated,
  });
  return !error && data === true;
}

export async function releaseCredits(id: string, errorKind: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("rpc_ai_release", { p_id: id, p_error_kind: errorKind });
  return !error && data === true;
}

/** Stima prudente dei token in ingresso (≈ 3 caratteri/token). */
export function estimateTokens(...texts: string[]): number {
  return Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 3);
}

/** Stato della quota (solo lettura): serve a segnalare nei log un eventuale superamento dopo il conteggio reale. */
export async function quotaStatus(orgId: string): Promise<{ used: number; limit: number } | null> {
  const { data } = await createAdminClient().from("ai_quotas").select("tokens_used, monthly_token_limit").eq("organization_id", orgId).maybeSingle();
  return data ? { used: Number(data.tokens_used), limit: Number(data.monthly_token_limit) } : null;
}

export const QUOTA_MESSAGE = "Crediti AI esauriti per questo mese: contatta l'amministratore per aumentare il limite.";
