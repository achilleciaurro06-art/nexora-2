"use client";

import { useActionState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { createTaskAction } from "../actions";

export function TaskForm({ customers }: { customers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createTaskAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
      <div><Label htmlFor="title">Nuova attività</Label><Input id="title" name="title" required placeholder="Es. Richiamare il cliente" /></div>
      <div><Label htmlFor="dueDate">Scadenza</Label><Input id="dueDate" name="dueDate" type="date" /></div>
      <div>
        <Label htmlFor="priority">Priorità</Label>
        <Select id="priority" name="priority" defaultValue="normal">
          <option value="low">Bassa</option><option value="normal">Normale</option><option value="high">Alta</option><option value="urgent">Urgente</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="customerId">Cliente</Label>
        <Select id="customerId" name="customerId" defaultValue=""><option value="">—</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      </div>
      <Button disabled={pending}>Aggiungi</Button>
      <label className="flex items-center gap-2 text-xs text-muted sm:col-span-5"><input type="checkbox" name="remind" /> Promemoria alla scadenza</label>
      {state && !state.ok && <div className="sm:col-span-5"><Alert>{state.error}</Alert></div>}
    </form>
  );
}
