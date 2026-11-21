import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { isUuid } from "@/lib/ids";
import { listCustomers } from "@/modules/clienti/repository";
import { listMembers } from "@/modules/organizzazioni/queries";
import { createTaskAction } from "@/modules/attivita/actions";
import { TaskEditor } from "@/modules/attivita/ui/task-editor";
import { PageHeader } from "@/components/ui/card";
import { listTaskTypes } from "@/modules/agenda/queries";

export const metadata = { title: "Nuova attività" };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ cliente?: string; preventivo?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!can(ctx.org.role, "data:write")) redirect("/attivita");
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const [customers, members, types, { data: quotes }] = await Promise.all([
    listCustomers(db, orgId),
    listMembers(db, orgId),
    listTaskTypes(db, orgId, true),
    db.from("quotes").select("id, number, title, customer_id").eq("organization_id", orgId).is("deleted_at", null).order("created_at", { ascending: false }).limit(300),
  ]);
  // precompilazione da cliente o preventivo (i valori vengono comunque riverificati dal server in salvataggio)
  const quote = isUuid(sp.preventivo) ? (quotes ?? []).find((q) => q.id === sp.preventivo) : undefined;
  const customerId = quote ? (quote.customer_id as string) : isUuid(sp.cliente) ? sp.cliente : undefined;
  return (
    <>
      <PageHeader title="Nuova attività" description={quote ? `Collegata al preventivo ${quote.number}` : undefined} />
      <TaskEditor
        mode="create" action={createTaskAction}
        defaults={{ customerId, quoteId: quote?.id as string | undefined, assigneeId: ctx.userId, title: quote ? `Follow-up preventivo ${quote.number}` : undefined }}
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        quotes={(quotes ?? []) as { id: string; number: string; title: string | null; customer_id: string }[]}
        members={members} types={types}
      />
    </>
  );
}
