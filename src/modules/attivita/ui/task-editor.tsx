"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import type { ActionResult } from "@/lib/result";
import { PRIORITY_LABEL, STATUS_LABEL } from "../schemas";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
export type TaskDefaults = {
  title?: string; description?: string | null; priority?: string; status?: string; dueDate?: string | null;
  assigneeId?: string | null; customerId?: string | null; quoteId?: string | null;
};
type QuoteOption = { id: string; number: string; title: string | null; customer_id: string };

export function TaskEditor({ action, defaults, customers, quotes, members, mode, readOnly }: {
  action: Action; defaults?: TaskDefaults; customers: { id: string; name: string }[]; quotes: QuoteOption[];
  members: { userId: string; name: string }[]; mode: "create" | "edit"; readOnly?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [customerId, setCustomerId] = useState(defaults?.customerId ?? "");
  const visibleQuotes = useMemo(() => (customerId ? quotes.filter((q) => q.customer_id === customerId) : quotes), [quotes, customerId]);
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k]?.[0] : undefined);

  return (
    <form action={formAction} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      {mode === "create" && <input type="hidden" name="redirect" value="detail" />}
      <div className="sm:col-span-2">
        <Label htmlFor="title">Titolo *</Label>
        <Input id="title" name="title" required defaultValue={defaults?.title ?? ""} disabled={readOnly} />
        {err("title") && <p className="mt-1 text-xs text-danger">{err("title")}</p>}
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="description">Descrizione</Label>
        <Textarea id="description" name="description" defaultValue={defaults?.description ?? ""} disabled={readOnly} />
      </div>
      <div>
        <Label htmlFor="status">Stato</Label>
        <Select id="status" name="status" defaultValue={defaults?.status ?? "todo"} disabled={readOnly}>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="priority">Priorità</Label>
        <Select id="priority" name="priority" defaultValue={defaults?.priority ?? "normal"} disabled={readOnly}>
          {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="dueDate">Scadenza</Label>
        <Input id="dueDate" name="dueDate" type="date" defaultValue={defaults?.dueDate ?? ""} disabled={readOnly} />
      </div>
      <div>
        <Label htmlFor="assigneeId">Assegnata a</Label>
        <Select id="assigneeId" name="assigneeId" defaultValue={defaults?.assigneeId ?? ""} disabled={readOnly}>
          <option value="">Nessuno</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="customerId">Cliente</Label>
        <Select id="customerId" name="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={readOnly}>
          <option value="">—</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="quoteId">Preventivo collegato</Label>
        <Select id="quoteId" name="quoteId" defaultValue={defaults?.quoteId ?? ""} key={customerId} disabled={readOnly}>
          <option value="">—</option>
          {visibleQuotes.map((q) => <option key={q.id} value={q.id}>{q.number}{q.title ? ` · ${q.title}` : ""}</option>)}
        </Select>
      </div>
      {mode === "create" && (
        <label className="flex items-center gap-2 text-sm text-muted sm:col-span-2">
          <input type="checkbox" name="remind" /> Crea un promemoria alla scadenza
        </label>
      )}
      {state && !state.ok && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
      {state?.ok && <div className="sm:col-span-2"><Alert kind="success">Salvato</Alert></div>}
      {!readOnly && <div className="sm:col-span-2"><Button disabled={pending}>{pending ? "Salvataggio…" : mode === "create" ? "Crea attività" : "Salva modifiche"}</Button></div>}
    </form>
  );
}
