import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { getCustomer } from "@/modules/clienti/repository";
import { updateCustomerAction, deleteCustomerAction } from "@/modules/clienti/actions";
import { CustomerForm } from "@/modules/clienti/ui/customer-form";
import { Badge, Card, PageHeader, Table } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { addContactAction, removeContactAction } from "@/modules/clienti/contacts";
import { Input, Label } from "@/components/ui/input";
import { formatEur } from "@/lib/money";
import { QUOTE_STATUS_LABEL, type QuoteStatus } from "@/types/domain";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const db = await createClient();
  const customer = await getCustomer(db, ctx.org.organizationId, id);
  if (!customer) notFound();
  const { data: quotes } = await db.from("quotes").select("id, number, title, status, total_cents, issue_date").eq("organization_id", ctx.org.organizationId).eq("customer_id", id).is("deleted_at", null).order("issue_date", { ascending: false });
  const { data: contacts } = await db.from("customer_contacts").select("id, full_name, job_title, email, phone").eq("organization_id", ctx.org.organizationId).eq("customer_id", id).order("created_at");
  const canWrite = can(ctx.org.role, "data:write");
  return (
    <>
      <PageHeader title={customer.name}
        actions={can(ctx.org.role, "data:delete") ? (
          <form action={deleteCustomerAction.bind(null, id)}><Button variant="danger" size="sm">Elimina</Button></form>
        ) : null} />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card><CustomerForm action={updateCustomerAction.bind(null, id)} customer={customer} readOnly={!canWrite} /></Card>
        <div className="space-y-6">
        <Card>
          <h2 className="mb-3 font-medium">Referenti</h2>
          {(contacts ?? []).length === 0 ? <p className="text-sm text-muted">Nessun referente.</p> : (
            <ul className="mb-3 space-y-2 text-sm">
              {(contacts ?? []).map((c) => (
                <li key={c.id as string} className="flex items-start justify-between gap-2">
                  <span><strong>{c.full_name as string}</strong>{c.job_title ? ` · ${c.job_title}` : ""}<br /><span className="text-muted">{[c.email, c.phone].filter(Boolean).join(" · ") || "—"}</span></span>
                  {canWrite && <form action={removeContactAction.bind(null, id, c.id as string)}><Button size="sm" variant="ghost" aria-label="Rimuovi referente">✕</Button></form>}
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <form action={addContactAction.bind(null, id)} className="grid gap-2">
              <div><Label htmlFor="full_name">Nuovo referente</Label><Input id="full_name" name="full_name" required placeholder="Nome e cognome" /></div>
              <Input name="job_title" placeholder="Ruolo" aria-label="Ruolo" />
              <Input name="email" type="email" placeholder="Email" aria-label="Email" />
              <Input name="phone" placeholder="Telefono" aria-label="Telefono" />
              <Button variant="outline" size="sm">Aggiungi</Button>
            </form>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-medium">Preventivi</h2>
          {(quotes ?? []).length === 0 ? <p className="text-sm text-muted">Nessun preventivo.</p> : (
            <Table><tbody>
              {(quotes ?? []).map((q) => (
                <tr key={q.id as string}>
                  <td><Link className="text-primary hover:underline" href={`/preventivi/${q.id}`}>{q.number as string}</Link></td>
                  <td><Badge>{QUOTE_STATUS_LABEL[q.status as QuoteStatus]}</Badge></td>
                  <td className="text-right">{formatEur(q.total_cents as number)}</td>
                </tr>
              ))}
            </tbody></Table>
          )}
        </Card>
        </div>
      </div>
    </>
  );
}
