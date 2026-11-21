import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dueAtFromParts } from "@/modules/attivita/schemas";
import { resolveByName } from "./packs";
import { zonedToUtcIso } from "@/lib/datetime";
import { sanitizeEmailHtml } from "@/modules/email/sanitize";
import { escapeHtml } from "@/modules/email/sanitize";

type Result = { ok: true; redirectTo?: string; summary?: string } | { ok: false; error: string };
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today = () => new Date().toISOString().slice(0, 10);

async function customerByName(db: SupabaseClient, orgId: string, name: string | undefined) {
  const { data } = await db.from("customers").select("id, name").eq("organization_id", orgId).is("deleted_at", null).is("archived_at", null).limit(500);
  return resolveByName((data ?? []) as { id: string; name: string }[], name);
}
async function quoteByNumber(db: SupabaseClient, orgId: string, number: string | undefined) {
  if (!number) return null;
  const { data } = await db.from("quotes").select("id, customer_id, status").eq("organization_id", orgId).eq("number", number).is("deleted_at", null).maybeSingle();
  return data as { id: string; customer_id: string; status: string } | null;
}
async function quoteById(db: SupabaseClient, orgId: string, id: string | undefined) {
  if (!id) return null;
  const { data } = await db.from("quotes").select("id, customer_id, status, number").eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  return data as { id: string; customer_id: string; status: string; number: string } | null;
}
/** I riferimenti proposti dal modello contano solo se esistono davvero nell'organizzazione (client dell'utente, RLS). */
async function customerById(db: SupabaseClient, orgId: string, id: string | undefined) {
  if (!id) return null;
  const { data } = await db.from("customers").select("id, name").eq("organization_id", orgId).eq("id", id).is("deleted_at", null).is("archived_at", null).maybeSingle();
  return data as { id: string; name: string } | null;
}

/**
 * Applica una proposta del Copilot DOPO la conferma dell'utente. I riferimenti per nome vengono risolti qui,
 * lato server, sui dati dell'organizzazione (mai ci si fida di identificativi forniti dal modello).
 * `overrides` contiene le eventuali modifiche apportate dall'utente prima di confermare.
 */
