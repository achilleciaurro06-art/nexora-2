"use client";

import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import type { ActionResult } from "@/lib/result";
import { CUSTOMER_TYPE_LABEL, type Customer } from "@/types/domain";
import { useFormAction } from "@/lib/use-form-action";
import { CustomFieldsInputs } from "@/modules/settore/ui/custom-fields-inputs";
import type { CustomFieldDef } from "@/modules/settore/custom-fields";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

export function CustomerForm({ action, customer, readOnly, fields = [], priceLists = [] }: { action: Action; customer?: Customer; readOnly?: boolean; fields?: CustomFieldDef[]; priceLists?: { id: string; name: string }[] }) {
  const { state, pending, onSubmit } = useFormAction(action);
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k]?.[0] : undefined);
  // i campi personalizzati obbligatori restano sempre visibili (il browser non può evidenziarli dentro una sezione chiusa)
  const required = fields.filter((d) => d.required), optional = fields.filter((d) => !d.required);
  const f = (name: keyof Customer) => ({ name, id: name, defaultValue: (customer?.[name] as string | null) ?? "", disabled: readOnly });
  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label htmlFor="name">Ragione sociale / Nome *</Label>
        <Input {...f("name")} required autoFocus={!customer} />
        {err("name") && <p className="mt-1 text-xs text-danger">{err("name")}</p>}
      </div>
      <div><Label htmlFor="phone">Telefono</Label><Input {...f("phone")} type="tel" /></div>
      <div><Label htmlFor="email">Email</Label><Input {...f("email")} type="email" />{err("email") && <p className="mt-1 text-xs text-danger">{err("email")}</p>}</div>
      <div>
        <Label htmlFor="customer_type">Tipologia</Label>
        <Select name="customer_type" id="customer_type" defaultValue={customer?.customer_type ?? "company"} disabled={readOnly}>
          {Object.entries(CUSTOMER_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </div>
      <CustomFieldsInputs defs={required} values={customer?.custom_values} readOnly={readOnly} />
      <Disclosure className="sm:col-span-2" title="Altri dettagli" hint="Partita IVA, indirizzo, stato, note…" defaultOpen={!!customer}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="industry">Settore di attività</Label><Input {...f("industry")} maxLength={100} /></div>
          <div>
            <Label htmlFor="status">Stato</Label>
            <Select name="status" id="status" defaultValue={customer?.status ?? "active"} disabled={readOnly}>
              <option value="lead">Potenziale</option><option value="active">Attivo</option><option value="inactive">Inattivo</option>
            </Select>
          </div>
          <div><Label htmlFor="vat_number">Partita IVA</Label><Input {...f("vat_number")} /></div>
          <div><Label htmlFor="tax_code">Codice fiscale</Label><Input {...f("tax_code")} /></div>
          <div className="sm:col-span-2"><Label htmlFor="website">Sito web</Label><Input {...f("website")} maxLength={200} placeholder="https://" /></div>
          <div className="sm:col-span-2"><Label htmlFor="address_line">Indirizzo</Label><Input {...f("address_line")} /></div>
          <div><Label htmlFor="city">Città</Label><Input {...f("city")} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label htmlFor="province">Prov.</Label><Input {...f("province")} maxLength={4} /></div>
            <div><Label htmlFor="postal_code">CAP</Label><Input {...f("postal_code")} /></div>
          </div>
          {priceLists.length > 0 && (
            <div className="sm:col-span-2">
              <Label htmlFor="price_list_id">Listino prezzi</Label>
              <Select name="price_list_id" id="price_list_id" defaultValue={customer?.price_list_id ?? ""} disabled={readOnly}>
                <option value="">Nessuno (prezzo base)</option>
                {priceLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </div>
          )}
          <CustomFieldsInputs defs={optional} values={customer?.custom_values} readOnly={readOnly} />
          <div className="sm:col-span-2"><Label htmlFor="notes">Note</Label><Textarea {...f("notes")} /></div>
        </div>
      </Disclosure>
      {state && !state.ok && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
      {state?.ok && <div className="sm:col-span-2"><Alert kind="success">Salvato</Alert></div>}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button disabled={pending}>{pending ? "Salvataggio…" : "Salva"}</Button>
          {!customer && <p className="text-xs text-muted">Bastano il nome e un recapito: il resto si può completare dopo dalla scheda.</p>}
        </div>
      )}
    </form>
  );
}
