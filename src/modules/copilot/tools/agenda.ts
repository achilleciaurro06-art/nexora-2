import "server-only";
import { z } from "zod";
import { defineTool } from "./types";
import type { ToolCtx } from "./types";
import { daysBetween, eur, limitArg, one, untrusted } from "./util";
import { listAgenda } from "@/modules/agenda/queries";
import { viewOf, type AgendaItem } from "@/modules/agenda/agenda";
import { addDays, fmtDateTime, utcToZonedParts } from "@/lib/datetime";

const show = (i: AgendaItem, today: string) => ({
  tipo: i.kind, titolo: i.title, cliente: i.customer_name, scadenza: i.when_date, ora: i.has_time && i.when_at ? utcToZonedParts(i.when_at).time : null,
  priorita: i.priority, stato: i.status, giorni_di_ritardo: i.when_date && i.when_date < today ? Math.round((Date.parse(today) - Date.parse(i.when_date)) / 86_400_000) : 0, link: i.href,
});

export const getMyDay = defineTool({
  name: "get_my_day",
  description: "Cosa c'è da fare oggi: attività, follow-up e appuntamenti di oggi, elementi in ritardo, prossimi impegni. Per default solo quelli assegnati all'utente, più i totali dell'organizzazione.",
  args: "{ only_mine?: boolean (default true) }",
  permission: "data:read",
  schema: z.object({ only_mine: z.boolean().default(true) }),
  async run({ db, orgId, userId, now, today }, a) {
    const all = await listAgenda(db, orgId, now);
    const mine = (i: AgendaItem) => !a.only_mine || i.assignee_id === userId;
    const pick = (v: string) => all.filter((i) => viewOf(i, now) === v);
    const today_ = pick("today"), overdue = pick("overdue"), upcoming = pick("upcoming").filter((i) => i.when_date && i.when_date <= addDays(today, 7));
    return { data: { oggi: today, da_fare_oggi: today_.filter(mine).slice(0, 15).map((i) => show(i, today)), in_ritardo: overdue.filter(mine).slice(0, 15).map((i) => show(i, today)),
      prossimi_7_giorni: upcoming.filter(mine).slice(0, 10).map((i) => show(i, today)),
      totali_organizzazione: { oggi: today_.length, in_ritardo: overdue.length }, solo_assegnati_a_me: a.only_mine },
      sources: [{ label: "Promemoria", href: "/promemoria" }] };
  },
});

export const getPendingFollowups = defineTool({
  name: "get_pending_followups",
  description: "Follow-up (dei clienti e dei preventivi) da fare: in ritardo, di oggi o dei prossimi giorni.",
  args: "{ scope?: 'overdue'|'today'|'week'|'all' (default overdue), only_mine?: boolean, limit?: 1-30 }",
  permission: "data:read",
  schema: z.object({ scope: z.enum(["overdue", "today", "week", "all"]).default("overdue"), only_mine: z.boolean().default(false), limit: limitArg(15, 30) }),
  async run({ db, orgId, userId, now, today }, a) {
    const all = (await listAgenda(db, orgId, now)).filter((i) => (i.kind === "follow_up" || i.kind === "quote_followup") && i.is_open && (!a.only_mine || i.assignee_id === userId));
    const sel = all.filter((i) => { const v = viewOf(i, now); return a.scope === "all" || (a.scope === "overdue" ? v === "overdue" : a.scope === "today" ? v === "today" : (v === "overdue" || v === "today" || (i.when_date !== null && i.when_date <= addDays(today, 7)))); })
      .sort((x, y) => (x.when_date ?? "9999").localeCompare(y.when_date ?? "9999"));
    return { data: { ambito: a.scope, totale: sel.length, follow_up: sel.slice(0, a.limit).map((i) => show(i, today)) }, sources: [{ label: "Follow-up", href: "/followup" }] };
  },
});

export const getUpcomingAppointments = defineTool({
  name: "get_upcoming_appointments",
  description: "Appuntamenti programmati nei prossimi N giorni.",
  args: "{ days?: 1-60 (default 7), customer_id?: uuid }",
  permission: "data:read",
  schema: z.object({ days: z.number().int().min(1).max(60).default(7), customer_id: z.uuid().optional() }),
  async run({ db, orgId, now }, a) {
    let q = db.from("appointments").select("id, title, starts_at, ends_at, location, customer_id, customers(name)").eq("organization_id", orgId).is("deleted_at", null).eq("status", "scheduled")
      .gte("starts_at", now.toISOString()).lte("starts_at", new Date(now.getTime() + a.days * 86_400_000).toISOString()).order("starts_at").limit(25);
    if (a.customer_id) q = q.eq("customer_id", a.customer_id);
    const { data } = await q;
    return { data: { giorni: a.days, appuntamenti: (data ?? []).map((x) => ({ id: x.id, titolo: x.title, quando: fmtDateTime(x.starts_at as string), luogo: x.location, cliente: one(x.customers as { name: string } | { name: string }[])?.name, cliente_id: x.customer_id, link: `/appuntamenti/${x.id}` })) },
      sources: [{ label: "Appuntamenti", href: "/appuntamenti" }] };
  },
});

