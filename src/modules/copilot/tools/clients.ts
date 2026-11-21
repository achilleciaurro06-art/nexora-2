import "server-only";
import { z } from "zod";
import { defineTool } from "./types";
import { daysBetween, eur, isoDay, likeTerm, limitArg, one, untrusted } from "./util";

export const searchClients = defineTool({
  name: "search_clients",
  description: "Cerca clienti attivi per nome/email/città. Senza query elenca i più recenti. Restituisce gli id da usare con gli altri strumenti.",
  args: "{ query?: string, status?: 'lead'|'active'|'inactive', limit?: 1-25 }",
  permission: "data:read",
  schema: z.object({ query: z.string().max(80).optional(), status: z.enum(["lead", "active", "inactive"]).optional(), limit: limitArg(10, 25) }),
  async run({ db, orgId }, a) {
    let q = db.from("customers").select("id, name, status, email, city, tags").eq("organization_id", orgId).is("deleted_at", null).is("archived_at", null).order("created_at", { ascending: false }).limit(a.limit);
    const t = likeTerm(a.query ?? "");
    if (t) q = q.or(`name.ilike.%${t}%,email.ilike.%${t}%,city.ilike.%${t}%`);
    if (a.status) q = q.eq("status", a.status);
    const { data } = await q;
    return { data: { clienti: (data ?? []).map((c) => ({ id: c.id, nome: c.name, stato: c.status, email: c.email, citta: c.city })), nota: "Solo clienti non archiviati." },
      sources: [{ label: "Elenco clienti", href: "/clienti" }] };
  },
});

export const getClientDetails = defineTool({
  name: "get_client_details",
  description: "Scheda completa di un cliente: anagrafica, referenti, valore commerciale (preventivi, accettato, fatturato registrato), attività e follow-up aperti, ultimo contatto.",
  args: "{ customer_id: uuid }",
  permission: "data:read",
  schema: z.object({ customer_id: z.uuid() }),
  async run({ db, orgId, now }, a) {
    const { data: c } = await db.from("customers").select("id, name, status, email, phone, city, vat_number, customer_type, industry, tags, notes, archived_at, created_at").eq("organization_id", orgId).eq("id", a.customer_id).is("deleted_at", null).maybeSingle();
    if (!c) return { data: { errore: "Cliente non trovato" } };
    const [{ data: contacts }, { data: quotes }, { data: bill }, { data: tasks }, { data: fus }, { data: calls }, { data: ev }] = await Promise.all([
      db.from("customer_contacts").select("full_name, job_title, email, phone").eq("organization_id", orgId).eq("customer_id", c.id).limit(10),
      db.from("quotes").select("number, status, total_cents, issue_date").eq("organization_id", orgId).eq("customer_id", c.id).is("deleted_at", null).order("issue_date", { ascending: false }).limit(200),
      db.from("quote_billings").select("amount_cents, billed_at, payment_status").eq("organization_id", orgId).eq("customer_id", c.id).limit(1000),
      db.from("tasks").select("title, due_at, priority").eq("organization_id", orgId).eq("customer_id", c.id).is("deleted_at", null).in("status", ["todo", "in_progress"]).order("due_at", { nullsFirst: false }).limit(10),
      db.from("follow_ups").select("title, due_on, status").eq("organization_id", orgId).eq("customer_id", c.id).is("deleted_at", null).in("status", ["todo", "scheduled", "in_progress", "waiting"]).order("due_on").limit(10),
      db.from("call_logs").select("called_at, outcome, direction").eq("organization_id", orgId).eq("customer_id", c.id).order("called_at", { ascending: false }).limit(3),
      db.from("activity_events").select("created_at, summary").eq("organization_id", orgId).eq("customer_id", c.id).order("created_at", { ascending: false }).limit(1),
    ]);
    const qs = quotes ?? [];
    const sum = (f: (s: string) => boolean) => eur(qs.filter((x) => f(x.status as string)).reduce((n, x) => n + Number(x.total_cents), 0));
    const last = ev?.[0]?.created_at as string | undefined;
    return {
      data: {
        cliente: { id: c.id, nome: c.name, stato: c.status, tipo: c.customer_type, settore: c.industry, email: c.email, telefono: c.phone, citta: c.city, partita_iva: c.vat_number, tag: c.tags, cliente_dal: String(c.created_at).slice(0, 10), archiviato: Boolean(c.archived_at), note: c.notes ? untrusted(c.notes, 400) : null },
        referenti: contacts ?? [],
        preventivi: { totale: qs.length, per_stato: Object.fromEntries(["draft", "sent", "accepted", "rejected", "expired"].map((s) => [s, qs.filter((x) => x.status === s).length])),
          accettato_eur: sum((s) => s === "accepted"), in_trattativa_eur: sum((s) => s === "sent" || s === "draft"),
          ultimi: qs.slice(0, 5).map((x) => ({ numero: x.number, stato: x.status, importo_eur: eur(x.total_cents), data: x.issue_date })) },
        fatturato_registrato_eur: eur((bill ?? []).reduce((n, b) => n + Number(b.amount_cents), 0)), di_cui_non_incassato_eur: eur((bill ?? []).filter((b) => b.payment_status === "unpaid").reduce((n, b) => n + Number(b.amount_cents), 0)),
        attivita_aperte: (tasks ?? []).map((t) => ({ titolo: t.title, scadenza: t.due_at ? String(t.due_at).slice(0, 10) : null, priorita: t.priority })),
        follow_up_aperti: (fus ?? []).map((f) => ({ titolo: f.title, scadenza: f.due_on, stato: f.status })),
        ultime_chiamate: (calls ?? []).map((x) => ({ data: String(x.called_at).slice(0, 10), esito: x.outcome, direzione: x.direction })),
        ultimo_contatto: last ? { data: last.slice(0, 10), giorni_fa: daysBetween(last, now), evento: ev?.[0]?.summary } : null,
        nota: "Importi dei preventivi ≠ fatture registrate. Lo stato incassato/non incassato è quello indicato manualmente dall'utente.",
      },
      sources: [{ label: `Scheda cliente ${c.name}`, href: `/clienti/${c.id}` }],
    };
  },
});

