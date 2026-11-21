import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { updateAiSettingsAction } from "@/modules/impostazioni/actions";
import { ActionForm } from "@/modules/impostazioni/ui/forms";
import { parseOrgSettings } from "@/modules/impostazioni/settings";
import { Card } from "@/components/ui/card";
import { CreditsPanel, type UsageView } from "@/modules/copilot/ui/credits";
import { Label, Select, Textarea } from "@/components/ui/input";

export const metadata = { title: "Impostazioni · AI" };

export default async function AiSettingsPage() {
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const canEdit = can(ctx.org.role, "settings:manage");
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const [{ data: org }, { data: quota }, { data: usage }] = await Promise.all([
    db.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
    db.from("ai_quotas").select("monthly_token_limit, tokens_used, input_price_micro_per_mtok, output_price_micro_per_mtok").eq("organization_id", orgId).maybeSingle(),
    db.from("ai_usage").select("id, created_at, feature, model, input_tokens, output_tokens, cost_micro_eur, status, tokens_source, cost_source").eq("organization_id", orgId).gte("created_at", monthStart).order("created_at", { ascending: false }).limit(25),
  ]);
  const ai = parseOrgSettings(org?.settings).ai;
  const used = Number(quota?.tokens_used ?? 0), limit = Number(quota?.monthly_token_limit ?? 0);
  return (
    <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
      <Card>
        <h2 className="mb-1 font-medium">Preferenze del Copilot</h2>
        <p className="mb-4 text-sm text-muted">Il contesto che scrivi qui viene fornito al Copilot a ogni richiesta (consuma token: sii sintetico). Non inserire dati riservati o password.</p>
        <ActionForm action={updateAiSettingsAction} readOnly={!canEdit} successMessage="Preferenze AI salvate">
          <div className="sm:col-span-2">
            <Label htmlFor="tone">Stile delle risposte</Label>
            <Select id="tone" name="tone" defaultValue={ai.tone} disabled={!canEdit}><option value="concise">Sintetico</option><option value="detailed">Dettagliato</option></Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="context">Informazioni sull&apos;azienda utili all&apos;AI</Label>
            <Textarea id="context" name="context" rows={6} maxLength={1500} defaultValue={ai.context} disabled={!canEdit}
              placeholder="Es. Siamo un'azienda di serramenti a Torino. Vendiamo a privati e imprese edili, i preventivi hanno validità 30 giorni, i clienti più importanti sono le imprese." />
            <p className="mt-1 text-xs text-muted">Massimo 1500 caratteri.</p>
          </div>
        </ActionForm>
      </Card>
      <CreditsPanel quota={quota ? { limit, used, inputPrice: quota.input_price_micro_per_mtok === null ? null : Number(quota.input_price_micro_per_mtok), outputPrice: quota.output_price_micro_per_mtok === null ? null : Number(quota.output_price_micro_per_mtok) } : null}
        usage={(usage ?? []) as UsageView[]} scope={can(ctx.org.role, "members:manage") ? "organization" : "mine"} />
    </div>
  );
}
