import "server-only";
import { type Addr } from "../addresses";
import { MAX_RAW_MESSAGE_BYTES } from "../limits";
import { accessToken, classifyHttp } from "./oauth";
import { type EmailProvider, type OAuthSecret, type OutgoingMessage, type RawMessage, type Secret, ProviderError } from "./types";

const API = "https://graph.microsoft.com/v1.0";
const oauth = (s: Secret): OAuthSecret => { if (s.kind !== "oauth") throw new ProviderError("Credenziali non valide per questa casella", "auth"); return s; };

async function call(token: string, url: string, init?: RequestInit & { raw?: boolean }): Promise<Response> {
  let res: Response;
  try { res = await fetch(url.startsWith("http") ? url : `${API}${url}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.body && !init.raw ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(25_000), cache: "no-store" }); }
  catch { throw new ProviderError("Microsoft 365 non risponde: riprova più tardi", "temporary"); }
  if (!res.ok) throw Object.assign(classifyHttp(res.status, "Microsoft 365"), { status: res.status });
  return res;
}
const rcpt = (l: Addr[]) => l.map((a) => ({ emailAddress: { address: a.address, ...(a.name ? { name: a.name } : {}) } }));

export const outlookProvider: EmailProvider = {
  /** Crea la bozza (che ha già l'identificativo definitivo del messaggio) e poi la invia: così il messaggio in "Posta inviata" è riconoscibile e non viene importato due volte. */
  async send(secret, account, msg: OutgoingMessage) {
    const { token, secret: next, refreshed } = await accessToken("outlook", oauth(secret));
    const draft = await (await call(token, "/me/messages", { method: "POST", body: JSON.stringify({
      subject: msg.subject, body: { contentType: "HTML", content: msg.html }, toRecipients: rcpt(msg.to), ccRecipients: rcpt(msg.cc), bccRecipients: rcpt(msg.bcc),
      attachments: msg.attachments.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.filename, contentType: a.contentType, contentBytes: a.content.toString("base64") })),
    }) })).json() as { id?: string; conversationId?: string; internetMessageId?: string };
    if (!draft.id) throw new ProviderError("Microsoft 365 non ha creato il messaggio", "temporary");
    try { await call(token, `/me/messages/${draft.id}/send`, { method: "POST" }); }
    catch (e) { throw e instanceof ProviderError && e.kind === "temporary" ? new ProviderError(e.message, "temporary", true) : e; }
    return { providerMessageId: draft.id, internetMessageId: draft.internetMessageId ?? msg.messageId, providerThreadId: draft.conversationId ?? null, sentAt: new Date(), secret: refreshed ? next : undefined };
  },

  async verify(secret) {
    const { token } = await accessToken("outlook", oauth(secret));
    await call(token, "/me/mailFolders/inbox?$select=id");
  },

  /** Incrementale con le query delta per cartella (posta in arrivo e inviata). */
  async sync(secret, account, opts) {
    const { token, secret: next, refreshed } = await accessToken("outlook", oauth(secret));
    const cursor = { ...(account.cursor as { inbox?: string; sent?: string }) };
    const messages: RawMessage[] = [];
    let hasMore = false;
    for (const [folder, name] of [["inbox", "inbox"], ["sent", "sentitems"]] as const) {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const initial = `/me/mailFolders/${name}/messages/delta?$select=id,conversationId,isRead,isDraft,receivedDateTime&$filter=receivedDateTime ge ${since}&$top=${Math.min(opts.limit, 50)}`;
      let url: string | null = cursor[folder] ?? initial;
      let reset = false;
      while (url) {
        let page: { value?: { id: string; conversationId?: string; isRead?: boolean; isDraft?: boolean; receivedDateTime?: string; "@removed"?: unknown }[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
        try { page = await (await call(token, url)).json() as typeof page; }
        catch (e) {
          // cursore scaduto (410): si riparte dagli ultimi 30 giorni, una sola volta; i duplicati sono scartati dagli identificativi
          if ((e as { status?: number }).status === 410 && !reset) { reset = true; delete cursor[folder]; url = initial; continue; }
          throw e;
        }
        for (const m of page.value ?? []) {
          if (m["@removed"] || m.isDraft) continue;
          if (messages.length >= opts.limit) { hasMore = true; break; }
          const mime = await call(token, `/me/messages/${m.id}/$value`, { raw: true });
          const buf = Buffer.from(await mime.arrayBuffer());
          if (buf.length > MAX_RAW_MESSAGE_BYTES) continue;
          messages.push({ providerMessageId: m.id, providerThreadId: m.conversationId ?? null, folder, raw: buf, isRead: m.isRead ?? false, internalDate: m.receivedDateTime ? new Date(m.receivedDateTime) : null });
        }
        if (hasMore) break;
        if (page["@odata.deltaLink"]) { cursor[folder] = page["@odata.deltaLink"]; url = null; } else url = page["@odata.nextLink"] ?? null;
      }
    }
    return { messages, cursor, hasMore, secret: refreshed ? next : undefined };
  },
};
