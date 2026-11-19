"use client";

import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import type { ActionResult } from "@/lib/result";
import type { Customer } from "@/types/domain";
import { useFormAction } from "@/lib/use-form-action";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

export function CustomerForm({ action, customer, readOnly }: { action: Action; customer?: Customer; readOnly?: boolean }) {
  const { state, pending, onSubmit } = useFormAction(action);
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k]?.[0] : undefined);
  const f = (name: keyof Customer) => ({ name, id: name, defaultValue: (customer?.[name] as string | null) ?? "", disabled: readOnly });
  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label htmlFor="name">Ragione sociale / Nome *</Label>
        <Input {...f("name")} required />
        {err("name") && <p className="mt-1 text-xs text-danger">{err("name")}</p>}
      </div>
      <div><Label htmlFor="vat_number">Partita IVA</Label><Input {...f("vat_number")} /></div>
      <div><Label htmlFor="tax_code">Codice fiscale</Label><Input {...f("tax_code")} /></div>
      <div><Label htmlFor="email">Email</Label><Input {...f("email")} type="email" />{err("email") && <p className="mt-1 text-xs text-danger">{err("email")}</p>}</div>
      <div><Label htmlFor="phone">Telefono</Label><Input {...f("phone")} /></div>
      <div className="sm:col-span-2"><Label htmlFor="address_line">Indirizzo</Label><Input {...f("address_line")} /></div>
      <div><Label htmlFor="city">Città</Label><Input {...f("city")} /></div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label htmlFor="province">Prov.</Label><Input {...f("province")} maxLength={4} /></div>
        <div><Label htmlFor="postal_code">CAP</Label><Input {...f("postal_code")} /></div>
      </div>
      <div>
        <Label htmlFor="status">Stato</Label>
        <Select name="status" id="status" defaultValue={customer?.status ?? "active"} disabled={readOnly}>
          <option value="lead">Potenziale</option><option value="active">Attivo</option><option value="inactive">Inattivo</option>
        </Select>
      </div>
      <div className="sm:col-span-2"><Label htmlFor="notes">Note</Label><Textarea {...f("notes")} /></div>
      {state && !state.ok && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
      {state?.ok && <div className="sm:col-span-2"><Alert kind="success">Salvato</Alert></div>}
      {!readOnly && <div className="sm:col-span-2"><Button disabled={pending}>{pending ? "Salvataggio…" : "Salva"}</Button></div>}
    </form>
  );
}
