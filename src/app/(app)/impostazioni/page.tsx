/* eslint-disable @next/next/no-img-element -- anteprima di un URL firmato temporaneo */
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { removeLogoAction } from "@/modules/impostazioni/actions";
import { LogoForm, ProfileForm, type OrgProfile } from "@/modules/impostazioni/ui/forms";
import { Card, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Impostazioni aziendali" };

export default async function SettingsPage() {
  const ctx = await requireContext();
  const db = await createClient();
  const canEdit = can(ctx.org.role, "settings:manage");
  const { data: org } = await db.from("organizations")
    .select("name, vat_number, tax_code, address, email, phone, website, logo_path, quote_footer, quote_default_terms")
    .eq("id", ctx.org.organizationId).maybeSingle();
  if (!org) return null;
  const logoUrl = org.logo_path ? (await db.storage.from("documents").createSignedUrl(org.logo_path as string, 300)).data?.signedUrl : undefined;
  return (
    <>
      <PageHeader title="Impostazioni aziendali"
        description={canEdit ? "Questi dati compaiono automaticamente nei PDF dei preventivi." : "Solo titolare e amministratori possono modificare questi dati."} />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card><ProfileForm org={org as OrgProfile} readOnly={!canEdit} /></Card>
        <Card className="h-fit">
          <h2 className="mb-3 font-medium">Logo</h2>
          {logoUrl ? <img src={logoUrl} alt={`Logo di ${org.name as string}`} className="mb-3 max-h-24 max-w-full rounded border border-border bg-white p-2" /> : <p className="mb-3 text-sm text-muted">Nessun logo caricato.</p>}
          {canEdit && (
            <div className="space-y-3">
              <LogoForm />
              {logoUrl && <form action={removeLogoAction}><Button variant="ghost" size="sm">Rimuovi logo</Button></form>}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
