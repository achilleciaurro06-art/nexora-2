import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIn } from "@/lib/datetime";
import { isValidEmail } from "@/modules/email/addresses";
import { replySubject } from "@/modules/email/compose";
import { PROPOSAL_LABEL, proposalSchema, proposalDetails, type ProposalDetail } from "./proposals";

export type PreparedProposal = { id: string; kind: string; label: string; description: string; details: ProposalDetail[]; status: "pending"; execution_status: "not_run" };
type Ctx = { db: SupabaseClient; orgId: string; userId: string; now?: Date };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

async function customerOf(c: Ctx, id: string | undefined) {
  if (!id) return null;
  const { data } = await c.db.from("customers").select("id, name, email").eq("organization_id", c.orgId).eq("id", id).is("deleted_at", null).is("archived_at", null).maybeSingle();
  return data as { id: string; name: string; email: string | null } | null;
}
async function quoteOf(c: Ctx, id: string | undefined) {
  if (!id) return null;
  const { data } = await c.db.from("quotes").select("id, number, status, customer_id, title, customers(name)").eq("organization_id", c.orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  return data as { id: string; number: string; status: string; customer_id: string; title: string | null; customers: { name: string } | { name: string }[] | null } | null;
}

/**
 * Valida e risolve una proposta del modello sui dati reali dell'organizzazione (client dell'utente: RLS).
 * Id inesistenti o di altri tenant → proposta scartata. I destinatari delle email non arrivano mai dal modello:
 * derivano dalla conversazione o dall'anagrafica del cliente.
 */
export async function resolveProposal(c: Ctx, raw: unknown): Promise<{ ok: true; kind: string; payload: Record<string, unknown>; description: string } | { ok: false; reason: string }> {
  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "proposta non valida" };
  const p = parsed.data;
  const today = todayIn(c.now ?? new Date());
  const futureOk = (d: string | undefined) => !d || d >= today;
  switch (p.kind) {
    case "task": {
      if (!futureOk(p.due_date)) return { ok: false, reason: "data nel passato" };
      const cu = await customerOf(c, p.customer_id); const qu = await quoteOf(c, p.quote_id);
      if (p.customer_id && !cu) return { ok: false, reason: "cliente non trovato" };
      if (p.quote_id && !qu) return { ok: false, reason: "preventivo non trovato" };
      return { ok: true, kind: p.kind, payload: { ...p, customer_label: cu?.name ?? null, quote_label: qu ? `Preventivo ${qu.number}` : null }, description: `Crea l'attività «${p.title}»${cu ? ` per ${cu.name}` : ""}${p.due_date ? ` entro il ${p.due_date}` : ""}` };
    }
    case "follow_up": {
      if (p.due_date < today) return { ok: false, reason: "data nel passato" };
      const cu = await customerOf(c, p.customer_id);
      if (!cu) return { ok: false, reason: "cliente non trovato o archiviato" };
      const qu = await quoteOf(c, p.quote_id);
      if (p.quote_id && (!qu || qu.customer_id !== cu.id)) return { ok: false, reason: "preventivo non del cliente" };
      return { ok: true, kind: p.kind, payload: { ...p, customer_label: cu.name, quote_label: qu ? `Preventivo ${qu.number}` : null }, description: `Programma un follow-up con ${cu.name} per il ${p.due_date}` };
    }
    case "quote_followup": {
      if (p.follow_up_date < today) return { ok: false, reason: "data nel passato" };
      const qu = await quoteOf(c, p.quote_id);
      if (!qu) return { ok: false, reason: "preventivo non trovato" };
      if (qu.status !== "draft" && qu.status !== "sent") return { ok: false, reason: "preventivo già chiuso" };
      return { ok: true, kind: p.kind, payload: { ...p, quote_label: `Preventivo ${qu.number} · ${one(qu.customers)?.name ?? ""}` }, description: `Imposta il follow-up del preventivo ${qu.number} al ${p.follow_up_date}` };
    }
    case "customer_note": {
      const cu = await customerOf(c, p.customer_id);
      if (!cu) return { ok: false, reason: "cliente non trovato o archiviato" };
      return { ok: true, kind: p.kind, payload: { ...p, customer_label: cu.name }, description: `Aggiungi una nota alla scheda di ${cu.name}` };
    }
    case "email_draft": {
      let customerId = p.customer_id ?? null, quoteId = p.quote_id ?? null, to: string | null = null, accountId: string | null = null, replyTo: string | null = null, threadId: string | null = null, subject = p.subject, mode = "new", toName: string | null = null;
      if (p.thread_id) {
        const { data: t } = await c.db.from("email_threads").select("id, account_id, customer_id, quote_id, subject").eq("organization_id", c.orgId).eq("id", p.thread_id).maybeSingle();
        if (!t) return { ok: false, reason: "conversazione non accessibile" };
        const { data: m } = await c.db.from("email_messages").select("id, from_address, from_name, to_addrs, direction, subject").eq("organization_id", c.orgId).eq("thread_id", t.id).eq("direction", "inbound").order("message_at", { ascending: false }).limit(1).maybeSingle();
        if (!m) return { ok: false, reason: "nessun messaggio ricevuto a cui rispondere" };
        if (!isValidEmail(m.from_address as string)) return { ok: false, reason: "mittente non valido" };
        accountId = t.account_id as string; to = (m.from_address as string).toLowerCase(); toName = (m.from_name as string | null) ?? null; replyTo = m.id as string; threadId = t.id as string; mode = "reply";
        customerId = customerId ?? ((t.customer_id as string | null) ?? null); quoteId = quoteId ?? ((t.quote_id as string | null) ?? null);
        subject = replySubject(String(m.subject ?? t.subject ?? "")) ;
      }
      const cu = await customerOf(c, customerId ?? undefined);
      if (customerId && !cu) return { ok: false, reason: "cliente non trovato o archiviato" };
      const qu = await quoteOf(c, quoteId ?? undefined);
      if (quoteId && !qu) return { ok: false, reason: "preventivo non trovato" };
      if (!to && cu) {
        const { data: contacts } = await c.db.from("customer_contacts").select("email").eq("organization_id", c.orgId).eq("customer_id", cu.id).not("email", "is", null).limit(1);
        const cand = cu.email ?? (contacts?.[0]?.email as string | undefined) ?? null;
        if (cand && isValidEmail(cand)) { to = cand.toLowerCase(); toName = cu.name; }
      }
      if (!accountId) {
        const { data: accs } = await c.db.from("email_accounts").select("id, address, is_default, status").eq("organization_id", c.orgId).is("disconnected_at", null).eq("status", "connected").order("is_default", { ascending: false }).limit(1);
        accountId = (accs?.[0]?.id as string | undefined) ?? null;
      }
      if (!accountId) return { ok: false, reason: "nessuna casella email collegata e utilizzabile" };
      const { data: acc } = await c.db.from("email_accounts").select("address").eq("organization_id", c.orgId).eq("id", accountId).maybeSingle();
      return { ok: true, kind: p.kind, payload: { kind: p.kind, subject, body: p.body, customer_id: customerId, quote_id: quoteId, thread_id: threadId, reply_to_message_id: replyTo, mode, to, to_name: toName, account_id: accountId,
        to_label: to, customer_label: cu?.name ?? null, account_label: (acc?.address as string | undefined) ?? null, quote_label: qu ? `Preventivo ${qu.number}` : null },
        description: `Prepara una bozza email${to ? ` per ${toName && toName !== to ? `${toName} <${to}>` : to}` : ""} — «${subject}». Non viene inviata: la rivedi e la invii tu.` };
    }
    case "appointment": {
      if (p.date < today) return { ok: false, reason: "data nel passato" };
      const cu = await customerOf(c, p.customer_id);
      if (p.customer_id && !cu) return { ok: false, reason: "cliente non trovato o archiviato" };
      return { ok: true, kind: p.kind, payload: { ...p, customer_label: cu?.name ?? null }, description: `Crea l'appuntamento «${p.title}» il ${p.date} alle ${p.start_time}${cu ? ` con ${cu.name}` : ""}` };
    }
    case "catalog_update": {
      if (p.description === undefined && p.category === undefined) return { ok: false, reason: "nessuna modifica" };
      const { data: pr } = await c.db.from("products").select("id, name, description, category").eq("organization_id", c.orgId).eq("id", p.product_id).is("deleted_at", null).maybeSingle();
      if (!pr) return { ok: false, reason: "voce di catalogo non trovata" };
      if ((p.description === undefined || p.description === (pr.description ?? "")) && (p.category === undefined || p.category === (pr.category ?? ""))) return { ok: false, reason: "nessuna differenza" };
      return { ok: true, kind: p.kind, payload: { ...p, product_label: pr.name, current_description: pr.description ?? "(vuota)", current_category: pr.category ?? "(vuota)" }, description: `Aggiorna la voce di catalogo «${pr.name}»` };
    }
    case "quote_update": {
      if (p.title === undefined && p.notes === undefined && p.terms === undefined) return { ok: false, reason: "nessuna modifica" };
      const qu = await quoteOf(c, p.quote_id);
      if (!qu) return { ok: false, reason: "preventivo non trovato" };
      if (qu.status !== "draft") return { ok: false, reason: "solo i preventivi in bozza sono modificabili" };
      return { ok: true, kind: p.kind, payload: { ...p, quote_label: `Preventivo ${qu.number} · ${one(qu.customers)?.name ?? ""}` }, description: `Modifica il preventivo in bozza ${qu.number}` };
    }
    case "quote_draft": return { ok: true, kind: p.kind, payload: p, description: `Crea una bozza di preventivo${p.client_name ? ` per ${p.client_name}` : ""} da rivedere prima del salvataggio` };
  }
}

