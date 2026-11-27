/**
 * Conteggio dei token di Gemini → (ingresso, uscita) per i crediti.
 *
 * Semantica dei campi di `usageMetadata` (documentata dall'SDK @google/genai):
 * - promptTokenCount: token del prompt; comprende già il contenuto in cache (cachedContentTokenCount NON va sommato).
 * - toolUsePromptTokenCount: risultati di strumenti rimandati al modello come ingresso; è SEPARATO dal prompt.
 * - candidatesTokenCount: token della risposta, ESCLUSI quelli di ragionamento.
 * - thoughtsTokenCount: token di ragionamento, separati dalla risposta, fatturati come uscita.
 * - totalTokenCount: prompt + candidati + strumenti + ragionamento.
 *
 * Regole:
 * 1. ingresso = prompt + strumenti.
 * 2. Se il totale c'è ed è coerente (≥ ingresso + candidati + ragionamento) è il riferimento: uscita = totale − ingresso.
 *    Nessun campo viene sommato due volte (il ragionamento è già nel totale).
 * 3. Se il totale c'è ma è INFERIORE alla somma delle parti (incoerente) si usano le parti, così il ragionamento non va perso;
 *    il caso è segnalato con `inconsistent` e registrato nei log.
 * 4. Se il totale manca si sommano le parti (fallback esplicito, `source: "parts"`).
 * 5. Se non c'è nessun dato (`source: "none"`) il chiamante usa una stima, segnalata come tale.
 */
export type GeminiUsageMeta = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
};

export type MappedUsage = { inputTokens: number; outputTokens: number; source: "total" | "parts" | "none"; inconsistent: boolean };

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

export function mapGeminiUsage(m: GeminiUsageMeta | undefined | null): MappedUsage {
  const input = n(m?.promptTokenCount) + n(m?.toolUsePromptTokenCount);
  const outParts = n(m?.candidatesTokenCount) + n(m?.thoughtsTokenCount);
  const total = n(m?.totalTokenCount);
  if (total > 0) {
    const outFromTotal = total - input;
    if (outFromTotal >= outParts) return { inputTokens: input, outputTokens: outFromTotal, source: "total", inconsistent: false };
    return { inputTokens: input, outputTokens: outParts, source: "parts", inconsistent: true };
  }
  return { inputTokens: input, outputTokens: outParts, source: input + outParts > 0 ? "parts" : "none", inconsistent: false };
}
