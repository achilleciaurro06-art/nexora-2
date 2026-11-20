import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { getQuote, listBillings, listRevisions } from "@/modules/preventivi/repository";
import { BillingForm } from "@/modules/preventivi/ui/billing-form";
import { listMembers, nameMap } from "@/modules/organizzazioni/queries";
import { listFieldDefs } from "@/modules/settore/queries";
import { displayValue } from "@/modules/settore/custom-fields";
import { StatusBadge } from "@/components/ui/status-badge";
import { changeQuoteStatusAction, deleteQuoteAction, duplicateQuoteAction, removeBillingAction } from "@/modules/preventivi/actions";
import { Alert, Card, PageHeader, Table } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { RemoveButton } from "@/components/ui/remove-button";
import { formatEur } from "@/lib/money";
import { PricePanel } from "@/modules/prezzi/ui/price-panel";
import { QUOTE_STATUS_LABEL, type QuoteStatus } from "@/types/domain";

const NEXT: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["sent"], sent: ["accepted", "rejected", "expired", "draft"], accepted: [], rejected: ["draft"], expired: ["draft"],
};

export const maxDuration = 60;
const quote_has = (v: Record<string, unknown> | null | undefined, k: string) => v?.[k] !== undefined && v[k] !== "";

export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ errore?: string }> }) {
  const { id } = await params;
  const { errore } = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const found = await getQuote(db, ctx.org.organizationId, id);
  if (!found) notFound();
  const [revisions, billings, fieldDefs] = await Promise.all([listRevisions(db, ctx.org.organizationId, id), listBillings(db, ctx.org.organizationId, id), listFieldDefs(db, ctx.org.organizationId, "quote")]);
  const shownFields = fieldDefs.filter((d) => (d.active || quote_has(found.quote.custom_values, d.key)) && quote_has(found.quote.custom_values, d.key));
  const { quote, items } = found;
  const customer = quote.customers;
  const canWrite = can(ctx.org.role, "data:write");
  const billedCents = billings.reduce((t, b) => t + Number(b.amount_cents), 0);
  const authors = nameMap(await listMembers(db, ctx.org.organizationId));
  return (
    <>
      <PageHeader title={`Preventivo ${quote.number}`} description={quote.title ?? undefined}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <a href={`/preventivi/${id}/pdf`} download className={buttonVariants({ variant: "outline" })}>Scarica PDF</a>
            {canWrite && <form action={duplicateQuoteAction.bind(null, id)} className="inline"><Button variant="outline">Duplica</Button></form>}
            {canWrite && <Link href={`/attivita/nuova?preventivo=${id}`} className={buttonVariants({ variant: "outline" })}>Crea attività</Link>}
            {canWrite && quote.status === "draft" && <Link href={`/preventivi/${id}/modifica`} className={buttonVariants({ variant: "outline" })}>Modifica</Link>}
            {can(ctx.org.role, "data:delete") && <RemoveButton variant="danger" size="default" label="Rimuovi preventivo" action={deleteQuoteAction.bind(null, id)} confirmMessage={`Rimuovere il preventivo ${quote.number}?${quote.status === "accepted" ? "\n\nATTENZIONE: è un preventivo ACCETTATO." : ""}\n\nNon comparirà più in elenchi, follow-up e statistiche. L'operazione viene registrata.`} />}
          </div>
        } />
      {errore === "duplicazione" && <div className="mb-4"><Alert>Impossibile duplicare il preventivo.</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Cliente</dt><dd>{customer?.deleted_at ? <span className="text-muted">{customer.name} (cliente rimosso)</span> : <Link className="text-primary hover:underline" href={`/clienti/${quote.customer_id}`}>{customer?.name}</Link>}</dd></div>
            <div><dt className="text-muted">Stato</dt><dd><StatusBadge status={quote.status} /></dd></div>
            <div><dt className="text-muted">Emissione</dt><dd>{new Date(quote.issue_date).toLocaleDateString("it-IT")}</dd></div>
            <div><dt className="text-muted">Follow-up</dt><dd>{quote.follow_up_date ? new Date(quote.follow_up_date).toLocaleDateString("it-IT") : "—"}</dd></div>
            {shownFields.map((d) => <div key={d.key}><dt className="text-muted">{d.label}</dt><dd>{displayValue(d, found.quote.custom_values?.[d.key])}</dd></div>)}
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
        <div className="no-print space-y-4">
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
        {quote.status === "accepted" && (
          <Card data-testid="billing-card">
            <h2 className="mb-1 font-medium">Fatturato registrato</h2>
            <p className="mb-3 text-xs text-muted">Il valore del preventivo non è fatturato: qui si registra ciò che è stato davvero fatturato.</p>
            <dl className="mb-3 grid grid-cols-2 gap-1 text-sm">
              <dt className="text-muted">Valore preventivo</dt><dd className="text-right">{formatEur(quote.total_cents)}</dd>
              <dt className="text-muted">Fatturato</dt><dd className="text-right font-medium" data-testid="billed-total">{formatEur(billedCents)}</dd>
              <dt className="text-muted">Da fatturare</dt><dd className="text-right">{formatEur(Math.max(quote.total_cents - billedCents, 0))}</dd>
            </dl>
            {billings.length > 0 && (
              <ul className="mb-3 divide-y divide-border text-sm">
                {billings.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span>{new Date(b.billed_at).toLocaleDateString("it-IT")} · {formatEur(b.amount_cents)}{b.reference ? ` · ${b.reference}` : ""}{b.note ? <span className="text-muted"> — {b.note}</span> : null}</span>
                    {can(ctx.org.role, "data:delete") && <RemoveButton action={removeBillingAction.bind(null, id, b.id)} confirmMessage={`Rimuovere la registrazione di ${formatEur(b.amount_cents)}?`} />}
                  </li>
                ))}
              </ul>
            )}
            {canWrite && <BillingForm quoteId={id} today={new Date().toISOString().slice(0, 10)} suggestedAmount={quote.total_cents - billedCents > 0 ? ((quote.total_cents - billedCents) / 100).toFixed(2).replace(".", ",") : ""} />}
          </Card>
        )}
        <Card data-testid="revisions-card">
          <h2 className="mb-2 font-medium">Storico modifiche</h2>
          {revisions.length === 0 ? <p className="text-sm text-muted">Nessuna revisione.</p> : (
            <ol className="space-y-1.5 text-sm">
              {revisions.map((r) => (
                <li key={r.id}>
                  <span className="text-muted">v{r.version} · {new Date(r.created_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}{r.created_by && authors.get(r.created_by) ? ` · ${authors.get(r.created_by)}` : ""}</span><br />{r.summary}
                </li>
              ))}
            </ol>
          )}
        </Card>
        </div>
      </div>
      <PricePanel orgId={ctx.org.organizationId} quoteId={id} quoteStatus={quote.status} canAnalyze={canWrite && can(ctx.org.role, "ai:use")} canApply={canWrite} />
    </>
  );
}
