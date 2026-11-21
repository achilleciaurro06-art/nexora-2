"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import type { ActionResult } from "@/lib/result";
import { useFormAction } from "@/lib/use-form-action";
import { QuoteLinesEditor, linesFromItems, linesToPayload, type Line, type LineItemInput } from "@/modules/preventivi/ui/quote-form";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
type Initial = { name: string; description: string | null; title: string | null; notes: string | null; terms: string | null; active: boolean; items: LineItemInput[] };

export function TemplateForm({ action, initial, defaultVat = "22", readOnly }: { action: Action; initial?: Initial; defaultVat?: string; readOnly?: boolean }) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [lines, setLines] = useState<Line[]>(linesFromItems(initial?.items, defaultVat));
  const payload = useMemo(() => linesToPayload(lines).map((l) => ({ description: l.description, quantity: l.quantity, unit_price_cents: l.unitPriceCents, discount_percent: l.discountPercent, vat_rate: l.vatRate })), [lines]);
  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <input type="hidden" name="items" value={JSON.stringify(payload)} />
      <fieldset disabled={readOnly} className="grid max-w-4xl gap-4 sm:grid-cols-2">
        <div><Label htmlFor="name">Nome del modello *</Label><Input id="name" name="name" required maxLength={100} defaultValue={initial?.name ?? ""} /></div>
        <div><Label htmlFor="description">Descrizione</Label><Input id="description" name="description" maxLength={500} defaultValue={initial?.description ?? ""} /></div>
        <div><Label htmlFor="title">Oggetto del preventivo</Label><Input id="title" name="title" maxLength={200} defaultValue={initial?.title ?? ""} /></div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={initial?.active ?? true} /> Attivo (proponibile nei preventivi)</label>
        <div><Label htmlFor="notes">Note</Label><Textarea id="notes" name="notes" defaultValue={initial?.notes ?? ""} /></div>
        <div><Label htmlFor="terms">Condizioni</Label><Textarea id="terms" name="terms" defaultValue={initial?.terms ?? ""} /></div>
      </fieldset>
      <QuoteLinesEditor lines={lines} onChange={setLines} defaultVat={defaultVat} />
      {state && !state.ok && <Alert>{state.error}</Alert>}
      {state?.ok && <Alert kind="success">Modello salvato</Alert>}
      {!readOnly && <Button disabled={pending}>{pending ? "Salvataggio…" : "Salva modello"}</Button>}
    </form>
  );
}
