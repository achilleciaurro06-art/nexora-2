import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listCustomerOptions } from "@/modules/clienti/repository";
import { getQuote } from "@/modules/preventivi/repository";
import { PageHeader } from "@/components/ui/card";
import { QuoteForm } from "@/modules/preventivi/ui/quote-form";
import { saveQuoteAction } from "@/modules/preventivi/actions";
import { parseOrgSettings } from "@/modules/impostazioni/settings";
import { loadQuoteCatalog } from "@/modules/settore/queries";

export const metadata = { title: "Modifica preventivo" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!can(ctx.org.role, "data:write")) redirect(`/preventivi/${id}`);
  const db = await createClient();
  const found = await getQuote(db, ctx.org.organizationId, id);
  if (!found) notFound();
  if (found.quote.status !== "draft") redirect(`/preventivi/${id}`);
  const [customers, catalog] = await Promise.all([listCustomerOptions(db, ctx.org.organizationId, found.quote.customer_id), loadQuoteCatalog(db, ctx.org.organizationId)]);
  const { data: org } = await db.from("organizations").select("settings").eq("id", ctx.org.organizationId).maybeSingle();
  const { quote, items } = found;
  return (
    <>
      <PageHeader title={`Modifica ${quote.number}`} />
      <QuoteForm action={saveQuoteAction.bind(null, id)} defaultVat={String(parseOrgSettings(org?.settings).quotes.default_vat_rate)} customers={customers.map((c) => ({ id: c.id, name: c.name }))} catalog={catalog}
        initial={{ customerId: quote.customer_id, title: quote.title, issueDate: quote.issue_date, validUntil: quote.valid_until, followUpDate: quote.follow_up_date, notes: quote.notes, terms: quote.terms, items, customValues: quote.custom_values }} />
    </>
  );
}
