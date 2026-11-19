"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { createActivationCodeAction } from "../actions";

export function CodeForm() {
  const [state, action, pending] = useActionState(createActivationCodeAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end">
        <div><Label htmlFor="email">Email del cliente *</Label><Input id="email" name="email" type="email" required /></div>
        <div><Label htmlFor="days">Validità (giorni)</Label><Input id="days" name="days" type="number" min={1} max={90} defaultValue={14} /></div>
        <div><Label htmlFor="note">Nota interna</Label><Input id="note" name="note" /></div>
        <Button disabled={pending}>Genera codice</Button>
      </div>
      {state && !state.ok && <Alert>{state.error}</Alert>}
      {state?.ok && (
        <Alert kind="success">
          Codice per <strong>{state.email}</strong> (mostrato una sola volta): <code className="select-all text-base font-semibold">{state.code}</code>
        </Alert>
      )}
    </form>
  );
}
