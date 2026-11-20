import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listQuotes } from "@/modules/preventivi/repository";
import { PageHeader, Table } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { formatEur } from "@/lib/money";
import { RemoveButton } from "@/components/ui/remove-button";
import { deleteQuoteAction } from "@/modules/preventivi/actions";
import { getSector } from "@/modules/settore/queries";
import { StatusBadge } from "@/components/ui/status-badge";
import { QUOTE_STATUS_LABEL, type QuoteStatus } from "@/types/domain";

export const metadata = { title: "Preventivi" };
const FILTERS: (QuoteStatus | "")[] = ["", "draft", "sent", "accepted", "rejected", "expired"];

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const quotes = await listQuotes(db, ctx.org.organizationId, FILTERS.includes(status as QuoteStatus) ? status : undefined);
  const { terms } = await getSector(db, ctx.org.organizationId);
  const canDelete = can(ctx.org.role, "data:delete");
  return (
    <>
      <PageHeader title={terms.quote_plural}
        actions={can(ctx.org.role, "data:write") ? <Link href="/preventivi/nuovo" className={buttonVariants()}>Nuovo {terms.quote_singular.toLowerCase()}</Link> : null} />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Filtro stato">
        {FILTERS.map((f) => (
          <Link key={f || "all"} href={f ? `/preventivi?status=${f}` : "/preventivi"} className={buttonVariants({ variant: (status ?? "") === f ? "default" : "outline", size: "sm" })}>
            {f ? QUOTE_STATUS_LABEL[f] : "Tutti"}
          </Link>
        ))}
      </nav>
      <Table>
        <thead><tr><th>Numero</th><th>Cliente</th><th>Oggetto</th><th>Data</th><th>Stato</th><th className="text-right">Totale</th>{canDelete && <th />}</tr></thead>
        <tbody>
          {quotes.length === 0 && <tr><td colSpan={7} className="text-muted">Nessun preventivo.</td></tr>}
          {quotes.map((q) => {
            const c = Array.isArray(q.customers) ? q.customers[0] : q.customers;
            return (
              <tr key={q.id}>
                <td><Link className="font-medium text-primary hover:underline" href={`/preventivi/${q.id}`}>{q.number}</Link></td>
                <td>{c ? (c.deleted_at ? <span className="text-muted">{c.name} (cliente rimosso)</span> : c.name) : "—"}</td><td>{q.title ?? "—"}</td>
                <td>{new Date(q.issue_date).toLocaleDateString("it-IT")}</td>
                <td><StatusBadge status={q.status} /></td>
                <td className="text-right">{formatEur(q.total_cents)}</td>
                {canDelete && (
                  <td className="text-right">
                    <RemoveButton action={deleteQuoteAction.bind(null, q.id)}
                      confirmMessage={`Rimuovere il preventivo ${q.number}${q.title ? ` «${q.title}»` : ""} (${formatEur(q.total_cents)})?${q.status === "accepted" ? "\n\nATTENZIONE: è un preventivo ACCETTATO." : ""}\n\nNon comparirà più in elenchi, follow-up e statistiche. L'operazione viene registrata.`} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
