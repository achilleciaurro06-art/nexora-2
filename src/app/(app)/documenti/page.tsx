import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { isUuid } from "@/lib/ids";
import { ANALYZABLE_MIMES, CATEGORY_FILTERS, documentLabel, mimesForCategory } from "@/lib/documents";
import { listCustomers } from "@/modules/clienti/repository";
import { deleteDocumentAction } from "@/modules/documenti/actions";
import { AnalyzeForm } from "@/modules/documenti/ui/analyze-form";
import { UploadForm } from "@/modules/documenti/ui/upload-form";
import { SuggestionList, type SuggestionRow } from "@/modules/copilot/ui/suggestion-list";
import { Badge, Card, PageHeader, Table } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

export const metadata = { title: "Documenti" };
export const maxDuration = 60;

const ANALYSIS = { none: "—", pending: "In corso", done: "Analizzato", failed: "Non riuscita" } as const;

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ q?: string; tipo?: string; cliente?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const customerFilter = isUuid(sp.cliente) ? sp.cliente : undefined;
  const mimes = mimesForCategory(sp.tipo ?? "all");
  const term = (sp.q ?? "").replace(/[%_,()]/g, " ").trim().slice(0, 80);

  let q = db.from("documents").select("id, name, mime_type, analysis_status, size_bytes, created_at, customer_id, description, customers(name)")
    .eq("organization_id", orgId).is("deleted_at", null).order("created_at", { ascending: false }).limit(200);
  if (mimes) q = q.in("mime_type", mimes);
  if (customerFilter) q = q.eq("customer_id", customerFilter);
  if (term) q = q.or(`name.ilike.%${term}%,description.ilike.%${term}%`);

  const [{ data: docs }, customers, { data: drafts }] = await Promise.all([
    q, listCustomers(db, orgId),
    db.from("ai_suggestions").select("id, kind, payload").eq("organization_id", orgId).eq("status", "pending").eq("kind", "quote_draft").order("created_at", { ascending: false }).limit(10),
  ]);
  const canWrite = can(ctx.org.role, "data:write");
  const canAnalyze = can(ctx.org.role, "ai:use") && canWrite;
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: sp.q, tipo: sp.tipo, cliente: sp.cliente, ...over };
    for (const [k, v] of Object.entries(merged)) if (v && v !== "all") p.set(k, v);
    return `/documenti${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Documenti" description="File archiviati in uno spazio privato, visibili solo alla tua organizzazione. L'originale resta sempre in archivio." />
      {canWrite && <Card className="mb-4"><UploadForm customers={customers.map((c) => ({ id: c.id, name: c.name }))} defaultCustomerId={customerFilter} /></Card>}

      <form className="mb-3 grid gap-2 sm:grid-cols-[2fr_1fr_auto]" role="search">
        <Input name="q" defaultValue={sp.q} placeholder="Cerca per nome o descrizione…" aria-label="Cerca documenti" />
        <Select name="cliente" defaultValue={customerFilter ?? ""} aria-label="Filtra per cliente">
          <option value="">Tutti i clienti</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <input type="hidden" name="tipo" value={sp.tipo ?? ""} />
        <Button variant="outline">Cerca</Button>
      </form>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Tipologia">
        {CATEGORY_FILTERS.map((c) => (
          <Link key={c.key} href={href({ tipo: c.key })} aria-current={(sp.tipo ?? "all") === c.key ? "true" : undefined}
            className={buttonVariants({ variant: (sp.tipo ?? "all") === c.key ? "default" : "outline", size: "sm" })}>{c.label}</Link>
        ))}
      </nav>

      <Table>
        <thead><tr><th>Nome</th><th>Tipo</th><th>Cliente</th><th>Dimensione</th><th>Caricato il</th><th>Analisi AI</th><th /></tr></thead>
        <tbody>
          {(docs ?? []).length === 0 && <tr><td colSpan={7} className="text-muted">Nessun documento{term || mimes || customerFilter ? " con questi filtri" : ""}.</td></tr>}
          {(docs ?? []).map((d) => {
            const c = Array.isArray(d.customers) ? d.customers[0] : d.customers;
            const mime = d.mime_type as string;
            const viewable = mime === "application/pdf" || mime.startsWith("image/");
            return (
              <tr key={d.id as string}>
                <td className="min-w-48"><Link className="font-medium text-primary hover:underline" href={`/documenti/${d.id}`}>{d.name as string}</Link>{d.description ? <p className="text-xs text-muted">{d.description as string}</p> : null}</td>
                <td><Badge>{documentLabel(mime)}</Badge></td>
                <td>{c ? <Link className="hover:underline" href={`/clienti/${d.customer_id}`}>{(c as { name: string }).name}</Link> : "—"}</td>
                <td>{(d.size_bytes as number) < 1_048_576 ? `${Math.max(1, Math.round((d.size_bytes as number) / 1024))} KB` : `${((d.size_bytes as number) / 1_048_576).toFixed(1)} MB`}</td>
                <td>{new Date(d.created_at as string).toLocaleDateString("it-IT")}</td>
                <td>
                  {canAnalyze && ANALYZABLE_MIMES.has(mime)
                    ? <AnalyzeForm documentId={d.id as string} label={d.analysis_status === "done" ? "Rianalizza" : d.analysis_status === "failed" ? "Riprova" : "Analizza con AI"} />
                    : <span className="text-muted">{ANALYSIS[d.analysis_status as keyof typeof ANALYSIS] ?? "—"}</span>}
                </td>
                <td className="whitespace-nowrap text-right">
                  {viewable && <Link className="mr-2 text-sm text-primary hover:underline" href={`/documenti/${d.id}/download?inline=1`} prefetch={false} target="_blank">Visualizza</Link>}
                  <Link className="mr-2 text-sm text-primary hover:underline" href={`/documenti/${d.id}/download`} prefetch={false}>Scarica</Link>
                  {can(ctx.org.role, "data:delete") && <form action={deleteDocumentAction.bind(null, d.id as string)} className="inline"><Button size="sm" variant="ghost">Elimina</Button></form>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      {(drafts ?? []).length > 0 && (
        <>
          <h2 className="mb-2 mt-8 font-medium">Bozze di preventivo da rivedere</h2>
          <Card><SuggestionList suggestions={(drafts ?? []) as SuggestionRow[]} canDecide={canWrite} /></Card>
        </>
      )}
    </>
  );
}
