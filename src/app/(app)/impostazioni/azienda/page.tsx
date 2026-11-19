/* eslint-disable @next/next/no-img-element -- anteprima di un URL firmato temporaneo */
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { removeLogoAction, updateCompanyAction } from "@/modules/impostazioni/actions";
import { ActionForm, LogoForm } from "@/modules/impostazioni/ui/forms";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export const metadata = { title: "Impostazioni · Azienda" };

export default async function CompanySettingsPage() {
  const ctx = await requireContext();
  const db = await createClient();
  const canEdit = can(ctx.org.role, "settings:manage");
  const { data: org } = await db.from("organizations")
    .select("name, vat_number, tax_code, address, legal_address, email, pec, phone, website, bank_name, iban, logo_path").eq("id", ctx.org.organizationId).maybeSingle();
  if (!org) return null;
  const logoUrl = org.logo_path ? (await db.storage.from("documents").createSignedUrl(org.logo_path as string, 300)).data?.signedUrl : undefined;
  const v = (k: string) => ((org as Record<string, unknown>)[k] as string | null) ?? "";
  const field = (id: string, label: string, props: React.ComponentProps<typeof Input> = {}, wide = false) => (
    <div className={wide ? "sm:col-span-2" : undefined}><Label htmlFor={id}>{label}</Label><Input id={id} name={id} defaultValue={v(id)} disabled={!canEdit} {...props} /></div>
  );
  return (
    <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
      <Card>
        <p className="mb-4 text-sm text-muted">{canEdit ? "Questi dati compaiono automaticamente nei PDF dei preventivi." : "Solo titolare e amministratori possono modificare questi dati."}</p>
        <ActionForm action={updateCompanyAction} readOnly={!canEdit} successMessage="Dati aziendali salvati">
          {field("name", "Ragione sociale *", { required: true }, true)}
          {field("vat_number", "Partita IVA")}
          {field("tax_code", "Codice fiscale")}
          {field("address", "Indirizzo (sede operativa)", {}, true)}
          {field("legal_address", "Sede legale (se diversa)", {}, true)}
          {field("email", "Email", { type: "email" })}
          {field("pec", "PEC", { type: "email" })}
          {field("phone", "Telefono")}
          {field("website", "Sito web", { placeholder: "https://www.esempio.it" })}
          {field("bank_name", "Banca")}
          {field("iban", "IBAN", { placeholder: "IT00 X000 0000 0000 0000 0000 000" })}
        </ActionForm>
      </Card>
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
  );
}
