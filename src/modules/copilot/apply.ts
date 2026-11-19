import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dueAtFromDate } from "@/modules/attivita/schemas";
import { resolveByName } from "./packs";

type Result = { ok: true; redirectTo?: string } | { ok: false; error: string };
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today = () => new Date().toISOString().slice(0, 10);

async function customerByName(db: SupabaseClient, orgId: string, name: string | undefined) {
  const { data } = await db.from("customers").select("id, name").eq("organization_id", orgId).is("deleted_at", null).limit(500);
  return resolveByName((data ?? []) as { id: string; name: string }[], name);
}
async function quoteByNumber(db: SupabaseClient, orgId: string, number: string | undefined) {
  if (!number) return null;
  const { data } = await db.from("quotes").select("id, customer_id, status").eq("organization_id", orgId).eq("number", number).is("deleted_at", null).maybeSingle();
  return data as { id: string; customer_id: string; status: string } | null;
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
    const q = await quoteByNumber(db, orgId, str("quote_number"));
    if (q) { quoteId = q.id; customerId = q.customer_id; }
    const c = await customerByName(db, orgId, str("customer_name"));
    if (kind === "customer_followup" && !c) return { ok: false, error: "Cliente non trovato o ambiguo: crea l'attività a mano dalla scheda cliente." };
    if (c && (!customerId || customerId === c.id)) customerId = c.id;
    const { error } = await db.from("tasks").insert({
      organization_id: orgId, title, description: str("description") ?? null, due_at: dueAtFromDate(dueRaw ?? null),
      customer_id: customerId, quote_id: customerId && q && q.customer_id === customerId ? quoteId : null, created_by: userId, assignee_id: userId,
    });
    return error ? { ok: false, error: "Impossibile creare l'attività" } : { ok: true, redirectTo: "/attivita" };
  }

  if (kind === "quote_followup") {
    const date = str("follow_up_date");
    if (!date || !iso.safeParse(date).success) return { ok: false, error: "Data non valida" };
    if (date < today()) return { ok: false, error: "La data di follow-up non può essere nel passato" };
    const q = await quoteByNumber(db, orgId, str("quote_number"));
    if (!q) return { ok: false, error: "Preventivo non trovato" };
    if (q.status !== "draft" && q.status !== "sent") return { ok: false, error: "Il preventivo è già chiuso: non serve un follow-up" };
    const { error } = await db.from("quotes").update({ follow_up_date: date }).eq("organization_id", orgId).eq("id", q.id);
    return error ? { ok: false, error: "Impossibile impostare il follow-up" } : { ok: true, redirectTo: `/preventivi/${q.id}` };
  }

  if (kind === "customer_note") {
    const body = str("body");
    if (!body || body.length > 4000) return { ok: false, error: "Testo della nota non valido" };
    const c = await customerByName(db, orgId, str("customer_name"));
    if (!c) return { ok: false, error: "Cliente non trovato o ambiguo" };
    const { error } = await db.from("customer_notes").insert({ organization_id: orgId, customer_id: c.id, body, created_by: userId });
    return error ? { ok: false, error: "Impossibile aggiungere la nota" } : { ok: true, redirectTo: `/clienti/${c.id}` };
  }

  return { ok: false, error: "Questo tipo di proposta si gestisce da una schermata dedicata" };
}
