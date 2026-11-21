"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { accountEditSchema, composeSchema, connectImapSchema, linkSchema, signatureSchema, templateSchema } from "./schemas";
import { connectPasswordAccount, disconnectAccount } from "./accounts";
import { BUCKET, sendEmail, syncAccount } from "./service";
import { generateQuotePdf } from "@/modules/preventivi/pdf-data";
import { createAdminClient } from "@/server/supabase/admin";
import { addDays, todayIn, zonedToUtcIso } from "@/lib/datetime";
import { safeFilename } from "./limits";
import { DOCUMENT_MIME } from "@/lib/documents";
import { sanitizeEmailHtml } from "./sanitize";

const refresh = (extra: string[] = []) => { for (const p of ["/email", "/email/caselle", "/dashboard", ...extra]) revalidatePath(p); };

/* ---------------------------------------------------------------- caselle */
export async function connectImapAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  const parsed = connectImapSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Controlla i campi", fieldErrors(parsed.error));
  const r = await connectPasswordAccount({ userId: ctx.userId, orgId: ctx.org.organizationId, role: ctx.org.role }, parsed.data);
  if (!r.ok) return fail(r.error);
  refresh();
  redirect("/email/caselle?collegata=1");
}

async function ownAccount(id: string) {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return null;
  const db = await createClient();
  const { data } = await db.from("email_accounts").select("id, created_by, organization_id").eq("id", id).eq("organization_id", ctx.org.organizationId).maybeSingle();
  if (!data) return null;
  const manage = data.created_by === ctx.userId || can(ctx.org.role, "settings:manage");
  return { ctx, db, account: data, manage };
}

export async function disconnectAccountAction(id: string, _prev: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  const o = await ownAccount(id);
  if (!o || !o.manage) return fail("Non hai i permessi per disconnettere questa casella");
  await disconnectAccount(id);
  refresh();
  return { ok: true };
}

export async function syncAccountAction(id: string): Promise<void> {
  const o = await ownAccount(id);
  if (!o) return;
  await syncAccount(id, { limit: 80 });
  refresh();
}
/** Aggiorna tutte le caselle a cui l'utente ha accesso (pulsante «Sincronizza» e apertura della posta). */
export async function syncMineAction(): Promise<{ imported: number; busy: boolean }> {
  const ctx = await requirePermission("data:read");
  const db = await createClient();
  const { data } = await db.from("email_accounts").select("id").eq("organization_id", ctx.org.organizationId).is("disconnected_at", null).in("status", ["connected", "error"]);
  let imported = 0, busy = false;
  for (const a of data ?? []) { const r = await syncAccount(a.id as string, { limit: 60 }); imported += r.imported; if (r.skipped) busy = true; }
  refresh();
  return { imported, busy };
}

export async function updateAccountAction(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const o = await ownAccount(id);
  if (!o || !o.manage) return fail("Non hai i permessi per modificare questa casella");
  const p = accountEditSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Controlla i campi");
  const { error } = await o.db.from("email_accounts").update({ display_name: p.data.displayName, signature: p.data.signature, visibility: p.data.visibility }).eq("id", id);
  if (error) return fail("Impossibile salvare");
  refresh();
  return { ok: true };
}

export async function setDefaultAccountAction(id: string): Promise<void> {
  await requirePermission("settings:manage");
  if (!isUuid(id)) return;
  await (await createClient()).rpc("set_default_email_account", { p_account: id });
  refresh();
}

export async function addMemberAction(accountId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const o = await ownAccount(accountId);
  const userId = String(formData.get("userId") ?? "");
  if (!o || !o.manage || !isUuid(userId)) return fail("Operazione non consentita");
  const { error } = await o.db.from("email_account_members").insert({ account_id: accountId, organization_id: o.ctx.org.organizationId, user_id: userId });
  if (error) return fail(error.code === "23505" ? "Il collaboratore è già autorizzato" : "Impossibile autorizzare il collaboratore");
  refresh();
  return { ok: true };
}
export async function removeMemberAction(accountId: string, userId: string): Promise<void> {
  const o = await ownAccount(accountId);
  if (!o || !o.manage || !isUuid(userId)) return;
  await o.db.from("email_account_members").delete().eq("account_id", accountId).eq("user_id", userId);
  refresh();
}

