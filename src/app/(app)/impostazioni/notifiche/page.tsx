import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { updateNotificationPrefsAction } from "@/modules/impostazioni/actions";
import { ActionForm } from "@/modules/impostazioni/ui/forms";
import { NOTIFICATION_KINDS, parseUserPrefs } from "@/modules/impostazioni/settings";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

export const metadata = { title: "Impostazioni · Notifiche" };

export default async function NotificationSettingsPage() {
  const ctx = await requireContext();
  const { data } = await (await createClient()).from("profiles").select("preferences").eq("id", ctx.userId).maybeSingle();
  const n = parseUserPrefs(data?.preferences).notifications;
  return (
    <Card>
      <p className="mb-4 text-sm text-muted">Scegli quali avvisi ricevere nell&apos;app. Sono preferenze personali: non cambiano quelle dei colleghi.</p>
      <ActionForm action={updateNotificationPrefsAction} successMessage="Preferenze di notifica salvate">
        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">Tipi di avviso</legend>
          {NOTIFICATION_KINDS.map((k) => (
            <label key={k.key} className="flex items-center gap-2 text-sm"><input type="checkbox" name={k.key} defaultChecked={n[k.key]} /> {k.label}</label>
          ))}
        </fieldset>
        <div>
          <Label htmlFor="due_soon_hours">Avvisami delle scadenze con anticipo di (ore)</Label>
          <Input id="due_soon_hours" name="due_soon_hours" type="number" min={1} max={168} defaultValue={n.due_soon_hours} required />
          <p className="mt-1 text-xs text-muted">Da 1 a 168 ore (7 giorni).</p>
        </div>
        <p className="text-xs text-muted sm:col-span-2">Notifiche email e notifiche del browser: saranno configurabili qui quando verranno attivate.</p>
      </ActionForm>
    </Card>
  );
}
