import "server-only";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { ImapFlow } from "imapflow";
import { env } from "@/server/env";
import { resolveMailHost } from "../host-guard";
import { MAX_RAW_MESSAGE_BYTES } from "../limits";
import { formatAddr } from "../addresses";
import { type EmailProvider, type OutgoingMessage, type RawMessage, type Secret, type ServerSettings, ProviderError } from "./types";

const allowPrivate = () => env().EMAIL_ALLOW_PRIVATE_HOSTS === "true";
const pwd = (s: Secret) => { if (s.kind !== "password") throw new ProviderError("Credenziali non valide per questa casella", "auth"); return s; };
const need = (s: ServerSettings | undefined, what: string): ServerSettings => { if (!s) throw new ProviderError(`Server ${what} non configurato`, "config"); return s; };
export const newMessageId = (address: string) => `<${randomUUID()}@${address.split("@")[1] ?? "nexora.local"}>`;

/** Errori SMTP → classificazione. Se l'errore avviene dopo l'invio dei dati l'esito è incerto (niente rinvio automatico). */
export function classifySmtpError(e: unknown): ProviderError {
  const err = e as { code?: string; command?: string; responseCode?: number; message?: string };
  if (e instanceof ProviderError) return e;
  const pre = ["CONN", "EHLO", "HELO", "STARTTLS", "AUTH PLAIN", "AUTH LOGIN", "AUTH", "MAIL FROM", "RCPT TO"];
  if (err.code === "EAUTH" || err.responseCode === 535) return new ProviderError("Accesso al server SMTP rifiutato: controlla utente e password", "auth");
  if (err.code === "EENVELOPE" || (err.responseCode && err.responseCode >= 550 && err.command !== "DATA")) return new ProviderError("Il server ha rifiutato un destinatario o il mittente", "permanent");
  if (err.code === "EDNS" || err.code === "ECONNECTION" || err.code === "ECONNREFUSED" || (err.command && pre.includes(err.command)) || err.code === "ESOCKET" && !err.command) {
    return new ProviderError("Impossibile contattare il server SMTP: riprova più tardi", "temporary");
  }
  if (err.responseCode && err.responseCode >= 500) return new ProviderError("Il server di posta ha rifiutato il messaggio", "permanent");
  return new ProviderError("Connessione interrotta durante l'invio: non è possibile confermare se il messaggio sia partito", "temporary", true);
}
export function classifyImapError(e: unknown): ProviderError {
  const err = e as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string };
  if (e instanceof ProviderError) return e;
  if (err.authenticationFailed || /auth|login|credentials|invalid/i.test(err.responseText ?? "")) return new ProviderError("Accesso IMAP rifiutato: controlla utente e password", "auth");
  return new ProviderError("Impossibile leggere la casella IMAP al momento", "temporary");
}

async function transportFor(settings: ServerSettings, password: string) {
  const ip = await resolveMailHost(settings.host, settings.port, allowPrivate());
  return nodemailer.createTransport({
    host: ip, port: settings.port, secure: settings.security === "ssl", requireTLS: settings.security === "starttls", ignoreTLS: settings.security === "none",
    auth: { user: settings.username, pass: password }, tls: { servername: settings.host, minVersion: "TLSv1.2" },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
  });
}
async function imapFor(settings: ServerSettings, password: string) {
  const ip = await resolveMailHost(settings.host, settings.port, allowPrivate());
  const client = new ImapFlow({
    host: ip, port: settings.port, secure: settings.security === "ssl", doSTARTTLS: settings.security === "starttls" ? true : settings.security === "none" ? false : undefined,
    auth: { user: settings.username, pass: password }, tls: { servername: settings.host, minVersion: "TLSv1.2" }, logger: false,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000, emitLogs: false,
  });
  client.on("error", () => { /* gestito dal chiamante tramite le promesse */ });
  return client;
}

const SENT_NAMES = ["sent", "sent items", "sent mail", "posta inviata", "inviata", "inviati", "elementi inviati"];
async function sentPath(client: ImapFlow): Promise<string | null> {
  const list = await client.list();
  return (list.find((m) => m.specialUse === "\\Sent") ?? list.find((m) => SENT_NAMES.includes(m.name.toLowerCase())))?.path ?? null;
}

