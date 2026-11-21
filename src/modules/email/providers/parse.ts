import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { type Addr, isValidEmail, normAddress } from "../addresses";
import { cleanMessageId, parseReferences } from "../threading";
import { MAX_STORED_ATTACHMENT_BYTES } from "../limits";

export type ParsedAttachment = { filename: string; contentType: string; content: Buffer; size: number };
export type ParsedMessage = {
  messageId: string | null; inReplyTo: string | null; references: string[]; from: Addr; replyTo: Addr | null; to: Addr[]; cc: Addr[]; bcc: Addr[];
  subject: string; date: Date; text: string; html: string | null; attachments: ParsedAttachment[]; skippedAttachments: number;
};

const flat = (v: AddressObject | AddressObject[] | undefined): Addr[] =>
  (Array.isArray(v) ? v : v ? [v] : []).flatMap((o) => o.value).flatMap((a) => (a.address && isValidEmail(normAddress(a.address)) ? [{ address: normAddress(a.address), name: a.name ? a.name.slice(0, 120) : undefined }] : []));

/** Interpreta un messaggio RFC 822 grezzo (qualunque provider) in una struttura normalizzata. Nessuna risorsa remota viene scaricata. */
export async function parseRaw(raw: Buffer): Promise<ParsedMessage> {
  const p: ParsedMail = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
  const from = flat(p.from)[0] ?? { address: "sconosciuto@invalid.invalid" };
  const date = p.date && !Number.isNaN(p.date.getTime()) && p.date.getTime() < Date.now() + 86_400_000 ? p.date : new Date();
  let skipped = 0;
  const attachments: ParsedAttachment[] = [];
  for (const a of p.attachments ?? []) {
    // le immagini incorporate nel corpo (firme, loghi) non si salvano come allegati
    if (a.contentDisposition === "inline" && a.cid) continue;
    if (a.size > MAX_STORED_ATTACHMENT_BYTES || attachments.length >= 20) { skipped++; continue; }
    attachments.push({ filename: (a.filename || "allegato").slice(0, 255), contentType: (a.contentType || "application/octet-stream").slice(0, 150), content: a.content, size: a.size });
  }
  return {
    messageId: cleanMessageId(p.messageId), inReplyTo: cleanMessageId(typeof p.inReplyTo === "string" ? p.inReplyTo : null), references: parseReferences(p.references as string | string[] | undefined),
    from, replyTo: flat(p.replyTo)[0] ?? null, to: flat(p.to), cc: flat(p.cc), bcc: [], subject: (p.subject ?? "").slice(0, 998),
    date, text: (p.text ?? "").slice(0, 300_000), html: typeof p.html === "string" ? p.html.slice(0, 600_000) : null, attachments, skippedAttachments: skipped,
  };
}