async function briefing(ctx: ToolCtx, apptId: string) {
  const { db, orgId, now } = ctx;
  const { data: ap } = await db.from("appointments").select("id, title, description, starts_at, location, notes, customer_id, contact_id, status").eq("organization_id", orgId).eq("id", apptId).is("deleted_at", null).maybeSingle();
  if (!ap) return null;
  const cid = ap.customer_id as string | null;
  if (!cid) return { appuntamento: { titolo: ap.title, quando: fmtDateTime(ap.starts_at as string), luogo: ap.location, note: ap.notes ? untrusted(ap.notes, 400) : null }, nota: "L'appuntamento non è collegato a un cliente: nessun dato commerciale da riepilogare." };
  const [{ data: c }, { data: quotes }, { data: tasks }, { data: fus }, { data: mails }, { data: calls }, { data: bill }] = await Promise.all([
    db.from("customers").select("name, email, phone, status, notes").eq("organization_id", orgId).eq("id", cid).maybeSingle(),
    db.from("quotes").select("number, title, status, total_cents, issue_date, follow_up_date").eq("organization_id", orgId).eq("customer_id", cid).is("deleted_at", null).order("issue_date", { ascending: false }).limit(8),
    db.from("tasks").select("title, due_at").eq("organization_id", orgId).eq("customer_id", cid).is("deleted_at", null).in("status", ["todo", "in_progress"]).limit(8),
    db.from("follow_ups").select("title, due_on, status").eq("organization_id", orgId).eq("customer_id", cid).is("deleted_at", null).in("status", ["todo", "scheduled", "in_progress", "waiting"]).limit(8),
    db.from("email_threads").select("id, subject, last_message_at").eq("organization_id", orgId).eq("customer_id", cid).order("last_message_at", { ascending: false }).limit(5),
    db.from("call_logs").select("called_at, outcome, notes").eq("organization_id", orgId).eq("customer_id", cid).order("called_at", { ascending: false }).limit(3),
    db.from("quote_billings").select("amount_cents").eq("organization_id", orgId).eq("customer_id", cid).limit(1000),
  ]);
  const open = (quotes ?? []).filter((q) => q.status === "sent" || q.status === "draft");
  return {
    appuntamento: { id: ap.id, titolo: ap.title, quando: fmtDateTime(ap.starts_at as string), luogo: ap.location, descrizione: ap.description ? untrusted(ap.description, 300) : null, note: ap.notes ? untrusted(ap.notes, 400) : null },
    cliente: { id: cid, nome: c?.name, stato: c?.status, email: c?.email, telefono: c?.phone, note: c?.notes ? untrusted(c.notes, 300) : null },
    preventivi_aperti: open.map((q) => ({ numero: q.number, oggetto: q.title, stato: q.status, importo_eur: eur(q.total_cents), giorni_dall_emissione: daysBetween(`${q.issue_date}T00:00:00Z`, now), follow_up: q.follow_up_date })),
    preventivi_recenti_chiusi: (quotes ?? []).filter((q) => q.status === "accepted" || q.status === "rejected").slice(0, 4).map((q) => ({ numero: q.number, stato: q.status, importo_eur: eur(q.total_cents), data: q.issue_date })),
    fatturato_registrato_totale_eur: eur((bill ?? []).reduce((n, b) => n + Number(b.amount_cents), 0)),
    attivita_aperte: (tasks ?? []).map((t) => ({ titolo: t.title, scadenza: t.due_at ? String(t.due_at).slice(0, 10) : null })), follow_up_aperti: (fus ?? []).map((f) => ({ titolo: f.title, scadenza: f.due_on, stato: f.status })),
    email_recenti: (mails ?? []).map((m) => ({ thread_id: m.id, oggetto: untrusted(m.subject, 150), data: String(m.last_message_at).slice(0, 10) })),
    ultime_chiamate: (calls ?? []).map((x) => ({ data: String(x.called_at).slice(0, 10), esito: x.outcome, note: x.notes ? untrusted(x.notes, 200) : null })),
  };
}

export const getAppointmentBriefing = defineTool({
  name: "get_appointment_briefing",
  description: "Dati per preparare un appuntamento: cliente, preventivi aperti e recenti, email e chiamate recenti, attività e follow-up aperti. Se l'utente cita un cliente senza appuntamento, usa get_client_details/get_client_history.",
  args: "{ appointment_id: uuid }",
  permission: "data:read",
  schema: z.object({ appointment_id: z.uuid() }),
  async run(ctx, a) {
    const b = await briefing(ctx, a.appointment_id);
    return b ? { data: b, sources: [{ label: "Appuntamento", href: `/appuntamenti/${a.appointment_id}` }] } : { data: { errore: "Appuntamento non trovato" } };
  },
});
