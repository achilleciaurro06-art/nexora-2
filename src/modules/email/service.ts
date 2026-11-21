import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/server/supabase/admin";
import { env } from "@/server/env";
import { type Addr, addrsFromJson, addrOnly } from "./addresses";
import { counterparties, decideLink, type MatchRow } from "./matching";
import { decryptSecret, encryptSecret, parseKey } from "./crypto";
import { htmlToText, sanitizeEmailHtml, snippetOf, textToHtml } from "./sanitize";
import { cleanMessageId, lookupIds, parseReferences, pickThread } from "./threading";
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_SEND_ATTACHMENTS_BYTES, downloadMime, isDangerousFile, safeFilename } from "./limits";
import { getProvider, type ProviderKind } from "./providers";
import { parseRaw } from "./providers/parse";
import { newMessageId } from "./providers/smtp-imap";
import { ProviderError, type AccountSettings, type OutgoingAttachment, type ProviderAccount, type RawMessage, type Secret } from "./providers/types";

export const BUCKET = "email-attachments";
const admin = () => createAdminClient();

export type AccountRow = {
  id: string; organization_id: string; provider: ProviderKind; address: string; display_name: string | null; status: "connected" | "error" | "needs_reauth" | "disconnected";
  settings: AccountSettings; sync_cursor: Record<string, unknown>; created_by: string | null; signature: string | null; visibility: "shared" | "restricted"; is_default: boolean;
  last_sync_at: string | null; last_sync_error: string | null; status_detail: string | null; sync_failures: number;
};

/* ---------------------------------------------------------------- segreti (cifrati; mai restituiti al browser) */
export function encryptionKey(): Buffer | null { return parseKey(env().EMAIL_ENCRYPTION_KEY); }
export async function storeSecret(accountId: string, secret: Secret): Promise<void> {
  const key = encryptionKey();
  if (!key) throw new ProviderError("Cifratura non configurata (manca EMAIL_ENCRYPTION_KEY)", "config");
  const { error } = await admin().rpc("rpc_email_secret_set", { p_account: accountId, p_ciphertext: encryptSecret(JSON.stringify(secret), key) });
  if (error) throw new ProviderError("Impossibile salvare le credenziali", "permanent");
}
export async function loadSecret(accountId: string): Promise<Secret> {
  const key = encryptionKey();
  if (!key) throw new ProviderError("Cifratura non configurata (manca EMAIL_ENCRYPTION_KEY)", "config");
  const { data } = await admin().rpc("rpc_email_secret_get", { p_account: accountId });
  if (!data) throw new ProviderError("Credenziali mancanti: ricollega la casella", "auth");
  try { return JSON.parse(decryptSecret(data as string, key)) as Secret; } catch { throw new ProviderError("Credenziali non leggibili: ricollega la casella", "auth"); }
}
const toProviderAccount = (a: AccountRow): ProviderAccount => ({ id: a.id, address: a.address, displayName: a.display_name, settings: a.settings ?? {}, cursor: a.sync_cursor ?? {} });

/* ---------------------------------------------------------------- abbinamento ai clienti */
async function matchRows(orgId: string, addresses: string[]): Promise<MatchRow[]> {
  if (addresses.length === 0) return [];
  const { data } = await admin().rpc("email_match_addresses", { p_org: orgId, p_addresses: addresses.slice(0, 50) });
  return (data ?? []) as MatchRow[];
}
/** Collega la conversazione solo se non è già stata collegata da una persona o in modo certo. */
async function autoLinkThread(orgId: string, threadId: string, parties: string[]) {
  const { data: t } = await admin().from("email_threads").select("link_status, customer_id").eq("id", threadId).eq("organization_id", orgId).maybeSingle();
  if (!t || t.link_status === "manual" || t.link_status === "auto") return;
  const d = decideLink(await matchRows(orgId, parties));
  if (d.status === "auto") await admin().from("email_threads").update({ customer_id: d.customerId, contact_id: d.contactId, link_status: "auto", link_candidates: [] }).eq("id", threadId).eq("organization_id", orgId);
  else if (d.status === "suggested") await admin().from("email_threads").update({ link_status: "suggested", link_candidates: d.candidates }).eq("id", threadId).eq("organization_id", orgId);
}

