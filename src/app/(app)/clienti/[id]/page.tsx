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
import { formatEur } from "@/lib/money";
import { QUOTE_STATUS_LABEL, type QuoteStatus } from "@/types/domain";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const db = await createClient();
  const customer = await getCustomer(db, ctx.org.organizationId, id);
  if (!customer) notFound();
  const { data: quotes } = await db.from("quotes").select("id, number, title, status, total_cents, issue_date").eq("organization_id", ctx.org.organizationId).eq("customer_id", id).is("deleted_at", null).order("issue_date", { ascending: false });
  const canWrite = can(ctx.org.role, "data:write");
  return (
    <>
      <PageHeader title={customer.name}
        actions={can(ctx.org.role, "data:delete") ? (
          <form action={deleteCustomerAction.bind(null, id)}><Button variant="danger" size="sm">Elimina</Button></form>
        ) : null} />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card><CustomerForm action={updateCustomerAction.bind(null, id)} customer={customer} readOnly={!canWrite} /></Card>
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
    </>
  );
}
