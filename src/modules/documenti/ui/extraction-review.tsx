"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Alert, Badge } from "@/components/ui/card";
import { QuoteLinesEditor, linesToPayload, type Line } from "@/modules/preventivi/ui/quote-form";
import { formatEur, quoteTotals } from "@/lib/money";
import type { ActionResult } from "@/lib/result";
import { fieldLabel, type Duplicate } from "../extraction";
import { useFormAction } from "@/lib/use-form-action";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

export type ReviewProps = {
  action: Action;
  customers: { id: string; name: string }[];
  match: { customerId: string; reason: "vat" | "name" } | null;
  client: { name?: string; vat_number?: string; tax_code?: string; email?: string; phone?: string; address?: string };
  quote: { title: string; issueDate: string; validUntil: string; notes: string; terms: string };
  initialLines: Line[];
  documentTotal: number | null;
  warnings: string[];
  missing: string[];
  inferred: string[];
  duplicates: Duplicate[];
  aiNotes?: string;
};

const Inferred = ({ path, list }: { path: string; list: string[] }) => (list.includes(path) ? <Badge className="ml-2 border-warning text-warning">dedotto</Badge> : null);

export function ExtractionReview(p: ReviewProps) {
  const { state, pending, onSubmit } = useFormAction(p.action);
  const [mode, setMode] = useState<"existing" | "new">(p.match || !p.client.name ? "existing" : "new");
  const [lines, setLines] = useState<Line[]>(p.initialLines);
  const payload = useMemo(() => linesToPayload(lines), [lines]);
  const totals = quoteTotals(payload);
  const diff = p.documentTotal !== null && Math.abs(totals.totalCents - Math.round(p.documentTotal * 100)) > 5;
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k]?.[0] : undefined);

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      {(p.warnings.length > 0 || p.duplicates.length > 0 || p.missing.length > 0 || p.aiNotes) && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
          {p.duplicates.length > 0 && (
            <div role="alert" className="rounded-md border border-danger/40 p-3">
              <p className="font-medium text-danger">Possibili duplicati</p>
              <ul className="mt-1 list-disc pl-5">{p.duplicates.map((d) => <li key={`${d.type}${d.id}`}>{d.label}</li>)}</ul>
              <label className="mt-2 flex items-center gap-2"><input type="checkbox" name="confirmDuplicates" required /> Ho verificato: voglio creare comunque la bozza</label>
            </div>
          )}
          {p.warnings.length > 0 && (
            <div><p className="font-medium text-warning">Controlli di coerenza</p><ul className="mt-1 list-disc pl-5">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>
          )}
          {p.missing.length > 0 && (
            <div><p className="font-medium">Non presenti nel documento</p><p className="mt-1 flex flex-wrap gap-1">{p.missing.map((m) => <Badge key={m}>{fieldLabel(m)}</Badge>)}</p></div>
          )}
          {p.aiNotes && <p className="text-muted"><strong>Nota dell&apos;AI:</strong> {p.aiNotes}</p>}
          <p className="text-xs text-muted">I dati sono stati letti dall&apos;AI e possono contenere errori: controllali e correggili prima di creare la bozza. Ciò che è &quot;dedotto&quot; non era scritto nel documento.</p>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-medium">Cliente</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="customerMode" value="existing" checked={mode === "existing"} onChange={() => setMode("existing")} /> Cliente esistente</label>
          <label className="flex items-center gap-2"><input type="radio" name="customerMode" value="new" checked={mode === "new"} onChange={() => setMode("new")} /> Crea nuovo cliente</label>
        </div>
        {mode === "existing" ? (
          <div className="max-w-md">
            <Label htmlFor="customerId">Cliente</Label>
            <Select id="customerId" name="customerId" defaultValue={p.match?.customerId ?? ""}>
              <option value="">Seleziona…</option>
              {p.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            {p.match && <p className="mt-1 text-xs text-muted">Abbinato automaticamente per {p.match.reason === "vat" ? "partita IVA" : "nome"}: verifica che sia corretto.</p>}
            {!p.match && p.client.name && <p className="mt-1 text-xs text-muted">Nel documento: «{p.client.name}» — nessun cliente corrispondente trovato.</p>}
            {err("customerId") && <p className="mt-1 text-xs text-danger">{err("customerId")}</p>}
          </div>
        ) : (
          <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="new_name">Ragione sociale *<Inferred path="client.name" list={p.inferred} /></Label><Input id="new_name" name="new_name" defaultValue={p.client.name ?? ""} />{err("new_name") && <p className="mt-1 text-xs text-danger">{err("new_name")}</p>}</div>
            <div><Label htmlFor="new_vat_number">Partita IVA<Inferred path="client.vat_number" list={p.inferred} /></Label><Input id="new_vat_number" name="new_vat_number" defaultValue={p.client.vat_number ?? ""} /></div>
            <div><Label htmlFor="new_tax_code">Codice fiscale</Label><Input id="new_tax_code" name="new_tax_code" defaultValue={p.client.tax_code ?? ""} /></div>
            <div><Label htmlFor="new_email">Email</Label><Input id="new_email" name="new_email" type="email" defaultValue={p.client.email ?? ""} /></div>
            <div><Label htmlFor="new_phone">Telefono</Label><Input id="new_phone" name="new_phone" defaultValue={p.client.phone ?? ""} /></div>
            <div className="sm:col-span-2"><Label htmlFor="new_address">Indirizzo</Label><Input id="new_address" name="new_address" defaultValue={p.client.address ?? ""} /></div>
          </div>
        )}
      </section>

      <section className="grid max-w-4xl gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="title">Oggetto<Inferred path="quote.title" list={p.inferred} /></Label><Input id="title" name="title" defaultValue={p.quote.title} /></div>
        <div><Label htmlFor="issueDate">Data emissione</Label><Input id="issueDate" name="issueDate" type="date" defaultValue={p.quote.issueDate} /></div>
        <div><Label htmlFor="validUntil">Valido fino al<Inferred path="quote.valid_until" list={p.inferred} /></Label><Input id="validUntil" name="validUntil" type="date" defaultValue={p.quote.validUntil} /></div>
        <div><Label htmlFor="followUpDate">Promemoria follow-up</Label><Input id="followUpDate" name="followUpDate" type="date" /></div>
      </section>

      <QuoteLinesEditor lines={lines} onChange={setLines} />
      {p.documentTotal !== null && (
        <p className={`text-sm ${diff ? "text-danger" : "text-muted"}`} role={diff ? "alert" : undefined}>
          Totale indicato nel documento: <strong>{formatEur(Math.round(p.documentTotal * 100))}</strong> · totale della bozza: <strong>{formatEur(totals.totalCents)}</strong>
          {diff ? " — non coincidono: verifica righe, sconti e IVA." : " — coincidono."}
        </p>
      )}

      <section className="grid max-w-4xl gap-4 sm:grid-cols-2">
        <div><Label htmlFor="notes">Note</Label><Textarea id="notes" name="notes" defaultValue={p.quote.notes} /></div>
        <div><Label htmlFor="terms">Condizioni / pagamento<Inferred path="quote.payment_terms" list={p.inferred} /></Label><Textarea id="terms" name="terms" defaultValue={p.quote.terms} /></div>
      </section>

      {state && !state.ok && <Alert>{state.error}</Alert>}
      <Button disabled={pending}>{pending ? "Creazione…" : "Crea bozza di preventivo"}</Button>
    </form>
  );
}
