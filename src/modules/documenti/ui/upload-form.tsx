"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { uploadDocumentAction } from "../actions";

export function UploadForm({ customers }: { customers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(uploadDocumentAction, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
      <div><Label htmlFor="file">File (PDF, immagini, Office, max 15 MB)</Label><Input id="file" name="file" type="file" required className="h-auto py-1.5" /></div>
      <div>
        <Label htmlFor="customerId">Cliente (opzionale)</Label>
        <Select id="customerId" name="customerId" defaultValue=""><option value="">—</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      </div>
      <Button disabled={pending}>{pending ? "Carico…" : "Carica"}</Button>
      {state && !state.ok && <div className="sm:col-span-3"><Alert>{state.error}</Alert></div>}
      {state?.ok && <div className="sm:col-span-3"><Alert kind="success">Documento caricato</Alert></div>}
    </form>
  );
}
