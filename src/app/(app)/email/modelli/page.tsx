import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { deleteTemplateAction, saveTemplateAction } from "@/modules/email/actions";
import { TemplateEditor } from "@/modules/email/ui/template-editor";
import { Card } from "@/components/ui/card";
import { RemoveButton } from "@/components/ui/remove-button";

export default async function TemplatesPage() {
  const ctx = await requireContext();
  const db = await createClient();
  const { data } = await db.from("email_templates").select("id, name, subject, body_html").eq("organization_id", ctx.org.organizationId).order("name");
  const canWrite = can(ctx.org.role, "data:write");
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Modelli riutilizzabili per le email. Nel testo e nell&apos;oggetto puoi usare i segnaposto <code>{"{{referente}}"}</code>, <code>{"{{cliente}}"}</code>, <code>{"{{azienda}}"}</code>, <code>{"{{mittente}}"}</code>, <code>{"{{numero_preventivo}}"}</code>, <code>{"{{oggetto}}"}</code>. Non vengono mai inviati in automatico.</p>
      {(data ?? []).map((t) => (
        <Card key={t.id as string} data-testid="template">
          <TemplateEditor id={t.id as string} name={t.name as string} subject={t.subject as string} body={t.body_html as string} readOnly={!canWrite} action={saveTemplateAction.bind(null, t.id as string)} />
          {can(ctx.org.role, "data:delete") && <div className="mt-3"><RemoveButton action={deleteTemplateAction.bind(null, t.id as string)} confirmMessage={`Eliminare il modello «${t.name as string}»?`} label="Elimina modello" /></div>}
        </Card>
      ))}
      {canWrite && <Card><h2 className="mb-3 font-medium">Nuovo modello</h2><TemplateEditor id="new" name="" subject="" body="" action={saveTemplateAction.bind(null, null)} reset /></Card>}
    </div>
  );
}
