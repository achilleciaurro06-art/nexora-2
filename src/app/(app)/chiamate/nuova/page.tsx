import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { createClient } from "@/server/supabase/server";
import { listCustomers } from "@/modules/clienti/repository";
import { listMembers } from "@/modules/organizzazioni/queries";
import { CallForm } from "@/modules/chiamate/ui/call-form";
import { PageHeader } from "@/components/ui/card";
import { isUuid } from "@/lib/ids";
import { utcToZonedParts } from "@/lib/datetime";

export const metadata = { title: "Registra chiamata" };

export default async function NewCallPage({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!can(ctx.org.role, "data:write")) redirect("/chiamate");
  const db = await createClient();
  const [customers, members] = await Promise.all([listCustomers(db, ctx.org.organizationId), listMembers(db, ctx.org.organizationId)]);
  const now = utcToZonedParts(new Date());
  return (
    <>
      <PageHeader title="Registra chiamata" description="Registro manuale: annota la telefonata e, se serve, fissa subito il prossimo contatto." />
      <CallForm customers={customers.map((c) => ({ id: c.id, name: c.name }))} members={members} defaults={{ customerId: isUuid(sp.cliente) ? sp.cliente : undefined, userId: ctx.userId, date: now.date, time: now.time }} />
    </>
  );
}
