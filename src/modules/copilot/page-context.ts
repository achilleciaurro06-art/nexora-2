import { isUuid } from "@/lib/ids";

/**
 * Contesto della pagina aperta. Il client invia SOLO il percorso: il server lo interpreta (qui) e verifica
 * l'entità con i dati dell'utente (RLS). Nessun nome o dato fornito dal client entra nel prompt.
 */
export type PageKind = "dashboard" | "clienti" | "cliente" | "preventivi" | "preventivo" | "email" | "thread" | "attivita" | "appuntamenti" | "appuntamento" | "followup" | "promemoria" | "catalogo" | "copilot" | "generic";
export type EntityType = "customer" | "quote" | "thread" | "appointment";
export type PageContext = { page: PageKind; entityType?: EntityType; entityId?: string };

const LIST_PAGES: Record<string, PageKind> = { dashboard: "dashboard", clienti: "clienti", preventivi: "preventivi", email: "email", attivita: "attivita", appuntamenti: "appuntamenti", followup: "followup", promemoria: "promemoria", catalogo: "catalogo", copilot: "copilot" };

export function parsePageContext(pathname: unknown): PageContext {
  if (typeof pathname !== "string" || pathname.length > 300) return { page: "generic" };
  const parts = pathname.split("?")[0]!.split("/").filter(Boolean);
  const first = parts[0] ?? "";
  const page = LIST_PAGES[first];
  if (!page) return { page: "generic" };
  const id = parts[1];
  if (parts.length === 2 && isUuid(id)) {
    if (first === "clienti") return { page: "cliente", entityType: "customer", entityId: id };
    if (first === "preventivi") return { page: "preventivo", entityType: "quote", entityId: id };
    if (first === "email") return { page: "thread", entityType: "thread", entityId: id };
    if (first === "appuntamenti") return { page: "appuntamento", entityType: "appointment", entityId: id };
  }
  return { page };
}

export const PAGE_LABEL: Record<PageKind, string> = {
  dashboard: "la dashboard", clienti: "l'elenco clienti", cliente: "la scheda di un cliente", preventivi: "l'elenco preventivi", preventivo: "un preventivo", email: "la posta", thread: "una conversazione email",
  attivita: "le attività", appuntamenti: "gli appuntamenti", appuntamento: "un appuntamento", followup: "i follow-up", promemoria: "i promemoria", catalogo: "il catalogo", copilot: "il Copilot", generic: "NEXORA",
};

/** Domande iniziali suggerite, adatte alla pagina in cui ci si trova. */
export function suggestedQuestions(c: PageContext): string[] {
  switch (c.page) {
    case "cliente": return ["Analizza questo cliente", "Riassumi le email ricevute da questo cliente", "Quando e come conviene ricontattarlo?", "Prepara un'email di follow-up per questo cliente"];
    case "preventivo": return ["Analizza questo preventivo e dimmi cosa potrei migliorare", "I prezzi sono in linea con il mio storico?", "Quali informazioni mancano?", "Prepara un sollecito per questo preventivo"];
    case "thread": return ["Riassumi questa conversazione", "Quali richieste e obiezioni ci sono?", "Preparami una risposta", "Suggerisci un'attività collegata"];
    case "appuntamento": return ["Prepara un briefing per questo appuntamento", "Quali questioni devo affrontare?"];
    case "email": return ["Quali richieste dei clienti non hanno ancora ricevuto risposta?", "Individua eventuali obiezioni commerciali nelle email recenti"];
    case "catalogo": return ["Quali prodotti hanno informazioni mancanti?", "Quali prodotti uso di più nei preventivi?", "Individua prezzi incoerenti"];
    case "preventivi": return ["Quali preventivi sono ancora senza risposta?", "Quali offerte hanno un importo particolarmente alto?", "Confronta i preventivi degli ultimi tre mesi"];
    case "clienti": return ["Quali clienti non contattiamo da più tempo?", "Quali clienti hanno generato più fatturato quest'anno?", "Quali clienti hanno preventivi ancora aperti?"];
    case "attivita": case "followup": case "promemoria": return ["Cosa devo fare oggi?", "Quali follow-up sono in ritardo?", "Quali clienti devo ricontattare?", "Quali appuntamenti ho nei prossimi giorni?"];
    case "appuntamenti": return ["Quali appuntamenti ho nei prossimi giorni?", "Prepara un riepilogo del prossimo appuntamento"];
    default: return ["Come sta andando la mia attività?", "Cosa devo fare oggi?", "Quali sono le principali criticità attuali?", "Quali opportunità commerciali sto trascurando?"];
  }
}