/** Salva le proposte valide come «da confermare»; stesse proposte identiche già in attesa nella conversazione non si duplicano. */
export async function prepareProposals(c: Ctx & { conversationId: string }, raws: unknown[]): Promise<{ proposals: PreparedProposal[]; dropped: number }> {
  const proposals: PreparedProposal[] = [];
  let dropped = 0;
  const { data: existing } = await c.db.from("ai_suggestions").select("id, kind, payload, description").eq("organization_id", c.orgId).eq("conversation_id", c.conversationId).eq("status", "pending").limit(50);
  for (const raw of raws.slice(0, 5)) {
    const r = await resolveProposal(c, raw);
    if (!r.ok) { dropped++; continue; }
    const same = (existing ?? []).find((e) => e.kind === r.kind && JSON.stringify(e.payload) === JSON.stringify(r.payload));
    if (same) { proposals.push({ id: same.id as string, kind: r.kind, label: PROPOSAL_LABEL[r.kind] ?? r.kind, description: (same.description as string) ?? r.description, details: proposalDetails(r.kind, r.payload), status: "pending", execution_status: "not_run" }); continue; }
    const { data, error } = await c.db.from("ai_suggestions").insert({ organization_id: c.orgId, kind: r.kind, payload: r.payload, description: r.description.slice(0, 600), source_type: "conversation", source_id: c.conversationId, conversation_id: c.conversationId, created_by: c.userId }).select("id").single();
    if (error || !data) { dropped++; continue; }
    proposals.push({ id: data.id as string, kind: r.kind, label: PROPOSAL_LABEL[r.kind] ?? r.kind, description: r.description, details: proposalDetails(r.kind, r.payload), status: "pending", execution_status: "not_run" });
  }
  return { proposals, dropped };
}