export async function saveSignatureAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  const p = signatureSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Firma non valida");
  const { error } = await (await createClient()).from("email_user_signatures").upsert({ user_id: ctx.userId, organization_id: ctx.org.organizationId, signature: p.data.signature });
  if (error) return fail("Impossibile salvare la firma");
  refresh();
  return { ok: true };
}

/* ---------------------------------------------------------------- composizione, bozze, invio */
export async function sendEmailAction(_prev: ActionResult<{ uncertain?: boolean }> | null, formData: FormData): Promise<ActionResult<{ uncertain?: boolean }>> {
  const ctx = await requirePermission("data:write");
  const parsed = composeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Controlla i campi", fieldErrors(parsed.error));
  const d = parsed.data;
  const db = await createClient();
  const res = await sendEmail({ userId: ctx.userId, org: ctx.org }, db, {
    accountId: d.accountId, idempotencyKey: d.idempotencyKey, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, bodyHtml: d.bodyHtml, replyToMessageId: d.replyToMessageId,
    customerId: d.customerId, quoteId: d.quoteId, markQuoteSent: !!d.markQuoteSent, attachQuotePdf: !!d.attachQuotePdf, uploaded: d.uploaded, documentIds: d.documentIds, draftId: d.draftId,
  }, (qid) => generateQuotePdf(db, ctx.org.organizationId, ctx.org.name, qid));
  if (!res.ok) return { ok: false, error: res.error, data: { uncertain: res.uncertain } } as ActionResult<{ uncertain?: boolean }>;
  refresh([`/email/${res.threadId}`, "/preventivi", "/clienti"]);
  redirect(`/email/${res.threadId}?inviata=1`);
}

export type DraftPayload = {
  id?: string | null; accountId?: string | null; mode?: "new" | "reply" | "reply_all" | "forward"; replyToMessageId?: string | null; customerId?: string | null; quoteId?: string | null;
  to: string; cc: string; bcc: string; subject: string; bodyHtml: string; uploaded: { storage_path: string; name: string; mime: string; size: number }[]; attachQuotePdf?: boolean;
};
/** Salvataggio automatico: la bozza è privata dell'autore (RLS). */
export async function saveDraftAction(p: DraftPayload): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requirePermission("data:write");
  const { parseAddressList } = await import("./addresses");
  const db = await createClient();
  const row = {
    organization_id: ctx.org.organizationId, author_id: ctx.userId, account_id: isUuid(p.accountId) ? p.accountId : null, mode: p.mode ?? "new",
    reply_to_message_id: isUuid(p.replyToMessageId) ? p.replyToMessageId : null, customer_id: isUuid(p.customerId) ? p.customerId : null, quote_id: isUuid(p.quoteId) ? p.quoteId : null,
    to_addrs: parseAddressList(p.to ?? "").ok, cc_addrs: parseAddressList(p.cc ?? "").ok, bcc_addrs: parseAddressList(p.bcc ?? "").ok, subject: (p.subject ?? "").slice(0, 998),
    body_html: sanitizeEmailHtml((p.bodyHtml ?? "").slice(0, 300_000)), attachments: (p.uploaded ?? []).slice(0, 20), options: { attachQuotePdf: !!p.attachQuotePdf },
  };
  if (isUuid(p.id)) {
    const { data, error } = await db.from("email_drafts").update(row).eq("id", p.id).eq("author_id", ctx.userId).select("id");
    return error || !data?.length ? { ok: false, error: "Bozza non trovata" } : { ok: true, id: p.id };
  }
  const { data, error } = await db.from("email_drafts").insert(row).select("id").single();
  if (error || !data) return { ok: false, error: "Impossibile salvare la bozza" };
  revalidatePath("/email");
  return { ok: true, id: data.id as string };
}

