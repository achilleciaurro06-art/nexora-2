import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listCustomers } from "@/modules/clienti/repository";
import { getQuote } from "@/modules/preventivi/repository";
import { PageHeader } from "@/components/ui/card";
import { QuoteForm } from "@/modules/preventivi/ui/quote-form";
import { saveQuoteAction } from "@/modules/preventivi/actions";

export const metadata = { title: "Modifica preventivo" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!can(ctx.org.role, "data:write")) redirect(`/preventivi/${id}`);
  const db = await createClient();
  const found = await getQuote(db, ctx.org.organizationId, id);
  if (!found) notFound();
  if (found.quote.status !== "draft") redirect(`/preventivi/${id}`);
  const customers = await listCustomers(db, ctx.org.organizationId);
  const { quote, items } = found;
  return (
    <>
      <PageHeader title={`Modifica ${quote.number}`} />
      <QuoteForm action={saveQuoteAction.bind(null, id)} customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        initial={{ customerId: quote.customer_id, title: quote.title, issueDate: quote.issue_date, validUntil: quote.valid_until, followUpDate: quote.follow_up_date, notes: quote.notes, terms: quote.terms, items }} />
    </>
  );
}
