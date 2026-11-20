"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import type { ActionResult } from "@/lib/result";
import { PRIORITY_LABEL, STATUS_LABEL } from "../schemas";
import { useFormAction } from "@/lib/use-form-action";
import { ContactSelect } from "@/modules/agenda/ui/contact-select";
import { REMINDER_OFFSETS } from "@/modules/agenda/types";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
export type TaskDefaults = {
  title?: string; description?: string | null; priority?: string; status?: string; dueDate?: string | null;
  assigneeId?: string | null; customerId?: string | null; quoteId?: string | null;
  contactId?: string | null; typeId?: string | null; dueTime?: string | null; durationMinutes?: number | null; notes?: string | null; reminder?: string;
};
type QuoteOption = { id: string; number: string; title: string | null; customer_id: string };

export function TaskEditor({ action, defaults, customers, quotes, members, mode, readOnly, types }: {
  action: Action; defaults?: TaskDefaults; customers: { id: string; name: string }[]; quotes: QuoteOption[]; types: { id: string; label: string }[];
  members: { userId: string; name: string }[]; mode: "create" | "edit"; readOnly?: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [customerId, setCustomerId] = useState(defaults?.customerId ?? "");
  const visibleQuotes = useMemo(() => (customerId ? quotes.filter((q) => q.customer_id === customerId) : quotes), [quotes, customerId]);
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k]?.[0] : undefined);

  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-4 sm:grid-cols-2">
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
        <Label htmlFor="typeId">Tipologia</Label>
        <Select id="typeId" name="typeId" defaultValue={defaults?.typeId ?? ""} disabled={readOnly}>
          <option value="">Attività generica</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </Select>
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
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <div>
          <Label htmlFor="dueDate">Scadenza</Label>
          <Input id="dueDate" name="dueDate" type="date" defaultValue={defaults?.dueDate ?? ""} disabled={readOnly} />
          {err("dueDate") && <p className="mt-1 text-xs text-danger">{err("dueDate")}</p>}
        </div>
        <div>
          <Label htmlFor="dueTime">Ora</Label>
          <Input id="dueTime" name="dueTime" type="time" defaultValue={defaults?.dueTime ?? ""} disabled={readOnly} />
        </div>
      </div>
      <div>
        <Label htmlFor="durationMinutes">Durata prevista (minuti)</Label>
        <Input id="durationMinutes" name="durationMinutes" type="number" min={1} max={1440} defaultValue={defaults?.durationMinutes ?? ""} disabled={readOnly} />
        {err("durationMinutes") && <p className="mt-1 text-xs text-danger">{err("durationMinutes")}</p>}
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
      <ContactSelect customerId={customerId} defaultValue={defaults?.contactId ?? ""} disabled={readOnly} />
      <div>
        <Label htmlFor="quoteId">Preventivo collegato</Label>
        <Select id="quoteId" name="quoteId" defaultValue={defaults?.quoteId ?? ""} key={customerId} disabled={readOnly}>
          <option value="">—</option>
          {visibleQuotes.map((q) => <option key={q.id} value={q.id}>{q.number}{q.title ? ` · ${q.title}` : ""}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="reminder">Promemoria</Label>
        <Select id="reminder" name="reminder" defaultValue={defaults?.reminder ?? ""} disabled={readOnly}>
          {REMINDER_OFFSETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <p className="mt-1 text-xs text-muted">Richiede una data di scadenza. Compare nelle notifiche.</p>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="notes">Note interne</Label>
        <Textarea id="notes" name="notes" defaultValue={defaults?.notes ?? ""} disabled={readOnly} />
      </div>
      {state && !state.ok && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
      {state?.ok && <div className="sm:col-span-2"><Alert kind="success">Salvato</Alert></div>}
      {!readOnly && <div className="sm:col-span-2"><Button disabled={pending}>{pending ? "Salvataggio…" : mode === "create" ? "Crea attività" : "Salva modifiche"}</Button></div>}
    </form>
  );
}
