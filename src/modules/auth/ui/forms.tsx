"use client";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { acceptInvitationAction, activateAction, loginAction } from "../actions";
import { useFormAction } from "@/lib/use-form-action";

function FieldError({ state, name }: { state: { ok: boolean; fieldErrors?: Record<string, string[] | undefined> } | null; name: string }) {
  const msg = state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined;
  return msg ? <p className="mt-1 text-xs text-danger">{msg}</p> : null;
}

export function LoginForm() {
  const { state, pending, onSubmit } = useFormAction(loginAction);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="email" required /></div>
      <div><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" autoComplete="current-password" required /></div>
      {state && !state.ok && <Alert>{state.error}</Alert>}
      <Button className="w-full" disabled={pending}>{pending ? "Accesso…" : "Accedi"}</Button>
    </form>
  );
}

export function ActivationForm() {
  const { state, pending, onSubmit } = useFormAction(activateAction);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div><Label htmlFor="code">Codice di attivazione</Label><Input id="code" name="code" required autoComplete="off" placeholder="XXXX-XXXX-XXXX" /><FieldError state={state} name="code" /></div>
      <div><Label htmlFor="orgName">Nome azienda</Label><Input id="orgName" name="orgName" required /><FieldError state={state} name="orgName" /></div>
      <div><Label htmlFor="fullName">Il tuo nome</Label><Input id="fullName" name="fullName" required autoComplete="name" /><FieldError state={state} name="fullName" /></div>
      <div><Label htmlFor="email">Email (quella a cui è stato inviato il codice)</Label><Input id="email" name="email" type="email" required autoComplete="email" /><FieldError state={state} name="email" /></div>
      <div><Label htmlFor="password">Password (min. 10 caratteri)</Label><Input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" /><FieldError state={state} name="password" /></div>
      {state && !state.ok && <Alert>{state.error}</Alert>}
      <Button className="w-full" disabled={pending}>{pending ? "Attivazione…" : "Attiva azienda"}</Button>
    </form>
  );
}

export function InvitationForm({ token }: { token: string }) {
  const { state, pending, onSubmit } = useFormAction(acceptInvitationAction.bind(null, token));
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div><Label htmlFor="fullName">Il tuo nome</Label><Input id="fullName" name="fullName" required autoComplete="name" /><FieldError state={state} name="fullName" /></div>
      <div><Label htmlFor="email">Email invitata</Label><Input id="email" name="email" type="email" required autoComplete="email" /><FieldError state={state} name="email" /></div>
      <div><Label htmlFor="password">Password (min. 10 caratteri)</Label><Input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" /><FieldError state={state} name="password" /></div>
      {state && !state.ok && <Alert>{state.error}</Alert>}
      <Button className="w-full" disabled={pending}>{pending ? "Attendi…" : "Accetta invito"}</Button>
    </form>
  );
}
