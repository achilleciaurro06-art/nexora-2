import { type Addr, dedupeAddrs, normAddress } from "./addresses";
import { escapeHtml, sanitizeEmailHtml, textToHtml } from "./sanitize";

export type Original = { direction: "inbound" | "outbound"; from: Addr; to: Addr[]; cc: Addr[]; replyTo?: Addr | null; subject: string; messageAt: string; bodyHtml: string | null; bodyText: string | null };
export type Mode = "reply" | "reply_all" | "forward";

export function replyRecipients(o: Original, own: string, mode: Mode): { to: Addr[]; cc: Addr[] } {
  if (mode === "forward") return { to: [], cc: [] };
  const me = normAddress(own);
  const notMe = (a: Addr) => normAddress(a.address) !== me;
  // rispondendo a un messaggio inviato da noi si scrive agli stessi destinatari
  const primary = o.direction === "outbound" ? o.to : [o.replyTo ?? o.from];
  if (mode === "reply") return { to: dedupeAddrs(primary.filter(notMe)), cc: [] };
  const to = dedupeAddrs([...primary, ...(o.direction === "outbound" ? [] : o.to)].filter(notMe));
  const inTo = new Set(to.map((a) => normAddress(a.address)));
  return { to, cc: dedupeAddrs(o.cc.filter(notMe)).filter((a) => !inTo.has(normAddress(a.address))) };
}

export const replySubject = (s: string) => `Re: ${s.replace(/^\s*((re|r|rif|ris|aw|sv)\s*:\s*)+/i, "").trim()}`.trim();
export const forwardSubject = (s: string) => `Fwd: ${s.replace(/^\s*((fwd|fw|i|wg)\s*:\s*)+/i, "").trim()}`.trim();

/** Citazione del messaggio originale (HTML sanitizzato: nessun contenuto attivo entra nel nuovo messaggio). */
export function quotedBlock(o: Original, mode: Mode, tz = "Europe/Rome"): string {
  const when = new Intl.DateTimeFormat("it-IT", { timeZone: tz, dateStyle: "long", timeStyle: "short" }).format(new Date(o.messageAt));
  const who = escapeHtml(o.from.name ? `${o.from.name} <${o.from.address}>` : o.from.address);
  const body = o.bodyHtml ? sanitizeEmailHtml(o.bodyHtml) : textToHtml(o.bodyText ?? "");
  const head = mode === "forward"
    ? `<p>---------- Messaggio inoltrato ----------<br>Da: ${who}<br>Data: ${escapeHtml(when)}<br>Oggetto: ${escapeHtml(o.subject)}</p>`
    : `<p>Il ${escapeHtml(when)}, ${who} ha scritto:</p>`;
  return `<p></p>${head}<blockquote>${body}</blockquote>`;
}

/** Sostituisce {{segnaposto}} con valori scappati; i segnaposto sconosciuti diventano vuoti. */
export function fillTemplate(text: string, vars: Record<string, string | null | undefined>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => escapeHtml(vars[k.toLowerCase()] ?? ""));
}
/** Per l'oggetto (testo semplice: nessun escape HTML). */
export function fillTemplateText(text: string, vars: Record<string, string | null | undefined>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => vars[k.toLowerCase()] ?? "");
}
export function withSignature(bodyHtml: string, signature: string | null | undefined): string {
  const sig = (signature ?? "").trim();
  if (!sig) return bodyHtml;
  return `${bodyHtml}<p>-- <br>${escapeHtml(sig).replace(/\n/g, "<br>")}</p>`;
}