export const getClientHistory = defineTool({
  name: "get_client_history",
  description: "Cronologia recente di un cliente (preventivi, chiamate, appuntamenti, follow-up, note, email), dalla più recente.",
  args: "{ customer_id: uuid, days?: 7-730 (default 180), limit?: 1-40 }",
  permission: "data:read",
  schema: z.object({ customer_id: z.uuid(), days: z.number().int().min(7).max(730).default(180), limit: limitArg(20, 40) }),
  async run({ db, orgId, now }, a) {
    const since = new Date(now.getTime() - a.days * 86_400_000).toISOString();
    const { data: c } = await db.from("customers").select("id, name").eq("organization_id", orgId).eq("id", a.customer_id).is("deleted_at", null).maybeSingle();
    if (!c) return { data: { errore: "Cliente non trovato" } };
    const [{ data: q }, { data: calls }, { data: ap }, { data: fu }, { data: notes }, { data: mails }] = await Promise.all([
      db.from("quotes").select("number, status, total_cents, issue_date, title").eq("organization_id", orgId).eq("customer_id", c.id).is("deleted_at", null).gte("created_at", since).limit(30),
      db.from("call_logs").select("called_at, outcome, direction, notes").eq("organization_id", orgId).eq("customer_id", c.id).gte("called_at", since).limit(30),
      db.from("appointments").select("starts_at, title, status").eq("organization_id", orgId).eq("customer_id", c.id).is("deleted_at", null).gte("starts_at", since).limit(30),
      db.from("follow_ups").select("due_on, title, status").eq("organization_id", orgId).eq("customer_id", c.id).is("deleted_at", null).gte("created_at", since).limit(30),
      db.from("customer_notes").select("created_at, body").eq("organization_id", orgId).eq("customer_id", c.id).gte("created_at", since).limit(20),
      db.from("email_threads").select("id, subject, last_message_at").eq("organization_id", orgId).eq("customer_id", c.id).gte("last_message_at", since).order("last_message_at", { ascending: false }).limit(15),
    ]);
    type Ev = { quando: string; tipo: string; dettaglio: unknown };
    const ev: Ev[] = [
      ...(q ?? []).map((x) => ({ quando: String(x.issue_date), tipo: "preventivo", dettaglio: { numero: x.number, stato: x.status, importo_eur: eur(x.total_cents), oggetto: x.title } })),
      ...(calls ?? []).map((x) => ({ quando: String(x.called_at).slice(0, 10), tipo: "chiamata", dettaglio: { esito: x.outcome, direzione: x.direction, note: x.notes ? untrusted(x.notes, 200) : null } })),
      ...(ap ?? []).map((x) => ({ quando: String(x.starts_at).slice(0, 10), tipo: "appuntamento", dettaglio: { titolo: x.title, stato: x.status } })),
      ...(fu ?? []).map((x) => ({ quando: String(x.due_on), tipo: "follow_up", dettaglio: { titolo: x.title, stato: x.status } })),
      ...(notes ?? []).map((x) => ({ quando: String(x.created_at).slice(0, 10), tipo: "nota", dettaglio: untrusted(x.body, 200) })),
      ...(mails ?? []).map((x) => ({ quando: String(x.last_message_at).slice(0, 10), tipo: "email", dettaglio: { thread_id: x.id, oggetto: untrusted(x.subject, 150) } })),
    ].sort((x, y) => y.quando.localeCompare(x.quando)).slice(0, a.limit);
    return { data: { cliente: c.name, finestra_giorni: a.days, eventi: ev, nota: "Le email di caselle riservate a cui l'utente non ha accesso non sono incluse." }, sources: [{ label: `Cronologia ${c.name}`, href: `/clienti/${c.id}` }] };
  },
});

