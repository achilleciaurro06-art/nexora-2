import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listCustomers } from "@/modules/clienti/repository";
import { Badge, PageHeader, Table } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata = { title: "Clienti" };
const STATUS = { lead: "Potenziale", active: "Attivo", inactive: "Inattivo" } as const;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await requireContext();
  const customers = await listCustomers(await createClient(), ctx.org.organizationId, q);
  return (
    <>
      <PageHeader title="Clienti" description={`${customers.length} risultati`}
        actions={can(ctx.org.role, "data:write") ? <Link href="/clienti/nuovo" className={buttonVariants()}>Nuovo cliente</Link> : null} />
      <form className="mb-4 max-w-sm"><Input name="q" defaultValue={q} placeholder="Cerca per nome…" aria-label="Cerca cliente" /></form>
      <Table>
        <thead><tr><th>Nome</th><th>Email</th><th>Telefono</th><th>Città</th><th>Stato</th></tr></thead>
        <tbody>
          {customers.length === 0 && <tr><td colSpan={5} className="text-muted">Nessun cliente.</td></tr>}
          {customers.map((c) => (
            <tr key={c.id}>
              <td><Link className="font-medium text-primary hover:underline" href={`/clienti/${c.id}`}>{c.name}</Link></td>
              <td>{c.email ?? "—"}</td><td>{c.phone ?? "—"}</td><td>{c.city ?? "—"}</td><td><Badge>{STATUS[c.status]}</Badge></td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