/* ---------------------------------------------------------------- ricezione */
export type IngestResult = "new" | "duplicate" | "skipped";

/** Registra un messaggio grezzo di una casella. Idempotente: lo stesso messaggio (id del provider o Message-ID) non viene mai importato due volte. */
export async function ingestRaw(acc: AccountRow, rm: RawMessage): Promise<IngestResult> {
  const db = admin();
  const orgId = acc.organization_id;
  const dupe = await db.from("email_messages").select("id").eq("account_id", acc.id).eq("provider_message_id", rm.providerMessageId).maybeSingle();
  if (dupe.data) return "duplicate";
  const p = await parseRaw(rm.raw);
  const mid = cleanMessageId(p.messageId);
  if (mid) {
    const same = await db.from("email_messages").select("id").eq("account_id", acc.id).eq("internet_message_id", mid).limit(1).maybeSingle();
    if (same.data) return "duplicate"; // es. un messaggio che abbiamo inviato noi e ritroviamo nella posta inviata
  }
  const own = acc.address.toLowerCase();
  const outbound = rm.folder === "sent" || p.from.address === own;
  const direction = outbound ? "outbound" : "inbound";

  // conversazione: per identificativo del provider o per riferimenti, mai per somiglianza dell'oggetto
  const ids = lookupIds({ inReplyTo: p.inReplyTo, references: p.references });
  const byProviderThread = new Map<string, string>(), byMessageId = new Map<string, string>();
  if (rm.providerThreadId) {
    const t = await db.from("email_threads").select("id").eq("account_id", acc.id).eq("provider_thread_id", rm.providerThreadId).maybeSingle();
    if (t.data) byProviderThread.set(rm.providerThreadId, t.data.id as string);
  }
  if (ids.length) {
    const { data } = await db.from("email_messages").select("internet_message_id, thread_id").eq("account_id", acc.id).in("internet_message_id", ids);
    for (const r of data ?? []) byMessageId.set(r.internet_message_id as string, r.thread_id as string);
  }
  let threadId = pickThread({ providerThreadId: rm.providerThreadId, inReplyTo: p.inReplyTo, references: p.references }, { byProviderThread, byMessageId });
  if (!threadId) {
    const ins = await db.from("email_threads").insert({ organization_id: orgId, account_id: acc.id, provider_thread_id: rm.providerThreadId, subject: p.subject }).select("id").single();
    if (ins.error) {
      if (ins.error.code !== "23505" || !rm.providerThreadId) throw new Error("thread");
      const t = await db.from("email_threads").select("id").eq("account_id", acc.id).eq("provider_thread_id", rm.providerThreadId).single();
      threadId = t.data!.id as string;
    } else threadId = ins.data.id as string;
  }

  const text = p.text || (p.html ? htmlToText(p.html) : "");
  const at = (p.date ?? rm.internalDate ?? new Date()).toISOString();
  const msgIns = await db.from("email_messages").insert({
    organization_id: orgId, account_id: acc.id, thread_id: threadId, direction, provider_message_id: rm.providerMessageId, internet_message_id: mid, in_reply_to: p.inReplyTo,
    references_ids: p.references, from_address: p.from.address, from_name: p.from.name ?? null, to_addrs: p.to, cc_addrs: p.cc, bcc_addrs: [], subject: p.subject,
    snippet: snippetOf(text, 300), body_text: text, body_html: p.html, message_at: at, status: outbound ? "sent" : "received", is_read: outbound ? true : rm.isRead, has_attachments: p.attachments.length > 0,
  }).select("id").single();
  if (msgIns.error) { if (msgIns.error.code === "23505") return "duplicate"; throw new Error("message"); }
  const messageId = msgIns.data.id as string;

  for (const a of p.attachments) {
    const path = `${orgId}/email/${messageId}/${randomUUID()}-${safeFilename(a.filename)}`;
    const up = await db.storage.from(BUCKET).upload(path, a.content, { contentType: downloadMime(a.contentType), upsert: false });
    if (up.error) continue;
    await db.from("email_attachments").insert({ organization_id: orgId, message_id: messageId, filename: safeFilename(a.filename), mime_type: a.contentType, size_bytes: a.size, storage_path: path });
  }
  await autoLinkThread(orgId, threadId, counterparties({ direction, from: p.from, to: p.to, cc: p.cc }, [own]));
  return "new";
}

