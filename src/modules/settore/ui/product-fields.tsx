import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { Product } from "../queries";

/** Campi del modulo prodotto/servizio (server component, da usare dentro un ActionForm). */
export function ProductFields({ product }: { product?: Product }) {
  return (
    <>
      <div><Label htmlFor="name">Nome *</Label><Input id="name" name="name" required maxLength={200} defaultValue={product?.name ?? ""} /></div>
      <div><Label htmlFor="code">Codice</Label><Input id="code" name="code" maxLength={40} defaultValue={product?.code ?? ""} /></div>
      <div><Label htmlFor="kind">Tipo</Label>
        <Select id="kind" name="kind" defaultValue={product?.kind ?? "product"}><option value="product">Prodotto</option><option value="service">Servizio</option></Select></div>
      <div><Label htmlFor="category">Categoria</Label><Input id="category" name="category" maxLength={80} defaultValue={product?.category ?? ""} /></div>
      <div><Label htmlFor="unit">Unità di misura *</Label><Input id="unit" name="unit" required maxLength={12} defaultValue={product?.unit ?? "pz"} placeholder="pz, ora, m, mq…" /></div>
      <div><Label htmlFor="unit_price_cents">Prezzo base (€)</Label><Input id="unit_price_cents" name="unit_price_cents" inputMode="decimal" defaultValue={product ? (product.unit_price_cents / 100).toFixed(2).replace(".", ",") : "0,00"} /></div>
      <div><Label htmlFor="vat_rate">IVA (%)</Label><Input id="vat_rate" name="vat_rate" type="number" step="0.01" min={0} max={100} defaultValue={product?.vat_rate ?? 22} required /></div>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={product?.active ?? true} /> Attivo (proponibile nei preventivi)</label>
      <div className="sm:col-span-2"><Label htmlFor="description">Descrizione (compare nella riga del preventivo)</Label><Textarea id="description" name="description" maxLength={1000} defaultValue={product?.description ?? ""} /></div>
    </>
  );
}
