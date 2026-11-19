import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { isUuid } from "@/lib/ids";
import { getCustomer } from "@/modules/clienti/repository";
import { updateCustomerAction, deleteCustomerAction } from "@/modules/clienti/actions";
import { addContactAction, removeContactAction, updateContactAction } from "@/modules/clienti/contacts";
import { addNoteAction, deleteNoteAction } from "@/modules/clienti/notes";
import { CustomerForm } from "@/modules/clienti/ui/customer-form";
import { TimelineSection } from "@/modules/clienti/ui/timeline-section";
import { listMembers, nameMap } from "@/modules/organizzazioni/queries";
import { PRIORITY_LABEL } from "@/modules/attivita/schemas";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { RemoveButton } from "@/components/ui/remove-button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { formatEur } from "@/lib/money";
import { StatusBadge } from "@/components/ui/status-badge";
import type { QuoteStatus } from "@/types/domain";

const CATEGORY = (mime: string) =>
  mime === "application/pdf" ? "PDF" : mime.startsWith("image/") ? "Immagine" : mime.includes("wordprocessingml") ? "Word" : mime.includes("spreadsheetml") ? "Excel" : "File";

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tl?: string }> }) {
  const { id } = await params;
  const { tl } = await searchParams;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const customer = await getCustomer(db, orgId, id);
  if (!customer) notFound();

  const [{ data: quotes }, { data: contacts }, { data: tasks }, { data: docs }, { data: notes }, members] = await Promise.all([
    db.from("quotes").select("id, number, title, status, total_cents, issue_date, follow_up_date").eq("organization_id", orgId).eq("customer_id", id).is("deleted_at", null).order("issue_date", { ascending: false }),
    db.from("customer_contacts").select("id, full_name, job_title, email, phone, notes").eq("organization_id", orgId).eq("customer_id", id).order("created_at"),
    db.from("tasks").select("id, title, status, priority, due_at, assignee_id").eq("organization_id", orgId).eq("customer_id", id).is("deleted_at", null).order("due_at", { nullsFirst: false }).limit(50),
    db.from("documents").select("id, name, mime_type, created_at").eq("organization_id", orgId).eq("customer_id", id).is("deleted_at", null).order("created_at", { ascending: false }).limit(20),
    db.from("customer_notes").select("id, body, created_at, created_by").eq("organization_id", orgId).eq("customer_id", id).order("created_at", { ascending: false }).limit(30),
    listMembers(db, orgId),
  ]);
  const names = nameMap(members);
  const canWrite = can(ctx.org.role, "data:write");
  const canDelete = can(ctx.org.role, "data:delete");
  const now = new Date();
  const openTasks = (tasks ?? []).filter((t) => t.status === "todo" || t.status === "in_progress");
  const openQuotes = (quotes ?? []).filter((q) => q.status === "draft" || q.status === "sent");
  const won = (quotes ?? []).filter((q) => q.status === "accepted").reduce((n, q) => n + Number(q.total_cents), 0);
  const pipeline = openQuotes.reduce((n, q) => n + Number(q.total_cents), 0);

  return (
    <>
      <PageHeader title={customer.name}
        description={[customer.city, customer.vat_number && `P.IVA ${customer.vat_number}`].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {canWrite && <Link href={`/preventivi/nuovo?cliente=${id}`} className={buttonVariants()}>Nuovo preventivo</Link>}
            {canWrite && <Link href={`/attivita/nuova?cliente=${id}`} className={buttonVariants({ variant: "outline" })}>Nuova attività</Link>}
            {canWrite && <Link href={`/documenti?cliente=${id}`} className={buttonVariants({ variant: "outline" })}>Carica documento</Link>}
            {canDelete && <RemoveButton variant="danger" size="default" label="Rimuovi cliente" action={deleteCustomerAction.bind(null, id)} confirmMessage={`Rimuovere il cliente «${customer.name}»?\n\n• ${openQuotes.length} preventiv${openQuotes.length === 1 ? "o aperto verrà rimosso" : "i aperti verranno rimossi"} insieme al cliente.\n• I preventivi accettati/chiusi restano nello storico.\n• Attività e documenti restano archiviati.\n\nL'operazione viene registrata.`} />}
          </div>
        } />

      <dl className="mb-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          ["Valore accettato", formatEur(won)], ["In trattativa", `${formatEur(pipeline)} (${openQuotes.length})`],
          ["Attività aperte", String(openTasks.length)], ["Referenti", String((contacts ?? []).length)],
        ].map(([k, v]) => <Card key={k} className="p-3"><dt className="text-muted">{k}</dt><dd className="mt-0.5 text-lg font-semibold">{v}</dd></Card>)}
      </dl>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Card><h2 className="mb-3 font-medium">Anagrafica e dati fiscali</h2><CustomerForm action={updateCustomerAction.bind(null, id)} customer={customer} readOnly={!canWrite} /></Card>

          <Card>
            <h2 className="mb-3 font-medium">Note</h2>
            {canWrite && (
              <form action={addNoteAction.bind(null, id)} className="mb-4 space-y-2">
                <Label htmlFor="body">Nuova nota</Label>
                <Textarea id="body" name="body" required maxLength={4000} placeholder="Es. Chiamata di oggi: interessato al piano annuale…" />
                <Button variant="outline" size="sm">Aggiungi nota</Button>
              </form>
            )}
            {(notes ?? []).length === 0 ? <p className="text-sm text-muted">Nessuna nota.</p> : (
              <ul className="space-y-3 text-sm">
                {(notes ?? []).map((n) => (
                  <li key={n.id as string} className="rounded-md border border-border p-3">
                    <p className="whitespace-pre-wrap">{n.body as string}</p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted">
                      <span>{new Date(n.created_at as string).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}{n.created_by ? ` · ${names.get(n.created_by as string) ?? ""}` : ""}</span>
                      {canWrite && (n.created_by === ctx.userId || canDelete) && <form action={deleteNoteAction.bind(null, id, n.id as string)}><Button size="sm" variant="ghost">Elimina</Button></form>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <TimelineSection orgId={orgId} customerId={id} filter={tl} names={names} />
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-medium">Referenti</h2>
            {(contacts ?? []).length === 0 && <p className="mb-3 text-sm text-muted">Nessun referente.</p>}
            <ul className="mb-3 space-y-2 text-sm">
              {(contacts ?? []).map((c) => (
                <li key={c.id as string} className="rounded-md border border-border p-3">
                  <p><strong>{c.full_name as string}</strong>{c.job_title ? ` · ${c.job_title}` : ""}</p>
                  <p className="text-muted">{[c.email, c.phone].filter(Boolean).join(" · ") || "—"}</p>
                  {c.notes ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{c.notes as string}</p> : null}
                  {canWrite && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-primary">Modifica</summary>
                      <form action={updateContactAction.bind(null, id, c.id as string)} className="mt-2 grid gap-2">
                        <Input name="full_name" required defaultValue={c.full_name as string} aria-label="Nome" />
                        <Input name="job_title" defaultValue={(c.job_title as string) ?? ""} placeholder="Ruolo" aria-label="Ruolo" />
                        <Input name="email" type="email" defaultValue={(c.email as string) ?? ""} placeholder="Email" aria-label="Email" />
                        <Input name="phone" defaultValue={(c.phone as string) ?? ""} placeholder="Telefono" aria-label="Telefono" />
                        <Textarea name="notes" defaultValue={(c.notes as string) ?? ""} placeholder="Note" aria-label="Note" />
                        <div className="flex gap-2">
                          <Button size="sm">Salva</Button>
                          <Button size="sm" variant="danger" formAction={removeContactAction.bind(null, id, c.id as string)} formNoValidate>Elimina</Button>
                        </div>
                      </form>
                    </details>
                  )}
                </li>
              ))}
            </ul>
            {canWrite && (
              <form action={addContactAction.bind(null, id)} className="grid gap-2">
                <div><Label htmlFor="full_name">Nuovo referente</Label><Input id="full_name" name="full_name" required placeholder="Nome e cognome" /></div>
                <Input name="job_title" placeholder="Ruolo" aria-label="Ruolo" />
                <Input name="email" type="email" placeholder="Email" aria-label="Email" />
                <Input name="phone" placeholder="Telefono" aria-label="Telefono" />
                <Textarea name="notes" placeholder="Note (facoltative)" aria-label="Note" />
                <Button variant="outline" size="sm">Aggiungi referente</Button>
              </form>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-medium">Preventivi</h2>
            {(quotes ?? []).length === 0 ? <p className="text-sm text-muted">Nessun preventivo.</p> : (
              <ul className="space-y-2 text-sm">
                {(quotes ?? []).map((q) => (
                  <li key={q.id as string} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate"><Link className="text-primary hover:underline" href={`/preventivi/${q.id}`}>{q.number as string}</Link>{q.title ? ` · ${q.title}` : ""}</span>
                    <span className="flex shrink-0 items-center gap-2"><StatusBadge status={q.status as QuoteStatus} />{formatEur(q.total_cents as number)}</span>
                  </li>
                ))}
              </ul>
            )}
            {(quotes ?? []).some((q) => q.follow_up_date && (q.status === "draft" || q.status === "sent")) && (
              <p className="mt-3 text-xs text-muted">
                Follow-up: {(quotes ?? []).filter((q) => q.follow_up_date && (q.status === "draft" || q.status === "sent")).map((q) => `${q.number} → ${new Date(q.follow_up_date as string).toLocaleDateString("it-IT")}`).join(" · ")}
              </p>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">Attività</h2>{canWrite && <Link className="text-sm text-primary hover:underline" href={`/attivita/nuova?cliente=${id}`}>+ Nuova</Link>}</div>
            {(tasks ?? []).length === 0 ? <p className="text-sm text-muted">Nessuna attività collegata.</p> : (
              <ul className="space-y-2 text-sm">
                {(tasks ?? []).map((t) => {
                  const done = t.status === "done" || t.status === "cancelled";
                  const overdue = !done && t.due_at && new Date(t.due_at as string) < now;
                  return (
                    <li key={t.id as string} className="flex items-center justify-between gap-2">
                      <Link className={`min-w-0 truncate hover:underline ${done ? "text-muted line-through" : ""}`} href={`/attivita/${t.id}`}>{t.title as string}</Link>
                      <span className={`shrink-0 text-xs ${overdue ? "text-danger" : "text-muted"}`}>
                        {t.assignee_id ? `${names.get(t.assignee_id as string) ?? ""} · ` : ""}{t.due_at ? new Date(t.due_at as string).toLocaleDateString("it-IT") : PRIORITY_LABEL[t.priority as keyof typeof PRIORITY_LABEL]}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">Documenti</h2>{canWrite && <Link className="text-sm text-primary hover:underline" href={`/documenti?cliente=${id}`}>+ Carica</Link>}</div>
            {(docs ?? []).length === 0 ? <p className="text-sm text-muted">Nessun documento collegato.</p> : (
              <ul className="space-y-2 text-sm">
                {(docs ?? []).map((d) => (
                  <li key={d.id as string} className="flex items-center justify-between gap-2">
                    <Link className="min-w-0 truncate text-primary hover:underline" href={`/documenti/${d.id}/download`} prefetch={false}>{d.name as string}</Link>
                    <Badge>{CATEGORY(d.mime_type as string)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
