import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { isUuid } from "@/lib/ids";
import { confirmExtractionAction, discardExtractionAction } from "@/modules/documenti/review-actions";
import { matchCustomer, normalizeSuggestionPayload } from "@/modules/documenti/extraction";
import { ExtractionReview } from "@/modules/documenti/ui/extraction-review";
import { linesFromItems } from "@/modules/preventivi/ui/quote-form";
import { Card, PageHeader } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Revisione dati estratti" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  if (!can(ctx.org.role, "data:write")) redirect("/documenti");
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data: sug } = await db.from("ai_suggestions").select("id, kind, status, payload, source_id").eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (!sug || sug.kind !== "quote_draft") notFound();
  const payload = normalizeSuggestionPayload(sug.payload);
  if (!payload) notFound();
  if (sug.status !== "pending") {
    return (
      <>
        <PageHeader title="Revisione dati estratti" />
        <Card><p className="text-sm">Questo suggerimento è già stato gestito ({sug.status === "accepted" ? "bozza creata" : "scartato"}).</p><Link className="mt-3 inline-block text-primary underline" href="/documenti">Torna ai documenti</Link></Card>
      </>
    );
  }

  const documentId = payload.document_id ?? (sug.source_id as string | null);
  const [{ data: customers }, { data: doc }] = await Promise.all([
    db.from("customers").select("id, name, vat_number").eq("organization_id", orgId).is("deleted_at", null).order("name").limit(500),
    documentId ? db.from("documents").select("id, name").eq("organization_id", orgId).eq("id", documentId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const list = (customers ?? []) as { id: string; name: string; vat_number: string | null }[];
  const m = matchCustomer(list, payload.data.client);
  const d = payload.data;

  // righe: mai valori inventati. Se manca il prezzo unitario ma c'è il totale riga, lo si ricava (e si dichiara)
  const inferred = [...payload.inferred_fields];
  const items = d.items.map((i) => {
    const qty = i.quantity ?? 1;
    let unit = i.unit_price;
    if (unit === undefined && i.line_total !== undefined && qty > 0) { unit = i.line_total / qty; if (!inferred.includes("items.unit_price")) inferred.push("items.unit_price"); }
    return { description: i.description, quantity: qty, unit_price_cents: Math.round((unit ?? 0) * 100), discount_percent: i.discount_percent ?? 0, vat_rate: i.vat_rate ?? 22 };
  });
  const vatAssumed = d.items.some((i) => i.vat_rate === undefined);
  const missing = payload.missing_fields;
  const warnings = [...payload.checks.warnings];
  if (vatAssumed) warnings.push("L'aliquota IVA non è indicata su alcune righe: è stata impostata al 22%, da verificare.");

  return (
    <>
      <PageHeader
        title="Revisione dati estratti"
        description={doc ? `Dal documento «${doc.name as string}». Controlla e correggi i dati: nulla viene creato finché non confermi.` : "Controlla e correggi i dati prima di creare la bozza."}
        actions={
          <div className="flex gap-2">
            {doc && <Link href={`/documenti/${doc.id}/download?inline=1`} prefetch={false} target="_blank" className={buttonVariants({ variant: "outline" })}>Apri l&apos;originale</Link>}
            <form action={discardExtractionAction.bind(null, id)}><Button variant="ghost">Scarta</Button></form>
          </div>
        } />
      <ExtractionReview
        action={confirmExtractionAction.bind(null, id)}
        customers={list.map((c) => ({ id: c.id, name: c.name }))}
        match={m ? { customerId: m.customer.id, reason: m.reason } : null}
        client={d.client}
        quote={{ title: d.quote.title ?? "", issueDate: d.quote.issue_date ?? new Date().toISOString().slice(0, 10), validUntil: d.quote.valid_until ?? "", notes: d.quote.notes ?? "", terms: d.quote.payment_terms ?? "" }}
        initialLines={linesFromItems(items.length ? items : undefined)}
        documentTotal={d.quote.total ?? null}
        warnings={warnings} missing={missing} inferred={inferred} duplicates={payload.checks.duplicates} aiNotes={payload.ai_notes}
      />
    </>
  );
}
