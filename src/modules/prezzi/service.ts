import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAi } from "@/server/ai/run";
import { analyzeItem, isSafeRationale, MIN_SAMPLES, netUnitCents, type HistoryItem, type ItemAnalysis } from "./stats";

/** Storico di riferimento: voci di preventivi INVIATI o ACCETTATI dell'azienda (le bozze non sono prezzi "reali"). */
const HISTORY_STATUSES = ["sent", "accepted"];
const HISTORY_LIMIT = 3000;

export async function loadPriceHistory(db: SupabaseClient, orgId: string, excludeQuoteId?: string): Promise<HistoryItem[]> {
  let q = db.from("quote_items")
    .select("description, unit_price_cents, discount_percent, quote_id, quotes!inner(status, deleted_at, number, issue_date)")
    .eq("organization_id", orgId).is("quotes.deleted_at", null).in("quotes.status", HISTORY_STATUSES)
    .order("created_at", { ascending: false }).limit(HISTORY_LIMIT);
  if (excludeQuoteId) q = q.neq("quote_id", excludeQuoteId);
  const { data } = await q;
  return (data ?? []).map((r) => {
    const quote = Array.isArray(r.quotes) ? r.quotes[0] : r.quotes;
    return {
      description: r.description as string, unitPriceCents: netUnitCents(Number(r.unit_price_cents), Number(r.discount_percent)),
      status: (quote as { status: string }).status, quoteId: r.quote_id as string,
      quoteNumber: (quote as { number: string }).number, issueDate: (quote as { issue_date: string }).issue_date,
    };
  });
}

const rationaleSchema = z.object({ rationales: z.array(z.object({ index: z.number().int().min(0), text: z.string() })).max(60) });
const RATIONALE_SCHEMA = {
  type: "object",
  properties: { rationales: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, text: { type: "string" } }, required: ["index", "text"] } } },
  required: ["rationales"],
};
const SYSTEM = `Sei un assistente commerciale. Ti vengono forniti, per alcune voci di un preventivo, il verdetto già calcolato dal sistema sul prezzo rispetto allo STORICO dell'azienda.
Per ogni voce scrivi una motivazione di massimo due frasi, in italiano, che spieghi in modo qualitativo il verdetto.
Regole inderogabili:
- NON scrivere cifre, percentuali o importi: i numeri sono già mostrati separatamente.
- NON citare prezzi di mercato, concorrenti, costi o margini: non li conosci. Parla solo di "storico dei tuoi preventivi".
- Non cambiare il verdetto. Se il verdetto è "ok" conferma che il prezzo è in linea con lo storico.
Rispondi SOLO con JSON: {"rationales":[{"index":0,"text":"..."}]}.`;

export type PriceAnalysisResult =
  | { ok: true; analysisId: string; items: ItemAnalysis[]; historyCount: number; suggestions: number }
  | { ok: false; error: string };

export async function analyzeQuotePrices(args: { db: SupabaseClient; orgId: string; userId: string; quoteId: string }): Promise<PriceAnalysisResult> {
  const { db, orgId, userId, quoteId } = args;
  const { data: quote } = await db.from("quotes").select("id").eq("organization_id", orgId).eq("id", quoteId).is("deleted_at", null).maybeSingle();
  if (!quote) return { ok: false, error: "Preventivo non trovato" };
  const { data: rows } = await db.from("quote_items").select("id, description, unit_price_cents, discount_percent").eq("organization_id", orgId).eq("quote_id", quoteId).order("position");
  if (!rows || rows.length === 0) return { ok: false, error: "Il preventivo non ha righe da analizzare" };

  const history = await loadPriceHistory(db, orgId, quoteId);
  const items = rows.map((r) => analyzeItem(
    { id: r.id as string, description: r.description as string, unitPriceCents: Number(r.unit_price_cents), discountPercent: Number(r.discount_percent) }, history, quoteId));

  // L'AI interviene solo dove c'è abbastanza storico (n >= 3) e solo per spiegare, in forma qualitativa
  let model: string | null = null;
  const assessable = items.map((it, index) => ({ it, index })).filter(({ it }) => it.verdict !== "insufficient_data" && (it.stats?.n ?? 0) >= MIN_SAMPLES);
  if (assessable.length > 0) {
    const payload = JSON.stringify(assessable.map(({ it, index }) => ({
      index, voce: it.description.slice(0, 120), verdetto: it.verdict, confronti_storici: it.stats?.n,
    })));
    const out = await runAi({ orgId, userId, feature: "price_analysis", req: { system: SYSTEM, messages: [{ role: "user", content: payload }], jsonSchema: RATIONALE_SCHEMA, maxOutputTokens: 800 } });
    // se l'AI non è disponibile (o i crediti sono finiti) si prosegue con le motivazioni deterministiche: l'analisi numerica resta valida
    if (out.ok) {
      model = out.res.model;
      try {
        const parsed = rationaleSchema.safeParse(JSON.parse(out.res.text));
        if (parsed.success) for (const r of parsed.data.rationales) {
          const target = items[r.index];
          if (target && assessable.some((a) => a.index === r.index) && isSafeRationale(r.text)) target.rationale = r.text.trim();
        }
      } catch { /* risposta non leggibile: restano le motivazioni deterministiche */ }
    }
  }

  const { data: analysis, error } = await db.from("price_analyses").insert({ organization_id: orgId, quote_id: quoteId, items, model, created_by: userId }).select("id").single();
  if (error || !analysis) return { ok: false, error: "Impossibile salvare l'analisi" };

  // proposte attuabili: una per voce anomala. Quelle precedenti non ancora decise vengono sostituite.
  await db.from("ai_suggestions").update({ status: "rejected" }).eq("organization_id", orgId).eq("kind", "price_review").eq("source_id", quoteId).eq("status", "pending");
  const actionable = items.filter((i) => (i.verdict === "low" || i.verdict === "high") && i.suggested_unit_price_cents !== null);
  if (actionable.length > 0) {
    await db.from("ai_suggestions").insert(actionable.map((i) => ({
      organization_id: orgId, kind: "price_review", source_type: "quote", source_id: quoteId, created_by: userId,
      payload: {
        quote_id: quoteId, analysis_id: analysis.id, item_id: i.item_id, description: i.description, verdict: i.verdict,
        current_unit_price_cents: i.current_unit_price_cents, suggested_unit_price_cents: i.suggested_unit_price_cents,
        deviation_pct: i.deviation_pct, stats: i.stats, rationale: i.rationale,
      },
    })));
  }
  return { ok: true, analysisId: analysis.id as string, items, historyCount: history.length, suggestions: actionable.length };
}
