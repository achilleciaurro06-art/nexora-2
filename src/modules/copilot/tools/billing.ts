import "server-only";
import { z } from "zod";
import { defineTool } from "./types";
import { eur, isoDay, lastMonths, limitArg, one, pct } from "./util";

const FISCAL_NOTE = "Si tratta di fatture REGISTRATE manualmente in NEXORA, con stato pagata/non pagata indicato dall'utente. NEXORA non emette fatture elettroniche, non gestisce SDI e non verifica i pagamenti in banca.";

export const getInvoiceSummary = defineTool({
  name: "get_invoice_summary",
  description: "Fatture registrate in un periodo (totale, incassato/non incassato secondo lo stato indicato dall'utente, per mese, per cliente), elenco delle fatture non incassate e importi accettati ma non ancora registrati come fatturati.",
  args: "{ from?: AAAA-MM-GG (default inizio mese corrente), to?: AAAA-MM-GG (default oggi), customer_id?: uuid, compare_previous?: boolean }",
  permission: "data:read",
  schema: z.object({ from: isoDay.optional(), to: isoDay.optional(), customer_id: z.uuid().optional(), compare_previous: z.boolean().default(false) }),
  async run({ db, orgId, today }, a) {
    const from = a.from ?? `${today.slice(0, 7)}-01`, to = a.to ?? today;
    if (from > to) return { data: { errore: "Periodo non valido: 'from' successivo a 'to'" } };
    const fetch = async (f: string, t: string) => {
      let q = db.from("quote_billings").select("amount_cents, billed_at, customer_id, payment_status, reference, customers(name)").eq("organization_id", orgId).gte("billed_at", f).lte("billed_at", t).limit(5000);
      if (a.customer_id) q = q.eq("customer_id", a.customer_id);
      const { data } = await q;
      return data ?? [];
    };
    const rows = await fetch(from, to);
    const total = rows.reduce((n, r) => n + Number(r.amount_cents), 0);
    const paid = rows.filter((r) => r.payment_status === "paid").reduce((n, r) => n + Number(r.amount_cents), 0);
    const byMonth = new Map<string, number>(), byCust = new Map<string, { nome: string; c: number }>();
    for (const r of rows) {
      const m = String(r.billed_at).slice(0, 7); byMonth.set(m, (byMonth.get(m) ?? 0) + Number(r.amount_cents));
      const e = byCust.get(r.customer_id as string) ?? { nome: one(r.customers as { name: string } | { name: string }[])?.name ?? "?", c: 0 }; e.c += Number(r.amount_cents); byCust.set(r.customer_id as string, e);
    }
    let confronto: unknown = undefined;
    if (a.compare_previous) {
      const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
      const pTo = new Date(Date.parse(from) - 86_400_000).toISOString().slice(0, 10), pFrom = new Date(Date.parse(from) - days * 86_400_000).toISOString().slice(0, 10);
      const prev = (await fetch(pFrom, pTo)).reduce((n, r) => n + Number(r.amount_cents), 0);
      confronto = { periodo_precedente: { da: pFrom, a: pTo }, fatturato_eur: eur(prev), variazione_pct: pct(total, prev) };
    }
    // fatture non incassate (tutte, qualunque periodo): stato indicato dall'utente
    let uq = db.from("quote_billings").select("amount_cents, billed_at, reference, customer_id, customers(name)").eq("organization_id", orgId).eq("payment_status", "unpaid").order("billed_at").limit(200);
    if (a.customer_id) uq = uq.eq("customer_id", a.customer_id);
    const { data: unpaid } = await uq;
    const nonIncassate = (unpaid ?? []).map((u) => ({ cliente: one(u.customers as { name: string } | { name: string }[])?.name, importo_eur: eur(u.amount_cents), fatturata_il: u.billed_at, giorni: Math.max(0, Math.floor((Date.parse(today) - Date.parse(u.billed_at as string)) / 86_400_000)), riferimento: u.reference }));
    // accettati non ancora (del tutto) fatturati
    const { data: acc } = await db.from("quotes").select("id, number, total_cents, issue_date, customers(name)").eq("organization_id", orgId).eq("status", "accepted").is("deleted_at", null).limit(2000);
    const ids = (acc ?? []).map((x) => x.id as string);
    const { data: billed } = ids.length ? await db.from("quote_billings").select("quote_id, amount_cents").eq("organization_id", orgId).in("quote_id", ids.slice(0, 500)) : { data: [] };
    const bq = new Map<string, number>();
    for (const b of billed ?? []) bq.set(b.quote_id as string, (bq.get(b.quote_id as string) ?? 0) + Number(b.amount_cents));
    const daFatturare = (acc ?? []).slice(0, 500).map((x) => ({ numero: x.number, cliente: one(x.customers as { name: string } | { name: string }[])?.name, residuo_eur: eur(Number(x.total_cents) - (bq.get(x.id as string) ?? 0)) })).filter((x) => x.residuo_eur > 0);
    return { data: { periodo: { da: from, a: to }, fatturato_registrato_eur: eur(total), incassato_nel_periodo_eur: eur(paid), non_incassato_nel_periodo_eur: eur(total - paid), registrazioni: rows.length,
      per_mese: [...byMonth.entries()].sort().map(([m, c]) => ({ mese: m, eur: eur(c) })),
      per_cliente: [...byCust.values()].sort((x, y) => y.c - x.c).slice(0, 8).map((x) => ({ cliente: x.nome, eur: eur(x.c) })), confronto,
      accettati_da_fatturare: { preventivi: daFatturare.length, residuo_totale_eur: Math.round(daFatturare.reduce((n, x) => n + x.residuo_eur, 0) * 100) / 100, primi: daFatturare.slice(0, 5) },
      fatture_non_incassate: { totale: nonIncassate.length, importo_totale_eur: Math.round(nonIncassate.reduce((n, x) => n + x.importo_eur, 0) * 100) / 100, elenco: nonIncassate.slice(0, 15) }, avvertenza: FISCAL_NOTE },
      sources: [{ label: "Preventivi e fatturato registrato", href: "/preventivi" }] };
  },
});

