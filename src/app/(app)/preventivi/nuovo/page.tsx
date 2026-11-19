import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listCustomers } from "@/modules/clienti/repository";
import { PageHeader } from "@/components/ui/card";
import { QuoteForm } from "@/modules/preventivi/ui/quote-form";
import { saveQuoteAction } from "@/modules/preventivi/actions";

export const metadata = { title: "Nuovo preventivo" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const { cliente } = await searchParams;
  const ctx = await requireContext();
  if (!can(ctx.org.role, "data:write")) redirect("/preventivi");
  const customers = await listCustomers(await createClient(), ctx.org.organizationId);
  return (
    <>
      <PageHeader title="Nuovo preventivo" description="Il numero viene assegnato automaticamente al salvataggio." />
      <QuoteForm action={saveQuoteAction.bind(null, null)} customers={customers.map((c) => ({ id: c.id, name: c.name }))} initial={{ customerId: cliente }} />
    </>
  );
}
