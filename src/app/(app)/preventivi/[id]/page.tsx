import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { getQuote } from "@/modules/preventivi/repository";
import { changeQuoteStatusAction, deleteQuoteAction } from "@/modules/preventivi/actions";
import { Badge, Card, PageHeader, Table } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatEur } from "@/lib/money";
import { QUOTE_STATUS_LABEL, type QuoteStatus } from "@/types/domain";
import { PrintButton } from "@/components/layout/print-button";

const NEXT: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["sent"], sent: ["accepted", "rejected", "expired", "draft"], accepted: [], rejected: ["draft"], expired: ["draft"],
};

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const found = await getQuote(await createClient(), ctx.org.organizationId, id);
  if (!found) notFound();
  const { quote, items } = found;
  const customer = quote.customers;
  const canWrite = can(ctx.org.role, "data:write");
  return (
    <>
      <PageHeader title={`Preventivo ${quote.number}`} description={quote.title ?? undefined}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <PrintButton />
            {canWrite && quote.status === "draft" && <Link href={`/preventivi/${id}/modifica`} className={buttonVariants({ variant: "outline" })}>Modifica</Link>}
            {can(ctx.org.role, "data:delete") && <form action={deleteQuoteAction.bind(null, id)}><Button variant="danger">Elimina</Button></form>}
          </div>
        } />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Cliente</dt><dd><Link className="text-primary hover:underline" href={`/clienti/${quote.customer_id}`}>{customer?.name}</Link></dd></div>
            <div><dt className="text-muted">Stato</dt><dd><Badge>{QUOTE_STATUS_LABEL[quote.status]}</Badge></dd></div>
            <div><dt className="text-muted">Emissione</dt><dd>{new Date(quote.issue_date).toLocaleDateString("it-IT")}</dd></div>
            <div><dt className="text-muted">Valido fino al</dt><dd>{quote.valid_until ? new Date(quote.valid_until).toLocaleDateString("it-IT") : "—"}</dd></div>
          </dl>
          <Table>
            <thead><tr><th>Descrizione</th><th className="text-right">Qtà</th><th className="text-right">Prezzo</th><th className="text-right">Sconto</th><th className="text-right">IVA</th><th className="text-right">Netto</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.description}</td><td className="text-right">{i.quantity}</td><td className="text-right">{formatEur(i.unit_price_cents)}</td>
                  <td className="text-right">{i.discount_percent}%</td><td className="text-right">{i.vat_rate}%</td><td className="text-right">{formatEur(i.line_net_cents)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <dl className="mt-4 ml-auto grid max-w-xs grid-cols-2 gap-1 text-sm">
            <dt className="text-muted">Imponibile</dt><dd className="text-right">{formatEur(quote.subtotal_cents)}</dd>
            <dt className="text-muted">IVA</dt><dd className="text-right">{formatEur(quote.vat_cents)}</dd>
            <dt className="font-semibold">Totale</dt><dd className="text-right font-semibold">{formatEur(quote.total_cents)}</dd>
          </dl>
          {quote.notes && <p className="mt-4 whitespace-pre-wrap text-sm"><strong>Note: </strong>{quote.notes}</p>}
          {quote.terms && <p className="mt-2 whitespace-pre-wrap text-sm"><strong>Condizioni: </strong>{quote.terms}</p>}
        </Card>
        {canWrite && NEXT[quote.status].length > 0 && (
          <Card className="no-print h-fit">
            <h2 className="mb-3 font-medium">Cambia stato</h2>
            <div className="flex flex-wrap gap-2">
              {NEXT[quote.status].map((s) => (
                <form key={s} action={changeQuoteStatusAction.bind(null, id)}>
                  <input type="hidden" name="status" value={s} />
                  <Button variant="outline" size="sm">{s === "draft" ? "Riporta in bozza" : `Segna ${QUOTE_STATUS_LABEL[s].toLowerCase()}`}</Button>
                </form>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
