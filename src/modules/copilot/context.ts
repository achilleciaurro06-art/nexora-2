import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPriceHistory } from "@/modules/prezzi/service";
import { analyzeItem } from "@/modules/prezzi/stats";
import { assemble, clampJson, customersMentioned, quoteNumbersIn, selectPacks, type PackName } from "./packs";

/** Budget di contesto: ~14.000 caratteri (≈ 4.500 token) per richiesta, a prescindere da quanti dati ha l'azienda. */
export const CONTEXT_BUDGET_CHARS = 14_000;
const eur = (cents: unknown) => Math.round(Number(cents ?? 0)) / 100;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

type Ctx = { db: SupabaseClient; orgId: string; userId: string; userName: string | null; question: string };

async function base({ db, orgId, userId, userName }: Ctx) {
  const [{ data: org }, { data: quotes }, { data: tasks }, customers] = await Promise.all([
    db.from("organizations").select("name, vat_number").eq("id", orgId).maybeSingle(),
    db.from("quotes").select("status, total_cents").eq("organization_id", orgId).is("deleted_at", null).limit(3000),
    db.from("tasks").select("due_at").eq("organization_id", orgId).is("deleted_at", null).in("status", ["todo", "in_progress"]).limit(1000),
    db.from("customers").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null).is("archived_at", null),
  ]);
  const by: Record<string, { n: number; eur: number }> = {};
  for (const q of quotes ?? []) { const s = q.status as string; by[s] ??= { n: 0, eur: 0 }; by[s].n++; by[s].eur += eur(q.total_cents); }
  for (const v of Object.values(by)) v.eur = Math.round(v.eur * 100) / 100;
  const now = Date.now();
  return {
    oggi: new Date().toISOString().slice(0, 10), azienda: org?.name, partita_iva: org?.vat_number, utente: userName, utente_id: userId,
    clienti_totali: customers.count ?? 0, preventivi_per_stato: by,
    attivita_aperte: (tasks ?? []).length, attivita_scadute: (tasks ?? []).filter((t) => t.due_at && new Date(t.due_at as string).getTime() < now).length,
  };
}

