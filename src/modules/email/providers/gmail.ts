import "server-only";
import MailComposer from "nodemailer/lib/mail-composer";
import { formatAddr } from "../addresses";
import { MAX_RAW_MESSAGE_BYTES } from "../limits";
import { accessToken, classifyHttp } from "./oauth";
import { type EmailProvider, type OAuthSecret, type RawMessage, type Secret, ProviderError } from "./types";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const oauth = (s: Secret): OAuthSecret => { if (s.kind !== "oauth") throw new ProviderError("Credenziali non valide per questa casella", "auth"); return s; };

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(20_000), cache: "no-store" }); }
  catch { throw new ProviderError("Gmail non risponde: riprova più tardi", "temporary"); }
  if (!res.ok) throw Object.assign(classifyHttp(res.status, "Gmail"), { status: res.status });
  return (await res.json()) as T;
}
type History = { history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[]; historyId?: string; nextPageToken?: string };
const b64url = (b: Buffer) => b.toString("base64url");

export const gmailProvider: EmailProvider = {
  async send(secret, account, msg) {
    const { token, secret: next, refreshed } = await accessToken("gmail", oauth(secret));
    const raw = await new MailComposer({
      from: formatAddr(msg.from), to: msg.to.map(formatAddr), cc: msg.cc.map(formatAddr), bcc: msg.bcc.map(formatAddr), subject: msg.subject, html: msg.html, text: msg.text, messageId: msg.messageId,
      inReplyTo: msg.inReplyTo ?? undefined, references: msg.references?.length ? msg.references : undefined,
      attachments: msg.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content })),
    }).compile().build();
    let r: { id?: string; threadId?: string };
    try { r = await api(token, "/messages/send", { method: "POST", body: JSON.stringify({ raw: b64url(raw), ...(msg.providerThreadId ? { threadId: msg.providerThreadId } : {}) }) }); }
    catch (e) { throw e instanceof ProviderError && e.kind === "temporary" ? new ProviderError(e.message, "temporary", true) : e; }
    if (!r.id) throw new ProviderError("Gmail non ha confermato l'invio", "temporary", true);
    return { providerMessageId: r.id, internetMessageId: msg.messageId, providerThreadId: r.threadId ?? null, sentAt: new Date(), secret: refreshed ? next : undefined };
  },

  async verify(secret) {
    const { token } = await accessToken("gmail", oauth(secret));
    await api(token, "/profile");
  },

  /** Incrementale con la cronologia (historyId); se l'identificativo è scaduto riparte dagli ultimi messaggi. */
  async sync(secret, account, opts) {
    const { token, secret: next, refreshed } = await accessToken("gmail", oauth(secret));
    const cursor = account.cursor as { historyId?: string };
    const ids = new Set<string>();
    let historyId = cursor.historyId;
    let fullResync = !historyId;
    if (historyId) {
      try {
        let page: string | undefined;
        const start: string = historyId;
        do {
          const h: History = await api<History>(token, `/history?startHistoryId=${encodeURIComponent(start)}&historyTypes=messageAdded&maxResults=100${page ? `&pageToken=${page}` : ""}`);
          for (const e of h.history ?? []) for (const a of e.messagesAdded ?? []) if (!a.message.labelIds?.includes("DRAFT")) ids.add(a.message.id);
          historyId = h.historyId ?? historyId;
          page = h.nextPageToken;
        } while (page && ids.size < opts.limit);
      } catch (e) {
        if ((e as { status?: number }).status === 404) fullResync = true; else throw e;
      }
    }
    if (fullResync) {
      ids.clear();
      for (const label of ["INBOX", "SENT"]) {
        const l = await api<{ messages?: { id: string }[] }>(token, `/messages?labelIds=${label}&maxResults=${Math.min(opts.limit, 50)}`);
        for (const m of l.messages ?? []) ids.add(m.id);
      }
      historyId = (await api<{ historyId: string }>(token, "/profile")).historyId;
    }
    const messages: RawMessage[] = [];
    const hasMore = ids.size > opts.limit;
    for (const id of [...ids].slice(0, opts.limit)) {
      let m: { id: string; threadId: string; labelIds?: string[]; raw?: string; sizeEstimate?: number; internalDate?: string };
      try { m = await api(token, `/messages/${id}?format=raw`); } catch (e) { if ((e as { status?: number }).status === 404) continue; throw e; }
      if (!m.raw || (m.sizeEstimate ?? 0) > MAX_RAW_MESSAGE_BYTES) continue;
      const labels = m.labelIds ?? [];
      if (labels.includes("DRAFT")) continue;
      messages.push({ providerMessageId: m.id, providerThreadId: m.threadId, folder: labels.includes("SENT") ? "sent" : "inbox", raw: Buffer.from(m.raw, "base64url"), isRead: !labels.includes("UNREAD"), internalDate: m.internalDate ? new Date(Number(m.internalDate)) : null });
    }
    // se restano messaggi non letti in questo giro, il cursore non avanza oltre la cronologia già vista: la prossima lettura li riprende (i duplicati sono scartati dagli identificativi)
    if (hasMore) historyId = cursor.historyId ?? historyId;
    return { messages, cursor: { historyId }, hasMore, secret: refreshed ? next : undefined };
  },
};
