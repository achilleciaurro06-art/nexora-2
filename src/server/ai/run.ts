import "server-only";
import { randomUUID } from "node:crypto";
import { getAiProvider, userMessageForAiError, type AiRequest, type AiResponse } from "./index";
import { QUOTA_MESSAGE, estimateTokens, releaseCredits, reserveCredits, settleCredits } from "./usage";

export type RunAiResult =
  | { ok: true; res: AiResponse; provider: string; estimated: boolean }
  | { ok: false; error: string; kind: "quota" | "provider" | "duplicate" };

/**
 * Esegue UNA chiamata al provider con prenotazione e contabilizzazione dei crediti.
 * - quota esaurita → nessuna chiamata al provider (nessun costo);
 * - errore del provider → crediti rimborsati e registrato come fallito;
 * - successo → consumo reale (o stimato se il provider non lo comunica, segnalato come tale).
 * Il fallback tra modelli è interno al provider e limitato (nessuna chiamata duplicata incontrollata).
 */
export async function runAi(a: {
  orgId: string; userId: string; feature: string; req: AiRequest; requestKey?: string;
}): Promise<RunAiResult> {
  const promptText = [a.req.system, ...a.req.messages.map((m) => m.content)];
  const estimate = estimateTokens(...promptText) + (a.req.maxOutputTokens ?? 1024) + (a.req.attachment ? 4000 : 0);
  const key = a.requestKey ?? `${a.feature}:${randomUUID()}`;
  const r = await reserveCredits({ orgId: a.orgId, userId: a.userId, feature: a.feature, requestKey: key, tokens: estimate });
  if (!r.ok) return { ok: false, kind: "quota", error: r.reason === "limit" || r.reason === "no_quota" ? QUOTA_MESSAGE : "Impossibile verificare i crediti AI. Riprova." };
  if (r.duplicate) return { ok: false, kind: "duplicate", error: "Questa richiesta è già stata elaborata." };
  const provider = getAiProvider();
  try {
    const res = await provider.generate(a.req);
    const reported = res.inputTokens + res.outputTokens > 0;
    const inputTokens = reported ? res.inputTokens : estimateTokens(...promptText);
    const outputTokens = reported ? res.outputTokens : estimateTokens(res.text);
    await settleCredits(r.id, { inputTokens, outputTokens, provider: provider.name, model: res.model, estimated: !reported });
    return { ok: true, res, provider: provider.name, estimated: !reported };
  } catch (e) {
    await releaseCredits(r.id, e instanceof Error && "kind" in e ? String((e as { kind: unknown }).kind) : "error");
    console.error("ai call failed", e instanceof Error ? e.message.slice(0, 200) : "unknown");
    return { ok: false, kind: "provider", error: userMessageForAiError(e) };
  }
}
