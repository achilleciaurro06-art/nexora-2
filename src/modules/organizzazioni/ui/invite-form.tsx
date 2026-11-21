"use client";

import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { inviteMemberAction } from "../actions";
import { useFormAction } from "@/lib/use-form-action";

export function InviteForm() {
  const { state, pending, onSubmit } = useFormAction(inviteMemberAction);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <div><Label htmlFor="email">Email da invitare</Label><Input id="email" name="email" type="email" required /></div>
        <div>
          <Label htmlFor="role">Ruolo</Label>
          <Select id="role" name="role" defaultValue="member"><option value="admin">Amministratore</option><option value="member">Membro</option><option value="viewer">Sola lettura</option></Select>
        </div>
        <Button disabled={pending}>Crea invito</Button>
      </div>
      {state && !state.ok && <Alert>{state.error}</Alert>}
      {state?.ok && (
        <Alert kind="success">
          Invito creato (valido 7 giorni). Invia questo link alla persona, <strong>viene mostrato una sola volta</strong>:
          <br /><code className="break-all select-all">{state.link}</code>
        </Alert>
      )}
    </form>
  );
}
