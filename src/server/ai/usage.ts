import "server-only";
import { createAdminClient } from "@/server/supabase/admin";
import type { AiResponse } from "./provider";

/** Prenota token sulla quota mensile dell'organizzazione (atomico, lato DB). */
export async function reserveTokens(orgId: string, tokens: number): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("rpc_ai_reserve_tokens", { p_org: orgId, p_tokens: tokens });
  return !error && data === true;
}

export async function recordUsage(orgId: string, userId: string, feature: string, provider: string, r: AiResponse) {
  await createAdminClient().from("ai_usage").insert({
    organization_id: orgId, user_id: userId, feature, provider, model: r.model,
    input_tokens: r.inputTokens, output_tokens: r.outputTokens,
  });
}

/** Stima prudente dei token in ingresso (≈ 3 caratteri/token). */
export function estimateTokens(...texts: string[]): number {
  return Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 3);
}
