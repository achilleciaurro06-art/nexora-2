"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import type { ActionResult } from "@/lib/result";
import { useFormAction } from "@/lib/use-form-action";
import { ContactSelect } from "@/modules/agenda/ui/contact-select";
import { PRIORITY_ORDER } from "@/modules/agenda/types";
import { PRIORITY_LABEL } from "@/modules/attivita/schemas";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
export type FollowUpDefaults = {
  customerId?: string; contactId?: string | null; quoteId?: string | null; title?: string; description?: string | null; reason?: string | null;
  dueOn?: string; assigneeId?: string | null; priority?: string; notes?: string | null; status?: string; sourceTaskId?: string | null;
};
type QuoteOpt = { id: string; number: string; title: string | null; customer_id: string };

export function FollowUpForm({ action, defaults, customers, quotes, members, mode, readOnly }: {
  action: Action; defaults?: FollowUpDefaults; customers: { id: string; name: string }[]; quotes: QuoteOpt[]; members: { userId: string; name: string }[]; mode: "create" | "edit"; readOnly?: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [customerId, setCustomerId] = useState(defaults?.customerId ?? "");
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k]?.[0] : undefined);
  const visibleQuotes = quotes.filter((q) => q.customer_id === customerId);
  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      {defaults?.sourceTaskId && <input type="hidden" name="sourceTaskId" value={defaults.sourceTaskId} />}
      <div className="sm:col-span-2"><Label htmlFor="title">Titolo *</Label><Input id="title" name="title" required maxLength={200} defaultValue={defaults?.title ?? ""} disabled={readOnly} />{err("title") && <p className="mt-1 text-xs text-danger">{err("title")}</p>}</div>
      {mode === "create" ? (
        <div>
          <Label htmlFor="customerId">Cliente *</Label>
          <Select id="customerId" name="customerId" required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="" disabled>Seleziona…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          {err("customerId") && <p className="mt-1 text-xs text-danger">{err("customerId")}</p>}
        </div>
      ) : (
        <div><Label>Cliente</Label><p className="flex h-9 items-center text-sm">{customers.find((c) => c.id === customerId)?.name ?? "—"}</p></div>
      )}
      <ContactSelect customerId={customerId} defaultValue={defaults?.contactId ?? ""} disabled={readOnly} />
      <div><Label htmlFor="quoteId">Preventivo collegato</Label>
        <Select id="quoteId" name="quoteId" defaultValue={defaults?.quoteId ?? ""} key={customerId} disabled={readOnly || !customerId}>
          <option value="">—</option>{visibleQuotes.map((q) => <option key={q.id} value={q.id}>{q.number}{q.title ? ` · ${q.title}` : ""}</option>)}
        </Select></div>
      <div><Label htmlFor="reason">Motivo del ricontatto</Label><Input id="reason" name="reason" maxLength={300} defaultValue={defaults?.reason ?? ""} placeholder="Es. Preventivo inviato senza risposta" disabled={readOnly} /></div>
      {mode === "create" && (
        <>
          <div><Label htmlFor="dueOn">Data prevista *</Label><Input id="dueOn" name="dueOn" type="date" required defaultValue={defaults?.dueOn ?? ""} />{err("dueOn") && <p className="mt-1 text-xs text-danger">{err("dueOn")}</p>}</div>
          <div><Label htmlFor="status">Stato iniziale</Label>
            <Select id="status" name="status" defaultValue={defaults?.status ?? "todo"}><option value="todo">Da fare</option><option value="scheduled">Programmato</option></Select></div>
        </>
      )}
      <div><Label htmlFor="assigneeId">Responsabile</Label>
        <Select id="assigneeId" name="assigneeId" defaultValue={defaults?.assigneeId ?? ""} disabled={readOnly}><option value="">Nessuno</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select></div>
      <div><Label htmlFor="priority">Priorità</Label>
        <Select id="priority" name="priority" defaultValue={defaults?.priority ?? "normal"} disabled={readOnly}>
          {(Object.keys(PRIORITY_ORDER) as (keyof typeof PRIORITY_LABEL)[]).sort((a, b) => PRIORITY_ORDER[b] - PRIORITY_ORDER[a]).map((k) => <option key={k} value={k}>{PRIORITY_LABEL[k]}</option>)}
        </Select></div>
      <div className="sm:col-span-2"><Label htmlFor="description">Descrizione</Label><Textarea id="description" name="description" defaultValue={defaults?.description ?? ""} disabled={readOnly} /></div>
      <div className="sm:col-span-2"><Label htmlFor="notes">Note</Label><Textarea id="notes" name="notes" defaultValue={defaults?.notes ?? ""} disabled={readOnly} /></div>
      {state && !state.ok && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
      {state?.ok && <div className="sm:col-span-2"><Alert kind="success">Salvato</Alert></div>}
      {!readOnly && <div className="sm:col-span-2"><Button disabled={pending}>{pending ? "Salvataggio…" : mode === "create" ? "Crea follow-up" : "Salva modifiche"}</Button></div>}
    </form>
  );
}
