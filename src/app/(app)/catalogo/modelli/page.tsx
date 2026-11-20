import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listTemplates } from "@/modules/settore/queries";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export default async function TemplatesPage() {
  const ctx = await requireContext();
  const templates = await listTemplates(await createClient(), ctx.org.organizationId);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Un modello precompila righe, oggetto, note e condizioni di un nuovo preventivo: scegli «Applica un modello» nel modulo del preventivo.</p>
        {can(ctx.org.role, "data:write") && <Link href="/catalogo/modelli/nuovo" className={buttonVariants()}>Nuovo modello</Link>}
      </div>
      <Card className="p-0">
        <ul className="divide-y divide-border text-sm" data-testid="templates">
          {templates.length === 0 && <li className="p-4 text-muted">Nessun modello. Puoi aggiungere quelli proposti per il tuo settore da Impostazioni → Settore.</li>}
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 p-3">
              <span><Link className="font-medium text-primary hover:underline" href={`/catalogo/modelli/${t.id}`}>{t.name}</Link>{t.description ? <span className="text-muted"> — {t.description}</span> : null}</span>
              <span className="text-xs text-muted">{t.items.length} righe{t.active ? "" : " · non attivo"}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
