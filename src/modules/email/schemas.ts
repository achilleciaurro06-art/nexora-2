import { z } from "zod";
import { optionalText } from "@/lib/forms";
import { type Addr, parseAddressList } from "./addresses";

const optUuid = z.uuid("Valore non valido").optional().or(z.literal("")).transform((v) => v || null);
const host = z.string().trim().min(1, "Indica il server").max(253).regex(/^[A-Za-z0-9.-]+$/, "Nome del server non valido");
const port = z.coerce.number("Porta non valida").int().min(1, "Porta non valida").max(65535, "Porta non valida");
const security = z.enum(["ssl", "starttls", "none"], "Sicurezza non valida");

export const connectImapSchema = z.object({
  address: z.string().trim().toLowerCase().email("Indirizzo email non valido").max(254),
  displayName: optionalText(120),
  imapHost: host, imapPort: port, imapSecurity: security, imapUser: z.string().trim().min(1, "Indica l'utente IMAP").max(254), imapPassword: z.string().min(1, "Indica la password IMAP").max(500),
  smtpHost: host, smtpPort: port, smtpSecurity: security, smtpUser: z.string().trim().min(1, "Indica l'utente SMTP").max(254), smtpPassword: z.string().min(1, "Indica la password SMTP").max(500),
});

export const accountEditSchema = z.object({
  displayName: optionalText(120), signature: optionalText(2000), visibility: z.enum(["shared", "restricted"], "Visibilità non valida"),
});

/** Elenco di indirizzi inserito in un campo di testo: se c'è anche un solo indirizzo non valido, l'invio è bloccato con un messaggio chiaro. */
const addrField = (label: string) => z.string().optional().default("").transform((v, ctx): Addr[] => {
  const r = parseAddressList(v);
  if (r.invalid.length) { ctx.addIssue({ code: "custom", message: `${label}: indirizzo non valido (${r.invalid[0]})` }); return z.NEVER; }
  return r.ok;
});
const jsonList = <T,>(schema: z.ZodType<T>) => z.string().optional().default("[]").transform((v, ctx): T[] => {
  try { return z.array(schema).max(20).parse(JSON.parse(v || "[]")); } catch { ctx.addIssue({ code: "custom", message: "Allegati non validi" }); return z.NEVER; }
});

export const composeSchema = z.object({
  accountId: z.uuid("Scegli la casella mittente"),
  idempotencyKey: z.uuid(),
  to: addrField("A"), cc: addrField("Cc"), bcc: addrField("Ccn"),
  subject: z.string().max(998, "Oggetto troppo lungo").default(""),
  bodyHtml: z.string().max(300_000, "Messaggio troppo lungo").default(""),
  replyToMessageId: optUuid, customerId: optUuid, quoteId: optUuid, draftId: optUuid,
  markQuoteSent: z.literal("on").optional(), attachQuotePdf: z.literal("on").optional(),
  uploaded: jsonList(z.object({ storage_path: z.string().max(500), name: z.string().max(255), mime: z.string().max(150), size: z.number().int().min(0).max(30_000_000) })),
  documentIds: z.string().optional().default("[]").transform((v) => { try { return z.array(z.uuid()).max(10).parse(JSON.parse(v || "[]")); } catch { return []; } }),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1, "Inserisci il nome del modello").max(100),
  subject: z.string().trim().max(300).default(""),
  bodyHtml: z.string().max(20_000, "Testo troppo lungo").default(""),
});

export const linkSchema = z.object({ customerId: optUuid, contactId: optUuid, quoteId: optUuid });
export const signatureSchema = z.object({ signature: z.string().trim().max(2000, "Firma troppo lunga") });
