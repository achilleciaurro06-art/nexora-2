import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { setNextQuoteNumberAction, updateQuoteNumberingAction, updateQuoteSettingsAction } from "@/modules/impostazioni/actions";
import { ActionForm } from "@/modules/impostazioni/ui/forms";
import { parseOrgSettings } from "@/modules/impostazioni/settings";
import { Card } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";

export const metadata = { title: "Impostazioni · Preventivi" };

export default async function QuoteSettingsPage() {
  const ctx = await requireContext();
  const canEdit = can(ctx.org.role, "settings:manage");
  const { data: org } = await (await createClient()).from("organizations").select("settings, quote_default_terms, quote_footer, quote_numbering").eq("id", ctx.org.organizationId).maybeSingle();
  const s = parseOrgSettings(org?.settings).quotes;
  const num = { prefix: "", digits: 4, yearly: true, ...((org?.quote_numbering as object | null) ?? {}) };
  const example = `${num.prefix}${num.yearly ? `${new Date().getFullYear()}/` : ""}${String(1).padStart(num.digits, "0")}`;
  return (
    <div className="space-y-4">
    <Card>
      <p className="mb-4 text-sm text-muted">{canEdit ? "Valori predefiniti per i nuovi preventivi. Si possono sempre cambiare caso per caso." : "Solo titolare e amministratori possono modificare queste impostazioni."}</p>
      <ActionForm action={updateQuoteSettingsAction} readOnly={!canEdit} successMessage="Impostazioni dei preventivi salvate">
        <div><Label htmlFor="default_vat_rate">Aliquota IVA predefinita (%)</Label><Input id="default_vat_rate" name="default_vat_rate" type="number" step="0.01" min={0} max={100} defaultValue={s.default_vat_rate} disabled={!canEdit} required /></div>
        <div><Label htmlFor="default_validity_days">Validità predefinita (giorni)</Label><Input id="default_validity_days" name="default_validity_days" type="number" min={0} max={365} defaultValue={s.default_validity_days} disabled={!canEdit} required />
          <p className="mt-1 text-xs text-muted">0 = nessuna scadenza precompilata.</p></div>
        <div className="sm:col-span-2"><Label htmlFor="quote_default_terms">Condizioni commerciali predefinite</Label><Textarea id="quote_default_terms" name="quote_default_terms" defaultValue={(org?.quote_default_terms as string) ?? ""} disabled={!canEdit} placeholder="Es. Pagamento 50% all'ordine, saldo alla consegna." /></div>
        <div className="sm:col-span-2"><Label htmlFor="quote_footer">Informazioni a piè dei preventivi (PDF)</Label><Textarea id="quote_footer" name="quote_footer" defaultValue={(org?.quote_footer as string) ?? ""} disabled={!canEdit} placeholder="Es. note legali, informazioni di pagamento aggiuntive." /></div>
        <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium">Aspetto del PDF</legend>
          <div><Label htmlFor="pdf_template">Modello</Label>
            <Select id="pdf_template" name="pdf_template" defaultValue={s.pdf_template} disabled={!canEdit}>
              <option value="classic">Classico (intestazione e tabella con filetti)</option>
              <option value="minimal">Essenziale (più sobrio, senza riquadri colorati)</option>
            </Select></div>
          <div><Label htmlFor="pdf_accent">Colore principale</Label>
            <Select id="pdf_accent" name="pdf_accent" defaultValue={s.pdf_accent} disabled={!canEdit}>
              <option value="indigo">Indaco</option><option value="green">Verde</option><option value="slate">Grigio</option><option value="orange">Arancione</option><option value="red">Rosso</option>
            </Select></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pdf_show_logo" defaultChecked={s.pdf_show_logo} disabled={!canEdit} /> Mostra il logo</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pdf_show_payment" defaultChecked={s.pdf_show_payment} disabled={!canEdit} /> Mostra i dati di pagamento (IBAN)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pdf_show_brand" defaultChecked={s.pdf_show_brand} disabled={!canEdit} /> Mostra «Generato con NEXORA» a piè di pagina</label>
        </fieldset>
      </ActionForm>
    </Card>
    <Card>
      <h2 className="mb-1 font-medium">Numerazione dei preventivi</h2>
      <p className="mb-4 text-sm text-muted">Vale per i preventivi creati da ora in poi: quelli già emessi mantengono il loro numero. Esempio attuale: <strong data-testid="numbering-example">{example}</strong></p>
      <ActionForm action={updateQuoteNumberingAction} readOnly={!canEdit} submitLabel="Salva numerazione" successMessage="Numerazione salvata">
        <div><Label htmlFor="prefix">Prefisso</Label><Input id="prefix" name="prefix" maxLength={10} defaultValue={num.prefix} disabled={!canEdit} placeholder="Es. PRV-" /></div>
        <div><Label htmlFor="digits">Cifre del progressivo</Label><Input id="digits" name="digits" type="number" min={3} max={8} defaultValue={num.digits} disabled={!canEdit} required /></div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="yearly" defaultChecked={num.yearly} disabled={!canEdit} /> Includi l&apos;anno e riparti da 1 ogni anno</label>
      </ActionForm>
      {canEdit && (
        <div className="mt-6 border-t border-border pt-4">
          <h3 className="mb-1 text-sm font-medium">Imposta il prossimo numero</h3>
          <p className="mb-3 text-xs text-muted">Utile se arrivi da un altro gestionale. Non si può mai tornare a un numero già emesso: la numerazione resta senza duplicati.</p>
          <ActionForm action={setNextQuoteNumberAction} submitLabel="Imposta">
            <div><Label htmlFor="next">Prossimo numero progressivo</Label><Input id="next" name="next" type="number" min={1} required /></div>
          </ActionForm>
        </div>
      )}
    </Card>
    </div>
  );
}