export async function applySuggestion(args: {
  db: SupabaseClient; orgId: string; userId: string; kind: string; payload: unknown; overrides: Record<string, string>;
}): Promise<Result> {
  const { db, orgId, userId, kind, overrides } = args;
  const p = (args.payload ?? {}) as Record<string, unknown>;
  const str = (k: string) => (overrides[k] ?? (typeof p[k] === "string" ? (p[k] as string) : undefined))?.trim() || undefined;

  if (kind === "insight") return { ok: true };

  if (kind === "task" || kind === "customer_followup") {
    const title = str("title");
    if (!title || title.length > 200) return { ok: false, error: "Titolo non valido" };
    const dueRaw = str("due_date");
    if (dueRaw && !iso.safeParse(dueRaw).success) return { ok: false, error: "Data non valida" };
    let customerId: string | null = null, quoteId: string | null = null;
    const q = (await quoteById(db, orgId, str("quote_id"))) ?? (await quoteByNumber(db, orgId, str("quote_number")));
    if (q) { quoteId = q.id; customerId = q.customer_id; }
    const c = (await customerById(db, orgId, str("customer_id"))) ?? (await customerByName(db, orgId, str("customer_name")));
    if (kind === "customer_followup" && !c) return { ok: false, error: "Cliente non trovato o ambiguo: crea l'attività a mano dalla scheda cliente." };
    if (c && (!customerId || customerId === c.id)) customerId = c.id;
    const { data: dupT } = await db.from("tasks").select("id").eq("organization_id", orgId).ilike("title", title.replace(/[%_]/g, " ")).is("deleted_at", null).in("status", ["todo", "in_progress"]).eq("customer_id", customerId ?? "00000000-0000-0000-0000-000000000000").limit(1);
    if (customerId && dupT?.length) return { ok: true, redirectTo: "/attivita", summary: "Esisteva già un'attività identica per questo cliente: non ne ho creata un'altra." };
    const { error } = await db.from("tasks").insert({
      organization_id: orgId, title, description: str("description") ?? null, due_at: dueAtFromParts(dueRaw ?? null, null).dueAt,
      customer_id: customerId, quote_id: customerId && q && q.customer_id === customerId ? quoteId : null, created_by: userId, assignee_id: userId,
    });
    return error ? { ok: false, error: "Impossibile creare l'attività" } : { ok: true, redirectTo: "/attivita" };
  }

  if (kind === "quote_followup") {
    const date = str("follow_up_date");
    if (!date || !iso.safeParse(date).success) return { ok: false, error: "Data non valida" };
    if (date < today()) return { ok: false, error: "La data di follow-up non può essere nel passato" };
    const q = (await quoteById(db, orgId, str("quote_id"))) ?? (await quoteByNumber(db, orgId, str("quote_number")));
    if (!q) return { ok: false, error: "Preventivo non trovato" };
    if (q.status !== "draft" && q.status !== "sent") return { ok: false, error: "Il preventivo è già chiuso: non serve un follow-up" };
    const { error } = await db.from("quotes").update({ follow_up_date: date }).eq("organization_id", orgId).eq("id", q.id);
    return error ? { ok: false, error: "Impossibile impostare il follow-up" } : { ok: true, redirectTo: `/preventivi/${q.id}` };
  }

  if (kind === "customer_note") {
    const body = str("body");
    if (!body || body.length > 4000) return { ok: false, error: "Testo della nota non valido" };
    const c = (await customerById(db, orgId, str("customer_id"))) ?? (await customerByName(db, orgId, str("customer_name")));
    if (!c) return { ok: false, error: "Cliente non trovato o ambiguo" };
    const { error } = await db.from("customer_notes").insert({ organization_id: orgId, customer_id: c.id, body, created_by: userId });
    return error ? { ok: false, error: "Impossibile aggiungere la nota" } : { ok: true, redirectTo: `/clienti/${c.id}` };
  }


  if (kind === "follow_up") {
    const title = str("title");
    if (!title || title.length > 200) return { ok: false, error: "Titolo non valido" };
    const due = str("due_date");
    if (!due || !iso.safeParse(due).success) return { ok: false, error: "Data non valida" };
    if (due < today()) return { ok: false, error: "La data del follow-up non può essere nel passato" };
    const c = await customerById(db, orgId, str("customer_id"));
    if (!c) return { ok: false, error: "Cliente non trovato o archiviato" };
    const q = await quoteById(db, orgId, str("quote_id"));
    if (str("quote_id") && (!q || q.customer_id !== c.id)) return { ok: false, error: "Il preventivo non appartiene al cliente" };
    // nessun duplicato: stesso cliente, stesso titolo, stessa data, ancora aperto
    const { data: dup } = await db.from("follow_ups").select("id").eq("organization_id", orgId).eq("customer_id", c.id).eq("due_on", due).ilike("title", title.replace(/[%_]/g, " ")).is("deleted_at", null).in("status", ["todo", "scheduled", "in_progress", "waiting"]).limit(1);
    if (dup?.length) return { ok: true, redirectTo: "/followup", summary: `Esisteva già un follow-up identico per ${c.name}: non ne ho creato un altro.` };
    const { error } = await db.from("follow_ups").insert({ organization_id: orgId, customer_id: c.id, quote_id: q?.id ?? null, title, reason: str("reason") ?? null, due_on: due, assignee_id: userId, created_by: userId });
    return error ? { ok: false, error: "Impossibile creare il follow-up" } : { ok: true, redirectTo: "/followup", summary: `Follow-up creato per ${c.name} il ${due}.` };
  }

  if (kind === "appointment") {
    const title = str("title"), date = str("date"), start = str("start_time");
    if (!title || title.length > 200) return { ok: false, error: "Titolo non valido" };
    if (!date || !iso.safeParse(date).success || date < today()) return { ok: false, error: "Data non valida o nel passato" };
    if (!start || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return { ok: false, error: "Ora non valida" };
    const dur = Math.min(480, Math.max(15, Number(p.duration_min ?? 60) || 60));
    const startsAt = zonedToUtcIso(`${date}T${start}`);
    if (!startsAt) return { ok: false, error: "Data non valida" };
    const endsAt = new Date(new Date(startsAt).getTime() + dur * 60_000).toISOString();
    const c = str("customer_id") ? await customerById(db, orgId, str("customer_id")) : null;
    if (str("customer_id") && !c) return { ok: false, error: "Cliente non trovato o archiviato" };
    const { data: dup } = await db.from("appointments").select("id").eq("organization_id", orgId).eq("starts_at", startsAt).ilike("title", title.replace(/[%_]/g, " ")).is("deleted_at", null).neq("status", "cancelled").limit(1);
    if (dup?.length) return { ok: true, redirectTo: `/appuntamenti/${dup[0]!.id}`, summary: "Esisteva già un appuntamento identico: non ne ho creato un altro." };
    const { data, error } = await db.from("appointments").insert({ organization_id: orgId, title, customer_id: c?.id ?? null, starts_at: startsAt, ends_at: endsAt, location: str("location") ?? null, notes: str("notes") ?? null, assignee_id: userId, created_by: userId }).select("id").single();
    return error || !data ? { ok: false, error: "Impossibile creare l'appuntamento" } : { ok: true, redirectTo: `/appuntamenti/${data.id}`, summary: `Appuntamento creato il ${date} alle ${start}.` };
  }

  if (kind === "catalog_update") {
    const id = str("product_id");
    if (!id) return { ok: false, error: "Voce di catalogo non valida" };
    const patch: Record<string, string | null> = {};
    if (p.description !== undefined) patch.description = (str("description") ?? "").slice(0, 1000) || null;
    if (p.category !== undefined) patch.category = (str("category") ?? "").slice(0, 80) || null;
    if (!Object.keys(patch).length) return { ok: false, error: "Nessuna modifica da applicare" };
    const { data, error } = await db.from("products").update(patch).eq("organization_id", orgId).eq("id", id).is("deleted_at", null).select("id").maybeSingle();
    return error || !data ? { ok: false, error: "Impossibile aggiornare la voce di catalogo" } : { ok: true, redirectTo: "/catalogo", summary: "Voce di catalogo aggiornata." };
  }

  if (kind === "quote_update") {
    const q = await quoteById(db, orgId, str("quote_id"));
    if (!q) return { ok: false, error: "Preventivo non trovato" };
    if (q.status !== "draft") return { ok: false, error: "Solo i preventivi in bozza si possono modificare" };
    const patch: Record<string, string | null> = {};
    if (p.title !== undefined) patch.title = (str("title") ?? "").slice(0, 200) || null;
    if (p.notes !== undefined) patch.notes = (str("notes") ?? "").slice(0, 2000) || null;
    if (p.terms !== undefined) patch.terms = (str("terms") ?? "").slice(0, 2000) || null;
    if (!Object.keys(patch).length) return { ok: false, error: "Nessuna modifica da applicare" };
    const { error } = await db.from("quotes").update(patch).eq("organization_id", orgId).eq("id", q.id).eq("status", "draft");
    return error ? { ok: false, error: "Impossibile modificare il preventivo" } : { ok: true, redirectTo: `/preventivi/${q.id}`, summary: `Preventivo ${q.number} aggiornato.` };
  }

  if (kind === "email_draft") {
    // crea SOLO una bozza dell'utente: l'invio avviene dal compositore, con la conferma esplicita dell'utente
    const subject = str("subject"), body = str("body");
    if (!subject || !body) return { ok: false, error: "Oggetto e testo sono obbligatori" };
    const accountId = str("account_id");
    if (!accountId) return { ok: false, error: "Nessuna casella email selezionata" };
    const { data: acc } = await db.from("email_accounts").select("id").eq("organization_id", orgId).eq("id", accountId).eq("status", "connected").is("disconnected_at", null).maybeSingle();
    if (!acc) return { ok: false, error: "La casella non è disponibile o non hai accesso" };
    const to = str("to");
    const html = sanitizeEmailHtml(body.split(/\n{2,}/).map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`).join(""));
    const { data, error } = await db.from("email_drafts").insert({
      organization_id: orgId, author_id: userId, account_id: acc.id, mode: str("mode") === "reply" ? "reply" : "new", thread_id: str("thread_id") ?? null, reply_to_message_id: str("reply_to_message_id") ?? null,
      customer_id: str("customer_id") ?? null, quote_id: str("quote_id") ?? null, to_addrs: to ? [{ address: to, ...(str("to_name") ? { name: str("to_name") } : {}) }] : [], subject: subject.slice(0, 200), body_html: html,
    }).select("id").single();
    return error || !data ? { ok: false, error: "Impossibile creare la bozza email" } : { ok: true, redirectTo: `/email/nuova?bozza=${data.id}`, summary: "Bozza email creata: aprila, controllala e inviala tu." };
  }

  return { ok: false, error: "Questo tipo di proposta si gestisce da una schermata dedicata" };
}
