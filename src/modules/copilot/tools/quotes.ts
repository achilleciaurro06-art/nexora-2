import "server-only";
import { z } from "zod";
import { defineTool } from "./types";
import type { ToolCtx } from "./types";
import { daysBetween, eur, isoDay, likeTerm, limitArg, one, untrusted } from "./util";
import { loadPriceHistory } from "@/modules/prezzi/service";
import { analyzeItem, MIN_SAMPLES } from "@/modules/prezzi/stats";

const STATUS = z.enum(["draft", "sent", "accepted", "rejected", "expired"]);

async function findQuote(ctx: ToolCtx, ref: { quote_id?: string; number?: string }) {
  let q = ctx.db.from("quotes").select("id, number, title, status, total_cents, subtotal_cents, vat_cents, issue_date, valid_until, follow_up_date, notes, terms, customer_id, customers(name, email)").eq("organization_id", ctx.orgId).is("deleted_at", null);
  q = ref.quote_id ? q.eq("id", ref.quote_id) : q.eq("number", ref.number ?? "");
  const { data } = await q.maybeSingle();
  return data;
}

export const searchQuotes = defineTool({
  name: "search_quotes",
  description: "Cerca preventivi per stato, cliente, periodo, importo, testo (numero/oggetto). Con 'unanswered' restituisce i preventivi INVIATI ancora senza esito.",
  args: "{ query?: string, status?: 'draft'|'sent'|'accepted'|'rejected'|'expired', customer_id?: uuid, from?: AAAA-MM-GG, to?: AAAA-MM-GG, min_total_eur?: number, unanswered?: boolean, order?: 'recent'|'oldest'|'highest', limit?: 1-30 }",
  permission: "data:read",
  schema: z.object({ query: z.string().max(80).optional(), status: STATUS.optional(), customer_id: z.uuid().optional(), from: isoDay.optional(), to: isoDay.optional(), min_total_eur: z.number().min(0).max(1e9).optional(),
    unanswered: z.boolean().optional(), order: z.enum(["recent", "oldest", "highest"]).default("recent"), limit: limitArg(10, 30) }),
  async run({ db, orgId, now }, a) {
    let q = db.from("quotes").select("id, number, title, status, total_cents, issue_date, valid_until, follow_up_date, customer_id, customers(name)", { count: "exact" }).eq("organization_id", orgId).is("deleted_at", null);
    if (a.unanswered) q = q.eq("status", "sent"); else if (a.status) q = q.eq("status", a.status);
    if (a.customer_id) q = q.eq("customer_id", a.customer_id);
    if (a.from) q = q.gte("issue_date", a.from);
    if (a.to) q = q.lte("issue_date", a.to);
    if (a.min_total_eur !== undefined) q = q.gte("total_cents", Math.round(a.min_total_eur * 100));
    const t = likeTerm(a.query ?? "");
    if (t) q = q.or(`number.ilike.%${t}%,title.ilike.%${t}%`);
    q = a.order === "highest" ? q.order("total_cents", { ascending: false }) : q.order("issue_date", { ascending: a.order === "oldest" });
    const { data, count } = await q.limit(a.limit);
    return { data: { totale_corrispondenti: count ?? 0, preventivi: (data ?? []).map((x) => ({ id: x.id, numero: x.number, oggetto: x.title, stato: x.status, cliente: one(x.customers as { name: string } | { name: string }[])?.name, cliente_id: x.customer_id,
      importo_eur: eur(x.total_cents), emesso_il: x.issue_date, giorni_dall_emissione: daysBetween(`${x.issue_date}T00:00:00Z`, now), valido_fino_al: x.valid_until, follow_up: x.follow_up_date })) },
      sources: [{ label: "Elenco preventivi", href: "/preventivi" }] };
  },
});

export const getQuoteDetails = defineTool({
  name: "get_quote_details",
  description: "Dettaglio di un preventivo (righe, importi, stato, scadenze, fatturato registrato collegato).",
  args: "{ quote_id?: uuid, number?: 'AAAA/NNNN' } (uno dei due)",
  permission: "data:read",
  schema: z.object({ quote_id: z.uuid().optional(), number: z.string().regex(/^\d{4}\/\d{3,5}$/).optional() }).refine((v) => v.quote_id || v.number, "serve quote_id o number"),
  async run(ctx, a) {
    const q = await findQuote(ctx, a);
    if (!q) return { data: { errore: "Preventivo non trovato" } };
    const [{ data: items }, { data: bill }] = await Promise.all([
      ctx.db.from("quote_items").select("description, quantity, unit_price_cents, discount_percent, vat_rate, line_net_cents").eq("organization_id", ctx.orgId).eq("quote_id", q.id).order("position").limit(100),
      ctx.db.from("quote_billings").select("amount_cents, billed_at, reference").eq("organization_id", ctx.orgId).eq("quote_id", q.id).limit(50),
    ]);
    const cust = one(q.customers as { name: string; email: string | null } | { name: string; email: string | null }[]);
    return { data: { id: q.id, numero: q.number, oggetto: q.title, stato: q.status, cliente: cust?.name, cliente_id: q.customer_id, emesso_il: q.issue_date, valido_fino_al: q.valid_until, follow_up: q.follow_up_date,
      imponibile_eur: eur(q.subtotal_cents), iva_eur: eur(q.vat_cents), totale_eur: eur(q.total_cents),
      righe: (items ?? []).map((r) => ({ descrizione: r.description, quantita: Number(r.quantity), prezzo_unitario_eur: eur(r.unit_price_cents), sconto_pct: Number(r.discount_percent), iva_pct: Number(r.vat_rate), netto_riga_eur: eur(r.line_net_cents) })),
      note: q.notes ? untrusted(q.notes, 400) : null, condizioni: q.terms ? untrusted(q.terms, 300) : null,
      fatturato_registrato_eur: eur((bill ?? []).reduce((n, b) => n + Number(b.amount_cents), 0)), registrazioni_fatturato: (bill ?? []).length },
      sources: [{ label: `Preventivo ${q.number}`, href: `/preventivi/${q.id}` }] };
  },
});

