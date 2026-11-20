"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { RemoveButton } from "@/components/ui/remove-button";
import { formatEur, parseEuroToCents } from "@/lib/money";
import { useFormAction } from "@/lib/use-form-action";
import { deleteInvoiceAction, markInvoicePaidAction, registerInvoiceAction, reopenInvoiceAction } from "../actions";
import { invoiceAmounts } from "../schemas";

/** Registrazione di una fattura (dati, non documento fiscale). Totale e IVA sono mostrati in anteprima e ricalcolati dal server. */
export function InvoiceForm({ customerId, quoteId, acceptedQuotes = [], today, suggestedTaxable = "", defaultRate = "22" }: {
  customerId: string | null; quoteId?: string | null; acceptedQuotes?: { id: string; label: string }[]; today: string; suggestedTaxable?: string; defaultRate?: string;
}) {
  const { state, pending, onSubmit } = useFormAction(registerInvoiceAction.bind(null, customerId, quoteId ?? null));
  const [taxable, setTaxable] = useState(suggestedTaxable);
  const [rate, setRate] = useState(defaultRate);
  const [paid, setPaid] = useState(false);
  const t = parseEuroToCents(taxable);
  const r = Number(rate.replace(",", "."));
  const preview = t && t > 0 && Number.isFinite(r) && r >= 0 && r <= 100 ? invoiceAmounts(t, r) : null;
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k]?.[0] : undefined);
  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" aria-label="Registra fattura">
      {acceptedQuotes.length > 0 && !quoteId && (
        <div className="sm:col-span-2"><Label htmlFor="inv-quote">Preventivo di origine (facoltativo)</Label>
          <Select id="inv-quote" name="quoteId" defaultValue=""><option value="">Nessuno</option>{acceptedQuotes.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}</Select></div>
      )}
      <div><Label htmlFor="inv-number">Numero fattura *</Label><Input id="inv-number" name="number" maxLength={60} required />{err("number") && <p className="mt-1 text-xs text-danger">{err("number")}</p>}</div>
      <div><Label htmlFor="inv-date">Data di emissione *</Label><Input id="inv-date" name="billedAt" type="date" defaultValue={today} required /></div>
      <div><Label htmlFor="inv-taxable">Imponibile (€) *</Label><Input id="inv-taxable" name="taxable" inputMode="decimal" value={taxable} onChange={(e) => setTaxable(e.target.value)} required /></div>
      <div><Label htmlFor="inv-rate">Aliquota IVA (%) *</Label><Input id="inv-rate" name="vatRate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required /></div>
      <p className="text-sm sm:col-span-2" data-testid="invoice-preview">{preview ? <>IVA {formatEur(preview.vatCents)} · <strong>Totale {formatEur(preview.totalCents)}</strong></> : <span className="text-muted">Il totale si calcola da imponibile e aliquota.</span>}</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="paid" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Già incassata</label>
      {paid && <div><Label htmlFor="inv-paid">Data di incasso</Label><Input id="inv-paid" name="paidAt" type="date" defaultValue={today} />{err("paidAt") && <p className="mt-1 text-xs text-danger">{err("paidAt")}</p>}</div>}
      <div className="sm:col-span-2"><Label htmlFor="inv-note">Nota</Label><Input id="inv-note" name="note" maxLength={500} /></div>
      {state && !state.ok && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
      {state?.ok && <div className="sm:col-span-2"><Alert kind="success">Fattura registrata</Alert></div>}
      <div className="sm:col-span-2"><Button size="sm" disabled={pending}>{pending ? "Registrazione…" : "Registra fattura"}</Button></div>
    </form>
  );
}

/** Incasso (data), annullamento incasso e rimozione di una fattura registrata. */
export function InvoiceActions({ id, number, paid, canDelete, today }: { id: string; number: string; paid: boolean; canDelete: boolean; today: string }) {
  const pay = useFormAction(markInvoicePaidAction.bind(null, id));
  const reopen = useFormAction(reopenInvoiceAction.bind(null, id));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {paid ? (
        <form onSubmit={reopen.onSubmit}><Button size="sm" variant="ghost" disabled={reopen.pending}>Annulla incasso</Button></form>
      ) : (
        <form onSubmit={pay.onSubmit} className="flex items-center gap-1">
          <Input name="paidAt" type="date" defaultValue={today} aria-label={`Data di incasso fattura ${number}`} className="h-8 w-36 text-xs" />
          <Button size="sm" variant="outline" disabled={pay.pending}>Segna incassata</Button>
        </form>
      )}
      {canDelete && <RemoveButton action={deleteInvoiceAction.bind(null, id)} confirmMessage={`Rimuovere la registrazione della fattura ${number}?\n\nÈ solo un dato registrato in NEXORA; l'operazione viene tracciata.`} />}
      {pay.state && !pay.state.ok && <span role="alert" className="text-xs text-danger">{pay.state.error}</span>}
    </div>
  );
}
