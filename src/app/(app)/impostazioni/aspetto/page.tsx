import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { updateAppearanceAction } from "@/modules/impostazioni/actions";
import { ActionForm } from "@/modules/impostazioni/ui/forms";
import { parseUserPrefs } from "@/modules/impostazioni/settings";
import { Card } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/input";
import { RANGES } from "@/modules/dashboard/metrics";

export const metadata = { title: "Impostazioni · Aspetto" };

export default async function AppearanceSettingsPage() {
  const ctx = await requireContext();
  const { data } = await (await createClient()).from("profiles").select("preferences").eq("id", ctx.userId).maybeSingle();
  const a = parseUserPrefs(data?.preferences).appearance;
  return (
    <Card>
      <p className="mb-4 text-sm text-muted">Preferenze personali di visualizzazione.</p>
      <ActionForm action={updateAppearanceAction} successMessage="Preferenze salvate">
        <div className="sm:col-span-2">
          <Label htmlFor="dashboard_range">Periodo predefinito della dashboard</Label>
          <Select id="dashboard_range" name="dashboard_range" defaultValue={a.dashboard_range}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </Select>
        </div>
      </ActionForm>
    </Card>
  );
}
