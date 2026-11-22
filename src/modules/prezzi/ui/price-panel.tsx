import { createClient } from "@/server/supabase/server";
import { Badge, Card } from "@/components/ui/card";
import { formatEur } from "@/lib/money";
import { AnalyzePricesButton, PriceSuggestionForm } from "./forms";
import type { ItemAnalysis, Verdict } from "../stats";

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  low: { label: "Prezzo basso", cls: "border-warning text-warning" },
  high: { label: "Prezzo alto", cls: "border-danger text-danger" },
  ok: { label: "In linea", cls: "border-success text-success" },
  insufficient_data: { label: "Dati insufficienti", cls: "text-muted" },
};

export async function PricePanel({ orgId, quoteId, quoteStatus, canAnalyze, canApply }: { orgId: string; quoteId: string; quoteStatus: string; canAnalyze: boolean; canApply: boolean }) {
  const db = await createClient();
  const [{ data: analysis }, { data: pending }] = await Promise.all([
    db.from("price_analyses").select("id, items, created_at, model").eq("organization_id", orgId).eq("quote_id", quoteId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("ai_suggestions").select("id, payload").eq("organization_id", orgId).eq("kind", "price_review").eq("source_id", quoteId).eq("status", "pending"),
  ]);
  const items = ((analysis?.items ?? []) as ItemAnalysis[]);
  const pendingByItem = new Map((pending ?? []).map((s) => [(s.payload as { item_id: string }).item_id, s.id as string]));

  return (
    <Card className="no-print mt-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Analisi dei prezzi</h2>
          <p className="text-sm text-muted">Confronta ogni riga con lo storico dei tuoi preventivi inviati o accettati. Non usa dati di mercato né margini: se lo storico non basta, lo dice.</p>
        </div>
        {canAnalyze && <AnalyzePricesButton quoteId={quoteId} hasAnalysis={items.length > 0} />}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted">Nessuna analisi ancora eseguita per questo preventivo.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted">Ultima analisi: {new Date(analysis!.created_at as string).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}. I suggerimenti sono facoltativi e non vengono mai applicati da soli.</p>
          <ul className="space-y-3">
            {items.map((it) => {
              const v = VERDICT[it.verdict];
              const sugId = pendingByItem.get(it.item_id);
              return (
                <li key={it.item_id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{it.description}</p>
                    <Badge className={v.cls}>{v.label}</Badge>
                  </div>
                  <p className="mt-1">Prezzo unitario netto: <strong>{formatEur(it.current_unit_price_cents)}</strong>
                    {it.deviation_pct !== null && <span className="text-muted"> ({it.deviation_pct > 0 ? "+" : ""}{it.deviation_pct}% rispetto alla mediana storica)</span>}
                  </p>
                  {it.stats ? (
                    <p className="text-muted">
                      Storico: {it.stats.n} {it.stats.n === 1 ? "voce simile" : "voci simili"} · min {formatEur(it.stats.min)} · mediana {formatEur(it.stats.median)} · max {formatEur(it.stats.max)}
                      {it.stats.medianAccepted !== null && ` · mediana sugli accettati ${formatEur(it.stats.medianAccepted)} (${it.stats.nAccepted})`}
                    </p>
                  ) : <p className="text-muted">Nessuna voce simile nello storico.</p>}
                  <p className="mt-1">{it.rationale}</p>
                  {it.samples.length > 0 && (
                    <details className="mt-1 text-xs text-muted">
                      <summary className="cursor-pointer">Voci confrontate</summary>
                      <ul className="mt-1 list-disc pl-5">{it.samples.map((s, i) => <li key={i}>{s.description} — {formatEur(s.unit_price_cents)}{s.quote_number ? ` (${s.quote_number}, ${s.status === "accepted" ? "accettato" : "inviato"})` : ""}</li>)}</ul>
                    </details>
                  )}
                  {sugId && it.suggested_unit_price_cents !== null && canApply && (
                    <div className="mt-3 rounded-md bg-primary/5 p-3">
                      <p className="mb-2">Prezzo suggerito (mediana storica): <strong>{formatEur(it.suggested_unit_price_cents)}</strong></p>
                      <PriceSuggestionForm suggestionId={sugId} quoteId={quoteId} suggestedCents={it.suggested_unit_price_cents} editable={quoteStatus === "draft"} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
