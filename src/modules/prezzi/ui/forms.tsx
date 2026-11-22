"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { analyzePricesAction, applyPriceSuggestionAction, rejectPriceSuggestionAction } from "../actions";

export function AnalyzePricesButton({ quoteId, hasAnalysis }: { quoteId: string; hasAnalysis: boolean }) {
  const [state, action, pending] = useActionState(analyzePricesAction.bind(null, quoteId), null);
  return (
    <form action={action} className="space-y-2">
      <Button disabled={pending}>{pending ? "Analisi in corso…" : hasAnalysis ? "Rianalizza i prezzi" : "Analizza i prezzi con l'AI"}</Button>
      {state && !state.ok && <Alert>{state.error}</Alert>}
    </form>
  );
}

export function PriceSuggestionForm({ suggestionId, quoteId, suggestedCents, editable }: { suggestionId: string; quoteId: string; suggestedCents: number; editable: boolean }) {
  const [state, action, pending] = useActionState(applyPriceSuggestionAction.bind(null, suggestionId), null);
  if (state?.ok) return <p role="status" className="text-sm text-success">Prezzo aggiornato.</p>;
  return (
    <form action={action} className="space-y-2">
      <Label htmlFor={`price-${suggestionId}`}>Prezzo unitario da applicare (al netto dello sconto)</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input id={`price-${suggestionId}`} name="price" inputMode="decimal" defaultValue={(suggestedCents / 100).toFixed(2).replace(".", ",")} className="w-32" disabled={!editable} />
        <Button size="sm" disabled={pending || !editable}>{pending ? "Applico…" : "Applica"}</Button>
        <Button size="sm" variant="outline" type="button" disabled={pending} formAction={rejectPriceSuggestionAction.bind(null, suggestionId, quoteId)} formNoValidate>Ignora</Button>
      </div>
      {!editable && <p className="text-xs text-muted">Il preventivo non è in bozza: riportalo in bozza per modificare i prezzi.</p>}
      {state && !state.ok && <Alert>{state.error}</Alert>}
    </form>
  );
}
