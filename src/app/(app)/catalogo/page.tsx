import Link from "next/link";
import { AskCopilotButton } from "@/modules/copilot/ui/ask-button";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listProducts } from "@/modules/settore/queries";
import { Card, Table } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEur } from "@/lib/money";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await requireContext();
  const products = await listProducts(await createClient(), ctx.org.organizationId, { search: q });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form className="flex gap-2" role="search"><Input name="q" defaultValue={q ?? ""} placeholder="Cerca per nome, codice, categoria" aria-label="Cerca nel catalogo" className="w-72" /><button className={buttonVariants({ variant: "outline" })}>Cerca</button></form>
        <div className="flex flex-wrap gap-2">{can(ctx.org.role, "ai:use") && <AskCopilotButton question="Controlla il catalogo: quali voci hanno informazioni mancanti o prezzi incoerenti?" label="Controlla con il Copilot" size="default" />}
          {can(ctx.org.role, "data:write") && <Link href="/catalogo/nuovo" className={buttonVariants()}>Nuovo prodotto o servizio</Link>}</div>
      </div>
      <Card className="p-0">
        <Table>
          <thead><tr><th>Codice</th><th>Nome</th><th>Tipo</th><th>Categoria</th><th>Unità</th><th className="text-right">Prezzo base</th><th className="text-right">IVA</th><th>Stato</th></tr></thead>
          <tbody>
            {products.length === 0 && <tr><td colSpan={8} className="text-muted">{q ? "Nessun risultato." : "Il catalogo è vuoto. Aggiungi i prodotti e i servizi che vendi di più."}</td></tr>}
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.code ?? "—"}</td>
                <td><Link className="font-medium text-primary hover:underline" href={`/catalogo/${p.id}`}>{p.name}</Link></td>
                <td>{p.kind === "service" ? "Servizio" : "Prodotto"}</td><td>{p.category ?? "—"}</td><td>{p.unit}</td>
                <td className="text-right">{formatEur(p.unit_price_cents)}</td><td className="text-right">{p.vat_rate}%</td>
                <td>{p.active ? "Attivo" : <span className="text-muted">Non attivo</span>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
