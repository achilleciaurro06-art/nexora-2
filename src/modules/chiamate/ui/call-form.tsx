"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { useFormAction } from "@/lib/use-form-action";
import { ContactSelect } from "@/modules/agenda/ui/contact-select";
import { CALL_OUTCOMES } from "@/modules/agenda/types";
import { logCallAction } from "../actions";

export function CallForm({ customers, members, defaults }: {
  customers: { id: string; name: string }[]; members: { userId: string; name: string }[];
  defaults: { customerId?: string; userId: string; date: string; time: string; nextOn?: string };
}) {
  const { state, pending, onSubmit } = useFormAction(logCallAction);
  const [customerId, setCustomerId] = useState(defaults.customerId ?? "");
  const [next, setNext] = useState(!!defaults.nextOn);
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k]?.[0] : undefined);
  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-4 sm:grid-cols-2" aria-label="Registra chiamata">
      <div>
        <Label htmlFor="customerId">Cliente *</Label>
        <Select id="customerId" name="customerId" required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="" disabled>Seleziona…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        {err("customerId") && <p className="mt-1 text-xs text-danger">{err("customerId")}</p>}
      </div>
      <ContactSelect customerId={customerId} />
      <fieldset className="flex items-center gap-4 text-sm"><legend className="mb-1 text-sm font-medium">Direzione *</legend>
        <label className="flex items-center gap-1.5"><input type="radio" name="direction" value="outbound" defaultChecked /> In uscita</label>
        <label className="flex items-center gap-1.5"><input type="radio" name="direction" value="inbound" /> In entrata</label>
      </fieldset>
      <div><Label htmlFor="userId">Collaboratore</Label><Select id="userId" name="userId" defaultValue={defaults.userId}>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label htmlFor="date">Data chiamata *</Label><Input id="date" name="date" type="date" required defaultValue={defaults.date} />{err("date") && <p className="mt-1 text-xs text-danger">{err("date")}</p>}</div>
        <div><Label htmlFor="time">Ora chiamata *</Label><Input id="time" name="time" type="time" required defaultValue={defaults.time} /></div>
      </div>
      <div><Label htmlFor="durationMinutes">Durata (minuti)</Label><Input id="durationMinutes" name="durationMinutes" inputMode="decimal" />{err("durationMinutes") && <p className="mt-1 text-xs text-danger">{err("durationMinutes")}</p>}</div>
      <div className="sm:col-span-2"><Label htmlFor="outcome">Esito *</Label>
        <Select id="outcome" name="outcome" required defaultValue="answered">{CALL_OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</Select></div>
      <div className="sm:col-span-2"><Label htmlFor="notes">Note e informazioni raccolte</Label><Textarea id="notes" name="notes" maxLength={4000} /></div>
      <fieldset className="space-y-3 rounded-md border border-border p-3 sm:col-span-2">
        <legend className="px-1 text-sm font-medium">Prossimo contatto</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={next} onChange={(e) => setNext(e.target.checked)} /> Crea un follow-up</label>
        {next && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label htmlFor="nextOn">Data del ricontatto *</Label><Input id="nextOn" name="nextOn" type="date" required defaultValue={defaults.nextOn ?? ""} /></div>
            <div><Label htmlFor="nextAssigneeId">Responsabile</Label><Select id="nextAssigneeId" name="nextAssigneeId" defaultValue={defaults.userId}>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select></div>
            <div><Label htmlFor="nextTitle">Titolo (facoltativo)</Label><Input id="nextTitle" name="nextTitle" maxLength={200} /></div>
          </div>
        )}
      </fieldset>
      {state && !state.ok && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
      <div className="sm:col-span-2"><Button disabled={pending}>{pending ? "Registrazione…" : "Registra chiamata"}</Button></div>
    </form>
  );
}
