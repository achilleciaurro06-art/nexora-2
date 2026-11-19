import { normalizeName } from "@/modules/documenti/extraction";

/**
 * Selezione del contesto per il Copilot — parte pura.
 * Obiettivo costi: a ogni domanda si caricano SOLO i blocchi di dati pertinenti, ciascuno con righe e
 * caratteri limitati, invece di tutto il database. La selezione è deterministica (parole chiave).
 */
export type PackName =
  | "stale_customers" | "pending_quotes" | "win_odds" | "top_customers" | "tasks" | "price_anomalies"
  | "documents" | "past_ai" | "org_info";

const RULES: { pack: PackName; re: RegExp }[] = [
  { pack: "stale_customers", re: /ricontatt|contattat|inattiv|da pi[uù] tempo|dimentic|trascur|sentit[io]|opportunit|interessant|riattiv/i },
  { pack: "pending_quotes", re: /risposta|attesa|sollecit|inviat|follow|pendent|aperti|in corso|trascur|opportunit|scadut|chiuder/i },
  { pack: "win_odds", re: /possibilit|probabil|conclus|chius|vinc|accett|conversion|successo|chance/i },
  { pack: "top_customers", re: /fatturat|valore|import|miglior|top\b|pi[uù] (grand|import|redditiz)|generat|ricav|incass|pipeline/i },
  { pack: "tasks", re: /oggi|attivit|scadenz|da fare|priorit|agenda|settimana|domani|promemoria|follow|impegn/i },
  { pack: "price_anomalies", re: /prezz|anomal|costos|economic|sottocost|sconto|tariff|listino/i },
  { pack: "documents", re: /document|\bpdf\b|\bfile\b|word|excel|allegat|caricat/i },
  { pack: "past_ai", re: /analisi|suggerim|precedent|gi[aà] propost|proposte|consigli/i },
  { pack: "org_info", re: /azienda|nostr[ao]|dati aziendali|iban|condizioni|partita iva|sito web|logo/i },
];

/** Priorità di taglio (le prime restano se il budget è stretto). */
export const PACK_PRIORITY: PackName[] = ["tasks", "pending_quotes", "stale_customers", "win_odds", "top_customers", "price_anomalies", "documents", "past_ai", "org_info"];

export function selectPacks(question: string): PackName[] {
  const hits = new Set<PackName>();
  for (const r of RULES) if (r.re.test(question)) hits.add(r.pack);
  return PACK_PRIORITY.filter((p) => hits.has(p));
}

/** Numeri di preventivo citati nella domanda, nel formato AAAA/NNNN. */
export function quoteNumbersIn(question: string): string[] {
  return [...new Set(question.match(/\b20\d{2}\/\d{3,5}\b/g) ?? [])].slice(0, 3);
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const GENERIC = new Set(["srl", "spa", "snc", "sas", "studio", "ditta", "societa", "di", "e", "il", "la", "the", "and", "group", "italia"]);

/** Clienti il cui nome compare nella domanda (tutti i token significativi presenti). Al massimo `limit`. */
export function customersMentioned(question: string, customers: { id: string; name: string }[], limit = 2): { id: string; name: string }[] {
  const q = ` ${norm(question)} `;
  const found: { id: string; name: string; score: number }[] = [];
  for (const c of customers) {
    const tokens = norm(c.name).split(" ").filter((t) => t.length >= 3 && !GENERIC.has(t));
    if (tokens.length === 0) continue;
    if (tokens.every((t) => q.includes(` ${t} `) || q.includes(` ${t}`))) found.push({ ...c, score: tokens.join("").length });
  }
  return found.sort((a, b) => b.score - a.score).slice(0, limit).map(({ id, name }) => ({ id, name }));
}

/** Serializza e tronca: ogni blocco ha un tetto di caratteri; il totale rispetta il budget. */
export function clampJson(value: unknown, maxChars: number): string {
  const s = JSON.stringify(value);
  if (s.length <= maxChars) return s;
  if (Array.isArray(value)) {
    let items = value;
    while (items.length > 1 && JSON.stringify(items).length > maxChars - 40) items = items.slice(0, Math.ceil(items.length * 0.7));
    return JSON.stringify(items).slice(0, maxChars) + (JSON.stringify(items).length > maxChars ? "…" : "");
  }
  return s.slice(0, maxChars) + "…";
}

export function assemble(blocks: { name: string; json: string }[], budget: number): { text: string; included: string[]; dropped: string[] } {
  const included: string[] = [], dropped: string[] = [];
  let used = 0;
  const parts: string[] = [];
  for (const b of blocks) {
    const part = `[${b.name}]\n${b.json}`;
    if (used + part.length + 1 > budget) { dropped.push(b.name); continue; }
    parts.push(part); included.push(b.name); used += part.length + 1;
  }
  return { text: parts.join("\n"), included, dropped };
}

/** Risoluzione prudente di un nome: corrispondenza esatta normalizzata; altrimenti l'unico candidato che lo contiene. */
export function resolveByName<T extends { id: string; name: string }>(candidates: T[], name: string | undefined | null): T | null {
  const n = normalizeName(name ?? "");
  if (n.length < 3) return null;
  const exact = candidates.filter((c) => normalizeName(c.name) === n);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const partial = candidates.filter((c) => { const cn = normalizeName(c.name); return cn.includes(n) || n.includes(cn); });
  return partial.length === 1 ? partial[0]! : null;
}