const packs: Record<PackName, (c: Ctx) => Promise<unknown>> = {
  async stale_customers({ db, orgId }) {
    const { data } = await db.rpc("customers_to_recontact", { p_org: orgId, p_days: 45, p_limit: 12 });
    return (data ?? []).map((r: { name: string; last_activity: string; open_quotes: number }) => ({
      cliente: r.name, ultima_attivita: day(r.last_activity), giorni_senza_contatto: daysSince(r.last_activity), preventivi_aperti: Number(r.open_quotes),
    }));
  },
  async pending_quotes({ db, orgId }) {
    const { data } = await db.from("quotes").select("number, title, total_cents, issue_date, valid_until, follow_up_date, customers(name)")
      .eq("organization_id", orgId).is("deleted_at", null).eq("status", "sent").order("issue_date", { ascending: true }).limit(15);
    const today = new Date().toISOString().slice(0, 10);
    return (data ?? []).map((q) => ({
      numero: q.number, cliente: one(q.customers as { name: string } | { name: string }[])?.name, oggetto: q.title, importo_eur: eur(q.total_cents),
      emesso_il: q.issue_date, giorni_dall_invio: daysSince(`${q.issue_date}T00:00:00Z`), follow_up: q.follow_up_date,
      follow_up_scaduto: Boolean(q.follow_up_date && (q.follow_up_date as string) < today), validita_scaduta: Boolean(q.valid_until && (q.valid_until as string) < today),
    }));
  },
  async win_odds({ db, orgId }) {
    const [{ data: decided }, { data: open }] = await Promise.all([
      db.from("quotes").select("status, customer_id").eq("organization_id", orgId).is("deleted_at", null).in("status", ["accepted", "rejected"]).limit(2000),
      db.from("quotes").select("number, total_cents, issue_date, customer_id, customers(name)").eq("organization_id", orgId).is("deleted_at", null).eq("status", "sent").order("total_cents", { ascending: false }).limit(15),
    ]);
    const acc = (decided ?? []).filter((q) => q.status === "accepted").length;
    const per = new Map<string, { a: number; r: number }>();
    for (const q of decided ?? []) { const e = per.get(q.customer_id as string) ?? { a: 0, r: 0 }; if (q.status === "accepted") e.a++; else e.r++; per.set(q.customer_id as string, e); }
    return {
      avvertenza: "Indicatori calcolati SOLO sullo storico dell'azienda; con pochi preventivi decisi l'affidabilità è bassa. Non sono previsioni.",
      preventivi_decisi: (decided ?? []).length, tasso_accettazione_globale_pct: (decided ?? []).length ? Math.round((acc / (decided ?? []).length) * 100) : null,
      preventivi_inviati_aperti: (open ?? []).map((q) => {
        const h = per.get(q.customer_id as string);
        return {
          numero: q.number, cliente: one(q.customers as { name: string } | { name: string }[])?.name, importo_eur: eur(q.total_cents), giorni_dall_invio: daysSince(`${q.issue_date}T00:00:00Z`),
          storico_cliente: h ? { accettati: h.a, rifiutati: h.r } : "nessun preventivo deciso con questo cliente",
        };
      }),
    };
  },
  async top_customers({ db, orgId }) {
    const { data } = await db.from("quotes").select("customer_id, status, total_cents, customers(name)").eq("organization_id", orgId).is("deleted_at", null).limit(3000);
    const m = new Map<string, { cliente: string; accettato: number; in_trattativa: number; n: number }>();
    for (const q of data ?? []) {
      const name = one(q.customers as { name: string } | { name: string }[])?.name ?? "?";
      const e = m.get(q.customer_id as string) ?? { cliente: name, accettato: 0, in_trattativa: 0, n: 0 };
      e.n++;
      if (q.status === "accepted") e.accettato += eur(q.total_cents);
      if (q.status === "draft" || q.status === "sent") e.in_trattativa += eur(q.total_cents);
      m.set(q.customer_id as string, e);
    }
    const all = [...m.values()].map((e) => ({ ...e, accettato: Math.round(e.accettato * 100) / 100, in_trattativa: Math.round(e.in_trattativa * 100) / 100 }));
    return {
      per_valore_accettato: [...all].sort((a, b) => b.accettato - a.accettato).slice(0, 8),
      per_valore_in_trattativa_potenziale: [...all].sort((a, b) => b.in_trattativa - a.in_trattativa).slice(0, 8),
    };
  },
  async tasks({ db, orgId, userId }) {
    const in7 = new Date(Date.now() + 7 * 86_400_000);
    const [{ data: tasks }, { data: followUps }, { data: reminders }] = await Promise.all([
      db.from("tasks").select("title, due_at, priority, assignee_id, customers(name), quotes(number)").eq("organization_id", orgId).is("deleted_at", null)
        .in("status", ["todo", "in_progress"]).order("due_at", { nullsFirst: false }).limit(25),
      db.from("quotes").select("number, follow_up_date, status, customers(name)").eq("organization_id", orgId).is("deleted_at", null).in("status", ["draft", "sent"])
        .not("follow_up_date", "is", null).lte("follow_up_date", in7.toISOString().slice(0, 10)).order("follow_up_date").limit(10),
      db.from("reminders").select("remind_at, tasks(title)").eq("organization_id", orgId).eq("status", "pending").lte("remind_at", in7.toISOString()).order("remind_at").limit(10),
    ]);
    const now = Date.now();
    const rows = (tasks ?? []).map((t) => ({
      titolo: t.title, scadenza: day(t.due_at as string | null), priorita: t.priority, mia: t.assignee_id === userId,
      cliente: one(t.customers as { name: string } | { name: string }[])?.name ?? null, preventivo: one(t.quotes as { number: string } | { number: string }[])?.number ?? null,
      stato: t.due_at ? (new Date(t.due_at as string).getTime() < now ? "scaduta" : new Date(t.due_at as string) <= in7 ? "entro_7_giorni" : "più_avanti") : "senza_scadenza",
    }));
    return {
      attivita_aperte: rows,
      follow_up_preventivi_entro_7_giorni: (followUps ?? []).map((q) => ({ preventivo: q.number, cliente: one(q.customers as { name: string } | { name: string }[])?.name, data: q.follow_up_date, stato: q.status })),
      promemoria_entro_7_giorni: (reminders ?? []).map((r) => ({ quando: day(r.remind_at as string), attivita: one(r.tasks as { title: string } | { title: string }[])?.title })),
    };
  },
  async price_anomalies({ db, orgId }) {
    const { data: quotes } = await db.from("quotes").select("id, number, status, quote_items(id, description, unit_price_cents, discount_percent)")
      .eq("organization_id", orgId).is("deleted_at", null).in("status", ["draft", "sent"]).order("created_at", { ascending: false }).limit(8);
    const history = await loadPriceHistory(db, orgId);
    const out: unknown[] = [];
    let insufficient = 0, checked = 0;
    for (const q of quotes ?? []) for (const it of (q.quote_items ?? []) as { id: string; description: string; unit_price_cents: number; discount_percent: number }[]) {
      const a = analyzeItem({ id: it.id, description: it.description, unitPriceCents: Number(it.unit_price_cents), discountPercent: Number(it.discount_percent) }, history, q.id as string);
      checked++;
      if (a.verdict === "insufficient_data") insufficient++;
      else if (a.verdict !== "ok" && out.length < 15) out.push({ preventivo: q.number, voce: it.description.slice(0, 80), verdetto: a.verdict, prezzo_netto_eur: eur(a.current_unit_price_cents), mediana_storica_eur: eur(a.stats?.median), confronti: a.stats?.n });
    }
    return {
      nota: "Verdetti calcolati solo sullo storico dei preventivi inviati/accettati dell'azienda (nessun dato di mercato). Servono almeno 3 voci simili.",
      voci_controllate: checked, voci_con_dati_insufficienti: insufficient, anomalie: out,
    };
  },
  async documents({ db, orgId }) {
    const { data } = await db.from("documents").select("name, mime_type, created_at, analysis_status, customers(name)").eq("organization_id", orgId).is("deleted_at", null).order("created_at", { ascending: false }).limit(15);
    return (data ?? []).map((d) => ({ nome: d.name, tipo: d.mime_type, caricato_il: day(d.created_at as string), analisi_ai: d.analysis_status, cliente: one(d.customers as { name: string } | { name: string }[])?.name ?? null }));
  },
  async past_ai({ db, orgId }) {
    const [{ data: sugs }, { data: analyses }] = await Promise.all([
      db.from("ai_suggestions").select("kind, status, payload, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(10),
      db.from("price_analyses").select("created_at, items, quotes(number)").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(5),
    ]);
    return {
      suggerimenti_recenti: (sugs ?? []).map((s) => { const p = (s.payload ?? {}) as Record<string, unknown>; return { tipo: s.kind, stato: s.status, data: day(s.created_at as string), oggetto: String(p.title ?? p.quote_title ?? p.client_name ?? p.description ?? "").slice(0, 80) }; }),
      analisi_prezzi_recenti: (analyses ?? []).map((a) => {
        const items = (a.items ?? []) as { verdict: string }[];
        return { preventivo: one(a.quotes as { number: string } | { number: string }[])?.number, data: day(a.created_at as string), anomale: items.filter((i) => i.verdict === "low" || i.verdict === "high").length, dati_insufficienti: items.filter((i) => i.verdict === "insufficient_data").length };
      }),
    };
  },
  async org_info({ db, orgId }) {
    const { data } = await db.from("organizations").select("name, vat_number, tax_code, address, email, phone, website, quote_default_terms, quote_footer").eq("id", orgId).maybeSingle();
    return data ? { ...data, quote_default_terms: String(data.quote_default_terms ?? "").slice(0, 400), quote_footer: String(data.quote_footer ?? "").slice(0, 300) } : null;
  },
};

async function customerProfile(c: Ctx, id: string, name: string) {
  const { db, orgId } = c;
  const [{ data: cust }, { data: contacts }, { data: quotes }, { data: tasks }, { data: notes }, { data: docs }, { data: events }] = await Promise.all([
    db.from("customers").select("status, email, phone, city, vat_number, notes, created_at, archived_at").eq("organization_id", orgId).eq("id", id).maybeSingle(),
    db.from("customer_contacts").select("full_name, job_title, email, phone, notes").eq("organization_id", orgId).eq("customer_id", id).limit(5),
    db.from("quotes").select("number, title, status, total_cents, issue_date, follow_up_date, quote_items(description, quantity, unit_price_cents)").eq("organization_id", orgId).eq("customer_id", id).is("deleted_at", null).order("issue_date", { ascending: false }).limit(8),
    db.from("tasks").select("title, status, due_at, priority").eq("organization_id", orgId).eq("customer_id", id).is("deleted_at", null).order("due_at", { nullsFirst: false }).limit(8),
    db.from("customer_notes").select("body, created_at").eq("organization_id", orgId).eq("customer_id", id).order("created_at", { ascending: false }).limit(5),
    db.from("documents").select("name, mime_type").eq("organization_id", orgId).eq("customer_id", id).is("deleted_at", null).limit(5),
    db.from("activity_events").select("summary, created_at").eq("organization_id", orgId).eq("customer_id", id).order("created_at", { ascending: false }).limit(10),
  ]);
  const { data: summary } = await db.rpc("customer_commercial_summary", { p_customer: id });
  const sm = (summary ?? null) as Record<string, number | string | null> | null;
  const valore = sm ? {
    nota: "accettato, fatturato e incassato sono misure diverse; i valori sono calcolati dal database",
    preventivi_emessi: { n: sm.issued_count, valore_eur: eur(sm.issued_cents as number) },
    accettati: { n: sm.accepted_count, valore_eur: eur(sm.accepted_cents as number) },
    rifiutati: { n: sm.rejected_count, valore_eur: eur(sm.rejected_cents as number) },
    trattative_aperte_inviati: { n: sm.open_count, valore_eur: eur(sm.open_cents as number) },
    valore_medio_eur: eur(sm.avg_issued_cents as number), conversione_pct: sm.conversion_pct,
    fatturato_registrato_eur: eur(sm.invoiced_cents as number), incassato_eur: eur(sm.collected_cents as number),
    ultima_attivita: day(sm.last_activity_at as string | null), ultimo_contatto: day(sm.last_contact_at as string | null),
  } : undefined;
  return {
    cliente: name, archiviato: cust?.archived_at ? "sì" : undefined, valore_commerciale: valore, stato: cust?.status, email: cust?.email, telefono: cust?.phone, citta: cust?.city, partita_iva: cust?.vat_number, note_anagrafica: String(cust?.notes ?? "").slice(0, 300),
    referenti: (contacts ?? []).map((r) => ({ nome: r.full_name, ruolo: r.job_title, email: r.email, telefono: r.phone, note: String(r.notes ?? "").slice(0, 120) })),
    preventivi: (quotes ?? []).map((q) => ({
      numero: q.number, oggetto: q.title, stato: q.status, importo_eur: eur(q.total_cents), emesso_il: q.issue_date, follow_up: q.follow_up_date,
      righe: ((q.quote_items ?? []) as { description: string; quantity: number; unit_price_cents: number }[]).slice(0, 5).map((i) => ({ voce: i.description.slice(0, 60), qta: Number(i.quantity), prezzo_eur: eur(i.unit_price_cents) })),
    })),
    attivita: (tasks ?? []).map((t) => ({ titolo: t.title, stato: t.status, scadenza: day(t.due_at as string | null), priorita: t.priority })),
    note: (notes ?? []).map((n) => ({ data: day(n.created_at as string), testo: String(n.body).slice(0, 200) })),
    documenti: (docs ?? []).map((d) => ({ nome: d.name, tipo: d.mime_type })),
    storico_recente: (events ?? []).map((e) => ({ data: day(e.created_at as string), evento: e.summary })),
  };
}

async function quoteDetail(c: Ctx, number: string) {
  const { data } = await c.db.from("quotes").select("number, title, status, total_cents, subtotal_cents, vat_cents, issue_date, valid_until, follow_up_date, notes, terms, customers(name), quote_items(description, quantity, unit_price_cents, discount_percent, vat_rate)")
    .eq("organization_id", c.orgId).eq("number", number).is("deleted_at", null).maybeSingle();
  if (!data) return { numero: number, trovato: false };
  return {
    numero: data.number, oggetto: data.title, cliente: one(data.customers as { name: string } | { name: string }[])?.name, stato: data.status,
    imponibile_eur: eur(data.subtotal_cents), iva_eur: eur(data.vat_cents), totale_eur: eur(data.total_cents), emesso_il: data.issue_date, valido_fino: data.valid_until, follow_up: data.follow_up_date,
    note: String(data.notes ?? "").slice(0, 300), condizioni: String(data.terms ?? "").slice(0, 300),
    righe: ((data.quote_items ?? []) as { description: string; quantity: number; unit_price_cents: number; discount_percent: number; vat_rate: number }[]).slice(0, 15)
      .map((i) => ({ voce: i.description.slice(0, 80), qta: Number(i.quantity), prezzo_eur: eur(i.unit_price_cents), sconto_pct: Number(i.discount_percent), iva_pct: Number(i.vat_rate) })),
  };
}

export type BuiltContext = { text: string; included: string[]; dropped: string[] };

/** Contesto mirato: base + blocchi scelti dalla domanda + eventuali clienti/preventivi citati. Tutto sotto RLS dell'utente. */
export async function buildContext(c: Ctx): Promise<BuiltContext> {
  const wanted = selectPacks(c.question);
  const numbers = quoteNumbersIn(c.question);
  const { data: names } = await c.db.from("customers").select("id, name").eq("organization_id", c.orgId).is("deleted_at", null).limit(500);
  const mentioned = customersMentioned(c.question, (names ?? []) as { id: string; name: string }[]);

  const [b, ...rest] = await Promise.all([
    base(c),
    ...wanted.map((p) => packs[p](c)),
    ...mentioned.map((m) => customerProfile(c, m.id, m.name)),
    ...numbers.map((n) => quoteDetail(c, n)),
  ]);
  const blocks: { name: string; json: string }[] = [{ name: "azienda", json: clampJson(b, 1_800) }];
  let i = 0;
  for (const p of wanted) blocks.push({ name: p, json: clampJson(rest[i++], 3_500) });
  for (const m of mentioned) blocks.push({ name: `scheda_cliente:${m.name}`, json: clampJson(rest[i++], 4_500) });
  for (const n of numbers) blocks.push({ name: `preventivo:${n}`, json: clampJson(rest[i++], 2_500) });
  return assemble(blocks, CONTEXT_BUDGET_CHARS);
}