export async function deleteDraftAction(id: string, _prev: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Bozza non valida");
  const db = await createClient();
  const { data } = await db.from("email_drafts").select("attachments").eq("id", id).eq("author_id", ctx.userId).maybeSingle();
  if (!data) return fail("Bozza non trovata");
  const paths = ((data.attachments ?? []) as { storage_path: string }[]).map((a) => a.storage_path).filter((p) => p.startsWith(`${ctx.org.organizationId}/email-drafts/${ctx.userId}/`));
  if (paths.length) await createAdminClient().storage.from(BUCKET).remove(paths);
  await db.from("email_drafts").delete().eq("id", id).eq("author_id", ctx.userId);
  revalidatePath("/email");
  return { ok: true };
}

/* ---------------------------------------------------------------- lettura e collegamenti */
export async function markThreadReadAction(threadId: string, read: boolean): Promise<void> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(threadId)) return;
  await (await createClient()).from("email_messages").update({ is_read: read }).eq("organization_id", ctx.org.organizationId).eq("thread_id", threadId).eq("direction", "inbound");
  refresh();
}

async function threadFor(threadId: string) {
  const ctx = await requirePermission("data:write");
  if (!isUuid(threadId)) return null;
  const db = await createClient();
  const { data } = await db.from("email_threads").select("id, subject, customer_id, contact_id, task_id, follow_up_id, quote_id").eq("id", threadId).eq("organization_id", ctx.org.organizationId).maybeSingle();
  return data ? { ctx, db, thread: data } : null;
}
function linkError(code?: string, message?: string) {
  if (code === "23514") {
    if (message?.includes("archived")) return "Il cliente è archiviato: ripristinalo prima di collegargli nuove email";
    if (message?.includes("contact")) return "Il referente non appartiene a questo cliente";
    if (message?.includes("quote")) return "Il preventivo non appartiene a questo cliente";
    return "Collegamento non coerente con il cliente";
  }
  return "Impossibile aggiornare il collegamento";
}
export async function linkThreadAction(threadId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await threadFor(threadId);
  if (!t) return fail("Conversazione non trovata o non autorizzata");
  const p = linkSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return fail("Valori non validi");
  if (!p.data.customerId && (p.data.contactId || p.data.quoteId)) return fail("Scegli prima il cliente");
  const { error } = await t.db.from("email_threads").update({ customer_id: p.data.customerId, contact_id: p.data.contactId, quote_id: p.data.quoteId }).eq("id", threadId);
  if (error) return fail(linkError(error.code, error.message));
  refresh([`/email/${threadId}`, "/clienti"]);
  return { ok: true };
}
export async function unlinkThreadAction(threadId: string, _prev: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  const t = await threadFor(threadId);
  if (!t) return fail("Conversazione non trovata o non autorizzata");
  const { error } = await t.db.from("email_threads").update({ customer_id: null, contact_id: null, quote_id: null }).eq("id", threadId);
  if (error) return fail(linkError(error.code, error.message));
  refresh([`/email/${threadId}`, "/clienti"]);
  return { ok: true };
}
/** Conferma una proposta di collegamento (indirizzo associato a più clienti). */
export async function confirmSuggestionAction(threadId: string, customerId: string, contactId: string | null): Promise<ActionResult> {
  const t = await threadFor(threadId);
  if (!t || !isUuid(customerId)) return fail("Operazione non valida");
  const { error } = await t.db.from("email_threads").update({ customer_id: customerId, contact_id: isUuid(contactId) ? contactId : null }).eq("id", threadId);
  if (error) return fail(linkError(error.code, error.message));
  refresh([`/email/${threadId}`, "/clienti"]);
  return { ok: true };
}

