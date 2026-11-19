"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { formatEur, quoteTotals } from "@/lib/money";
import type { ActionResult } from "@/lib/result";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
export type Line = { description: string; quantity: string; price: string; discount: string; vat: string };
export type LineItemInput = { description: string; quantity: number; unit_price_cents: number; discount_percent: number; vat_rate: number };
export type QuoteFormInitial = {
  customerId?: string; title?: string | null; issueDate?: string; validUntil?: string | null; followUpDate?: string | null; notes?: string | null; terms?: string | null;
  items?: LineItemInput[];
};

export const emptyLine = (): Line => ({ description: "", quantity: "1", price: "0", discount: "0", vat: "22" });
const num = (s: string) => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export function linesFromItems(items: LineItemInput[] | undefined): Line[] {
  return items?.length
    ? items.map((i) => ({ description: i.description, quantity: String(i.quantity), price: (i.unit_price_cents / 100).toFixed(2), discount: String(i.discount_percent), vat: String(i.vat_rate) }))
    : [emptyLine()];
}
export function linesToPayload(lines: Line[]) {
  return lines.map((l) => ({
    description: l.description, quantity: num(l.quantity), unitPriceCents: Math.round(num(l.price) * 100),
    discountPercent: num(l.discount), vatRate: num(l.vat),
  }));
}

/** Editor righe + totali, condiviso tra preventivo e revisione dei documenti. */
export function QuoteLinesEditor({ lines, onChange }: { lines: Line[]; onChange: (l: Line[]) => void }) {
  const totals = quoteTotals(linesToPayload(lines));
  const update = (i: number, patch: Partial<Line>) => onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  return (
    <>
      <div className="space-y-2">
        <h2 className="font-medium">Righe</h2>
        <div className="hidden gap-2 text-xs text-muted sm:grid sm:grid-cols-[1fr_80px_110px_80px_80px_36px]">
          <span>Descrizione</span><span>Qtà</span><span>Prezzo (€)</span><span>Sconto %</span><span>IVA %</span><span />
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_80px_110px_80px_80px_36px]">
            <Input aria-label="Descrizione" value={l.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="Descrizione" />
            <Input aria-label="Quantità" inputMode="decimal" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
            <Input aria-label="Prezzo" inputMode="decimal" value={l.price} onChange={(e) => update(i, { price: e.target.value })} />
            <Input aria-label="Sconto" inputMode="decimal" value={l.discount} onChange={(e) => update(i, { discount: e.target.value })} />
            <Input aria-label="IVA" inputMode="decimal" value={l.vat} onChange={(e) => update(i, { vat: e.target.value })} />
            <Button type="button" variant="ghost" size="sm" aria-label="Rimuovi riga" disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, idx) => idx !== i))}>
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, emptyLine()])}><Plus size={14} /> Aggiungi riga</Button>
      </div>
      <dl className="ml-auto grid max-w-xs grid-cols-2 gap-1 text-sm">
        <dt className="text-muted">Imponibile</dt><dd className="text-right">{formatEur(totals.subtotalCents)}</dd>
        <dt className="text-muted">IVA</dt><dd className="text-right">{formatEur(totals.vatCents)}</dd>
        <dt className="font-semibold">Totale</dt><dd className="text-right font-semibold">{formatEur(totals.totalCents)}</dd>
      </dl>
    </>
  );
}

export function QuoteForm({ action, customers, initial }: { action: Action; customers: { id: string; name: string }[]; initial?: QuoteFormInitial }) {
  const [state, formAction, pending] = useActionState(action, null);
  const [lines, setLines] = useState<Line[]>(linesFromItems(initial?.items));
  const payload = useMemo(() => linesToPayload(lines), [lines]);
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k]?.[0] : undefined);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="items" value={JSON.stringify(payload)} />
      <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="customerId">Cliente *</Label>
          <Select id="customerId" name="customerId" required defaultValue={initial?.customerId ?? ""}>
            <option value="" disabled>Seleziona…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          {err("customerId") && <p className="mt-1 text-xs text-danger">{err("customerId")}</p>}
        </div>
        <div><Label htmlFor="title">Oggetto</Label><Input id="title" name="title" defaultValue={initial?.title ?? ""} /></div>
        <div><Label htmlFor="issueDate">Data emissione</Label><Input id="issueDate" name="issueDate" type="date" defaultValue={initial?.issueDate ?? new Date().toISOString().slice(0, 10)} /></div>
        <div><Label htmlFor="validUntil">Valido fino al</Label><Input id="validUntil" name="validUntil" type="date" defaultValue={initial?.validUntil ?? ""} /></div>
        <div><Label htmlFor="followUpDate">Promemoria follow-up</Label><Input id="followUpDate" name="followUpDate" type="date" defaultValue={initial?.followUpDate ?? ""} /></div>
      </div>

      <QuoteLinesEditor lines={lines} onChange={setLines} />

      <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
        <div><Label htmlFor="notes">Note</Label><Textarea id="notes" name="notes" defaultValue={initial?.notes ?? ""} /></div>
        <div><Label htmlFor="terms">Condizioni</Label><Textarea id="terms" name="terms" defaultValue={initial?.terms ?? ""} /></div>
      </div>
      {state && !state.ok && <Alert>{state.error}</Alert>}
      <Button disabled={pending}>{pending ? "Salvataggio…" : "Salva preventivo"}</Button>
    </form>
  );
}
