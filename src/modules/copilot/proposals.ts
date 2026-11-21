import { z } from "zod";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const text = (n: number) => z.string().trim().min(1).max(n);
const uid = z.uuid();

/**
 * Azioni che il modello può PROPORRE. Non sono comandi: ogni proposta viene validata, risolta sui dati dell'organizzazione
 * (gli id inventati vengono scartati) e resta inerte finché l'utente autenticato non conferma.
 */
export const proposalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), title: text(200), description: z.string().max(2000).optional(), due_date: iso.optional(), customer_id: uid.optional(), quote_id: uid.optional() }),
  z.object({ kind: z.literal("follow_up"), customer_id: uid, title: text(200), due_date: iso, reason: z.string().max(300).optional(), quote_id: uid.optional() }),
  z.object({ kind: z.literal("quote_followup"), quote_id: uid, follow_up_date: iso, reason: z.string().max(300).optional() }),
  z.object({ kind: z.literal("customer_note"), customer_id: uid, body: text(1500) }),
  z.object({ kind: z.literal("email_draft"), customer_id: uid.optional(), thread_id: uid.optional(), quote_id: uid.optional(), subject: text(200), body: text(6000) }),
  z.object({ kind: z.literal("appointment"), customer_id: uid.optional(), title: text(200), date: iso, start_time: hhmm, duration_min: z.number().int().min(15).max(480).default(60), location: z.string().max(300).optional(), notes: z.string().max(1000).optional() }),
  z.object({ kind: z.literal("catalog_update"), product_id: uid, description: z.string().trim().max(1000).optional(), category: z.string().trim().max(80).optional() }),
  z.object({ kind: z.literal("quote_update"), quote_id: uid, title: z.string().trim().max(200).optional(), notes: z.string().trim().max(2000).optional(), terms: z.string().trim().max(2000).optional() }),
  z.object({
    kind: z.literal("quote_draft"), client_name: z.string().max(200).optional(), quote_title: z.string().max(200).optional(), description: z.string().max(2000).optional(), amount: z.number().min(0).max(1e9).optional(),
    items: z.array(z.object({ description: text(300), quantity: z.number().min(0).max(1e6).optional(), unit_price: z.number().min(0).max(1e9).optional() })).max(30).optional(),
  }),
]);
export type Proposal = z.infer<typeof proposalSchema>;
export type ProposalKind = Proposal["kind"];

export const PROPOSAL_LABEL: Record<string, string> = {
  task: "Crea attività", follow_up: "Programma follow-up", quote_followup: "Data di follow-up del preventivo", customer_note: "Aggiungi nota al cliente", email_draft: "Prepara bozza email",
  appointment: "Crea appuntamento", catalog_update: "Aggiorna voce di catalogo", quote_update: "Modifica preventivo (bozza)", quote_draft: "Bozza di preventivo", customer_followup: "Ricontatta il cliente", insight: "Osservazione", price_review: "Revisione prezzo",
};

/** Riga mostrata all'utente prima di confermare: cosa verrà fatto, con quali dati. */
export type ProposalDetail = { label: string; value: string };
export function proposalDetails(kind: string, p: Record<string, unknown>): ProposalDetail[] {
  const s = (k: string) => (typeof p[k] === "string" && p[k] ? (p[k] as string) : null);
  const d: ProposalDetail[] = [];
  const add = (label: string, v: string | null) => { if (v) d.push({ label, value: v }); };
  const label = (k: string) => s(k);
  switch (kind) {
    case "task": add("Titolo", s("title")); add("Cliente", label("customer_label")); add("Scadenza", s("due_date")); add("Dettagli", s("description")); break;
    case "follow_up": add("Cliente", label("customer_label")); add("Titolo", s("title")); add("Data", s("due_date")); add("Motivo", s("reason")); add("Preventivo", label("quote_label")); break;
    case "quote_followup": add("Preventivo", label("quote_label")); add("Data follow-up", s("follow_up_date")); add("Motivo", s("reason")); break;
    case "customer_note": add("Cliente", label("customer_label")); add("Nota", s("body")); break;
    case "email_draft": add("Destinatario", label("to_label") ?? "da inserire nella bozza"); add("Cliente", label("customer_label")); add("Oggetto", s("subject")); add("Testo", s("body")); add("Casella", label("account_label")); break;
    case "appointment": add("Titolo", s("title")); add("Cliente", label("customer_label")); add("Quando", `${s("date") ?? ""} ${s("start_time") ?? ""} (${p.duration_min ?? 60} min)`); add("Luogo", s("location")); break;
    case "catalog_update": add("Voce", label("product_label")); if (s("description") !== null) add("Nuova descrizione", s("description")); if (s("category") !== null) add("Nuova categoria", s("category")); add("Descrizione attuale", label("current_description")); add("Categoria attuale", label("current_category")); break;
    case "quote_update": add("Preventivo", label("quote_label")); if (s("title") !== null) add("Nuovo oggetto", s("title")); if (s("notes") !== null) add("Nuove note", s("notes")); if (s("terms") !== null) add("Nuove condizioni", s("terms")); break;
    case "quote_draft": add("Cliente", s("client_name")); add("Oggetto", s("quote_title")); break;
    default: add("Titolo", s("title")); add("Dettagli", s("description"));
  }
  return d;
}
