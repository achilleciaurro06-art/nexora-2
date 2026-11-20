import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { createClient } from "@/server/supabase/server";
import { listCustomers } from "@/modules/clienti/repository";
import { listMembers } from "@/modules/organizzazioni/queries";
import { createAppointmentAction } from "@/modules/appuntamenti/actions";
import { AppointmentForm } from "@/modules/appuntamenti/ui/appointment-form";
import { isDateStr } from "@/modules/appuntamenti/calendar";
import { PageHeader } from "@/components/ui/card";
import { isUuid } from "@/lib/ids";
import { todayIn } from "@/lib/datetime";

export const metadata = { title: "Nuovo appuntamento" };

export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<{ cliente?: string; data?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!can(ctx.org.role, "data:write")) redirect("/appuntamenti");
  const db = await createClient();
  const [customers, members] = await Promise.all([listCustomers(db, ctx.org.organizationId), listMembers(db, ctx.org.organizationId)]);
  return (
    <>
      <PageHeader title="Nuovo appuntamento" description="Gli orari sono quelli dell'azienda (Europa/Roma)." />
      <AppointmentForm mode="create" action={createAppointmentAction} customers={customers.map((c) => ({ id: c.id, name: c.name }))} members={members}
        defaults={{ customerId: isUuid(sp.cliente) ? sp.cliente : null, date: isDateStr(sp.data) ? sp.data : todayIn(new Date()), assigneeId: ctx.userId, reminder: "60" }} />
    </>
  );
}
