import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { archiveTemplateAction, saveTemplateAction } from "@/modules/settore/actions";
import { listTemplates } from "@/modules/settore/queries";
import { TemplateForm } from "@/modules/settore/ui/template-form";
import { parseOrgSettings } from "@/modules/impostazioni/settings";
import { RemoveButton } from "@/components/ui/remove-button";
import { isUuid } from "@/lib/ids";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!isUuid(id)) notFound();
  const db = await createClient();
  const [templates, { data: org }] = await Promise.all([listTemplates(db, ctx.org.organizationId), db.from("organizations").select("settings").eq("id", ctx.org.organizationId).maybeSingle()]);
  const t = templates.find((x) => x.id === id);
  if (!t) notFound();
  const canWrite = can(ctx.org.role, "data:write");
  return (
    <div className="space-y-4">
      <TemplateForm action={saveTemplateAction.bind(null, id)} readOnly={!canWrite} defaultVat={String(parseOrgSettings(org?.settings).quotes.default_vat_rate)} initial={{ ...t, items: t.items }} />
      {canWrite && <RemoveButton variant="outline" size="default" label="Archivia modello" action={archiveTemplateAction.bind(null, id)} confirmMessage={`Archiviare il modello «${t.name}»?\n\nI preventivi già fatti non cambiano.`} />}
    </div>
  );
}
