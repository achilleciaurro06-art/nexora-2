import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatEur } from "@/lib/money";
import { decideSuggestionAction } from "../actions";

export type SuggestionRow = { id: string; kind: string; payload: unknown };

const LABEL: Record<string, string> = { task: "Attività", insight: "Spunto", quote_draft: "Bozza preventivo da documento" };

export function SuggestionList({ suggestions, canDecide }: { suggestions: SuggestionRow[]; canDecide: boolean }) {
  if (suggestions.length === 0) return <p className="text-sm text-muted">Nessun suggerimento in attesa.</p>;
  return (
    <ul className="space-y-3 text-sm">
      {suggestions.map((s) => {
        const p = (s.payload ?? {}) as Record<string, unknown>;
        const isDraft = s.kind === "quote_draft";
        const items = Array.isArray(p.items) ? (p.items as { description: string; quantity: number; unit_price: number }[]) : [];
        return (
          <li key={s.id} className="rounded-md border border-border p-3">
            <Badge>{LABEL[s.kind] ?? s.kind}</Badge>
            {isDraft ? (
              <div className="mt-1 space-y-1">
                <p><strong>Cliente:</strong> {(p.client_name as string) || "— (da scegliere)"}</p>
                <p><strong>Oggetto:</strong> {(p.quote_title as string) || "—"}</p>
                {items.length > 0 ? (
                  <ul className="list-disc pl-4 text-muted">{items.slice(0, 6).map((i, n) => <li key={n}>{i.description} — {i.quantity} × {formatEur(Math.round(i.unit_price * 100))}</li>)}</ul>
                ) : (
                  <p><strong>Importo:</strong> {typeof p.amount === "number" ? formatEur(Math.round(p.amount * 100)) : "—"}</p>
                )}
                <p className="text-xs text-muted">Verrà creata una bozza modificabile: controllala prima di inviarla.</p>
              </div>
            ) : (
              <>
                <p className="mt-1 font-medium">{p.title as string}</p>
                {typeof p.description === "string" && <p className="text-muted">{p.description}</p>}
                {typeof p.due_date === "string" && <p className="text-xs text-muted">Scadenza: {p.due_date}</p>}
              </>
            )}
            {canDecide && (
              <form action={decideSuggestionAction.bind(null, s.id)} className="mt-2 flex gap-2">
                <Button size="sm" name="decision" value="accept">{isDraft ? "Crea bozza" : s.kind === "task" ? "Crea attività" : "Ok"}</Button>
                <Button size="sm" variant="outline" name="decision" value="reject">Scarta</Button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
