import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { isUuid } from "@/lib/ids";
import { getCommercialSummary, getCustomer, getDeleteBlockers } from "@/modules/clienti/repository";
import { archiveCustomerAction, restoreCustomerAction, updateCustomerAction } from "@/modules/clienti/actions";
import { addContactAction, removeContactAction, updateContactAction } from "@/modules/clienti/contacts";
import { addNoteAction, deleteNoteAction } from "@/modules/clienti/notes";
import { listFieldDefs, listPriceLists } from "@/modules/settore/queries";
import { CustomerForm } from "@/modules/clienti/ui/customer-form";
import { PermanentDelete } from "@/modules/clienti/ui/permanent-delete";
import { TimelineSection } from "@/modules/clienti/ui/timeline-section";
import { InvoiceActions, InvoiceForm } from "@/modules/fatture/ui/invoice-form";
import { listInvoices } from "@/modules/fatture/queries";
import { listMembers, nameMap } from "@/modules/organizzazioni/queries";
import { PRIORITY_LABEL } from "@/modules/attivita/schemas";
import { fmtDate, fmtDateTime, fmtDay, todayIn } from "@/lib/datetime";
import { APPOINTMENT_STATUS_LABEL, CALL_DIRECTION_LABEL, CALL_OUTCOME_LABEL, type CallOutcome } from "@/modules/agenda/types";
import { FollowUpBadge } from "@/modules/followup/ui/follow-up-status";
import { OPEN_STATUSES, isOverdue, type FollowUpStatus } from "@/modules/followup/states";
import { eventHref } from "@/modules/clienti/timeline";
import { listThreads } from "@/modules/email/queries";
import { Alert, Badge, Card, PageHeader, Table } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { RemoveButton } from "@/components/ui/remove-button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { formatEur } from "@/lib/money";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { CUSTOMER_TYPE_LABEL, type QuoteStatus } from "@/types/domain";

