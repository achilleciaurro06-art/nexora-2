import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { savePriceListAction } from "@/modules/settore/actions";
import { listPriceLists } from "@/modules/settore/queries";
import { ActionForm } from "@/modules/impostazioni/ui/forms";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

export default async function PriceListsPage() {
  const ctx = await requireContext();
  const db = await createClient();
  const [lists, counts, customers] = await Promise.all([
    listPriceLists(db, ctx.org.organizationId),
    db.from("price_list_items").select("price_list_id").eq("organization_id", ctx.org.organizationId).limit(20000),
    db.from("customers").select("price_list_id").eq("organization_id", ctx.org.organizationId).is("deleted_at", null).not("price_list_id", "is", null).limit(5000),
  ]);
  const n = (rows: { price_list_id: unknown }[] | null, id: string) => (rows ?? []).filter((r) => r.price_list_id === id).length;
  const canEdit = can(ctx.org.role, "settings:manage");
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Un listino ridefinisce i prezzi di alcuni prodotti per certi clienti (rivenditori, convenzioni…). Il listino si assegna dalla scheda cliente; nei preventivi i prodotti prendono il prezzo del listino, altrimenti il prezzo base.</p>
      <Card className="p-0">
        <ul className="divide-y divide-border text-sm" data-testid="price-lists">
          {lists.length === 0 && <li className="p-4 text-muted">Nessun listino.</li>}
          {lists.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 p-3">
              <Link className="font-medium text-primary hover:underline" href={`/catalogo/listini/${l.id}`}>{l.name}</Link>
              <span className="text-xs text-muted">{n(counts.data, l.id)} prezzi · {n(customers.data, l.id)} clienti{l.active ? "" : " · non attivo"}</span>
            </li>
          ))}
        </ul>
      </Card>
      {canEdit && (
        <Card>
          <h2 className="mb-2 font-medium">Nuovo listino</h2>
          <ActionForm action={savePriceListAction.bind(null, null)} submitLabel="Crea listino">
            <div><Label htmlFor="name">Nome *</Label><Input id="name" name="name" required maxLength={100} placeholder="Es. Rivenditori" /></div>
            <div><Label htmlFor="description">Descrizione</Label><Input id="description" name="description" maxLength={500} /></div>
            <input type="hidden" name="active" value="on" />
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