export type SyncSummary = { imported: number; duplicates: number; failed: number; hasMore: boolean; error?: string; skipped?: boolean };

/** Sincronizzazione di una casella (manuale, all'apertura o da pianificazione). Blocco anti-concorrenza: due sincronizzazioni insieme non si pestano i piedi. */
export async function syncAccount(accountId: string, opts: { limit?: number } = {}): Promise<SyncSummary> {
  const db = admin();
  const { data: claimed } = await db.rpc("rpc_email_claim_sync", { p_account: accountId });
  if (claimed !== true) return { imported: 0, duplicates: 0, failed: 0, hasMore: false, skipped: true };
  const { data: row } = await db.from("email_accounts").select("*").eq("id", accountId).maybeSingle();
  const acc = (row ?? null) as AccountRow | null;
  if (!acc) return { imported: 0, duplicates: 0, failed: 0, hasMore: false, skipped: true };
  const sum: SyncSummary = { imported: 0, duplicates: 0, failed: 0, hasMore: false };
  try {
    let secret = await loadSecret(acc.id);
    const res = await getProvider(acc.provider).sync(secret, toProviderAccount(acc), { limit: opts.limit ?? 60 });
    if (res.secret) { secret = res.secret; await storeSecret(acc.id, res.secret); }
    for (const rm of res.messages) {
      try { const r = await ingestRaw(acc, rm); if (r === "new") sum.imported++; else if (r === "duplicate") sum.duplicates++; }
      catch { sum.failed++; }
    }
    sum.hasMore = res.hasMore;
    await db.from("email_accounts").update({ sync_cursor: res.cursor, last_sync_at: new Date().toISOString(), last_sync_error: null, sync_failures: 0, status: "connected", status_detail: null, sync_started_at: null }).eq("id", acc.id);
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError("Errore imprevisto durante la sincronizzazione", "temporary");
    sum.error = pe.message;
    const failures = acc.sync_failures + 1;
    await db.from("email_accounts").update({
      last_sync_error: pe.message.slice(0, 290), sync_failures: failures, sync_started_at: null,
      status: pe.kind === "auth" ? "needs_reauth" : pe.kind === "config" ? "error" : failures >= 5 ? "error" : acc.status,
      status_detail: pe.kind === "auth" || pe.kind === "config" || failures >= 5 ? pe.message.slice(0, 290) : acc.status_detail,
    }).eq("id", acc.id);
  }
  return sum;
}

/** Caselle da aggiornare (usata dalla pianificazione esterna e dall'apertura della sezione). */
export async function syncDueAccounts(orgId: string | null, olderThanSeconds: number, budgetMs: number): Promise<{ accounts: number; imported: number }> {
  let q = admin().from("email_accounts").select("id").is("disconnected_at", null).in("status", ["connected", "error"]).order("last_sync_at", { ascending: true, nullsFirst: true }).limit(20);
  q = q.or(`last_sync_at.is.null,last_sync_at.lt.${new Date(Date.now() - olderThanSeconds * 1000).toISOString()}`);
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q;
  const start = Date.now();
  let n = 0, imported = 0;
  for (const a of data ?? []) {
    if (Date.now() - start > budgetMs) break;
    const r = await syncAccount(a.id as string);
    if (!r.skipped) { n++; imported += r.imported; }
  }
  return { accounts: n, imported };
}

/* ---------------------------------------------------------------- invio */
export type SendInput = {
  accountId: string; idempotencyKey: string; to: Addr[]; cc: Addr[]; bcc: Addr[]; subject: string; bodyHtml: string;
  replyToMessageId?: string | null; customerId?: string | null; quoteId?: string | null; markQuoteSent?: boolean;
  uploaded: { storage_path: string; name: string; mime: string; size: number }[]; attachQuotePdf?: boolean; documentIds: string[]; draftId?: string | null;
};
export type SendOutcome = { ok: true; messageId: string; threadId: string; duplicate?: boolean } | { ok: false; error: string; uncertain?: boolean };

