import { formatEur } from "@/lib/money";
import { normalizeSuggestionPayload } from "@/modules/documenti/extraction";
import { SuggestionCard, type SuggestionView } from "./suggestion-card";

export type SuggestionRow = { id: string; kind: string; payload: unknown };

const s = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Elenco delle proposte in attesa. I dati vengono preparati lato server; la decisione resta sempre all'utente. */
export function SuggestionList({ suggestions, canDecide }: { suggestions: SuggestionRow[]; canDecide: boolean }) {
  const rows = suggestions.filter((x) => x.kind !== "price_review"); // le proposte di prezzo si gestiscono nel preventivo
  if (rows.length === 0) return <p className="text-sm text-muted">Nessun suggerimento in attesa.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const p = (r.payload ?? {}) as Record<string, unknown>;
        let draft: SuggestionView["draft"];
        if (r.kind === "quote_draft") {
          const n = normalizeSuggestionPayload(r.payload);
          draft = {
            client: n?.data.client.name, title: n?.data.quote.title, items: n?.data.items.length ?? 0,
            total: typeof n?.data.quote.total === "number" ? formatEur(Math.round(n.data.quote.total * 100)) : undefined,
            warnings: n?.checks.warnings.length ?? 0, duplicates: n?.checks.duplicates.length ?? 0,
          };
        }
        const view: SuggestionView = {
          id: r.id, kind: r.kind, canDecide, draft,
          fields: {
            title: s(p.title), description: s(p.description), due_date: s(p.due_date), follow_up_date: s(p.follow_up_date), body: s(p.body),
            customer_name: s(p.customer_name), quote_number: s(p.quote_number), reason: s(p.reason),
          },
        };
        return <SuggestionCard key={r.id} s={view} />;
      })}
    </ul>
  );
}
