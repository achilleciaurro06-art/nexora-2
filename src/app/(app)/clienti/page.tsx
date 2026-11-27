import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { countArchivedCustomers, listCustomers } from "@/modules/clienti/repository";
import { ArrowDown, ArrowUp, ChevronsUpDown, Plus, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Alert, Badge, EmptyState, PageHeader, Table, Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { RemoveButton } from "@/components/ui/remove-button";
import { archiveCustomerAction, restoreCustomerAction } from "@/modules/clienti/actions";
import { getSector } from "@/modules/settore/queries";
import { CUSTOMER_TYPE_LABEL } from "@/types/domain";

export const metadata = { title: "Clienti" };
const STATUS = { lead: "Potenziale", active: "Attivo", inactive: "Inattivo" } as const;

type SP = { q?: string; stato?: string; filtro?: string; tipo?: string; eliminato?: string; ord?: string; dir?: string; p?: string };
const PAGE_SIZE = 25;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const archived = sp.stato === "archiviati";
  const ctx = await requireContext();
  const db = await createClient();
  const [customers, archivedCount, { terms }] = await Promise.all([
    listCustomers(db, ctx.org.organizationId, { q: sp.q, archived, status: sp.filtro, type: sp.tipo }),
    countArchivedCustomers(db, ctx.org.organizationId),
    getSector(db, ctx.org.organizationId),
  ]);
  const canWrite = can(ctx.org.role, "data:write");
  const base = (st: string) => (st ? `/clienti?stato=${st}` : "/clienti");

  // preventivi per cliente (sola lettura, stessa RLS): serve alla colonna «Preventivi» e agli indicatori
  const ids = customers.map((c) => c.id);
  const { data: qrows } = ids.length ? await db.from("quotes").select("customer_id, status").eq("organization_id", ctx.org.organizationId).is("deleted_at", null).in("customer_id", ids.slice(0, 200)) : { data: [] };
  const qc = new Map<string, { n: number; open: number }>();
  for (const r of qrows ?? []) { const e = qc.get(r.customer_id as string) ?? { n: 0, open: 0 }; e.n++; if (r.status === "sent" || r.status === "draft") e.open++; qc.set(r.customer_id as string, e); }

  // ordinamento e paginazione sull'elenco già caricato (nessuna modifica alla query)
  const ord = ["nome", "preventivi", "stato", "citta"].includes(sp.ord ?? "") ? (sp.ord as string) : "nome";
  const dir = sp.dir === "desc" ? -1 : 1;
  const val = (c: (typeof customers)[number]) => ord === "preventivi" ? (qc.get(c.id)?.n ?? 0) : ord === "stato" ? c.status : ord === "citta" ? (c.city ?? "") : c.name.toLowerCase();
  const sorted = [...customers].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(sp.p) || 1));
  const visible = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const href = (over: Partial<SP>) => {
    const m = { ...sp, ...over } as Record<string, string | undefined>;
    const qs = Object.entries(m).filter(([k, v]) => v && k !== "eliminato").map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join("&");
    return `/clienti${qs ? `?${qs}` : ""}`;
  };
  const sortLink = (key: string, label: string) => {
    const active = ord === key;
    return <Link href={href({ ord: key, dir: active && dir === 1 ? "desc" : "asc", p: undefined })} className="nx-t inline-flex items-center gap-1 hover:text-foreground" aria-label={`Ordina per ${label}`}>{label}{active ? (dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ChevronsUpDown className="size-3 opacity-40" />}</Link>;
  };
  const withOpen = customers.filter((c) => (qc.get(c.id)?.open ?? 0) > 0).length;
  const kpis = [
    { label: archived ? "Archiviati" : "Clienti", value: customers.length, tone: archived ? "slate" : "violet", ink: archived ? "text-foreground" : "text-violet" },
    { label: "Con preventivi aperti", value: withOpen, tone: "amber", ink: "text-warning" },
    { label: "Potenziali", value: customers.filter((c) => c.status === "lead").length, tone: "blue", ink: "text-primary" },
    { label: "Attivi", value: customers.filter((c) => c.status === "active").length, tone: "green", ink: "text-success" },
  ];

  return (
    <>
      <PageHeader title={archived ? `${terms.customer_plural} archiviati` : terms.customer_plural} description={`${customers.length} risultati`}
        actions={canWrite && !archived ? <Link href="/clienti/nuovo" className={buttonVariants()}><Plus className="size-4" />Nuovo {terms.customer_singular.toLowerCase()}</Link> : null} />
      {sp.eliminato && <div className="mb-4"><Alert kind="success">Cliente eliminato definitivamente.</Alert></div>}

      <dl className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Indicatori dell'elenco">
        {kpis.map((k) => <Card key={k.label} tone={k.tone as "violet" | "amber" | "blue" | "green" | "slate"} className="px-4 py-3"><dt className="text-xs font-semibold text-foreground/70">{k.label}</dt><dd className={`mt-0.5 text-2xl font-bold tabular-nums ${k.ink}`}>{k.value}</dd></Card>)}
      </dl>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 rounded-md border border-border bg-card p-1 shadow-card" aria-label="Elenco clienti">
          <Link href={base("")} aria-current={!archived ? "page" : undefined} className={cn("nx-t rounded-sm px-3 py-1.5 text-sm", !archived ? "bg-primary text-white" : "text-muted hover:text-foreground")}>Attivi</Link>
          <Link href={base("archiviati")} aria-current={archived ? "page" : undefined} className={cn("nx-t rounded-sm px-3 py-1.5 text-sm", archived ? "bg-primary text-white" : "text-muted hover:text-foreground")}>Archiviati ({archivedCount})</Link>
        </nav>
        <form className="flex flex-wrap gap-2" role="search">
          {archived && <input type="hidden" name="stato" value="archiviati" />}
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input name="q" defaultValue={sp.q} placeholder="Cerca per nome, P.IVA, email, città…" aria-label="Cerca cliente" className="w-72 pl-9" /></div>
          <Select name="filtro" defaultValue={sp.filtro ?? ""} aria-label="Filtra per stato" className="w-40"><option value="">Tutti gli stati</option>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Select name="tipo" defaultValue={sp.tipo ?? ""} aria-label="Filtra per tipologia" className="w-44"><option value="">Tutte le tipologie</option>{Object.entries(CUSTOMER_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <button className={buttonVariants({ variant: "outline" })}>Filtra</button>
        </form>
      </div>

      <Table>
        <thead><tr><th>{sortLink("nome", "Nome")}</th><th>Contatto</th><th>{sortLink("preventivi", "Preventivi")}</th><th>{archived ? "Archiviato il" : sortLink("stato", "Stato")}</th>{canWrite && <th className="text-right">Azioni</th>}</tr></thead>
        <tbody>
          {visible.length === 0 && <tr><td colSpan={5}><EmptyState icon={<Users className="size-5" />} title={archived ? "Nessun cliente archiviato." : "Nessun cliente."} description={archived ? "I clienti archiviati compariranno qui e si potranno ripristinare." : sp.q || sp.filtro || sp.tipo ? "Prova a cambiare ricerca o filtri." : "Aggiungi il primo cliente per iniziare a lavorare sui preventivi."} action={canWrite && !archived && !sp.q ? <Link href="/clienti/nuovo" className={buttonVariants({ size: "sm" })}>Nuovo {terms.customer_singular.toLowerCase()}</Link> : undefined} /></td></tr>}
          {visible.map((c) => {
            const n = qc.get(c.id);
            return (
              <tr key={c.id}>
                <td>
                  <Link className="flex items-center gap-3" href={`/clienti/${c.id}`}>
                    <Avatar name={c.name} size={34} />
                    <span className="min-w-0"><span className="block truncate font-medium text-primary hover:underline">{c.name}</span><span className="block truncate text-xs text-muted">{CUSTOMER_TYPE_LABEL[c.customer_type ?? "company"]}{c.city ? ` · ${c.city}` : ""}</span></span>
                  </Link>
                </td>
                <td><span className="block">{c.email ?? "—"}</span><span className="block text-xs text-muted">{c.phone ?? "—"}</span></td>
                <td>{n ? <span><span className="font-medium">{n.n}</span>{n.open > 0 && <span className="ml-1.5 rounded-sm bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">{n.open} aperti</span>}</span> : <span className="text-muted">0</span>}</td>
                <td>{archived ? (c.archived_at ? new Date(c.archived_at).toLocaleDateString("it-IT") : "—") : <Badge className={c.status === "active" ? "border-success/30 bg-success/10 text-success" : c.status === "lead" ? "border-primary/30 bg-primary/10 text-primary" : ""}>{STATUS[c.status]}</Badge>}</td>
                {canWrite && (
                  <td className="text-right">
                    {archived
                      ? <RemoveButton label="Ripristina" action={restoreCustomerAction.bind(null, c.id)} confirmMessage={`Ripristinare «${c.name}»? Tornerà tra i clienti attivi.`} />
                      : <RemoveButton label="Archivia" action={archiveCustomerAction.bind(null, c.id)} confirmMessage={`Archiviare «${c.name}»?\n\nNon comparirà più tra i clienti attivi né nei selettori, ma preventivi, referenti, documenti, attività e storico restano conservati. Potrai ripristinarlo in qualsiasi momento.`} />}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </Table>
      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginazione">
          <span className="text-muted">Pagina {page} di {pages} · {sorted.length} clienti</span>
          <span className="flex gap-2">
            {page > 1 ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={href({ p: String(page - 1) })}>Precedente</Link> : null}
            {page < pages ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={href({ p: String(page + 1) })}>Successiva</Link> : null}
          </span>
        </nav>
      )}
    </>
  );
}