type Ctx = { userId: string; org: { organizationId: string; name: string } };

async function uploadsFromBucket(orgId: string, userId: string, files: SendInput["uploaded"]): Promise<OutgoingAttachment[]> {
  const out: OutgoingAttachment[] = [];
  for (const f of files) {
    if (!f.storage_path.startsWith(`${orgId}/email-drafts/${userId}/`)) throw new Error("Allegato non valido");
    const { data, error } = await admin().storage.from(BUCKET).download(f.storage_path);
    if (error || !data) throw new Error(`Allegato non più disponibile: ${f.name}`);
    out.push({ filename: safeFilename(f.name), contentType: f.mime || "application/octet-stream", content: Buffer.from(await data.arrayBuffer()) });
  }
  return out;
}

export async function sendEmail(ctx: Ctx, db: SupabaseClient, input: SendInput, generateQuotePdf?: (quoteId: string) => Promise<{ bytes: Uint8Array; filename: string } | null>): Promise<SendOutcome> {
  const orgId = ctx.org.organizationId;
  const a = admin();
  // 1) casella: la lettura passa dalla RLS, quindi solo chi è autorizzato la vede
  const { data: acc } = await db.from("email_accounts").select("*").eq("id", input.accountId).eq("organization_id", orgId).is("disconnected_at", null).maybeSingle();
  if (!acc) return { ok: false, error: "Casella non trovata o non autorizzata" };
  const account = acc as AccountRow;
  if (account.status !== "connected") return { ok: false, error: account.status === "needs_reauth" ? "La casella richiede di essere ricollegata" : "La casella non è collegata correttamente" };
  const recipients = [...input.to, ...input.cc, ...input.bcc];
  if (input.to.length === 0) return { ok: false, error: "Indica almeno un destinatario" };
  if (recipients.length > 100) return { ok: false, error: "Troppi destinatari (massimo 100)" };
  const subject = input.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 998);
  const html = sanitizeEmailHtml(input.bodyHtml);
  const text = htmlToText(html);
  if (!subject && !text) return { ok: false, error: "Scrivi un oggetto o un testo" };

  // 2) idempotenza: la stessa richiesta non invia mai due volte
  const prev = await a.from("email_messages").select("id, thread_id, status").eq("organization_id", orgId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (prev.data) {
    if (prev.data.status === "sent") return { ok: true, messageId: prev.data.id as string, threadId: prev.data.thread_id as string, duplicate: true };
    return { ok: false, uncertain: true, error: "Un invio precedente non ha dato conferma: controlla la posta inviata prima di riprovare" };
  }

  // 3) risposta: conversazione e intestazioni
  let threadId: string | null = null, inReplyTo: string | null = null, references: string[] = [], providerThreadId: string | null = null, newThread = false;
  if (input.replyToMessageId) {
    const { data: orig } = await db.from("email_messages").select("thread_id, account_id, internet_message_id, references_ids, email_threads(provider_thread_id)").eq("id", input.replyToMessageId).eq("organization_id", orgId).maybeSingle();
    if (!orig) return { ok: false, error: "Messaggio originale non trovato o non autorizzato" };
    if (orig.account_id !== account.id) return { ok: false, error: "Per rispondere usa la casella della conversazione" };
    threadId = orig.thread_id as string;
    inReplyTo = (orig.internet_message_id as string | null) ?? null;
    references = [...parseReferences(orig.references_ids as string[]), ...(inReplyTo ? [inReplyTo] : [])].slice(-20);
    const t = Array.isArray(orig.email_threads) ? orig.email_threads[0] : orig.email_threads;
    providerThreadId = (t as { provider_thread_id: string | null } | null)?.provider_thread_id ?? null;
  }
  // 4) cliente: nessuna nuova comunicazione partita dai selettori verso clienti archiviati
  let customerId = input.customerId ?? null;
  if (customerId) {
    const { data: c } = await db.from("customers").select("id, archived_at, deleted_at").eq("organization_id", orgId).eq("id", customerId).maybeSingle();
    if (!c || c.deleted_at) return { ok: false, error: "Cliente non trovato" };
    if (c.archived_at) return { ok: false, error: "Il cliente è archiviato: ripristinalo prima di scrivergli" };
  }
  type QuoteRef = { id: string; customer_id: string; status: string };
  let quote = null as QuoteRef | null;
  if (input.quoteId) {
    const { data: q } = await db.from("quotes").select("id, customer_id, status").eq("organization_id", orgId).eq("id", input.quoteId).is("deleted_at", null).maybeSingle();
    if (!q) return { ok: false, error: "Preventivo non trovato" };
    if (customerId && q.customer_id !== customerId) return { ok: false, error: "Il preventivo appartiene a un altro cliente" };
    quote = q as QuoteRef; customerId = customerId ?? q.customer_id;
  }

  // 5) allegati
  const attachments: OutgoingAttachment[] = [];
  try { attachments.push(...await uploadsFromBucket(orgId, ctx.userId, input.uploaded)); } catch (e) { return { ok: false, error: (e as Error).message }; }
  if (input.attachQuotePdf && quote && generateQuotePdf) {
    const pdf = await generateQuotePdf(quote.id);
    if (pdf) attachments.push({ filename: pdf.filename, contentType: "application/pdf", content: Buffer.from(pdf.bytes) });
  }
  if (input.documentIds.length) {
    const { data: docs } = await db.from("documents").select("id, name, mime_type, storage_path").eq("organization_id", orgId).is("deleted_at", null).in("id", input.documentIds.slice(0, 10));
    for (const d of docs ?? []) {
      const dl = await a.storage.from("documents").download(d.storage_path as string);
      if (dl.data) attachments.push({ filename: safeFilename(d.name as string), contentType: d.mime_type as string, content: Buffer.from(await dl.data.arrayBuffer()) });
    }
  }
  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) return { ok: false, error: `Massimo ${MAX_ATTACHMENTS_PER_MESSAGE} allegati` };
  if (attachments.some((x) => isDangerousFile(x.filename))) return { ok: false, error: "Tipo di file non consentito tra gli allegati (eseguibili e script)" };
  if (attachments.reduce((n, x) => n + x.content.length, 0) > MAX_SEND_ATTACHMENTS_BYTES) return { ok: false, error: "Gli allegati superano 20 MB in totale" };

  // 6) registra il tentativo PRIMA di inviare
  if (!threadId) {
    const t = await a.from("email_threads").insert({ organization_id: orgId, account_id: account.id, subject }).select("id").single();
    if (t.error) return { ok: false, error: "Impossibile registrare la conversazione" };
    threadId = t.data.id as string; newThread = true;
  }
  const messageId = newMessageId(account.address);
  const from: Addr = { address: account.address, name: account.display_name ?? undefined };
  const ins = await a.from("email_messages").insert({
    organization_id: orgId, account_id: account.id, thread_id: threadId, direction: "outbound", internet_message_id: messageId, in_reply_to: inReplyTo, references_ids: references,
    from_address: account.address, from_name: account.display_name, to_addrs: input.to, cc_addrs: input.cc, bcc_addrs: input.bcc, subject, snippet: snippetOf(text, 300),
    body_text: text, body_html: html, status: "sending", idempotency_key: input.idempotencyKey, is_read: true, sent_by: ctx.userId, has_attachments: attachments.length > 0,
  }).select("id").single();
  if (ins.error) {
    if (newThread) await a.from("email_threads").delete().eq("id", threadId);
    return ins.error.code === "23505" ? { ok: false, uncertain: true, error: "Invio già in corso" } : { ok: false, error: "Impossibile registrare il messaggio" };
  }
  const rowId = ins.data.id as string;

  // 7) invio reale: solo dopo la conferma del provider il messaggio risulta inviato
  let result;
  try {
    let secret = await loadSecret(account.id);
    result = await getProvider(account.provider).send(secret, toProviderAccount(account), { from, to: input.to, cc: input.cc, bcc: input.bcc, subject, html, text, attachments, inReplyTo, references, providerThreadId, messageId });
    if (result.secret) { secret = result.secret; await storeSecret(account.id, result.secret); }
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError("Invio non riuscito", "temporary", true);
    if (pe.kind === "auth") await a.from("email_accounts").update({ status: "needs_reauth", status_detail: pe.message.slice(0, 290) }).eq("id", account.id);
    if (pe.uncertain) {
      await a.from("email_messages").update({ status: "failed", error: pe.message.slice(0, 290) }).eq("id", rowId);
      return { ok: false, uncertain: true, error: pe.message };
    }
    await a.from("email_messages").delete().eq("id", rowId);
    if (newThread) await a.from("email_threads").delete().eq("id", threadId);
    return { ok: false, error: pe.message };
  }

  // 8) esito: allegati, collegamenti, stato "inviato"
  for (const att of attachments) {
    const path = `${orgId}/email/${rowId}/${randomUUID()}-${safeFilename(att.filename)}`;
    const up = await a.storage.from(BUCKET).upload(path, att.content, { contentType: downloadMime(att.contentType), upsert: false });
    if (!up.error) await a.from("email_attachments").insert({ organization_id: orgId, message_id: rowId, filename: att.filename, mime_type: att.contentType, size_bytes: att.content.length, storage_path: path });
  }
  const link: Record<string, unknown> = {};
  if (result.providerThreadId && newThread) link.provider_thread_id = result.providerThreadId;
  const { data: thr } = await a.from("email_threads").select("customer_id, link_status, quote_id").eq("id", threadId).single();
  if (customerId && (!thr?.customer_id || thr.link_status !== "manual")) Object.assign(link, { customer_id: customerId, link_status: "manual", linked_by: ctx.userId, linked_at: new Date().toISOString(), link_candidates: [] });
  if (quote) link.quote_id = quote.id;
  if (Object.keys(link).length) await a.from("email_threads").update(link).eq("id", threadId);
  if (!customerId) await autoLinkThread(orgId, threadId, addrOnly([...input.to, ...input.cc]));
  await a.from("email_messages").update({ status: "sent", provider_message_id: result.providerMessageId, internet_message_id: result.internetMessageId ?? messageId, message_at: result.sentAt.toISOString() }).eq("id", rowId);
  if (quote && input.markQuoteSent && quote.status === "draft") await db.from("quotes").update({ status: "sent" }).eq("organization_id", orgId).eq("id", quote.id);
  for (const f of input.uploaded) await a.storage.from(BUCKET).remove([f.storage_path]);
  if (input.draftId) await db.from("email_drafts").delete().eq("id", input.draftId).eq("author_id", ctx.userId);
  return { ok: true, messageId: rowId, threadId };
}

