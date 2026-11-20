import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { isUuid } from "@/lib/ids";
import { ANALYZABLE_MIMES, documentLabel } from "@/lib/documents";
import { listCustomerOptions } from "@/modules/clienti/repository";
import { updateDocumentMetadataAction } from "@/modules/documenti/actions";
import { MetadataForm } from "@/modules/documenti/ui/metadata-form";
import { AnalyzeForm } from "@/modules/documenti/ui/analyze-form";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Documento" };
export const maxDuration = 60;

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data: doc } = await db.from("documents")
    .select("id, name, description, mime_type, size_bytes, created_at, customer_id, quote_id, analysis_status, quotes(number)")
    .eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!doc) notFound();
  const [customers, { data: sugs }] = await Promise.all([
    listCustomerOptions(db, orgId, doc.customer_id as string | null),
    db.from("ai_suggestions").select("id, status, created_at").eq("organization_id", orgId).eq("kind", "quote_draft").eq("source_id", id).order("created_at", { ascending: false }).limit(10),
  ]);
  const mime = doc.mime_type as string;
  const viewable = mime === "application/pdf" || mime.startsWith("image/");
  const canWrite = can(ctx.org.role, "data:write");
  const quote = Array.isArray(doc.quotes) ? doc.quotes[0] : doc.quotes;
  return (
    <>
      <PageHeader title={doc.name as string} description={`${documentLabel(mime)} · ${((doc.size_bytes as number) / 1024).toFixed(0)} KB · caricato il ${new Date(doc.created_at as string).toLocaleDateString("it-IT")}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {viewable && <Link href={`/documenti/${id}/download?inline=1`} prefetch={false} target="_blank" className={buttonVariants({ variant: "outline" })}>Visualizza</Link>}
            <Link href={`/documenti/${id}/download`} prefetch={false} className={buttonVariants()}>Scarica</Link>
          </div>
        } />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <MetadataForm action={updateDocumentMetadataAction.bind(null, id)} readOnly={!canWrite} customers={customers.map((c) => ({ id: c.id, name: c.name }))}
            doc={{ name: doc.name as string, description: doc.description as string | null, customerId: doc.customer_id as string | null }} />
        </Card>
        <div className="space-y-6">
          <Card>
            <h2 className="mb-2 font-medium">Collegamenti</h2>
            <ul className="space-y-1 text-sm">
              <li>Cliente: {doc.customer_id ? <Link className="text-primary hover:underline" href={`/clienti/${doc.customer_id}`}>{customers.find((c) => c.id === doc.customer_id)?.name ?? "apri"}</Link> : "—"}</li>
              <li>Preventivo: {doc.quote_id && quote ? <Link className="text-primary hover:underline" href={`/preventivi/${doc.quote_id}`}>{(quote as { number: string }).number}</Link> : "—"}</li>
            </ul>
          </Card>
          {ANALYZABLE_MIMES.has(mime) && can(ctx.org.role, "ai:use") && canWrite && (
            <Card>
              <h2 className="mb-2 font-medium">Analisi AI</h2>
              <p className="mb-3 text-sm text-muted">Estrae cliente, righe e importi. Nulla viene creato senza la tua revisione.</p>
              <AnalyzeForm documentId={id} label={doc.analysis_status === "done" ? "Rianalizza" : "Analizza con AI"} />
              {(sugs ?? []).length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {(sugs ?? []).map((s) => (
                    <li key={s.id as string} className="flex items-center justify-between gap-2">
                      <span>{new Date(s.created_at as string).toLocaleDateString("it-IT")} <Badge>{s.status === "pending" ? "da rivedere" : s.status === "accepted" ? "bozza creata" : "scartata"}</Badge></span>
                      {s.status === "pending" && <Link className="text-primary hover:underline" href={`/documenti/revisione/${s.id}`}>Rivedi</Link>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
