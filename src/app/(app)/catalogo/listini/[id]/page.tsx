import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { deletePriceListAction, savePriceListAction, savePriceListItemsAction } from "@/modules/settore/actions";
import { listProducts } from "@/modules/settore/queries";
import { ActionForm } from "@/modules/impostazioni/ui/forms";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { RemoveButton } from "@/components/ui/remove-button";
import { formatEur } from "@/lib/money";
import { isUuid } from "@/lib/ids";

export default async function PriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!isUuid(id)) notFound();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data: list } = await db.from("price_lists").select("id, name, description, active").eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (!list) notFound();
  const [products, items, linked] = await Promise.all([
    listProducts(db, orgId),
    db.from("price_list_items").select("product_id, unit_price_cents").eq("organization_id", orgId).eq("price_list_id", id),
    db.from("customers").select("name").eq("organization_id", orgId).eq("price_list_id", id).is("deleted_at", null).order("name").limit(50),
  ]);
  const prices = new Map((items.data ?? []).map((i) => [i.product_id as string, Number(i.unit_price_cents)]));
  const canEdit = can(ctx.org.role, "settings:manage");
  return (
    <div className="space-y-4">
      <Card>
        <ActionForm action={savePriceListAction.bind(null, id)} readOnly={!canEdit} successMessage="Listino salvato">
          <div><Label htmlFor="name">Nome *</Label><Input id="name" name="name" required maxLength={100} defaultValue={list.name as string} disabled={!canEdit} /></div>
          <div><Label htmlFor="description">Descrizione</Label><Input id="description" name="description" maxLength={500} defaultValue={(list.description as string | null) ?? ""} disabled={!canEdit} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={list.active as boolean} disabled={!canEdit} /> Attivo (applicabile nei preventivi)</label>
        </ActionForm>
        <p className="mt-3 text-sm text-muted">Clienti con questo listino: {(linked.data ?? []).length ? (linked.data ?? []).map((c) => c.name as string).join(", ") : "nessuno"}.</p>
      </Card>
      <Card>
        <h2 className="mb-1 font-medium">Prezzi del listino</h2>
        <p className="mb-3 text-sm text-muted">Lascia vuoto dove vale il prezzo base.</p>
        {products.length === 0 ? <p className="text-sm text-muted">Il catalogo è vuoto: aggiungi prima i prodotti.</p> : (
          <ActionForm action={savePriceListItemsAction.bind(null, id)} readOnly={!canEdit} submitLabel="Salva prezzi" successMessage="Prezzi salvati">
            <div className="grid gap-2 sm:col-span-2" data-testid="price-grid">
              {products.map((p) => (
                <div key={p.id} className="grid items-center gap-2 sm:grid-cols-[1fr_130px_150px]">
                  <label htmlFor={`price_${p.id}`} className="text-sm">{p.code ? `${p.code} · ` : ""}{p.name}</label>
                  <span className="text-xs text-muted">Base: {formatEur(p.unit_price_cents)}</span>
                  <Input id={`price_${p.id}`} name={`price_${p.id}`} inputMode="decimal" aria-label={`Prezzo di listino per ${p.name}`} defaultValue={prices.has(p.id) ? (prices.get(p.id)! / 100).toFixed(2).replace(".", ",") : ""} disabled={!canEdit} />
                </div>
              ))}
            </div>
          </ActionForm>
        )}
      </Card>
      {can(ctx.org.role, "data:delete") && (
        <RemoveButton variant="outline" size="default" label="Elimina listino" action={deletePriceListAction.bind(null, id)}
          confirmMessage={`Eliminare il listino «${list.name as string}»?\n\nI clienti che lo usano tornano al prezzo base. I preventivi già fatti non cambiano.`} />
      )}
    </div>
  );
}