export { addrsFromJson, textToHtml };

/** Lettura di un file del bucket privato (per il download autorizzato dalle route). */
export async function readStoredFile(path: string): Promise<Buffer | null> {
  const dl = await admin().storage.from(BUCKET).download(path);
  return dl.data ? Buffer.from(await dl.data.arrayBuffer()) : null;
}
/** Caricamento di un allegato di bozza nella cartella privata dell'utente. */
export async function storeDraftUpload(orgId: string, userId: string, name: string, content: Buffer, mime: string): Promise<{ storage_path: string } | null> {
  const path = `${orgId}/email-drafts/${userId}/${randomUUID()}-${name}`;
  const up = await admin().storage.from(BUCKET).upload(path, content, { contentType: mime, upsert: false });
  return up.error ? null : { storage_path: path };
}

/** Copia gli allegati di un messaggio nella cartella bozze dell'utente (per «Inoltra»). Passa dalla RLS: solo allegati visibili all'utente. */
export async function copyAttachmentsToDraft(db: SupabaseClient, orgId: string, userId: string, messageId: string): Promise<{ storage_path: string; name: string; mime: string; size: number }[]> {
  const { data } = await db.from("email_attachments").select("filename, mime_type, size_bytes, storage_path").eq("organization_id", orgId).eq("message_id", messageId).limit(MAX_ATTACHMENTS_PER_MESSAGE);
  const out: { storage_path: string; name: string; mime: string; size: number }[] = [];
  for (const a of data ?? []) {
    const bytes = await readStoredFile(a.storage_path as string);
    if (!bytes) continue;
    const st = await storeDraftUpload(orgId, userId, safeFilename(a.filename as string), bytes, a.mime_type as string);
    if (st) out.push({ storage_path: st.storage_path, name: a.filename as string, mime: a.mime_type as string, size: bytes.length });
  }
  return out;
}
