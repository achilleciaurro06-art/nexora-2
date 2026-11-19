import "server-only";
import type { AiProvider } from "./provider";
import { GeminiProvider } from "./providers/gemini";

export function getAiProvider(): AiProvider {
  return new GeminiProvider();
}
export type { AiProvider, AiRequest, AiResponse, AiMessage } from "./provider";
