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

export type AiErrorKind = "overloaded" | "not_found" | "auth" | "other";
export class AiProviderError extends Error {
  constructor(message: string, readonly kind: AiErrorKind, readonly status?: number) {
    super(message);
    this.name = "AiProviderError";
  }
}

/** Messaggio comprensibile per l'utente a partire dall'errore del provider. */
export function userMessageForAiError(e: unknown): string {
  if (e instanceof AiProviderError) {
    if (e.kind === "overloaded") return "Il modello AI è temporaneamente sovraccarico. Riprova tra qualche istante.";
    if (e.kind === "auth") return "Il servizio AI non è configurato correttamente (chiave non valida o non abilitata). Contatta l'amministratore.";
    if (e.kind === "not_found") return "Il modello AI configurato non è disponibile. Contatta l'amministratore.";
  }
  return "Il servizio AI non è disponibile al momento. Riprova tra poco.";
}
