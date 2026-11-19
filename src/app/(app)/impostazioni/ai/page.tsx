import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { updateAiSettingsAction } from "@/modules/impostazioni/actions";
import { ActionForm } from "@/modules/impostazioni/ui/forms";
import { parseOrgSettings } from "@/modules/impostazioni/settings";
import { Card } from "@/components/ui/card";
import { Label, Select, Textarea } from "@/components/ui/input";

export const metadata = { title: "Impostazioni · AI" };
const FEATURE: Record<string, string> = { copilot: "Copilot", document_analysis: "Analisi documenti", price_analysis: "Analisi prezzi" };

export default async function AiSettingsPage() {
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const canEdit = can(ctx.org.role, "settings:manage");
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const [{ data: org }, { data: quota }, { data: usage }] = await Promise.all([
    db.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
    db.from("ai_quotas").select("monthly_token_limit, tokens_used").eq("organization_id", orgId).maybeSingle(),
    can(ctx.org.role, "members:manage") ? db.from("ai_usage").select("feature, input_tokens, output_tokens").eq("organization_id", orgId).gte("created_at", monthStart) : Promise.resolve({ data: [] }),
  ]);
  const ai = parseOrgSettings(org?.settings).ai;
  const used = Number(quota?.tokens_used ?? 0), limit = Number(quota?.monthly_token_limit ?? 0);
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const by = new Map<string, { calls: number; tokens: number }>();
  for (const u of usage ?? []) {
    const e = by.get(u.feature as string) ?? { calls: 0, tokens: 0 };
    e.calls++; e.tokens += Number(u.input_tokens) + Number(u.output_tokens);
    by.set(u.feature as string, e);
  }
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
      <Card className="h-fit">
        <h2 className="mb-3 font-medium">Utilizzo e limiti</h2>
        <p className="text-sm">Questo mese: <strong>{used.toLocaleString("it-IT")}</strong> / {limit.toLocaleString("it-IT")} token (prenotati)</p>
        <div className="mt-2 h-2 rounded-full bg-border" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Quota AI utilizzata"><div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
        <p className="mt-1 text-xs text-muted">Il limite è stabilito dal gestore della piattaforma. Si azzera ogni mese.</p>
        {by.size > 0 && (
          <ul className="mt-4 space-y-1 text-sm">
            {[...by.entries()].map(([f, v]) => <li key={f} className="flex justify-between gap-2"><span>{FEATURE[f] ?? f}</span><span className="text-muted">{v.calls} · {v.tokens.toLocaleString("it-IT")} token</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}
