import "server-only";
import { GoogleGenAI } from "@google/genai";
import { env } from "@/server/env";
import { AiProviderError, type AiProvider, type AiRequest, type AiResponse } from "../provider";
import { mapGeminiUsage } from "./gemini-usage";

const RETRY_DELAYS_MS = [700, 1800];
const CALL_TIMEOUT_MS = 20_000;
const TOTAL_BUDGET_MS = 40_000; // sotto il limite di 60s della funzione

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  if (typeof s === "number") return s;
  const m = /"code":\s*(\d{3})/.exec(err instanceof Error ? err.message : "");
  return m ? Number(m[1]) : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GeminiProvider implements AiProvider {
  readonly name = "gemini";

  async generate(req: AiRequest): Promise<AiResponse> {
    const e = env();
    if (!e.GEMINI_API_KEY) throw new AiProviderError("GEMINI_API_KEY non configurata", "auth");
    const ai = new GoogleGenAI({ apiKey: e.GEMINI_API_KEY, httpOptions: { timeout: CALL_TIMEOUT_MS } });
    const startedAt = Date.now();

    const contents = req.messages.map((m, idx) => {
      const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [{ text: m.content }];
      if (req.attachment && idx === req.messages.length - 1 && m.role === "user") {
        parts.push({ inlineData: { mimeType: req.attachment.mimeType, data: Buffer.from(req.attachment.data).toString("base64") } });
      }
      return { role: m.role === "assistant" ? "model" : "user", parts };
    });

    // modello principale, poi fallback: se uno è sovraccarico (503) o non disponibile (404) si prova l'altro
    const models = [...new Set([e.GEMINI_MODEL, e.GEMINI_FALLBACK_MODEL])];
    let lastKind: AiProviderError["kind"] = "other";
    let lastStatus: number | undefined;
    let lastMessage = "";

    for (const model of models) {
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (Date.now() - startedAt > TOTAL_BUDGET_MS - CALL_TIMEOUT_MS) {
          throw new AiProviderError(lastMessage || "tempo massimo raggiunto", "overloaded", lastStatus);
        }
        try {
          const res = await ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: req.system,
              maxOutputTokens: req.maxOutputTokens ?? 1024,
              ...(req.jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: req.jsonSchema } : {}),
            },
          });
          // conteggio a partire dal totale del provider (ragionamento e strumenti inclusi, senza doppie somme): vedi gemini-usage.ts
          const usage = mapGeminiUsage(res.usageMetadata);
          if (usage.inconsistent) console.warn(`gemini ${model}: totalTokenCount inferiore alla somma dei campi, uso la somma dei campi`);
          return { text: res.text ?? "", model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, usageSource: usage.source };
        } catch (err) {
          const status = statusOf(err);
          lastStatus = status;
          lastMessage = err instanceof Error ? err.message.slice(0, 300) : "errore sconosciuto";
          console.error(`gemini ${model} tentativo ${attempt + 1}: stato ${status ?? "?"}`);
          if (status === 401 || status === 403) throw new AiProviderError(lastMessage, "auth", status);
          if (status === 404) { lastKind = "not_found"; break; } // modello assente: passa al fallback
          if (status === 429 || (status !== undefined && status >= 500) || status === undefined) {
            lastKind = "overloaded";
            const delay = RETRY_DELAYS_MS[attempt];
            if (delay === undefined) break;
            await sleep(delay);
            continue;
          }
          throw new AiProviderError(lastMessage, "other", status);
        }
      }
    }
    throw new AiProviderError(lastMessage || "AI non disponibile", lastKind, lastStatus);
  }
}
