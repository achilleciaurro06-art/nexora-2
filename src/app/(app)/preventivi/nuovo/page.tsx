import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listCustomers } from "@/modules/clienti/repository";
import { PageHeader } from "@/components/ui/card";
import { QuoteForm } from "@/modules/preventivi/ui/quote-form";
import { saveQuoteAction } from "@/modules/preventivi/actions";
import { parseOrgSettings } from "@/modules/impostazioni/settings";
import { isoDayOffset } from "@/lib/dates";
import { loadQuoteCatalog } from "@/modules/settore/queries";

export const metadata = { title: "Nuovo preventivo" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const { cliente } = await searchParams;
  const ctx = await requireContext();
  if (!can(ctx.org.role, "data:write")) redirect("/preventivi");
  const db = await createClient();
  const [customers, catalog] = await Promise.all([listCustomers(db, ctx.org.organizationId), loadQuoteCatalog(db, ctx.org.organizationId)]);
  const { data: org } = await db.from("organizations").select("quote_default_terms, settings").eq("id", ctx.org.organizationId).maybeSingle();
  const q = parseOrgSettings(org?.settings).quotes;
  const validUntil = q.default_validity_days > 0 ? isoDayOffset(q.default_validity_days) : null;
  return (
    <>
      <PageHeader title="Nuovo preventivo" description="Il numero viene assegnato automaticamente al salvataggio." />
      <QuoteForm action={saveQuoteAction.bind(null, null)} customers={customers.map((c) => ({ id: c.id, name: c.name }))} defaultVat={String(q.default_vat_rate)} catalog={catalog} initial={{ customerId: cliente, terms: (org?.quote_default_terms as string | null) ?? null, validUntil }} />
    </>
  );
}
