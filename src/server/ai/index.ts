import "server-only";
import type { AiProvider } from "./provider";
import { GeminiProvider } from "./providers/gemini";
import { MockProvider } from "./providers/mock";
import { env } from "@/server/env";

/**
 * Provider AI. Gemini è l'unico provider reale integrato; l'interfaccia `AiProvider` permette di aggiungerne altri senza toccare il Copilot.
 * Il provider simulato esiste solo per i test e non può essere attivato su un deploy di produzione Vercel.
 */
export function getAiProvider(): AiProvider {
  if (env().AI_PROVIDER === "mock" && process.env.VERCEL_ENV !== "production") return new MockProvider();
  return new GeminiProvider();
}
export type { AiProvider, AiRequest, AiResponse, AiMessage } from "./provider";
export { AiProviderError, userMessageForAiError } from "./provider";