/* ---------------------------------------------------------------- attività e follow-up da un'email (senza duplicati) */
export async function createTaskFromEmailAction(threadId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await threadFor(threadId);
  if (!t) return fail("Conversazione non trovata o non autorizzata");
  if (t.thread.task_id) return fail("Esiste già un'attività collegata a questa conversazione");
  const title = String(formData.get("title") ?? "").trim().slice(0, 200) || `Rispondere a: ${String(t.thread.subject).slice(0, 150)}`;
  const { data: task, error } = await t.db.from("tasks").insert({
    organization_id: t.ctx.org.organizationId, title, description: `Da email: ${t.thread.subject}`, customer_id: t.thread.customer_id, contact_id: t.thread.contact_id, created_by: t.ctx.userId, assignee_id: t.ctx.userId,
    due_at: zonedToUtcIso(`${addDays(todayIn(new Date()), 1)}T09:00`), priority: "normal",
  }).select("id").single();
  if (error || !task) return fail(error?.code === "23514" ? "Il cliente è archiviato: ripristinalo prima di creare nuove attività" : "Impossibile creare l'attività");
  // il collegamento impedisce di creare un secondo record per la stessa conversazione
  const { error: le } = await t.db.from("email_threads").update({ task_id: task.id }).eq("id", threadId).is("task_id", null);
  if (le) return fail("Attività creata ma non collegata alla conversazione");
  refresh([`/email/${threadId}`, "/attivita", "/promemoria"]);
  return { ok: true };
}
export async function createFollowUpFromEmailAction(threadId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await threadFor(threadId);
  if (!t) return fail("Conversazione non trovata o non autorizzata");
  if (t.thread.follow_up_id) return fail("Esiste già un follow-up collegato a questa conversazione");
  if (!t.thread.customer_id) return fail("Collega prima la conversazione a un cliente");
  const title = String(formData.get("title") ?? "").trim().slice(0, 200) || `Ricontatto: ${String(t.thread.subject).slice(0, 150)}`;
  const days = Math.min(60, Math.max(1, Number(formData.get("days") ?? 3) || 3));
  const { data: fu, error } = await t.db.from("follow_ups").insert({
    organization_id: t.ctx.org.organizationId, customer_id: t.thread.customer_id, contact_id: t.thread.contact_id, quote_id: t.thread.quote_id, title, reason: `Da email: ${String(t.thread.subject).slice(0, 250)}`,
    due_on: addDays(todayIn(new Date()), days), assignee_id: t.ctx.userId, status: "scheduled", created_by: t.ctx.userId,
  }).select("id").single();
  if (error || !fu) return fail(error?.code === "23514" ? "Il cliente è archiviato: ripristinalo prima di creare nuovi follow-up" : "Impossibile creare il follow-up");
  const { error: le } = await t.db.from("email_threads").update({ follow_up_id: fu.id }).eq("id", threadId).is("follow_up_id", null);
  if (le) return fail("Follow-up creato ma non collegato alla conversazione");
  refresh([`/email/${threadId}`, "/followup", "/promemoria"]);
  return { ok: true };
}
export async function linkExistingAction(threadId: string, kind: "task" | "follow_up", _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await threadFor(threadId);
  const id = String(formData.get("id") ?? "");
  if (!t || !isUuid(id)) return fail("Operazione non valida");
  const col = kind === "task" ? "task_id" : "follow_up_id";
  const { error } = await t.db.from("email_threads").update({ [col]: id }).eq("id", threadId);
  if (error) return fail(error.code === "23514" ? "L'elemento appartiene a un altro cliente" : "Impossibile collegare");
  refresh([`/email/${threadId}`]);
  return { ok: true };
}

