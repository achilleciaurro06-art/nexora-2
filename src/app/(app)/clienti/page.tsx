import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listCustomers } from "@/modules/clienti/repository";
import { Badge, PageHeader, Table } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RemoveButton } from "@/components/ui/remove-button";
import { deleteCustomerAction } from "@/modules/clienti/actions";
import { getSector } from "@/modules/settore/queries";

export const metadata = { title: "Clienti" };
const STATUS = { lead: "Potenziale", active: "Attivo", inactive: "Inattivo" } as const;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const customers = await listCustomers(db, ctx.org.organizationId, q);
  const { terms } = await getSector(db, ctx.org.organizationId);
  const canDelete = can(ctx.org.role, "data:delete");
  // conteggi per un messaggio di conferma chiaro (quanti preventivi aperti verranno rimossi con il cliente)
  const counts = new Map<string, { open: number; closed: number }>();
  if (canDelete && customers.length > 0) {
    const { data } = await db.from("quotes").select("customer_id, status").eq("organization_id", ctx.org.organizationId).is("deleted_at", null).in("customer_id", customers.map((c) => c.id)).limit(5000);
    for (const r of data ?? []) {
      const e = counts.get(r.customer_id as string) ?? { open: 0, closed: 0 };
      if (r.status === "draft" || r.status === "sent") e.open++; else e.closed++;
      counts.set(r.customer_id as string, e);
    }
  }
  const confirmText = (name: string, id: string) => {
    const c = counts.get(id) ?? { open: 0, closed: 0 };
    return `Rimuovere il cliente «${name}»?\n\n` +
      (c.open > 0 ? `• ${c.open} preventiv${c.open === 1 ? "o aperto (bozza/inviato) verrà rimosso" : "i aperti (bozza/inviati) verranno rimossi"} insieme al cliente.\n` : "• Nessun preventivo aperto.\n") +
      (c.closed > 0 ? `• ${c.closed} preventiv${c.closed === 1 ? "o accettato/chiuso resta" : "i accettati/chiusi restano"} nello storico.\n` : "") +
      "• Attività e documenti collegati restano archiviati.\n\nL'operazione viene registrata nel registro delle operazioni.";
  };
  return (
    <>
      <PageHeader title={terms.customer_plural} description={`${customers.length} risultati`}
        actions={can(ctx.org.role, "data:write") ? <Link href="/clienti/nuovo" className={buttonVariants()}>Nuovo {terms.customer_singular.toLowerCase()}</Link> : null} />
      <form className="mb-4 max-w-sm"><Input name="q" defaultValue={q} placeholder="Cerca per nome…" aria-label="Cerca cliente" /></form>
      <Table>
        <thead><tr><th>Nome</th><th>Email</th><th>Telefono</th><th>Città</th><th>Stato</th>{canDelete && <th />}</tr></thead>
        <tbody>
          {customers.length === 0 && <tr><td colSpan={6} className="text-muted">Nessun cliente.</td></tr>}
          {customers.map((c) => (
            <tr key={c.id}>
              <td><Link className="font-medium text-primary hover:underline" href={`/clienti/${c.id}`}>{c.name}</Link></td>
              <td>{c.email ?? "—"}</td><td>{c.phone ?? "—"}</td><td>{c.city ?? "—"}</td><td><Badge>{STATUS[c.status]}</Badge></td>
              {canDelete && <td className="text-right"><RemoveButton action={deleteCustomerAction.bind(null, c.id)} confirmMessage={confirmText(c.name, c.id)} /></td>}
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