export const analyzeQuote = defineTool({
  name: "analyze_quote",
  description: "Analisi di un preventivo su dati reali: prezzi di ogni riga confrontati con lo STORICO dell'azienda (solo preventivi inviati/accettati), informazioni mancanti, preventivi precedenti dello stesso cliente. Non esistono costi né margini nel sistema.",
  args: "{ quote_id?: uuid, number?: 'AAAA/NNNN' } (uno dei due)",
  permission: "data:read",
  schema: z.object({ quote_id: z.uuid().optional(), number: z.string().regex(/^\d{4}\/\d{3,5}$/).optional() }).refine((v) => v.quote_id || v.number, "serve quote_id o number"),
  async run(ctx, a) {
    const q = await findQuote(ctx, a);
    if (!q) return { data: { errore: "Preventivo non trovato" } };
    const [{ data: items }, history, { data: prev }] = await Promise.all([
      ctx.db.from("quote_items").select("id, description, quantity, unit_price_cents, discount_percent").eq("organization_id", ctx.orgId).eq("quote_id", q.id).order("position").limit(60),
      loadPriceHistory(ctx.db, ctx.orgId, q.id),
      ctx.db.from("quotes").select("number, status, total_cents, issue_date").eq("organization_id", ctx.orgId).eq("customer_id", q.customer_id).neq("id", q.id).is("deleted_at", null).order("issue_date", { ascending: false }).limit(10),
    ]);
    const rows = (items ?? []).map((r) => analyzeItem({ id: r.id as string, description: r.description as string, unitPriceCents: Number(r.unit_price_cents), discountPercent: Number(r.discount_percent) }, history, q.id));
    const cust = one(q.customers as { name: string; email: string | null } | { name: string; email: string | null }[]);
    const mancanti: string[] = [];
    if (!q.title) mancanti.push("oggetto del preventivo");
    if (!q.valid_until) mancanti.push("data di validità");
    if (!q.terms) mancanti.push("condizioni (pagamento, consegna)");
    if (!cust?.email) mancanti.push("email del cliente (serve per l'invio)");
    if ((items ?? []).length === 0) mancanti.push("righe del preventivo");
    if ((items ?? []).some((r) => Number(r.unit_price_cents) === 0)) mancanti.push("una o più righe hanno prezzo 0");
    if (q.status === "sent" && !q.follow_up_date) mancanti.push("data di follow-up");
    const decided = (prev ?? []).filter((p) => p.status === "accepted" || p.status === "rejected");
    return { data: { preventivo: { id: q.id, numero: q.number, stato: q.status, totale_eur: eur(q.total_cents), cliente: cust?.name },
      prezzi_righe: rows.map((r) => ({ descrizione: r.description, prezzo_netto_eur: eur(r.current_unit_price_cents), esito: r.verdict, scostamento_pct: r.deviation_pct, prezzo_suggerito_eur: r.suggested_unit_price_cents === null ? null : eur(r.suggested_unit_price_cents), confronti: r.stats?.n ?? 0,
        mediana_storica_eur: r.stats ? eur(r.stats.median) : null, spiegazione: r.rationale })),
      avvertenza_prezzi: `Confronto SOLO con lo storico dei preventivi inviati/accettati dell'azienda; servono almeno ${MIN_SAMPLES} voci simili, altrimenti 'insufficient_data'. Nessun prezzo di mercato.`,
      informazioni_mancanti: mancanti,
      storico_cliente: { preventivi_precedenti: (prev ?? []).length, accettati: decided.filter((p) => p.status === "accepted").length, rifiutati: decided.filter((p) => p.status === "rejected").length,
        ultimi: (prev ?? []).slice(0, 4).map((p) => ({ numero: p.number, stato: p.status, importo_eur: eur(p.total_cents), data: p.issue_date })) },
      margini: "Non disponibili: NEXORA non registra i costi, quindi non è possibile calcolare margini." },
      sources: [{ label: `Preventivo ${q.number}`, href: `/preventivi/${q.id}` }, { label: "Storico prezzi dell'azienda" }] };
  },
});
