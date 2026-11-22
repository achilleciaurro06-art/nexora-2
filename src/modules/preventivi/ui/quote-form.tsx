"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AskCopilotButton } from "@/modules/copilot/ui/ask-button";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Alert, Table } from "@/components/ui/card";
import { formatEur, quoteTotals } from "@/lib/money";
import type { ActionResult } from "@/lib/result";
import { useFormAction } from "@/lib/use-form-action";
import { CustomFieldsInputs } from "@/modules/settore/ui/custom-fields-inputs";
import { priceFor } from "@/modules/settore/pricing";
import type { QuoteCatalog } from "@/modules/settore/queries";
import type { CustomValues } from "@/modules/settore/custom-fields";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
export type Line = { description: string; quantity: string; price: string; discount: string; vat: string };
export type LineItemInput = { description: string; quantity: number; unit_price_cents: number; discount_percent: number; vat_rate: number };
export type QuoteFormInitial = {
  customerId?: string; title?: string | null; issueDate?: string; validUntil?: string | null; followUpDate?: string | null; notes?: string | null; terms?: string | null;
  items?: LineItemInput[]; customValues?: CustomValues | null;
};

export const emptyLine = (vat = "22"): Line => ({ description: "", quantity: "1", price: "0", discount: "0", vat });
const num = (s: string) => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export function linesFromItems(items: LineItemInput[] | undefined, defaultVat = "22"): Line[] {
  return items?.length
    ? items.map((i) => ({ description: i.description, quantity: String(i.quantity), price: (i.unit_price_cents / 100).toFixed(2), discount: String(i.discount_percent), vat: String(i.vat_rate) }))
    : [emptyLine(defaultVat)];
}
export function linesToPayload(lines: Line[]) {
  return lines.map((l) => ({
    description: l.description, quantity: num(l.quantity), unitPriceCents: Math.round(num(l.price) * 100),
    discountPercent: num(l.discount), vatRate: num(l.vat),
  }));
}

/** Editor righe + totali, condiviso tra preventivo e revisione dei documenti. */
export function QuoteLinesEditor({ lines, onChange, defaultVat = "22" }: { lines: Line[]; onChange: (l: Line[]) => void; defaultVat?: string }) {
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
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, emptyLine(defaultVat)])}><Plus size={14} /> Aggiungi riga</Button>
      </div>
      <dl className="ml-auto grid max-w-xs grid-cols-2 gap-1 text-sm">
        <dt className="text-muted">Imponibile</dt><dd className="text-right">{formatEur(totals.subtotalCents)}</dd>
        <dt className="text-muted">IVA</dt><dd className="text-right">{formatEur(totals.vatCents)}</dd>
        <dt className="font-semibold">Totale</dt><dd className="text-right font-semibold">{formatEur(totals.totalCents)}</dd>
      </dl>
    </>
  );
}