const TABS = [
  { key: "panoramica", label: "Panoramica" }, { key: "referenti", label: "Referenti" }, { key: "preventivi", label: "Preventivi" },
  { key: "attivita", label: "Attività" }, { key: "documenti", label: "Documenti e comunicazioni" }, { key: "fatturazione", label: "Fatturazione" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const CATEGORY = (mime: string) =>
  mime === "application/pdf" ? "PDF" : mime.startsWith("image/") ? "Immagine" : mime.includes("wordprocessingml") ? "Word" : mime.includes("spreadsheetml") ? "Excel" : "File";
const dt = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString("it-IT") : "—");
const dtt = (v: string) => new Date(v).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tl?: string; tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? "panoramica") as TabKey;
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const customer = await getCustomer(db, orgId, id);
  if (!customer) notFound();
  const archived = !!customer.archived_at;
  const [summary, members] = await Promise.all([getCommercialSummary(db, id), listMembers(db, orgId)]);
  const names = nameMap(members);
  const canWrite = can(ctx.org.role, "data:write") && !archived;
  const canRestore = can(ctx.org.role, "data:write");
  const canDelete = can(ctx.org.role, "data:delete");
  const today = new Date().toISOString().slice(0, 10);
  const s = summary;
  const tabHref = (k: string) => `/clienti/${id}${k === "panoramica" ? "" : `?tab=${k}`}`;

  return (
    <>
      <PageHeader title={customer.name}
        description={[customer.customer_type ? CUSTOMER_TYPE_LABEL[customer.customer_type] : null, customer.industry, customer.city, customer.vat_number && `P.IVA ${customer.vat_number}`].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {canWrite && <Link href={`/preventivi/nuovo?cliente=${id}`} className={buttonVariants()}>Nuovo preventivo</Link>}
            {canWrite && <Link href={`/attivita/nuova?cliente=${id}`} className={buttonVariants({ variant: "outline" })}>Nuova attività</Link>}
            {canWrite && <Link href={`/documenti?cliente=${id}`} className={buttonVariants({ variant: "outline" })}>Carica documento</Link>}
            {canWrite && <RemoveButton variant="outline" size="default" label="Archivia" action={archiveCustomerAction.bind(null, id)}
              confirmMessage={`Archiviare «${customer.name}»?\n\nNon comparirà più tra i clienti attivi né nei selettori, ma preventivi, referenti, documenti, attività e storico restano conservati. Potrai ripristinarlo in qualsiasi momento.`} />}
          </div>
        } />

      {archived && (
        <Card className="mb-4 border-amber-400 bg-amber-50 dark:bg-amber-950/30" data-testid="archived-banner">
          <p className="font-medium">Cliente archiviato</p>
          <p className="text-sm text-muted">Archiviato il {dtt(customer.archived_at!)}{customer.archived_by ? ` da ${names.get(customer.archived_by) ?? "un collaboratore"}` : ""}. Tutti i dati sono conservati; non compare tra i clienti attivi né nei selettori.</p>
          {canRestore && <div className="mt-3"><RemoveButton variant="default" size="default" label="Ripristina cliente" action={restoreCustomerAction.bind(null, id)} confirmMessage={`Ripristinare «${customer.name}»?`} /></div>}
        </Card>
      )}

      {/* indicatori sempre visibili */}
      <dl className="mb-6 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4" data-testid="customer-kpis">
        <Card className="p-3"><dt className="text-muted">Preventivi accettati</dt><dd className="mt-0.5 text-lg font-semibold" data-testid="kpi-accepted">{formatEur(s?.accepted_cents)}</dd><dd className="text-xs text-muted">{s?.accepted_count ?? 0} preventivi · non è fatturato</dd></Card>
        <Card className="p-3"><dt className="text-muted">In trattativa (inviati)</dt><dd className="mt-0.5 text-lg font-semibold" data-testid="kpi-open">{formatEur(s?.open_cents)}</dd><dd className="text-xs text-muted">{s?.open_count ?? 0} aperti · {s?.draft_count ?? 0} bozze</dd></Card>
        <Card className="p-3"><dt className="text-muted">Fatturato registrato</dt><dd className="mt-0.5 text-lg font-semibold" data-testid="kpi-invoiced">{formatEur(s?.invoiced_cents)}</dd><dd className="text-xs text-muted">incassato {formatEur(s?.collected_cents)}</dd></Card>
        <Card className="p-3"><dt className="text-muted">Ultima attività</dt><dd className="mt-0.5 text-lg font-semibold">{dt(s?.last_activity_at)}</dd><dd className="text-xs text-muted">ultimo contatto {dt(s?.last_contact_at)}</dd></Card>
      </dl>

      <nav aria-label="Sezioni della scheda cliente" className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-2">
        {TABS.map((t) => (
          <Link key={t.key} href={tabHref(t.key)} aria-current={t.key === tab ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm hover:bg-border/50", t.key === tab && "bg-primary/10 font-medium text-primary")}>{t.label}</Link>
        ))}
      </nav>

      {tab === "panoramica" && <Overview />}
      {tab === "referenti" && <ContactsTab />}
      {tab === "preventivi" && <QuotesTab />}
      {tab === "attivita" && <ActivityTab />}
      {tab === "documenti" && <DocumentsTab />}
      {tab === "fatturazione" && <BillingTab />}

      {archived && canDelete && <DeletePanel />}
    </>
  );

  /* ------------------------------------------------------------------ tab: panoramica */
  async function Overview() {
    const [fieldDefs, priceLists] = await Promise.all([listFieldDefs(db, orgId, "customer", true), listPriceLists(db, orgId)]);
    const rows: [string, string, string?][] = [
      ["Preventivi emessi", String(s?.issued_count ?? 0), formatEur(s?.issued_cents)],
      ["Accettati", String(s?.accepted_count ?? 0), formatEur(s?.accepted_cents)],
      ["Rifiutati", String(s?.rejected_count ?? 0), formatEur(s?.rejected_cents)],
      ["Scaduti", String(s?.expired_count ?? 0), formatEur(s?.expired_cents)],
      ["Trattative aperte (inviati)", String(s?.open_count ?? 0), formatEur(s?.open_cents)],
      ["Valore medio dei preventivi emessi", "", formatEur(s?.avg_issued_cents)],
      ["Conversione (accettati su decisi)", s?.conversion_pct == null ? "—" : `${s.conversion_pct}%`],
    ];
    return (
      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Card>
          <h2 className="mb-1 font-medium">Informazioni generali</h2>
          <p className="mb-3 text-xs text-muted">Cliente dal {dt(customer!.created_at)}{customer!.website ? <> · <a className="text-primary hover:underline" href={/^https?:\/\//.test(customer!.website) ? customer!.website : `https://${customer!.website}`} target="_blank" rel="noopener noreferrer">{customer!.website}</a></> : null}</p>
          <CustomerForm action={updateCustomerAction.bind(null, id)} customer={customer!} readOnly={!canWrite} fields={fieldDefs} priceLists={priceLists.filter((l) => l.active || l.id === customer!.price_list_id)} />
        </Card>
        <Card className="h-fit" data-testid="commercial-value">
          <h2 className="mb-1 font-medium">Valore commerciale</h2>
          <p className="mb-3 text-xs text-muted">Calcolato dai preventivi e dalle fatture registrate. Accettato, fatturato e incassato sono tre cose diverse.</p>
          <Table>
            <thead><tr><th>Indicatore</th><th className="text-right">N.</th><th className="text-right">Valore</th></tr></thead>
            <tbody>
              {rows.map(([k, n, v]) => <tr key={k}><td>{k}</td><td className="text-right">{n}</td><td className="text-right">{v ?? ""}</td></tr>)}
              <tr className="border-t-2"><td>Fatturato registrato</td><td className="text-right">{s?.invoiced_count ?? 0}</td><td className="text-right">{formatEur(s?.invoiced_cents)}</td></tr>
              <tr><td>Incassato</td><td /><td className="text-right">{formatEur(s?.collected_cents)}</td></tr>
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-muted">Ultima attività commerciale: {s?.last_activity_at ? dtt(s.last_activity_at) : "—"}<br />Ultimo contatto (nota, attività chiusa o preventivo inviato/deciso): {s?.last_contact_at ? dtt(s.last_contact_at) : "—"}</p>
        </Card>
      </div>
    );
  }

  /* ------------------------------------------------------------------ tab: referenti */
  async function ContactsTab() {
    const { data: contacts } = await db.from("customer_contacts").select("id, full_name, job_title, email, phone, notes").eq("organization_id", orgId).eq("customer_id", id).order("created_at");
    return (
      <Card className="max-w-3xl">
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
    );
  }

  /* ------------------------------------------------------------------ tab: preventivi */
  async function QuotesTab() {
    const [{ data: quotes }, { data: events }] = await Promise.all([
      db.from("quotes").select("id, number, title, status, total_cents, issue_date, follow_up_date").eq("organization_id", orgId).eq("customer_id", id).is("deleted_at", null).order("issue_date", { ascending: false }).order("number", { ascending: false }),
      db.from("activity_events").select("entity_id, event, created_at").eq("organization_id", orgId).eq("customer_id", id).eq("entity", "quote").in("event", ["status_sent", "status_accepted"]).order("created_at", { ascending: true }).limit(1000),
    ]);
    const sent = new Map<string, string>(), accepted = new Map<string, string>();
    for (const e of events ?? []) (e.event === "status_sent" ? sent : accepted).set(e.entity_id as string, e.created_at as string);
    return (
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          {[["Emessi", s?.issued_cents, s?.issued_count], ["Accettati", s?.accepted_cents, s?.accepted_count], ["Rifiutati", s?.rejected_cents, s?.rejected_count], ["Ancora aperti", s?.open_cents, s?.open_count]].map(([k, v, n]) => (
            <Card key={k as string} className="p-3"><dt className="text-muted">{k as string}</dt><dd className="mt-0.5 font-semibold">{formatEur(v as number)}</dd><dd className="text-xs text-muted">{n as number} preventivi</dd></Card>
          ))}
        </dl>
        <Table>
          <thead><tr><th>Numero</th><th>Data</th><th>Oggetto</th><th className="text-right">Importo</th><th>Stato</th><th>Inviato</th><th>Accettato</th></tr></thead>
          <tbody>
            {(quotes ?? []).length === 0 && <tr><td colSpan={7} className="text-muted">Nessun preventivo.</td></tr>}
            {(quotes ?? []).map((q) => (
              <tr key={q.id as string}>
                <td><Link className="font-medium text-primary hover:underline" href={`/preventivi/${q.id}`}>{q.number as string}</Link></td>
                <td>{dt(q.issue_date as string)}</td><td>{(q.title as string) ?? "—"}</td><td className="text-right">{formatEur(q.total_cents as number)}</td>
                <td><StatusBadge status={q.status as QuoteStatus} /></td>
                <td>{sent.has(q.id as string) ? dt(sent.get(q.id as string)) : "—"}</td>
                <td>{q.status === "accepted" && accepted.has(q.id as string) ? dt(accepted.get(q.id as string)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    );
  }

  /* ------------------------------------------------------------------ tab: attività, appuntamenti, chiamate, follow-up */
  async function ActivityTab() {
    const nowIso = new Date().toISOString();
    const [{ data: tasks }, { data: apps }, { data: calls }, { data: fus }, { data: quotes }, { data: history }] = await Promise.all([
      db.from("tasks").select("id, title, status, priority, due_at, due_has_time, completed_at, assignee_id, task_types(label)").eq("organization_id", orgId).eq("customer_id", id).is("deleted_at", null).order("due_at", { nullsFirst: false }).limit(100),
      db.from("appointments").select("id, title, starts_at, ends_at, status, location").eq("organization_id", orgId).eq("customer_id", id).is("deleted_at", null).order("starts_at", { ascending: false }).limit(50),
      db.from("call_logs").select("id, called_at, direction, outcome, duration_seconds, user_id, follow_up_id").eq("organization_id", orgId).eq("customer_id", id).order("called_at", { ascending: false }).limit(20),
      db.from("follow_ups").select("id, title, status, due_on, assignee_id").eq("organization_id", orgId).eq("customer_id", id).is("deleted_at", null).order("due_on").limit(100),
      db.from("quotes").select("id, number, status, follow_up_date").eq("organization_id", orgId).eq("customer_id", id).is("deleted_at", null).in("status", ["draft", "sent"]).not("follow_up_date", "is", null).order("follow_up_date"),
      db.from("activity_events").select("id, entity, entity_id, summary, created_at, actor_id").eq("organization_id", orgId).eq("customer_id", id).in("entity", ["task", "appointment", "call", "follow_up"]).order("created_at", { ascending: false }).limit(30),
    ]);
    const now = new Date();
    const open = (tasks ?? []).filter((t) => t.status === "todo" || t.status === "in_progress");
    const done = (tasks ?? []).filter((t) => t.status === "done" || t.status === "cancelled");
    const upcomingApps = (apps ?? []).filter((a) => a.status === "scheduled" && (a.ends_at as string) >= nowIso).sort((x, y) => (x.starts_at as string).localeCompare(y.starts_at as string));
    const pastApps = (apps ?? []).filter((a) => !upcomingApps.includes(a));
    const openFus = (fus ?? []).filter((f) => OPEN_STATUSES.includes(f.status as FollowUpStatus));
    const closedFus = (fus ?? []).filter((f) => !OPEN_STATUSES.includes(f.status as FollowUpStatus));
    const today = todayIn(now);
    const nextApp = upcomingApps[0];
    const nextFu = openFus[0];
    const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
    const Row = ({ t }: { t: NonNullable<typeof tasks>[number] }) => {
      const isDone = t.status === "done" || t.status === "cancelled";
      const overdue = !isDone && t.due_at && new Date(t.due_at as string) < now;
      return (
        <li className="flex items-center justify-between gap-2">
          <Link className={`min-w-0 truncate hover:underline ${isDone ? "text-muted line-through" : ""}`} href={`/attivita/${t.id}`}>{t.title as string}</Link>
          <span className={`shrink-0 text-xs ${overdue ? "text-danger" : "text-muted"}`}>
            {one(t.task_types as { label: string } | { label: string }[] | null)?.label ?? "Attività"} · {t.assignee_id ? `${names.get(t.assignee_id as string) ?? ""} · ` : ""}{isDone && t.completed_at ? `chiusa il ${fmtDate(t.completed_at as string)}` : t.due_at ? `scadenza ${t.due_has_time ? fmtDateTime(t.due_at as string) : fmtDate(t.due_at as string)}` : PRIORITY_LABEL[t.priority as keyof typeof PRIORITY_LABEL]}
          </span>
        </li>
      );
    };
    return (
      <div className="space-y-6">
        {canWrite && (
          <div className="flex flex-wrap gap-2" data-testid="quick-create">
            <Link href={`/attivita/nuova?cliente=${id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Nuova attività</Link>
            <Link href={`/appuntamenti/nuovo?cliente=${id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Nuovo appuntamento</Link>
            <Link href={`/chiamate/nuova?cliente=${id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Registra chiamata</Link>
            <Link href={`/followup/nuovo?cliente=${id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Nuovo follow-up</Link>
          </div>
        )}
        <dl className="grid gap-3 sm:grid-cols-2" data-testid="next-actions">
          <Card className="p-3"><dt className="text-sm text-muted">Prossimo appuntamento</dt><dd className="mt-0.5 font-medium" data-testid="next-appointment">{nextApp ? <Link className="text-primary hover:underline" href={`/appuntamenti/${nextApp.id}`}>{fmtDateTime(nextApp.starts_at as string)} · {nextApp.title as string}</Link> : <span className="text-muted">Nessuno in programma</span>}</dd></Card>
          <Card className="p-3"><dt className="text-sm text-muted">Prossimo follow-up</dt><dd className="mt-0.5 font-medium" data-testid="next-followup">{nextFu ? <><Link className="text-primary hover:underline" href={`/followup/${nextFu.id}`}>{fmtDay(nextFu.due_on as string)} · {nextFu.title as string}</Link> <FollowUpBadge status={nextFu.status as FollowUpStatus} overdue={isOverdue(nextFu.status as FollowUpStatus, nextFu.due_on as string, today)} /></> : <span className="text-muted">Nessuno programmato</span>}</dd></Card>
        </dl>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 font-medium">Appuntamenti</h2>
            {(apps ?? []).length === 0 ? <p className="text-sm text-muted">Nessun appuntamento.</p> : (
              <ul className="space-y-2 text-sm" data-testid="customer-appointments">
                {[...upcomingApps, ...pastApps].map((a) => (
                  <li key={a.id as string} className="flex items-center justify-between gap-2">
                    <Link className={`min-w-0 truncate hover:underline ${a.status === "cancelled" ? "text-muted line-through" : ""}`} href={`/appuntamenti/${a.id}`}>{a.title as string}</Link>
                    <span className="shrink-0 text-xs text-muted">{fmtDateTime(a.starts_at as string)} · {APPOINTMENT_STATUS_LABEL[a.status as keyof typeof APPOINTMENT_STATUS_LABEL]}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="mb-3 font-medium">Chiamate</h2>
            {(calls ?? []).length === 0 ? <p className="text-sm text-muted">Nessuna chiamata registrata.</p> : (
              <ul className="space-y-2 text-sm" data-testid="customer-calls">
                {(calls ?? []).map((c) => (
                  <li key={c.id as string} className="flex items-center justify-between gap-2">
                    <span>{CALL_DIRECTION_LABEL[c.direction as keyof typeof CALL_DIRECTION_LABEL]} · {CALL_OUTCOME_LABEL[c.outcome as CallOutcome]}{c.follow_up_id ? <> · <Link className="text-primary hover:underline" href={`/followup/${c.follow_up_id}`}>follow-up</Link></> : null}</span>
                    <span className="shrink-0 text-xs text-muted">{fmtDateTime(c.called_at as string)}{c.user_id ? ` · ${names.get(c.user_id as string) ?? ""}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="mb-3 font-medium">Follow-up</h2>
            {(fus ?? []).length === 0 && (quotes ?? []).length === 0 ? <p className="text-sm text-muted">Nessun follow-up.</p> : (
              <ul className="space-y-2 text-sm" data-testid="customer-followups">
                {[...openFus, ...closedFus].map((f) => (
                  <li key={f.id as string} className="flex items-center justify-between gap-2">
                    <Link className="min-w-0 truncate hover:underline" href={`/followup/${f.id}`}>{f.title as string}</Link>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted">{fmtDay(f.due_on as string)} <FollowUpBadge status={f.status as FollowUpStatus} overdue={isOverdue(f.status as FollowUpStatus, f.due_on as string, today)} /></span>
                  </li>
                ))}
                {(quotes ?? []).map((q) => <li key={q.id as string} className="text-xs text-muted">Preventivo <Link className="text-primary hover:underline" href={`/preventivi/${q.id}`}>{q.number as string}</Link>: follow-up il {fmtDay(q.follow_up_date as string)}</li>)}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="mb-3 font-medium">Attività e scadenze</h2>
            {open.length === 0 && done.length === 0 ? <p className="text-sm text-muted">Nessuna attività collegata.</p> : (
              <>
                {open.length > 0 && <ul className="space-y-2 text-sm">{open.map((t) => <Row key={t.id as string} t={t} />)}</ul>}
                {done.length > 0 && <><h3 className="mb-2 mt-4 text-sm font-medium">Completate</h3><ul className="space-y-2 text-sm">{done.slice(0, 15).map((t) => <Row key={t.id as string} t={t} />)}</ul></>}
              </>
            )}
          </Card>
        </div>
        <Card data-testid="interaction-history">
          <h2 className="mb-3 font-medium">Storico delle interazioni</h2>
          {(history ?? []).length === 0 ? <p className="text-sm text-muted">Ancora nessuna interazione registrata.</p> : (
            <ol className="space-y-2 text-sm">
              {(history ?? []).map((e) => (
                <li key={e.id as number} className="flex justify-between gap-3">
                  <Link className="truncate hover:underline" href={eventHref(e as never, id) ?? `/clienti/${id}`}>{e.summary as string}</Link>
                  <span className="shrink-0 text-xs text-muted">{fmtDateTime(e.created_at as string)}{e.actor_id ? ` · ${names.get(e.actor_id as string) ?? ""}` : ""}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    );
  }

  /* ------------------------------------------------------------------ tab: documenti e comunicazioni */
  async function DocumentsTab() {
    const [{ data: docs }, { data: notes }, emailThreads] = await Promise.all([
      db.from("documents").select("id, name, mime_type, created_at").eq("organization_id", orgId).eq("customer_id", id).is("deleted_at", null).order("created_at", { ascending: false }).limit(50),
      db.from("customer_notes").select("id, body, created_at, created_by").eq("organization_id", orgId).eq("customer_id", id).order("created_at", { ascending: false }).limit(30),
      listThreads(db, orgId, { folder: "tutte", customerId: id, limit: 15 }),
    ]);
    return (
      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-medium">Note commerciali</h2>
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
                      <span>{dtt(n.created_at as string)}{n.created_by ? ` · ${names.get(n.created_by as string) ?? ""}` : ""}</span>
                      {canWrite && (n.created_by === ctx.userId || canDelete) && <form action={deleteNoteAction.bind(null, id, n.id as string)}><Button size="sm" variant="ghost">Elimina</Button></form>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <TimelineSection orgId={orgId} customerId={id} filter={sp.tl} names={names} />
        </div>
        <div className="space-y-6">
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
          <Card data-testid="customer-emails">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">Email</h2>{canWrite && <Link className="text-sm text-primary hover:underline" href={`/email/nuova?cliente=${id}`}>+ Scrivi</Link>}</div>
            {emailThreads.length === 0 ? <p className="text-sm text-muted">Nessuna email collegata a questo cliente.</p> : (
              <ul className="space-y-3 text-sm">
                {emailThreads.map((t) => (
                  <li key={t.id} className="space-y-0.5" data-testid="customer-email">
                    <p className="flex items-center justify-between gap-2">
                      <Link className="min-w-0 truncate font-medium text-primary hover:underline" href={`/email/${t.id}`}>{t.subject || "(senza oggetto)"}</Link>
                      <span className="shrink-0 text-xs text-muted">{t.last ? fmtDateTime(t.last.message_at) : ""}</span>
                    </p>
                    <p className="truncate text-xs text-muted">{t.last ? `${t.last.direction === "inbound" ? "Ricevuta da" : "Inviata a"} ${t.last.direction === "inbound" ? (t.last.from_name || t.last.from_address) : t.last.to.map((a) => a.address).join(", ")} — ${t.last.snippet ?? ""}` : ""}</p>
                    <p className="flex items-center gap-2 text-xs text-muted">{t.message_count} messagg{t.message_count === 1 ? "io" : "i"}{t.last?.has_attachments ? " · 📎 allegati" : ""}{t.unread_count > 0 ? <Badge className="border-primary text-primary">{t.unread_count} non lett{t.unread_count === 1 ? "a" : "e"}</Badge> : null}
                      {canWrite && t.last && <Link className="text-primary hover:underline" href={`/email/${t.id}`}>Apri e rispondi</Link>}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ tab: fatturazione */
  async function BillingTab() {
    const [invoices, { data: quotes }] = await Promise.all([
      listInvoices(db, orgId, { customerId: id }),
      db.from("quotes").select("id, number, title, total_cents").eq("organization_id", orgId).eq("customer_id", id).is("deleted_at", null).eq("status", "accepted").order("issue_date", { ascending: false }),
    ]);
    const label = new Map((quotes ?? []).map((q) => [q.id as string, q.number as string]));
    const toCollect = Math.max((s?.invoiced_cents ?? 0) - (s?.collected_cents ?? 0), 0);
    const toInvoice = Math.max((s?.accepted_cents ?? 0) - (s?.accepted_invoiced_cents ?? 0), 0);
    return (
      <div className="space-y-6">
        <Card data-testid="value-comparison">
          <h2 className="mb-1 font-medium">Preventivato, accettato, fatturato, incassato</h2>
          <p className="mb-3 text-xs text-muted">Quattro misure diverse: un preventivo accettato non è ancora una fattura, e una fattura non è ancora un incasso.</p>
          <Table>
            <tbody>
              <tr><td>Valore preventivato (emesso)</td><td className="text-right" data-testid="v-issued">{formatEur(s?.issued_cents)}</td></tr>
              <tr><td>Valore accettato</td><td className="text-right" data-testid="v-accepted">{formatEur(s?.accepted_cents)}</td></tr>
              <tr><td>Valore fatturato (registrato)</td><td className="text-right" data-testid="v-invoiced">{formatEur(s?.invoiced_cents)}</td></tr>
              <tr><td>Valore incassato (registrato)</td><td className="text-right" data-testid="v-collected">{formatEur(s?.collected_cents)}</td></tr>
              <tr className="border-t-2"><td>Accettato non ancora fatturato</td><td className="text-right">{formatEur(toInvoice)}</td></tr>
              <tr><td>Fatturato non ancora incassato</td><td className="text-right">{formatEur(toCollect)}</td></tr>
            </tbody>
          </Table>
        </Card>
        <Card className="p-0">
          <Table>
            <thead><tr><th>Fattura</th><th>Emissione</th><th>Preventivo</th><th className="text-right">Imponibile</th><th className="text-right">IVA</th><th className="text-right">Totale</th><th>Pagamento</th>{canWrite && <th />}</tr></thead>
            <tbody data-testid="invoices">
              {invoices.length === 0 && <tr><td colSpan={8} className="text-muted">Nessuna fattura registrata.</td></tr>}
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td><strong>{i.reference ?? "—"}</strong>{i.note ? <span className="block text-xs text-muted">{i.note}</span> : null}</td>
                  <td>{dt(i.billed_at)}</td>
                  <td>{i.quote_id ? <Link className="text-primary hover:underline" href={`/preventivi/${i.quote_id}`}>{label.get(i.quote_id) ?? "vedi"}</Link> : "—"}</td>
                  <td className="text-right">{i.taxable_cents === null ? "—" : formatEur(i.taxable_cents)}</td><td className="text-right">{i.vat_cents === null ? "—" : formatEur(i.vat_cents)}</td>
                  <td className="text-right font-medium">{formatEur(i.amount_cents)}</td>
                  <td>{i.payment_status === "paid" ? <span className="text-green-700 dark:text-green-400">Incassata il {dt(i.paid_at)}</span> : <span className="text-amber-700 dark:text-amber-400">Da incassare</span>}</td>
                  {canWrite && <td><InvoiceActions id={i.id} number={i.reference ?? "senza numero"} paid={i.payment_status === "paid"} canDelete={canDelete} today={today} /></td>}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        {canWrite && (
          <Card>
            <h2 className="mb-1 font-medium">Registra una fattura</h2>
            <p className="mb-3 text-xs text-muted">Qui si <strong>registrano i dati</strong> di fatture emesse altrove (gestionale o fatturazione elettronica). NEXORA non genera né invia fatture fiscali.</p>
            <InvoiceForm customerId={id} acceptedQuotes={(quotes ?? []).map((q) => ({ id: q.id as string, label: `${q.number as string}${q.title ? ` · ${q.title}` : ""} · ${formatEur(q.total_cents as number)}` }))} today={today} />
          </Card>
        )}
        {!canWrite && !archived && <Alert>Il tuo ruolo consente solo la consultazione.</Alert>}
      </div>
    );
  }

  /* ------------------------------------------------------------------ eliminazione definitiva (solo archiviati, titolare/amministratori) */
  async function DeletePanel() {
    const b = await getDeleteBlockers(db, id);
    const blockers = b ? ([["preventivi", b.quotes], ["fatture registrate", b.invoices], ["documenti", b.documents], ["attività", b.tasks], ["appuntamenti", b.appointments], ["chiamate", b.calls], ["follow-up", b.follow_ups], ["conversazioni email", b.emails]] as [string, number][]).filter(([, n]) => n > 0) : [];
    const willRemove = b ? ([["referenti", b.contacts], ["note", b.notes]] as [string, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`) : [];
    return (
      <Card className="mt-8 border-danger/40" data-testid="delete-panel">
        <h2 className="mb-2 font-medium text-danger">Eliminazione definitiva</h2>
        {blockers.length > 0 ? (
          <div className="text-sm" data-testid="delete-blocked">
            <p>L&apos;eliminazione definitiva <strong>non è consentita</strong>: il cliente ha dati collegati che vanno conservati ({blockers.map(([k, n]) => `${n} ${k}`).join(", ")}).</p>
            <p className="mt-1 text-muted">Archiviarlo è sufficiente per toglierlo dagli elenchi attivi senza perdere nulla.</p>
          </div>
        ) : <PermanentDelete id={id} name={customer!.name} willRemove={willRemove} />}
      </Card>
    );
  }
}