export const getRecontactCandidates = defineTool({
  name: "get_clients_to_recontact",
  description: "Clienti attivi senza alcuna attività registrata da almeno N giorni (ordinati dal più fermo), con valore commerciale storico.",
  args: "{ days?: 14-720 (default 60), limit?: 1-25 }",
  permission: "data:read",
  schema: z.object({ days: z.number().int().min(14).max(720).default(60), limit: limitArg(10, 25) }),
  async run({ db, orgId, now }, a) {
    const { data } = await db.rpc("customers_to_recontact", { p_org: orgId, p_days: a.days, p_limit: a.limit });
    const rows = (data ?? []) as { customer_id: string; name: string; last_activity: string; open_quotes: number }[];
    const ids = rows.map((r) => r.customer_id);
    const { data: acc } = ids.length ? await db.from("quotes").select("customer_id, total_cents").eq("organization_id", orgId).eq("status", "accepted").is("deleted_at", null).in("customer_id", ids) : { data: [] };
    const val = new Map<string, number>();
    for (const q of acc ?? []) val.set(q.customer_id as string, (val.get(q.customer_id as string) ?? 0) + Number(q.total_cents));
    return { data: { clienti: rows.map((r) => ({ id: r.customer_id, nome: r.name, ultima_attivita: String(r.last_activity).slice(0, 10), giorni_senza_contatto: daysBetween(r.last_activity, now), preventivi_aperti: Number(r.open_quotes), accettato_storico_eur: eur(val.get(r.customer_id) ?? 0) })), soglia_giorni: a.days },
      sources: [{ label: "Clienti da ricontattare", href: "/clienti" }] };
  },
});

export const topClients = defineTool({
  name: "get_top_clients",
  description: "Classifica dei clienti per valore: fatturato registrato o preventivi accettati in un periodo.",
  args: "{ metric?: 'billed'|'accepted' (default billed), from?: AAAA-MM-GG, to?: AAAA-MM-GG, limit?: 1-20 }",
  permission: "data:read",
  schema: z.object({ metric: z.enum(["billed", "accepted"]).default("billed"), from: isoDay.optional(), to: isoDay.optional(), limit: limitArg(10, 20) }),
  async run({ db, orgId, today }, a) {
    const from = a.from ?? `${today.slice(0, 4)}-01-01`, to = a.to ?? today;
    const m = new Map<string, { nome: string; cents: number; n: number }>();
    if (a.metric === "billed") {
      const { data } = await db.from("quote_billings").select("customer_id, amount_cents, customers(name)").eq("organization_id", orgId).gte("billed_at", from).lte("billed_at", to).limit(5000);
      for (const b of data ?? []) { const e = m.get(b.customer_id as string) ?? { nome: one(b.customers as { name: string } | { name: string }[])?.name ?? "?", cents: 0, n: 0 }; e.cents += Number(b.amount_cents); e.n++; m.set(b.customer_id as string, e); }
    } else {
      const { data } = await db.from("quotes").select("customer_id, total_cents, customers(name)").eq("organization_id", orgId).eq("status", "accepted").is("deleted_at", null).gte("issue_date", from).lte("issue_date", to).limit(5000);
      for (const b of data ?? []) { const e = m.get(b.customer_id as string) ?? { nome: one(b.customers as { name: string } | { name: string }[])?.name ?? "?", cents: 0, n: 0 }; e.cents += Number(b.total_cents); e.n++; m.set(b.customer_id as string, e); }
    }
    const rows = [...m.entries()].sort((x, y) => y[1].cents - x[1].cents).slice(0, a.limit).map(([id, v]) => ({ id, nome: v.nome, importo_eur: eur(v.cents), documenti: v.n }));
    return { data: { metrica: a.metric === "billed" ? "fatturato registrato" : "preventivi accettati", periodo: { da: from, a: to }, clienti: rows, nota: rows.length === 0 ? "Nessun dato nel periodo." : undefined }, sources: [{ label: "Clienti", href: "/clienti" }] };
  },
});