export const getSalesStatistics = defineTool({
  name: "get_sales_statistics",
  description: "Andamento mensile degli ultimi N mesi: preventivi emessi/accettati/rifiutati (numero e importi), conversione, fatturato registrato, variazioni mese su mese.",
  args: "{ months?: 2-24 (default 6) }",
  permission: "data:read",
  schema: z.object({ months: limitArg(6, 24).refine((n) => n >= 2, "almeno 2 mesi") }),
  async run({ db, orgId, today }, a) {
    const months = lastMonths(today, a.months), from = `${months[0]}-01`;
    const [{ data: qs }, { data: bs }] = await Promise.all([
      db.from("quotes").select("status, total_cents, issue_date").eq("organization_id", orgId).is("deleted_at", null).neq("status", "draft").gte("issue_date", from).limit(5000),
      db.from("quote_billings").select("amount_cents, billed_at").eq("organization_id", orgId).gte("billed_at", from).limit(5000),
    ]);
    const rows = months.map((m) => {
      const q = (qs ?? []).filter((x) => String(x.issue_date).startsWith(m)), b = (bs ?? []).filter((x) => String(x.billed_at).startsWith(m));
      const acc = q.filter((x) => x.status === "accepted"), rej = q.filter((x) => x.status === "rejected");
      return { mese: m, preventivi_emessi: q.length, emessi_eur: eur(q.reduce((n, x) => n + Number(x.total_cents), 0)), accettati: acc.length, accettati_eur: eur(acc.reduce((n, x) => n + Number(x.total_cents), 0)), rifiutati: rej.length,
        conversione_pct: acc.length + rej.length > 0 ? Math.round((acc.length / (acc.length + rej.length)) * 100) : null, fatturato_registrato_eur: eur(b.reduce((n, x) => n + Number(x.amount_cents), 0)) };
    });
    const withVar = rows.map((r, i) => ({ ...r, variazione_fatturato_vs_mese_prec_pct: i > 0 ? pct(r.fatturato_registrato_eur, rows[i - 1]!.fatturato_registrato_eur) : null }));
    return { data: { mesi: withVar, nota: `Il mese corrente (${months[months.length - 1]}) è parziale. Conversione = accettati/(accettati+rifiutati) dei soli preventivi con esito. ${FISCAL_NOTE}` }, sources: [{ label: "Andamento commerciale", href: "/dashboard" }] };
  },
});
