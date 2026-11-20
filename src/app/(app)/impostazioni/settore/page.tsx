import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { applyPresetAction, createFieldAction, toggleFieldAction, updateSectorAction } from "@/modules/settore/actions";
import { getSector, listFieldDefs } from "@/modules/settore/queries";
import { SECTORS, SECTOR_KEYS } from "@/modules/settore/presets";
import { DEFAULT_TERMS, TERM_KEYS } from "@/modules/settore/terms";
import { FIELD_TYPE_LABEL } from "@/modules/settore/custom-fields";
import { ActionForm } from "@/modules/impostazioni/ui/forms";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";

export const metadata = { title: "Impostazioni · Settore" };
const TERM_LABEL = { customer_singular: "Cliente (singolare)", customer_plural: "Clienti (plurale)", quote_singular: "Preventivo (singolare)", quote_plural: "Preventivi (plurale)" } as const;

export default async function SectorSettingsPage() {
  const ctx = await requireContext();
  const canEdit = can(ctx.org.role, "settings:manage");
  const db = await createClient();
  const [{ sector, rawTerms }, defs] = await Promise.all([getSector(db, ctx.org.organizationId), listFieldDefs(db, ctx.org.organizationId)]);
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 font-medium">Settore e terminologia</h2>
        <p className="mb-4 text-sm text-muted">{canEdit ? "Adatta NEXORA al tuo mestiere: il settore orienta anche i suggerimenti del Copilot, i nomi cambiano nei menu e negli elenchi." : "Solo titolare e amministratori possono modificare queste impostazioni."}</p>
        <ActionForm action={updateSectorAction} readOnly={!canEdit} successMessage="Settore e terminologia salvati">
          <div className="sm:col-span-2">
            <Label htmlFor="sector">Settore</Label>
            <Select id="sector" name="sector" defaultValue={sector} disabled={!canEdit}>
              {SECTOR_KEYS.map((k) => <option key={k} value={k}>{SECTORS[k].label}</option>)}
            </Select>
            <p className="mt-1 text-xs text-muted">{SECTORS[sector].description}</p>
          </div>
          {TERM_KEYS.map((k) => (
            <div key={k}><Label htmlFor={k}>{TERM_LABEL[k]}</Label><Input id={k} name={k} maxLength={30} defaultValue={rawTerms[k] ?? ""} placeholder={DEFAULT_TERMS[k]} disabled={!canEdit} /></div>
          ))}
        </ActionForm>
        {canEdit && sector !== "generic" && (SECTORS[sector].fields.length > 0 || SECTORS[sector].templates.length > 0) && (
          <div className="mt-6 border-t border-border pt-4">
            <h3 className="mb-1 text-sm font-medium">Proposte per «{SECTORS[sector].label}»</h3>
            <p className="mb-3 text-xs text-muted">{SECTORS[sector].fields.length} campi personalizzati e {SECTORS[sector].templates.length} modelli di partenza. Sono suggerimenti da adattare; quelli già presenti non vengono toccati e i prezzi dei modelli sono a zero.</p>
            <ActionForm action={applyPresetAction} submitLabel="Aggiungi le proposte"><span className="hidden" /></ActionForm>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 font-medium">Campi personalizzati</h2>
        <p className="mb-4 text-sm text-muted">Dati in più su clienti e preventivi, specifici del tuo settore. Un campo disattivato sparisce dai moduli ma i valori già inseriti restano salvati.</p>
        {(["customer", "quote"] as const).map((entity) => {
          const rows = defs.filter((d) => d.entity === entity);
          return (
            <div key={entity} className="mb-4">
              <h3 className="mb-1 text-sm font-medium">{entity === "customer" ? "Sui clienti" : "Sui preventivi"}</h3>
              {rows.length === 0 ? <p className="text-sm text-muted">Nessun campo.</p> : (
                <ul className="divide-y divide-border text-sm" data-testid={`fields-${entity}`}>
                  {rows.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className={d.active ? "" : "text-muted line-through"}>{d.label} <span className="text-xs text-muted">· {FIELD_TYPE_LABEL[d.field_type]}{d.required ? " · obbligatorio" : ""}{d.field_type === "select" ? ` · ${d.options.join(", ")}` : ""}</span></span>
                      {canEdit && <form action={toggleFieldAction.bind(null, d.id!, !d.active)}><Button variant="ghost" size="sm">{d.active ? "Disattiva" : "Riattiva"}</Button></form>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {canEdit && (
          <div className="border-t border-border pt-4">
            <h3 className="mb-2 text-sm font-medium">Nuovo campo</h3>
            <ActionForm action={createFieldAction} submitLabel="Crea campo" successMessage="Campo creato">
              <div><Label htmlFor="entity">Dove</Label><Select id="entity" name="entity" defaultValue="customer"><option value="customer">Clienti</option><option value="quote">Preventivi</option></Select></div>
              <div><Label htmlFor="field_type">Tipo</Label><Select id="field_type" name="field_type" defaultValue="text">{Object.entries(FIELD_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></div>
              <div><Label htmlFor="label">Nome del campo</Label><Input id="label" name="label" maxLength={80} required /></div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="required" /> Obbligatorio</label>
              <div className="sm:col-span-2"><Label htmlFor="options">Scelte (solo per «Scelta da elenco», una per riga)</Label><Textarea id="options" name="options" rows={3} /></div>
            </ActionForm>
          </div>
        )}
      </Card>
    </div>
  );
}
