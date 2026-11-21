import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { archiveProductAction, saveProductAction } from "@/modules/settore/actions";
import { ProductFields } from "@/modules/settore/ui/product-fields";
import { ActionForm } from "@/modules/impostazioni/ui/forms";
import { Card } from "@/components/ui/card";
import { RemoveButton } from "@/components/ui/remove-button";
import { isUuid } from "@/lib/ids";
import type { Product } from "@/modules/settore/queries";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!isUuid(id)) notFound();
  const { data } = await (await createClient()).from("products").select("id, kind, code, name, description, category, unit, unit_price_cents, vat_rate, active")
    .eq("organization_id", ctx.org.organizationId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!data) notFound();
  const canWrite = can(ctx.org.role, "data:write");
  return (
    <Card>
      <ActionForm action={saveProductAction.bind(null, id)} readOnly={!canWrite} successMessage="Prodotto salvato"><ProductFields product={data as Product} /></ActionForm>
      {canWrite && (
        <div className="mt-6 border-t border-border pt-4">
          <RemoveButton variant="outline" size="default" label="Archivia" action={archiveProductAction.bind(null, id)}
            confirmMessage={`Archiviare «${data.name as string}»?\n\nNon sarà più proponibile nei preventivi. I preventivi già fatti non cambiano.`} />
        </div>
      )}
    </Card>
  );
}
