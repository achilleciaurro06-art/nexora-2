import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { countArchivedCustomers, listCustomers } from "@/modules/clienti/repository";
import { Alert, Badge, PageHeader, Table } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { RemoveButton } from "@/components/ui/remove-button";
import { archiveCustomerAction, restoreCustomerAction } from "@/modules/clienti/actions";
import { getSector } from "@/modules/settore/queries";
import { CUSTOMER_TYPE_LABEL } from "@/types/domain";

export const metadata = { title: "Clienti" };
const STATUS = { lead: "Potenziale", active: "Attivo", inactive: "Inattivo" } as const;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; stato?: string; filtro?: string; tipo?: string; eliminato?: string }> }) {
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
  const base = (s: string) => (s ? `/clienti?stato=${s}` : "/clienti");
  return (
    <>
      <PageHeader title={archived ? `${terms.customer_plural} archiviati` : terms.customer_plural} description={`${customers.length} risultati`}
        actions={canWrite && !archived ? <Link href="/clienti/nuovo" className={buttonVariants()}>Nuovo {terms.customer_singular.toLowerCase()}</Link> : null} />
      {sp.eliminato && <div className="mb-4"><Alert kind="success">Cliente eliminato definitivamente.</Alert></div>}
      <nav className="mb-4 flex gap-2" aria-label="Elenco clienti">
        <Link href={base("")} aria-current={!archived ? "page" : undefined} className={buttonVariants({ variant: !archived ? "default" : "outline", size: "sm" })}>Attivi</Link>
        <Link href={base("archiviati")} aria-current={archived ? "page" : undefined} className={buttonVariants({ variant: archived ? "default" : "outline", size: "sm" })}>Archiviati ({archivedCount})</Link>
      </nav>
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        {archived && <input type="hidden" name="stato" value="archiviati" />}
        <Input name="q" defaultValue={sp.q} placeholder="Cerca per nome, P.IVA, email, città…" aria-label="Cerca cliente" className="w-72" />
        <Select name="filtro" defaultValue={sp.filtro ?? ""} aria-label="Filtra per stato" className="w-40"><option value="">Tutti gli stati</option>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select name="tipo" defaultValue={sp.tipo ?? ""} aria-label="Filtra per tipologia" className="w-44"><option value="">Tutte le tipologie</option>{Object.entries(CUSTOMER_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <button className={buttonVariants({ variant: "outline" })}>Filtra</button>
      </form>
      <Table>
        <thead><tr><th>Nome</th><th>Tipologia</th><th>Email</th><th>Telefono</th><th>Città</th><th>{archived ? "Archiviato il" : "Stato"}</th>{canWrite && <th />}</tr></thead>
        <tbody>
          {customers.length === 0 && <tr><td colSpan={7} className="text-muted">{archived ? "Nessun cliente archiviato." : "Nessun cliente."}</td></tr>}
          {customers.map((c) => (
            <tr key={c.id}>
              <td><Link className="font-medium text-primary hover:underline" href={`/clienti/${c.id}`}>{c.name}</Link></td>
              <td>{CUSTOMER_TYPE_LABEL[c.customer_type ?? "company"]}</td>
              <td>{c.email ?? "—"}</td><td>{c.phone ?? "—"}</td><td>{c.city ?? "—"}</td>
              <td>{archived ? (c.archived_at ? new Date(c.archived_at).toLocaleDateString("it-IT") : "—") : <Badge>{STATUS[c.status]}</Badge>}</td>
              {canWrite && (
                <td className="text-right">
                  {archived
                    ? <RemoveButton label="Ripristina" action={restoreCustomerAction.bind(null, c.id)} confirmMessage={`Ripristinare «${c.name}»? Tornerà tra i clienti attivi.`} />
                    : <RemoveButton label="Archivia" action={archiveCustomerAction.bind(null, c.id)} confirmMessage={`Archiviare «${c.name}»?\n\nNon comparirà più tra i clienti attivi né nei selettori, ma preventivi, referenti, documenti, attività e storico restano conservati. Potrai ripristinarlo in qualsiasi momento.`} />}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
