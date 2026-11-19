"use client";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { useFormAction } from "@/lib/use-form-action";
import { addBillingAction } from "../actions";

/** Registrazione di un importo fatturato: il campo si svuota solo a salvataggio riuscito. */
export function BillingForm({ quoteId, today, suggestedAmount }: { quoteId: string; today: string; suggestedAmount: string }) {
  const { state, pending, onSubmit } = useFormAction(addBillingAction.bind(null, quoteId));
  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" aria-label="Registra fatturato">
      <div><Label htmlFor="amount">Importo fatturato (€)</Label><Input id="amount" name="amount" inputMode="decimal" defaultValue={suggestedAmount} required /></div>
      <div><Label htmlFor="billedAt">Data</Label><Input id="billedAt" name="billedAt" type="date" defaultValue={today} required /></div>
      <div><Label htmlFor="reference">Riferimento (es. n. fattura)</Label><Input id="reference" name="reference" maxLength={80} /></div>
      <div><Label htmlFor="billing-note">Nota</Label><Input id="billing-note" name="note" maxLength={500} /></div>
      {state && !state.ok && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
      {state?.ok && <div className="sm:col-span-2"><Alert kind="success">Fatturato registrato</Alert></div>}
      <div className="sm:col-span-2"><Button size="sm" disabled={pending}>{pending ? "Registrazione…" : "Registra fatturato"}</Button></div>
    </form>
  );
}