export function QuoteForm({ action, customers, initial, defaultVat = "22", catalog }: { action: Action; customers: { id: string; name: string }[]; initial?: QuoteFormInitial; defaultVat?: string; catalog?: QuoteCatalog }) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [lines, setLines] = useState<Line[]>(linesFromItems(initial?.items, defaultVat));
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [terms, setTerms] = useState(initial?.terms ?? "");
  const [hint, setHint] = useState<string | null>(null);
  const payload = useMemo(() => linesToPayload(lines), [lines]);
  const isBlank = (ls: Line[]) => ls.length === 1 && !ls[0]!.description.trim();
  const listId = catalog?.customerLists[customerId];

  const addProduct = (productId: string) => {
    const p = catalog?.products.find((x) => x.id === productId);
    if (!p) return;
    const { cents, fromList } = priceFor(p, listId, catalog!.listPrices);
    const line: Line = { description: p.description ? `${p.name} — ${p.description}` : p.name, quantity: "1", price: (cents / 100).toFixed(2), discount: "0", vat: String(p.vat_rate) };
    setLines(isBlank(lines) ? [line] : [...lines, line]);
    setHint(fromList ? `«${p.name}»: applicato il prezzo del listino ${catalog!.listNames[listId!] ?? ""}` : `«${p.name}»: applicato il prezzo base`);
  };
  const applyTemplate = (templateId: string) => {
    const t = catalog?.templates.find((x) => x.id === templateId);
    if (!t) return;
    if (!isBlank(lines) && !window.confirm(`Applicare il modello «${t.name}»? Le righe attuali verranno sostituite.`)) return;
    setLines(linesFromItems(t.items as LineItemInput[], defaultVat));
    if (!title.trim() && t.title) setTitle(t.title);
    if (!notes.trim() && t.notes) setNotes(t.notes);
    if (!terms.trim() && t.terms) setTerms(t.terms);
    setHint(`Modello «${t.name}» applicato`);
  };
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k]?.[0] : undefined);

  // procedura guidata: tutti i campi restano nel form (sezioni nascoste, non smontate) quindi tornando indietro non si perde nulla
  const STEPS = ["Cliente e dati", "Prodotti e servizi", "Condizioni", "Riepilogo"] as const;
  const [step, setStep] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  /** Valida i passaggi dal corrente fino a quello di destinazione: si ferma sul primo campo non valido. */
  const goTo = (target: number) => {
    for (let st = step; st < target; st++) {
      const box = formRef.current?.querySelector<HTMLElement>(`[data-step="${st}"]`);
      const fields = box ? Array.from(box.querySelectorAll<HTMLInputElement>("input, select, textarea")) : [];
      for (const f of fields) {
        if (!f.checkValidity()) { setStep(st); setTimeout(() => f.reportValidity(), 0); return; }
      }
    }
    setStep(Math.max(0, Math.min(STEPS.length - 1, target)));
  };
  const goNext = () => goTo(step + 1);
  const totals = quoteTotals(payload);
  const customerName = customers.find((c) => c.id === customerId)?.name;
  const filled = lines.filter((l) => l.description.trim());

  return (
    <form ref={formRef} onSubmit={onSubmit} onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && step < STEPS.length - 1) { e.preventDefault(); if (step === 0) goNext(); } }} className="space-y-6">
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Passaggi">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button type="button" onClick={() => goTo(i)} aria-current={i === step ? "step" : undefined}
              className={cn("nx-t flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm", i === step ? "border-primary bg-primary/[0.06] font-medium" : "border-border bg-card text-muted hover:border-primary/40")}>
              <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold", i < step ? "bg-success text-white" : i === step ? "bg-primary text-white" : "bg-subtle text-muted")}>{i < step ? <Check className="size-3.5" /> : i + 1}</span>
              <span className="truncate">{label}</span>
            </button>
          </li>
        ))}
      </ol>

      <div data-step="0" hidden={step !== 0} className="rounded-lg border border-border bg-card p-5 shadow-card">
        <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="customerId">Cliente *</Label>
            <Select id="customerId" name="customerId" required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="" disabled>Seleziona…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            {err("customerId") && <p className="mt-1 text-xs text-danger">{err("customerId")}</p>}
          </div>
          <div><Label htmlFor="title">Oggetto</Label><Input id="title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><Label htmlFor="issueDate">Data emissione</Label><Input id="issueDate" name="issueDate" type="date" defaultValue={initial?.issueDate ?? new Date().toISOString().slice(0, 10)} /></div>
          <div><Label htmlFor="validUntil">Valido fino al</Label><Input id="validUntil" name="validUntil" type="date" defaultValue={initial?.validUntil ?? ""} /></div>
          <div><Label htmlFor="followUpDate">Promemoria follow-up</Label><Input id="followUpDate" name="followUpDate" type="date" defaultValue={initial?.followUpDate ?? ""} /></div>
          <CustomFieldsInputs defs={catalog?.fields ?? []} values={initial?.customValues} />
        </div>
      </div>

      <div data-step="1" hidden={step !== 1} className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-card">
        {catalog && (catalog.products.length > 0 || catalog.templates.length > 0) && (
          <div className="grid max-w-4xl gap-4 rounded-md border border-line bg-subtle p-3 sm:grid-cols-2" data-testid="catalog-tools">
            {catalog.templates.length > 0 && (
              <div><Label htmlFor="tpl">Applica un modello</Label>
                <Select id="tpl" value="" onChange={(e) => applyTemplate(e.target.value)}><option value="">Scegli un modello…</option>{catalog.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></div>
            )}
            {catalog.products.length > 0 && (
              <div><Label htmlFor="prod">Aggiungi dal catalogo</Label>
                <Select id="prod" value="" onChange={(e) => addProduct(e.target.value)}><option value="">Scegli un prodotto o servizio…</option>
                  {catalog.products.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ""}{p.name}</option>)}</Select></div>
            )}
            {hint && <p role="status" className="text-xs text-muted sm:col-span-2">{hint}</p>}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/20 bg-primary/[0.04] px-3 py-2 text-sm">
          <span className="flex items-center gap-2 text-muted"><Sparkles className="size-4 text-primary" />Descrivi la richiesta e il Copilot prepara una bozza con i prezzi del catalogo: la riveli e la approvi tu.</span>
          <AskCopilotButton question={`Prepara una bozza di preventivo${customerName ? ` per ${customerName}` : ""}${title.trim() ? ` per «${title.trim()}»` : ""}, usando prodotti e prezzi del catalogo.`} label="Prepara con il Copilot" />
        </div>
        <QuoteLinesEditor lines={lines} onChange={setLines} defaultVat={defaultVat} />
      </div>

      <div data-step="2" hidden={step !== 2} className="rounded-lg border border-border bg-card p-5 shadow-card">
        <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
          <div><Label htmlFor="notes">Note</Label><Textarea id="notes" name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div><Label htmlFor="terms">Condizioni</Label><Textarea id="terms" name="terms" value={terms} onChange={(e) => setTerms(e.target.value)} /></div>
        </div>
      </div>

      <div data-step="3" hidden={step !== 3} className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-card" data-testid="quote-summary">
        <h2 className="font-semibold">Riepilogo</h2>
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3"><dt className="text-muted">Cliente</dt><dd className="font-medium">{customerName ?? "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Oggetto</dt><dd className="text-right font-medium">{title.trim() || "—"}</dd></div>
        </dl>
        <Table>
          <thead><tr><th>Descrizione</th><th className="text-right">Qtà</th><th className="text-right">Prezzo</th><th className="text-right">Sconto</th><th className="text-right">IVA</th></tr></thead>
          <tbody>
            {filled.length === 0 && <tr><td colSpan={5} className="text-muted">Nessuna riga inserita.</td></tr>}
            {filled.map((l, i) => <tr key={i}><td>{l.description}</td><td className="text-right">{l.quantity}</td><td className="text-right">{l.price} €</td><td className="text-right">{l.discount}%</td><td className="text-right">{l.vat}%</td></tr>)}
          </tbody>
        </Table>
        <dl className="ml-auto grid max-w-xs grid-cols-2 gap-1 text-sm">
          <dt className="text-muted">Imponibile</dt><dd className="text-right">{formatEur(totals.subtotalCents)}</dd>
          <dt className="text-muted">IVA</dt><dd className="text-right">{formatEur(totals.vatCents)}</dd>
          <dt className="font-semibold">Totale</dt><dd className="text-right text-lg font-semibold">{formatEur(totals.totalCents)}</dd>
        </dl>
        {(notes.trim() || terms.trim()) && <p className="whitespace-pre-wrap rounded-md bg-subtle p-3 text-xs text-muted">{[notes.trim() && `Note: ${notes.trim()}`, terms.trim() && `Condizioni: ${terms.trim()}`].filter(Boolean).join("\n")}</p>}
        <p className="text-xs text-muted">Il numero viene assegnato automaticamente al salvataggio. Nulla viene inviato al cliente.</p>
      </div>

      {state && !state.ok && <Alert>{state.error}</Alert>}
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="outline" onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={step === 0}><ChevronLeft className="size-4" />Indietro</Button>
        {step < STEPS.length - 1
          ? <Button key="avanti" type="button" onClick={goNext}>Avanti<ChevronRight className="size-4" /></Button>
          : <Button key="salva" disabled={pending}>{pending ? "Salvataggio…" : "Salva preventivo"}</Button>}
      </div>
    </form>
  );
}
