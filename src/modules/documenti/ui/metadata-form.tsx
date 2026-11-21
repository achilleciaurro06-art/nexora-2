"use client";

import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import type { ActionResult } from "@/lib/result";
import { useFormAction } from "@/lib/use-form-action";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

export function MetadataForm({ action, doc, customers, readOnly }: {
  action: Action; doc: { name: string; description: string | null; customerId: string | null }; customers: { id: string; name: string }[]; readOnly: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  return (
    <form onSubmit={onSubmit} className="grid max-w-2xl gap-4">
      <div><Label htmlFor="name">Nome</Label><Input id="name" name="name" required defaultValue={doc.name} disabled={readOnly} /></div>
      <div><Label htmlFor="description">Descrizione</Label><Textarea id="description" name="description" defaultValue={doc.description ?? ""} disabled={readOnly} /></div>
      <div>
        <Label htmlFor="customerId">Cliente collegato</Label>
        <Select id="customerId" name="customerId" defaultValue={doc.customerId ?? ""} disabled={readOnly}>
          <option value="">Nessuno</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>
      {state && !state.ok && <Alert>{state.error}</Alert>}
      {state?.ok && <Alert kind="success">Salvato</Alert>}
      {!readOnly && <div><Button disabled={pending}>{pending ? "Salvataggio…" : "Salva"}</Button></div>}
    </form>
  );
}
