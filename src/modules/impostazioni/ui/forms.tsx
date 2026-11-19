"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { updateOrganizationProfileAction, uploadLogoAction } from "../actions";

export type OrgProfile = {
  name: string; vat_number: string | null; tax_code: string | null; address: string | null; email: string | null; phone: string | null;
  website: string | null; quote_footer: string | null; quote_default_terms: string | null;
};

export function ProfileForm({ org, readOnly }: { org: OrgProfile; readOnly: boolean }) {
  const [state, action, pending] = useActionState(updateOrganizationProfileAction, null);
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k]?.[0] : undefined);
  const f = (k: keyof OrgProfile) => ({ name: k, id: k, defaultValue: org[k] ?? "", disabled: readOnly });
  return (
    <form action={action} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><Label htmlFor="name">Nome azienda *</Label><Input {...f("name")} required />{err("name") && <p className="mt-1 text-xs text-danger">{err("name")}</p>}</div>
      <div><Label htmlFor="vat_number">Partita IVA</Label><Input {...f("vat_number")} /></div>
      <div><Label htmlFor="tax_code">Codice fiscale</Label><Input {...f("tax_code")} /></div>
      <div className="sm:col-span-2"><Label htmlFor="address">Indirizzo</Label><Input {...f("address")} /></div>
      <div><Label htmlFor="email">Email</Label><Input {...f("email")} type="email" />{err("email") && <p className="mt-1 text-xs text-danger">{err("email")}</p>}</div>
      <div><Label htmlFor="phone">Telefono</Label><Input {...f("phone")} /></div>
      <div className="sm:col-span-2"><Label htmlFor="website">Sito web</Label><Input {...f("website")} placeholder="https://www.esempio.it" />{err("website") && <p className="mt-1 text-xs text-danger">{err("website")}</p>}</div>
      <div className="sm:col-span-2">
        <Label htmlFor="quote_default_terms">Condizioni predefinite dei preventivi</Label>
        <Textarea {...f("quote_default_terms")} placeholder="Es. Validità 30 giorni. Pagamento 50% all'ordine, saldo alla consegna." />
        <p className="mt-1 text-xs text-muted">Precompilate nei nuovi preventivi (modificabili caso per caso).</p>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="quote_footer">Informazioni a piè dei preventivi (PDF)</Label>
        <Textarea {...f("quote_footer")} placeholder="Es. IBAN, coordinate di pagamento, note legali." />
      </div>
      {state && !state.ok && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
      {state?.ok && <div className="sm:col-span-2"><Alert kind="success">Impostazioni salvate</Alert></div>}
      {!readOnly && <div className="sm:col-span-2"><Button disabled={pending}>{pending ? "Salvataggio…" : "Salva impostazioni"}</Button></div>}
    </form>
  );
}

export function LogoForm() {
  const [state, action, pending] = useActionState(uploadLogoAction, null);
  return (
    <form action={action} className="space-y-2">
      <Label htmlFor="logo">Carica un nuovo logo (PNG o JPEG, max 1 MB)</Label>
      <Input id="logo" name="logo" type="file" accept="image/png,image/jpeg" required className="h-auto py-1.5" />
      {state && !state.ok && <Alert>{state.error}</Alert>}
      {state?.ok && <Alert kind="success">Logo aggiornato</Alert>}
      <Button variant="outline" disabled={pending}>{pending ? "Carico…" : "Carica logo"}</Button>
    </form>
  );
}
