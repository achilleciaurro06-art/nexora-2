import "server-only";
import { z } from "zod";
import { defineTool } from "./types";
import { eur, likeTerm, limitArg } from "./util";

export const getCatalogProducts = defineTool({
  name: "get_catalog_products",
  description: "Prodotti e servizi del catalogo con prezzo, categoria, utilizzo nei preventivi e segnalazioni di qualità (descrizione o categoria mancante, prezzo a 0, nomi duplicati, prezzo diverso da quello usato nei preventivi).",
  args: "{ query?: string, category?: string, issues_only?: boolean, limit?: 1-40 }",
  permission: "data:read",
  schema: z.object({ query: z.string().max(80).optional(), category: z.string().max(80).optional(), issues_only: z.boolean().default(false), limit: limitArg(20, 40) }),
  async run({ db, orgId }, a) {
    const { data } = await db.from("products").select("id, kind, code, name, description, category, unit, unit_price_cents, vat_rate, active").eq("organization_id", orgId).is("deleted_at", null).order("name").limit(600);
    const all = data ?? [];
    const names = new Map<string, number>();
    for (const p of all) { const k = String(p.name).toLowerCase().trim(); names.set(k, (names.get(k) ?? 0) + 1); }
    // utilizzo nei preventivi inviati/accettati: righe con descrizione uguale al nome del prodotto
    const { data: items } = await db.from("quote_items").select("description, unit_price_cents, discount_percent, quotes!inner(status, deleted_at)").eq("organization_id", orgId).is("quotes.deleted_at", null).in("quotes.status", ["sent", "accepted"]).limit(4000);
    const use = new Map<string, { n: number; prices: number[] }>();
    for (const r of items ?? []) { const k = String(r.description).toLowerCase().trim(); const e = use.get(k) ?? { n: 0, prices: [] }; e.n++; e.prices.push(Math.round(Number(r.unit_price_cents) * (1 - Number(r.discount_percent) / 100))); use.set(k, e); }
    const t = likeTerm(a.query ?? "").toLowerCase();
    const rows = all.filter((p) => (!t || `${p.name} ${p.code ?? ""} ${p.category ?? ""}`.toLowerCase().includes(t)) && (!a.category || (p.category ?? "").toLowerCase() === a.category.toLowerCase())).map((p) => {
      const u = use.get(String(p.name).toLowerCase().trim());
      const problemi: string[] = [];
      if (!p.description) problemi.push("descrizione mancante");
      if (!p.category) problemi.push("categoria mancante");
      if (Number(p.unit_price_cents) === 0) problemi.push("prezzo a 0");
      if ((names.get(String(p.name).toLowerCase().trim()) ?? 0) > 1) problemi.push("nome duplicato");
      if (u && u.prices.length >= 3) { const med = [...u.prices].sort((x, y) => x - y)[Math.floor(u.prices.length / 2)]!; if (Math.abs(med - Number(p.unit_price_cents)) / Math.max(1, Number(p.unit_price_cents)) > 0.2) problemi.push(`prezzo di listino diverso (>20%) dalla mediana usata nei preventivi (${eur(med)} €)`); }
      return { id: p.id, tipo: p.kind, codice: p.code, nome: p.name, descrizione: p.description, categoria: p.category, unita: p.unit, prezzo_eur: eur(p.unit_price_cents), iva_pct: Number(p.vat_rate), attivo: p.active, usato_nei_preventivi: u?.n ?? 0, problemi };
    });
    const sel = (a.issues_only ? rows.filter((r) => r.problemi.length) : rows);
    const categorie = [...new Set(all.map((p) => p.category).filter(Boolean))].slice(0, 30);
    return { data: { totale_catalogo: all.length, con_problemi: rows.filter((r) => r.problemi.length).length, categorie_esistenti: categorie, prodotti: sel.slice(0, a.limit),
      nota: "Costi non presenti nel catalogo: nessuna analisi di margine possibile. L'utilizzo è calcolato confrontando il nome del prodotto con le descrizioni delle righe dei preventivi." }, sources: [{ label: "Catalogo", href: "/catalogo" }] };
  },
});
