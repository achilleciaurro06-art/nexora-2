import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { updateEmailSettingsAction } from "@/modules/impostazioni/actions";
import { ActionForm } from "@/modules/impostazioni/ui/forms";
import { parseOrgSettings } from "@/modules/impostazioni/settings";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";

export const metadata = { title: "Impostazioni · Email" };

export default async function EmailSettingsPage() {
  const ctx = await requireContext();
  const canEdit = can(ctx.org.role, "settings:manage");
  const { data: org } = await (await createClient()).from("organizations").select("settings, email").eq("id", ctx.org.organizationId).maybeSingle();
  const e = parseOrgSettings(org?.settings).email;
  return (
    <Card>
      <p className="mb-4 text-sm text-muted">Preferenze di invio per le email inviate da NEXORA (ad esempio i preventivi). {canEdit ? "" : "Solo titolare e amministratori possono modificarle."}</p>
      <ActionForm action={updateEmailSettingsAction} readOnly={!canEdit} successMessage="Preferenze email salvate">
        <div><Label htmlFor="sender_name">Nome del mittente</Label><Input id="sender_name" name="sender_name" defaultValue={e.sender_name} disabled={!canEdit} placeholder="Es. Azienda Prova — Ufficio commerciale" /></div>
        <div><Label htmlFor="reply_to">Indirizzo per le risposte</Label><Input id="reply_to" name="reply_to" type="email" defaultValue={e.reply_to || ((org?.email as string) ?? "")} disabled={!canEdit} /></div>
        <div className="sm:col-span-2"><Label htmlFor="signature">Firma</Label><Textarea id="signature" name="signature" rows={4} defaultValue={e.signature} disabled={!canEdit} placeholder={"Cordiali saluti,\nMario Rossi\nAzienda Prova S.r.l."} /></div>
      </ActionForm>
    </Card>
  );
}
