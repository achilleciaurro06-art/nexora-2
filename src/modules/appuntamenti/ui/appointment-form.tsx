"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import type { ActionResult } from "@/lib/result";
import { useFormAction } from "@/lib/use-form-action";
import { ContactSelect } from "@/modules/agenda/ui/contact-select";
import { REMINDER_OFFSETS } from "@/modules/agenda/types";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
export type AppointmentDefaults = {
  title?: string; description?: string | null; customerId?: string | null; contactId?: string | null; date?: string; startTime?: string; endTime?: string;
  location?: string | null; assigneeId?: string | null; notes?: string | null; reminder?: string; participants?: string[];
};

export function AppointmentForm({ action, defaults, customers, members, mode, readOnly }: {
  action: Action; defaults?: AppointmentDefaults; customers: { id: string; name: string }[]; members: { userId: string; name: string }[]; mode: "create" | "edit"; readOnly?: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [customerId, setCustomerId] = useState(defaults?.customerId ?? "");
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k]?.[0] : undefined);
  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><Label htmlFor="title">Titolo *</Label><Input id="title" name="title" required maxLength={200} defaultValue={defaults?.title ?? ""} disabled={readOnly} />{err("title") && <p className="mt-1 text-xs text-danger">{err("title")}</p>}</div>
      <div><Label htmlFor="customerId">Cliente</Label>
        <Select id="customerId" name="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={readOnly}><option value="">—</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
      <ContactSelect customerId={customerId} defaultValue={defaults?.contactId ?? ""} disabled={readOnly} />
      <div><Label htmlFor="date">Data *</Label><Input id="date" name="date" type="date" required defaultValue={defaults?.date ?? ""} disabled={readOnly} />{err("date") && <p className="mt-1 text-xs text-danger">{err("date")}</p>}</div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label htmlFor="startTime">Inizio *</Label><Input id="startTime" name="startTime" type="time" required defaultValue={defaults?.startTime ?? "09:00"} disabled={readOnly} /></div>
        <div><Label htmlFor="endTime">Fine *</Label><Input id="endTime" name="endTime" type="time" required defaultValue={defaults?.endTime ?? "10:00"} disabled={readOnly} />{err("endTime") && <p className="mt-1 text-xs text-danger">{err("endTime")}</p>}</div>
      </div>
      <div className="sm:col-span-2"><Label htmlFor="location">Luogo o indirizzo</Label><Input id="location" name="location" maxLength={300} defaultValue={defaults?.location ?? ""} disabled={readOnly} /></div>
      <div><Label htmlFor="assigneeId">Responsabile</Label>
        <Select id="assigneeId" name="assigneeId" defaultValue={defaults?.assigneeId ?? ""} disabled={readOnly}><option value="">Nessuno</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select></div>
      <div><Label htmlFor="reminder">Promemoria</Label>
        <Select id="reminder" name="reminder" defaultValue={defaults?.reminder ?? ""} disabled={readOnly}>{REMINDER_OFFSETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
      {members.length > 1 && (
        <fieldset className="sm:col-span-2" disabled={readOnly}>
          <legend className="mb-1 text-sm font-medium">Partecipanti</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {members.map((m) => <label key={m.userId} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="participants" value={m.userId} defaultChecked={defaults?.participants?.includes(m.userId)} /> {m.name}</label>)}
          </div>
        </fieldset>
      )}
      <div className="sm:col-span-2"><Label htmlFor="description">Descrizione</Label><Textarea id="description" name="description" defaultValue={defaults?.description ?? ""} disabled={readOnly} /></div>
      <div className="sm:col-span-2"><Label htmlFor="notes">Note interne</Label><Textarea id="notes" name="notes" defaultValue={defaults?.notes ?? ""} disabled={readOnly} /></div>
      {state && !state.ok && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
      {state?.ok && <div className="sm:col-span-2"><Alert kind="success">Salvato</Alert></div>}
      {!readOnly && <div className="sm:col-span-2"><Button disabled={pending}>{pending ? "Salvataggio…" : mode === "create" ? "Crea appuntamento" : "Salva modifiche"}</Button></div>}
    </form>
  );
}
