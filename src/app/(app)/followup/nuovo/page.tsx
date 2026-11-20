import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listCustomers } from "@/modules/clienti/repository";
import { listMembers } from "@/modules/organizzazioni/queries";
import { createFollowUpAction } from "@/modules/followup/actions";
import { FollowUpForm, type FollowUpDefaults } from "@/modules/followup/ui/follow-up-form";
import { PageHeader } from "@/components/ui/card";
import { isUuid } from "@/lib/ids";
import { addDays, todayIn } from "@/lib/datetime";

export const metadata = { title: "Nuovo follow-up" };

export default async function NewFollowUpPage({ searchParams }: { searchParams: Promise<{ cliente?: string; attivita?: string; chiamata?: string; preventivo?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!can(ctx.org.role, "data:write")) redirect("/followup");
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const [customers, members, { data: quotes }] = await Promise.all([
    listCustomers(db, orgId), listMembers(db, orgId),
    db.from("quotes").select("id, number, title, customer_id").eq("organization_id", orgId).is("deleted_at", null).in("status", ["draft", "sent", "accepted"]).order("created_at", { ascending: false }).limit(300),
  ]);
  // precompilazione da attività, chiamata, preventivo o cliente (il server ricontrolla tutto in salvataggio)
  const d: FollowUpDefaults = { assigneeId: ctx.userId, dueOn: addDays(todayIn(new Date()), 3) };
  let from: string | undefined;
  if (isUuid(sp.attivita)) {
    const { data: t } = await db.from("tasks").select("id, title, description, customer_id, contact_id, priority").eq("organization_id", orgId).eq("id", sp.attivita).is("deleted_at", null).maybeSingle();
    if (t) { Object.assign(d, { title: `Ricontatto: ${t.title as string}`, description: t.description, customerId: t.customer_id ?? undefined, contactId: t.contact_id, priority: t.priority, sourceTaskId: t.id }); from = `dall'attività «${t.title as string}»`; }
  } else if (isUuid(sp.chiamata)) {
    const { data: c } = await db.from("call_logs").select("customer_id, contact_id, customers(name)").eq("organization_id", orgId).eq("id", sp.chiamata).maybeSingle();
    if (c) { const cn = Array.isArray(c.customers) ? c.customers[0] : c.customers; Object.assign(d, { customerId: c.customer_id, contactId: c.contact_id, title: `Richiamare ${(cn as { name: string } | null)?.name ?? "il cliente"}`, reason: "Dopo una chiamata" }); from = "dalla chiamata"; }
  } else if (isUuid(sp.preventivo)) {
    const q = (quotes ?? []).find((x) => x.id === sp.preventivo);
    if (q) { Object.assign(d, { customerId: q.customer_id, quoteId: q.id, title: `Follow-up preventivo ${q.number}`, reason: "Preventivo inviato" }); from = `dal preventivo ${q.number}`; }
  } else if (isUuid(sp.cliente)) d.customerId = sp.cliente;
  return (
    <>
      <PageHeader title="Nuovo follow-up" description={from ? `Creato ${from}` : "Un ricontatto commerciale con data, responsabile e cronologia."} />
      <FollowUpForm mode="create" action={createFollowUpAction} defaults={d} customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        quotes={(quotes ?? []) as { id: string; number: string; title: string | null; customer_id: string }[]} members={members} />
    </>
  );
}
