import Link from "next/link";
import { AskCopilotButton } from "@/modules/copilot/ui/ask-button";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listProducts } from "@/modules/settore/queries";
import { Package, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Card, EmptyState, Table } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { formatEur } from "@/lib/money";

type SP = { q?: string; cat?: string; tipo?: string; stato?: string };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { q } = sp;
  const ctx = await requireContext();
  const all = await listProducts(await createClient(), ctx.org.organizationId, { search: q });
  // filtri sull'elenco già caricato (nessuna modifica alla query): categoria, tipo e stato
  const categories = [...new Set(all.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "it"));
  const products = all.filter((p) => (!sp.cat || p.category === sp.cat) && (!sp.tipo || p.kind === sp.tipo) && (!sp.stato || (sp.stato === "attivi" ? p.active : !p.active)));
  const href = (over: Partial<SP>) => {
    const m = { ...sp, ...over } as Record<string, string | undefined>;
    const qs = Object.entries(m).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join("&");
    return `/catalogo${qs ? `?${qs}` : ""}`;
  };
  const chip = (active: boolean) => cn("nx-t whitespace-nowrap rounded-sm border px-2.5 py-1 text-xs font-medium", active ? "border-primary bg-primary text-white" : "border-border bg-card text-muted hover:border-primary/40 hover:text-foreground");
  const kpis = [
    { label: "Voci", value: all.length }, { label: "Prodotti", value: all.filter((p) => p.kind === "product").length },
    { label: "Servizi", value: all.filter((p) => p.kind === "service").length }, { label: "Non attive", value: all.filter((p) => !p.active).length },
  ];
  return (
    <>
      <dl className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Indicatori del catalogo">
        {kpis.map((k) => <div key={k.label} className="rounded-lg border border-border bg-card px-4 py-3 shadow-card"><dt className="text-xs font-medium text-muted">{k.label}</dt><dd className="mt-0.5 text-xl font-semibold">{k.value}</dd></div>)}
      </dl>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <form className="flex flex-wrap gap-2" role="search">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input name="q" defaultValue={q ?? ""} placeholder="Cerca per nome, codice, categoria" aria-label="Cerca nel catalogo" className="w-72 pl-9" /></div>
          {sp.cat && <input type="hidden" name="cat" value={sp.cat} />}
          <Select name="tipo" defaultValue={sp.tipo ?? ""} aria-label="Filtra per tipo" className="w-40"><option value="">Prodotti e servizi</option><option value="product">Prodotti</option><option value="service">Servizi</option></Select>
          <Select name="stato" defaultValue={sp.stato ?? ""} aria-label="Filtra per stato" className="w-36"><option value="">Tutti gli stati</option><option value="attivi">Attivi</option><option value="non-attivi">Non attivi</option></Select>
          <button className={buttonVariants({ variant: "outline" })}>Cerca</button>
        </form>
        <div className="flex flex-wrap gap-2">{can(ctx.org.role, "ai:use") && <AskCopilotButton question="Controlla il catalogo: quali voci hanno informazioni mancanti o prezzi incoerenti?" label="Controlla con il Copilot" size="default" />}
          {can(ctx.org.role, "data:write") && <Link href="/catalogo/nuovo" className={buttonVariants()}><Plus className="size-4" />Nuovo prodotto o servizio</Link>}</div>
      </div>
      {categories.length > 0 && (
        <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Categorie">
          <Link href={href({ cat: undefined })} className={chip(!sp.cat)} aria-current={!sp.cat ? "page" : undefined}>Tutte le categorie</Link>
          {categories.map((c) => <Link key={c} href={href({ cat: c })} className={chip(sp.cat === c)} aria-current={sp.cat === c ? "page" : undefined}>{c}</Link>)}
        </nav>
      )}
      <Card className="p-0">
        <Table>
          <thead><tr><th>Codice</th><th>Nome</th><th>Tipo</th><th>Categoria</th><th>Unità</th><th className="text-right">Prezzo base</th><th className="text-right">IVA</th><th>Stato</th></tr></thead>
          <tbody>
            {products.length === 0 && <tr><td colSpan={8}><EmptyState icon={<Package className="size-5" />} title={q || sp.cat || sp.tipo || sp.stato ? "Nessun risultato." : "Il catalogo è vuoto. Aggiungi i prodotti e i servizi che vendi di più."} description={q || sp.cat || sp.tipo || sp.stato ? "Prova a cambiare ricerca o filtri." : undefined} /></td></tr>}
            {products.map((p) => (
              <tr key={p.id}>
                <td className="text-muted">{p.code ?? "—"}</td>
                <td><Link className="font-medium text-primary hover:underline" href={`/catalogo/${p.id}`}>{p.name}</Link></td>
                <td>{p.kind === "service" ? "Servizio" : "Prodotto"}</td><td>{p.category ? <Badge>{p.category}</Badge> : "—"}</td><td>{p.unit}</td>
                <td className="text-right font-medium">{formatEur(p.unit_price_cents)}</td><td className="text-right">{p.vat_rate}%</td>
                <td>{p.active ? <Badge className="border-success/30 bg-success/10 text-success">Attivo</Badge> : <span className="text-muted">Non attivo</span>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
