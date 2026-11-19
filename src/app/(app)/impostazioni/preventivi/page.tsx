import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { updateQuoteSettingsAction } from "@/modules/impostazioni/actions";
import { ActionForm } from "@/modules/impostazioni/ui/forms";
import { parseOrgSettings } from "@/modules/impostazioni/settings";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";

export const metadata = { title: "Impostazioni · Preventivi" };

export default async function QuoteSettingsPage() {
  const ctx = await requireContext();
  const canEdit = can(ctx.org.role, "settings:manage");
  const { data: org } = await (await createClient()).from("organizations").select("settings, quote_default_terms, quote_footer").eq("id", ctx.org.organizationId).maybeSingle();
  const s = parseOrgSettings(org?.settings).quotes;
  return (
    <Card>
      <p className="mb-4 text-sm text-muted">{canEdit ? "Valori predefiniti per i nuovi preventivi. Si possono sempre cambiare caso per caso." : "Solo titolare e amministratori possono modificare queste impostazioni."}</p>
      <ActionForm action={updateQuoteSettingsAction} readOnly={!canEdit} successMessage="Impostazioni dei preventivi salvate">
        <div><Label htmlFor="default_vat_rate">Aliquota IVA predefinita (%)</Label><Input id="default_vat_rate" name="default_vat_rate" type="number" step="0.01" min={0} max={100} defaultValue={s.default_vat_rate} disabled={!canEdit} required /></div>
        <div><Label htmlFor="default_validity_days">Validità predefinita (giorni)</Label><Input id="default_validity_days" name="default_validity_days" type="number" min={0} max={365} defaultValue={s.default_validity_days} disabled={!canEdit} required />
          <p className="mt-1 text-xs text-muted">0 = nessuna scadenza precompilata.</p></div>
        <div className="sm:col-span-2"><Label htmlFor="quote_default_terms">Condizioni commerciali predefinite</Label><Textarea id="quote_default_terms" name="quote_default_terms" defaultValue={(org?.quote_default_terms as string) ?? ""} disabled={!canEdit} placeholder="Es. Pagamento 50% all'ordine, saldo alla consegna." /></div>
        <div className="sm:col-span-2"><Label htmlFor="quote_footer">Informazioni a piè dei preventivi (PDF)</Label><Textarea id="quote_footer" name="quote_footer" defaultValue={(org?.quote_footer as string) ?? ""} disabled={!canEdit} placeholder="Es. note legali, informazioni di pagamento aggiuntive." /></div>
      </ActionForm>
    </Card>
  );
}
