import "server-only";

export type AiMessage = { role: "user" | "assistant"; content: string };
export type AiRequest = {
  system: string;
  messages: AiMessage[];
  /** JSON Schema: se presente la risposta deve essere JSON conforme. */
  jsonSchema?: unknown;
  maxOutputTokens?: number;
  /** Allegato opzionale (es. PDF) passato come dato, mai come istruzione. */
  attachment?: { mimeType: string; data: Uint8Array };
};
export type AiResponse = { text: string; model: string; inputTokens: number; outputTokens: number };

/** Interfaccia indipendente dal provider: Gemini è il primo adapter. */
export interface AiProvider {
  readonly name: string;
  generate(req: AiRequest): Promise<AiResponse>;
}