export const smtpImapProvider: EmailProvider = {
  async send(secret, account, msg: OutgoingMessage) {
    const s = pwd(secret);
    const smtp = need(account.settings.smtp, "SMTP");
    const all = [...msg.to, ...msg.cc, ...msg.bcc];
    const composer = new MailComposer({
      from: formatAddr(msg.from), to: msg.to.map(formatAddr), cc: msg.cc.map(formatAddr), subject: msg.subject, html: msg.html, text: msg.text, messageId: msg.messageId,
      inReplyTo: msg.inReplyTo ?? undefined, references: msg.references?.length ? msg.references : undefined,
      attachments: msg.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content })),
    });
    const raw = await composer.compile().build();
    try {
      const t = await transportFor(smtp, s.smtpPassword);
      await t.sendMail({ envelope: { from: msg.from.address, to: all.map((a) => a.address) }, raw });
    } catch (e) { throw classifySmtpError(e); }
    // copia nella cartella "Inviata" (se c'è un server IMAP): serve perché la lettura dei messaggi inviati li ritrova già registrati
    if (account.settings.imap) {
      try {
        const c = await imapFor(account.settings.imap, s.imapPassword);
        await c.connect();
        try { const p = await sentPath(c); if (p) await c.append(p, raw, ["\\Seen"]); } finally { await c.logout().catch(() => undefined); }
      } catch { /* la copia è facoltativa: l'invio è già riuscito */ }
    }
    return { providerMessageId: null, internetMessageId: msg.messageId, providerThreadId: null, sentAt: new Date() };
  },

  async verify(secret, account) {
    const s = pwd(secret);
    try { await (await transportFor(need(account.settings.smtp, "SMTP"), s.smtpPassword)).verify(); } catch (e) { throw classifySmtpError(e); }
    const imap = account.settings.imap;
    if (imap) {
      const c = await imapFor(imap, s.imapPassword);
      try { await c.connect(); await c.logout(); } catch (e) { throw classifyImapError(e); }
    }
  },

  /** Sincronizzazione incrementale per UID (INBOX e posta inviata). Alla prima lettura importa solo gli ultimi messaggi. */
  async sync(secret, account, opts) {
    const s = pwd(secret);
    const imap = need(account.settings.imap, "IMAP");
    const client = await imapFor(imap, s.imapPassword);
    const cursor = { ...(account.cursor as Record<string, { uidValidity?: string; lastUid?: number }>) };
    const messages: RawMessage[] = [];
    let hasMore = false, bytes = 0;
    try {
      await client.connect();
      const sent = await sentPath(client);
      for (const [folder, path] of [["inbox", "INBOX"], ["sent", sent]] as const) {
        if (!path) continue;
        const lock = await client.getMailboxLock(path, { readOnly: true });
        try {
          const box = client.mailbox;
          if (!box) continue;
          const key = `${folder}`;
          const cur = cursor[key] ?? {};
          const uidValidity = String(box.uidValidity);
          let lastUid = cur.uidValidity === uidValidity ? (cur.lastUid ?? 0) : 0;
          const first = lastUid === 0;
          const uidNext = box.uidNext ?? 1;
          if (uidNext - 1 <= lastUid) { cursor[key] = { uidValidity, lastUid }; continue; }
          // prima lettura: solo gli ultimi N messaggi; poi tutto ciò che è nuovo, a blocchi
          const from = first ? Math.max(1, uidNext - opts.limit) : lastUid + 1;
          for await (const m of client.fetch(`${from}:*`, { uid: true, flags: true, source: true, size: true, internalDate: true }, { uid: true })) {
            if (m.uid <= lastUid) continue;
            if (messages.length >= opts.limit || bytes > 40 * 1024 * 1024) { hasMore = true; break; }
            lastUid = Math.max(lastUid, m.uid);
            if ((m.size ?? 0) > MAX_RAW_MESSAGE_BYTES || !m.source) continue;
            bytes += m.source.length;
            messages.push({ providerMessageId: `imap:${folder}:${uidValidity}:${m.uid}`, providerThreadId: null, folder, raw: m.source, isRead: m.flags?.has("\\Seen") ?? false, internalDate: m.internalDate instanceof Date ? m.internalDate : null });
          }
          cursor[key] = { uidValidity, lastUid: first && messages.length === 0 ? uidNext - 1 : lastUid };
        } finally { lock.release(); }
      }
    } catch (e) { throw classifyImapError(e); } finally { await client.logout().catch(() => undefined); }
    return { messages, cursor, hasMore };
  },
};
