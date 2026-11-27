import "server-only";
import { randomUUID } from "node:crypto";
import { getAiProvider, userMessageForAiError, type AiRequest, type AiResponse } from "./index";
import { estimateAttachment } from "./attachment-estimate";
import { QUOTA_MESSAGE, estimateTokens, quotaStatus, releaseCredits, reserveCredits, settleCredits } from "./usage";

export type RunAiResult =
  | { ok: true; res: AiResponse; provider: string; estimated: boolean; overshoot?: { reserved: number; actual: number } }
  | { ok: false; error: string; kind: "quota" | "provider" | "duplicate" | "attachment" };

/**
 * Esegue UNA chiamata al provider con prenotazione e contabilizzazione dei crediti.
 * - allegato oltre i limiti (PDF > 25 pagine, immagine troppo grande) → rifiutato PRIMA di prenotare e di chiamare il provider;
 * - quota esaurita → nessuna chiamata al provider (nessun costo);
 * - errore del provider → crediti rimborsati e registrato come fallito;
 * - successo → consumo reale (o stimato se il provider non lo comunica, segnalato come tale).
 * Il fallback tra modelli è interno al provider e limitato (nessuna chiamata duplicata incontrollata).
 *
 * La stima include testo, istruzioni, schema JSON della risposta, allegato e uscita massima. Se il consumo reale supera comunque
 * la prenotazione, il conteggio resta quello reale (nessun consumo nascosto) ma lo scarto è segnalato (`overshoot` + log) e,
 * se porta oltre il limite mensile, le richieste successive sono rifiutate dalla prenotazione fino al rinnovo.
 */
export async function runAi(a: {
  orgId: string; userId: string; feature: string; req: AiRequest; requestKey?: string;
}): Promise<RunAiResult> {
  const promptText = [a.req.system, ...a.req.messages.map((m) => m.content), a.req.jsonSchema ? JSON.stringify(a.req.jsonSchema) : ""];
  let attachmentTokens = 0;
  if (a.req.attachment) {
    const est = estimateAttachment(a.req.attachment.mimeType, a.req.attachment.data);
    if (est.tooLarge) return { ok: false, kind: "attachment", error: est.tooLarge.message };
    attachmentTokens = est.tokens;
  }
  const estimate = estimateTokens(...promptText) + (a.req.maxOutputTokens ?? 1024) + attachmentTokens;
  const key = a.requestKey ?? `${a.feature}:${randomUUID()}`;
  const r = await reserveCredits({ orgId: a.orgId, userId: a.userId, feature: a.feature, requestKey: key, tokens: estimate });
  if (!r.ok) return { ok: false, kind: "quota", error: r.reason === "limit" || r.reason === "no_quota" ? QUOTA_MESSAGE : "Impossibile verificare i crediti AI. Riprova." };
  if (r.duplicate) return { ok: false, kind: "duplicate", error: "Questa richiesta è già stata elaborata." };
  const provider = getAiProvider();
  try {
    const res = await provider.generate(a.req);
    const reported = res.inputTokens + res.outputTokens > 0;
    const inputTokens = reported ? res.inputTokens : estimateTokens(...promptText) + attachmentTokens;
    const outputTokens = reported ? res.outputTokens : estimateTokens(res.text);
    await settleCredits(r.id, { inputTokens, outputTokens, provider: provider.name, model: res.model, estimated: !reported });
    const actual = inputTokens + outputTokens;
    let overshoot: { reserved: number; actual: number } | undefined;
    if (actual > Math.ceil(estimate)) {
      overshoot = { reserved: Math.ceil(estimate), actual };
      const q = await quotaStatus(a.orgId).catch(() => null);
      console.warn("ai_overshoot", JSON.stringify({ org: a.orgId, feature: a.feature, reserved: overshoot.reserved, actual, source: res.usageSource ?? "n/d", used: q?.used, limit: q?.limit, overLimit: q ? q.used > q.limit : undefined }));
    }
    return { ok: true, res, provider: provider.name, estimated: !reported, ...(overshoot ? { overshoot } : {}) };
  } catch (e) {
    await releaseCredits(r.id, e instanceof Error && "kind" in e ? String((e as { kind: unknown }).kind) : "error");
    console.error("ai call failed", e instanceof Error ? e.message.slice(0, 200) : "unknown");
    return { ok: false, kind: "provider", error: userMessageForAiError(e) };
  }
}
