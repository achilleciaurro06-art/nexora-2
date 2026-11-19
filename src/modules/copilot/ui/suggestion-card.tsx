"use client";

import { Alert, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { decideSuggestionAction } from "../actions";
import { useFormAction } from "@/lib/use-form-action";

export type SuggestionView = {
  id: string; kind: string; canDecide: boolean;
  fields: { title?: string; description?: string; due_date?: string; follow_up_date?: string; body?: string; customer_name?: string; quote_number?: string; reason?: string };
  draft?: { client?: string; title?: string; items: number; total?: string; warnings: number; duplicates: number };
};

const LABEL: Record<string, string> = {
  task: "Attività", customer_followup: "Follow-up cliente", quote_followup: "Follow-up preventivo", customer_note: "Nota sul cliente",
  quote_draft: "Bozza di preventivo", insight: "Spunto", price_review: "Prezzo",
};
const APPLY: Record<string, string> = {
  task: "Crea attività", customer_followup: "Crea follow-up", quote_followup: "Imposta follow-up", customer_note: "Aggiungi nota", quote_draft: "Rivedi e crea bozza", insight: "Ok",
};

export function SuggestionCard({ s }: { s: SuggestionView }) {
  const { state, pending, onSubmit } = useFormAction(decideSuggestionAction.bind(null, s.id));
  const f = s.fields;
  if (state?.ok) return <li className="rounded-md border border-border p-3 text-sm text-muted">Fatto.</li>;
  return (
    <li className="rounded-md border border-border p-3 text-sm">
      <Badge>{LABEL[s.kind] ?? s.kind}</Badge>
      <form onSubmit={onSubmit} className="mt-2 space-y-2">
        {s.kind === "quote_draft" && s.draft ? (
          <div className="space-y-1">
            <p><strong>Cliente:</strong> {s.draft.client || "— (da scegliere)"}</p>
            <p><strong>Oggetto:</strong> {s.draft.title || "—"}</p>
            <p><strong>Righe:</strong> {s.draft.items} · <strong>Totale:</strong> {s.draft.total ?? "—"}</p>
            {s.draft.warnings > 0 && <p className="text-xs text-amber-600">{s.draft.warnings} controlli da verificare</p>}
            {s.draft.duplicates > 0 && <p className="text-xs text-danger">Possibile duplicato</p>}
            <p className="text-xs text-muted">Prima di creare la bozza potrai controllare e correggere ogni dato.</p>
          </div>
        ) : s.kind === "customer_note" ? (
          <>
            <p className="text-xs text-muted">Cliente: {f.customer_name}</p>
            <Label htmlFor={`b-${s.id}`}>Testo della nota (modificabile)</Label>
            <Textarea id={`b-${s.id}`} name="body" defaultValue={f.body ?? ""} disabled={!s.canDecide} />
          </>
        ) : s.kind === "quote_followup" ? (
          <>
            <p>Preventivo <strong>{f.quote_number}</strong>{f.reason ? ` — ${f.reason}` : ""}</p>
            <Label htmlFor={`d-${s.id}`}>Data di follow-up (modificabile)</Label>
            <Input id={`d-${s.id}`} name="follow_up_date" type="date" defaultValue={f.follow_up_date ?? ""} disabled={!s.canDecide} />
          </>
        ) : s.kind === "task" || s.kind === "customer_followup" ? (
          <>
            <Label htmlFor={`t-${s.id}`}>Titolo (modificabile)</Label>
            <Input id={`t-${s.id}`} name="title" defaultValue={f.title ?? ""} disabled={!s.canDecide} />
            {(f.customer_name || f.quote_number) && <p className="text-xs text-muted">{[f.customer_name && `Cliente: ${f.customer_name}`, f.quote_number && `Preventivo ${f.quote_number}`].filter(Boolean).join(" · ")}</p>}
            {f.description && <p className="text-muted">{f.description}</p>}
            <Label htmlFor={`due-${s.id}`}>Scadenza</Label>
            <Input id={`due-${s.id}`} name="due_date" type="date" defaultValue={f.due_date ?? ""} disabled={!s.canDecide} />
          </>
        ) : (
          <>
            <p className="font-medium">{f.title}</p>
            {f.description && <p className="text-muted">{f.description}</p>}
          </>
        )}
        {state && !state.ok && <Alert>{state.error}</Alert>}
        {s.canDecide && (
          <div className="flex gap-2">
            <Button size="sm" name="decision" value="accept" disabled={pending}>{APPLY[s.kind] ?? "Applica"}</Button>
            <Button size="sm" variant="outline" name="decision" value="reject" disabled={pending}>Scarta</Button>
          </div>
        )}
      </form>
    </li>
  );
}
