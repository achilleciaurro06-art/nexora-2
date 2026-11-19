import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listCustomers } from "@/modules/clienti/repository";
import { deleteDocumentAction } from "@/modules/documenti/actions";
import { AnalyzeForm } from "@/modules/documenti/ui/analyze-form";
import { SuggestionList, type SuggestionRow } from "@/modules/copilot/ui/suggestion-list";
import { UploadForm } from "@/modules/documenti/ui/upload-form";
import { Card, PageHeader, Table } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Documenti" };
export const maxDuration = 60;

export default async function DocumentsPage() {
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const [{ data: docs }, customers, { data: drafts }] = await Promise.all([
    db.from("documents").select("id, name, mime_type, analysis_status, size_bytes, created_at, customers(name)").eq("organization_id", orgId).is("deleted_at", null).order("created_at", { ascending: false }).limit(200),
    listCustomers(db, orgId),
    db.from("ai_suggestions").select("id, kind, payload").eq("organization_id", orgId).eq("status", "pending").eq("kind", "quote_draft").order("created_at", { ascending: false }).limit(10),
  ]);
  const canAnalyze = can(ctx.org.role, "ai:use") && can(ctx.org.role, "data:write");
  return (
    <>
      <PageHeader title="Documenti" description="File archiviati in uno spazio privato, visibili solo alla tua organizzazione." />
      {can(ctx.org.role, "data:write") && <Card className="mb-4"><UploadForm customers={customers.map((c) => ({ id: c.id, name: c.name }))} /></Card>}
      <Table>
        <thead><tr><th>Nome</th><th>Cliente</th><th>Dimensione</th><th>Caricato il</th><th>Analisi AI</th><th /></tr></thead>
        <tbody>
          {(docs ?? []).length === 0 && <tr><td colSpan={6} className="text-muted">Nessun documento.</td></tr>}
          {(docs ?? []).map((d) => {
            const c = Array.isArray(d.customers) ? d.customers[0] : d.customers;
            return (
              <tr key={d.id as string}>
                <td><Link className="text-primary hover:underline" href={`/documenti/${d.id}/download`} prefetch={false}>{d.name as string}</Link></td>
                <td>{(c as { name: string } | null)?.name ?? "—"}</td>
                <td>{((d.size_bytes as number) / 1024).toFixed(0)} KB</td>
                <td>{new Date(d.created_at as string).toLocaleDateString("it-IT")}</td>
                <td>
                  {canAnalyze && ["application/pdf", "image/png", "image/jpeg"].includes(d.mime_type as string) ? (
                    <AnalyzeForm documentId={d.id as string} label={d.analysis_status === "done" ? "Rianalizza" : d.analysis_status === "failed" ? "Riprova" : "Analizza con AI"} />
                  ) : "—"}
                </td>
                <td className="text-right">{can(ctx.org.role, "data:delete") && <form action={deleteDocumentAction.bind(null, d.id as string)}><Button size="sm" variant="ghost">Elimina</Button></form>}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {(drafts ?? []).length > 0 && (
        <>
          <h2 className="mb-2 mt-8 font-medium">Bozze di preventivo suggerite dall&apos;AI</h2>
          <Card><SuggestionList suggestions={(drafts ?? []) as SuggestionRow[]} canDecide={can(ctx.org.role, "data:write")} /></Card>
        </>
      )}
    </>
  );
}
