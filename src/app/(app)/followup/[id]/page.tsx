import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listCustomerOptions } from "@/modules/clienti/repository";
import { listMembers, nameMap } from "@/modules/organizzazioni/queries";
import { deleteFollowUpAction, updateFollowUpAction } from "@/modules/followup/actions";
import { FOLLOW_UP_LABEL, FOLLOW_UP_STATUSES, isOverdue, isOpen, type FollowUpStatus } from "@/modules/followup/states";
import { FollowUpBadge } from "@/modules/followup/ui/follow-up-status";
import { FollowUpForm } from "@/modules/followup/ui/follow-up-form";
import { ReschedulePanel, StatusPanel } from "@/modules/followup/ui/follow-up-actions";
import { Alert, Badge, Card, PageHeader } from "@/components/ui/card";
import { RemoveButton } from "@/components/ui/remove-button";
import { buttonVariants } from "@/components/ui/button";
import { PRIORITY_LABEL } from "@/modules/attivita/schemas";
import { fmtDateTime, fmtDay, todayIn } from "@/lib/datetime";
import { isUuid } from "@/lib/ids";

export default async function FollowUpPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data: f } = await db.from("follow_ups").select("*, customers(name, archived_at)").eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!f) notFound();
  const [customers, members, { data: quotes }, { data: events }] = await Promise.all([
    listCustomerOptions(db, orgId, f.customer_id as string), listMembers(db, orgId),
    db.from("quotes").select("id, number, title, customer_id").eq("organization_id", orgId).eq("customer_id", f.customer_id as string).is("deleted_at", null).limit(100),
    db.from("follow_up_events").select("id, event, from_status, to_status, from_due, to_due, note, actor_id, created_at").eq("organization_id", orgId).eq("follow_up_id", id).order("id", { ascending: false }).limit(200),
  ]);
  const names = nameMap(members);
  const st = f.status as FollowUpStatus;
  const today = todayIn(new Date());
  const late = isOverdue(st, f.due_on as string, today);
  const canWrite = can(ctx.org.role, "data:write");
  const cust = Array.isArray(f.customers) ? f.customers[0] : f.customers;
  const help = FOLLOW_UP_STATUSES.find((s) => s.key === st)?.help;
  const describe = (e: { event: string; from_status: string | null; to_status: string | null; from_due: string | null; to_due: string | null }) =>
    e.event === "created" ? `Creato (${FOLLOW_UP_LABEL[e.to_status as FollowUpStatus]}, per il ${fmtDay(e.to_due!)})`
    : e.event === "status" ? `Stato: ${FOLLOW_UP_LABEL[e.from_status as FollowUpStatus]} → ${FOLLOW_UP_LABEL[e.to_status as FollowUpStatus]}`
    : e.event === "rescheduled" ? `Riprogrammato: dal ${fmtDay(e.from_due!)} al ${fmtDay(e.to_due!)}` : "Dati modificati";
  return (
    <>
      <PageHeader title={f.title as string} description={f.reason ? (f.reason as string) : undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/clienti/${f.customer_id}`} className={buttonVariants({ variant: "outline" })}>Scheda cliente</Link>
            {can(ctx.org.role, "data:delete") && <RemoveButton variant="danger" size="default" label="Elimina" action={deleteFollowUpAction.bind(null, id)} confirmMessage="Eliminare il follow-up? Non comparirà più negli elenchi (resta traccia nel registro delle operazioni)." />}
          </div>
        } />
      {late && <div className="mb-4"><Alert>Follow-up in ritardo: era previsto per il {fmtDay(f.due_on as string)}.</Alert></div>}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <FollowUpBadge status={st} overdue={late} />
        <Badge>Prevista il {fmtDay(f.due_on as string)}</Badge>
        <Badge>Priorità {PRIORITY_LABEL[f.priority as keyof typeof PRIORITY_LABEL].toLowerCase()}</Badge>
        {f.assignee_id && <Badge>Responsabile: {names.get(f.assignee_id as string) ?? "—"}</Badge>}
        {(cust as { archived_at?: string | null } | null)?.archived_at && <Badge>Cliente archiviato</Badge>}
        {f.quote_id && <Link className="text-primary underline" href={`/preventivi/${f.quote_id}`}>Preventivo collegato</Link>}
        {f.source_task_id && <Link className="text-primary underline" href={`/attivita/${f.source_task_id}`}>Da attività</Link>}
      </div>
      {help && <p className="mb-4 text-sm text-muted">{help}</p>}
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          {canWrite && (
            <Card>
              <h2 className="mb-3 font-medium">Stato</h2>
              <StatusPanel id={id} status={st} />
              {isOpen(st) && <div className="mt-5 border-t border-border pt-4"><h3 className="mb-2 text-sm font-medium">Riprogramma</h3><ReschedulePanel id={id} dueOn={f.due_on as string} /></div>}
            </Card>
          )}
          <Card>
            <h2 className="mb-3 font-medium">Dettagli</h2>
            <FollowUpForm mode="edit" action={updateFollowUpAction.bind(null, id)} readOnly={!canWrite}
              defaults={{ customerId: f.customer_id as string, contactId: f.contact_id as string | null, quoteId: f.quote_id as string | null, title: f.title as string, description: f.description as string | null,
                reason: f.reason as string | null, assigneeId: f.assignee_id as string | null, priority: f.priority as string, notes: f.notes as string | null }}
              customers={customers.map((c) => ({ id: c.id, name: c.name }))} quotes={(quotes ?? []) as { id: string; number: string; title: string | null; customer_id: string }[]} members={members} />
          </Card>
        </div>
        <Card className="h-fit" data-testid="follow-up-history">
          <h2 className="mb-3 font-medium">Cronologia</h2>
          <ol className="space-y-3 text-sm">
            {(events ?? []).map((e) => (
              <li key={e.id as number}>
                <p>{describe(e as never)}</p>
                {e.note ? <p className="text-xs italic text-muted">«{e.note as string}»</p> : null}
                <p className="text-xs text-muted">{fmtDateTime(e.created_at as string)}{e.actor_id ? ` · ${names.get(e.actor_id as string) ?? ""}` : ""}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