/* ---------------------------------------------------------------- allegati → documenti del CRM */
export async function saveAttachmentToDocumentsAction(attachmentId: string, _prev: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(attachmentId)) return fail("Allegato non valido");
  const db = await createClient();
  const { data: att } = await db.from("email_attachments").select("id, filename, mime_type, size_bytes, storage_path, message_id").eq("id", attachmentId).maybeSingle();
  if (!att) return fail("Allegato non trovato o non autorizzato");
  const { data: msg } = await db.from("email_messages").select("thread_id, email_threads(customer_id)").eq("id", att.message_id as string).maybeSingle();
  const th = msg ? (Array.isArray(msg.email_threads) ? msg.email_threads[0] : msg.email_threads) : null;
  const customerId = (th as { customer_id: string | null } | null)?.customer_id ?? null;
  if (!DOCUMENT_MIME[att.mime_type as string]) return fail("Questo tipo di file non è archiviabile tra i documenti (PDF, immagini, Word, Excel, testo)");
  const admin = createAdminClient();
  const dl = await admin.storage.from(BUCKET).download(att.storage_path as string);
  if (!dl.data) return fail("File non disponibile");
  const bytes = Buffer.from(await dl.data.arrayBuffer());
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const { data: dup } = await db.from("documents").select("id").eq("organization_id", ctx.org.organizationId).eq("content_hash", hash).is("deleted_at", null).limit(1).maybeSingle();
  if (dup) return fail("Questo file è già presente nell'archivio documenti");
  const path = `${ctx.org.organizationId}/${randomUUID()}-${safeFilename(att.filename as string)}`;
  const up = await admin.storage.from("documents").upload(path, bytes, { contentType: att.mime_type as string, upsert: false });
  if (up.error) return fail("Impossibile archiviare il file");
  const { error } = await db.from("documents").insert({
    organization_id: ctx.org.organizationId, name: safeFilename(att.filename as string), storage_path: path, mime_type: att.mime_type, size_bytes: bytes.length,
    customer_id: customerId, uploaded_by: ctx.userId, content_hash: hash, description: "Allegato email",
  });
  if (error) { await admin.storage.from("documents").remove([path]); return fail("Impossibile registrare il documento"); }
  revalidatePath("/documenti");
  return { ok: true };
}

/* ---------------------------------------------------------------- modelli */
export async function saveTemplateAction(id: string | null, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  const p = templateSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Controlla i campi");
  const db = await createClient();
  const row = { name: p.data.name, subject: p.data.subject, body_html: sanitizeEmailHtml(p.data.bodyHtml) };
  const res = id && isUuid(id)
    ? await db.from("email_templates").update(row).eq("id", id).eq("organization_id", ctx.org.organizationId)
    : await db.from("email_templates").insert({ ...row, organization_id: ctx.org.organizationId, created_by: ctx.userId });
  if (res.error) return fail(res.error.code === "23505" ? "Esiste già un modello con questo nome" : "Impossibile salvare il modello");
  revalidatePath("/email/modelli");
  return { ok: true };
}
export async function deleteTemplateAction(id: string, _prev: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:delete");
  if (!isUuid(id)) return fail("Modello non valido");
  const { error } = await (await createClient()).from("email_templates").delete().eq("id", id).eq("organization_id", ctx.org.organizationId);
  if (error) return fail("Impossibile eliminare il modello");
  revalidatePath("/email/modelli");
  return { ok: true };
}

/* ---------------------------------------------------------------- analisi AI (propone, non esegue) */
export async function analyzeEmailAction(messageId: string, scope: "message" | "thread"): Promise<{ ok: true; analysis: import("./analysis").EmailAnalysis } | { ok: false; error: string }> {
  const ctx = await requirePermission("ai:use");
  if (!isUuid(messageId)) return { ok: false, error: "Messaggio non valido" };
  const { analyzeEmail } = await import("./analysis");
  return analyzeEmail(await createClient(), { userId: ctx.userId, orgId: ctx.org.organizationId }, messageId, scope === "thread" ? "thread" : "message");
}
