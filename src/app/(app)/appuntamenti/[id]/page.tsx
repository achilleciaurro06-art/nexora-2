import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listCustomerOptions } from "@/modules/clienti/repository";
import { listMembers, nameMap } from "@/modules/organizzazioni/queries";
import { getReminderOffset } from "@/modules/agenda/reminders";
import { deleteAppointmentAction, setAppointmentStatusAction, updateAppointmentAction } from "@/modules/appuntamenti/actions";
import { AppointmentForm } from "@/modules/appuntamenti/ui/appointment-form";
import { APPOINTMENT_STATUS_LABEL } from "@/modules/agenda/types";
import { Alert, Badge, Card, PageHeader } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { RemoveButton } from "@/components/ui/remove-button";
import { fmtDateTime, fmtTime, utcToZonedParts } from "@/lib/datetime";
import { isUuid } from "@/lib/ids";

export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data: a } = await db.from("appointments").select("*, customers(name, archived_at)").eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!a) notFound();
  const [customers, members, offset, { data: parts }, { data: events }] = await Promise.all([
    listCustomerOptions(db, orgId, a.customer_id as string | null), listMembers(db, orgId), getReminderOffset(db, orgId, { appointmentId: id }),
    db.from("appointment_participants").select("user_id").eq("organization_id", orgId).eq("appointment_id", id),
    db.from("activity_events").select("id, summary, created_at, actor_id").eq("organization_id", orgId).eq("entity", "appointment").eq("entity_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  const names = nameMap(members);
  const s = utcToZonedParts(a.starts_at as string), e = utcToZonedParts(a.ends_at as string);
  const cust = Array.isArray(a.customers) ? a.customers[0] : a.customers;
  const canWrite = can(ctx.org.role, "data:write");
  const status = a.status as keyof typeof APPOINTMENT_STATUS_LABEL;
  const toClose = status === "scheduled" && new Date(a.ends_at as string) < new Date();
  const btn = (label: string, to: string, variant: "default" | "outline" | "danger" = "outline") => (
    <form action={setAppointmentStatusAction.bind(null, id)}><input type="hidden" name="status" value={to} /><Button variant={variant}>{label}</Button></form>
  );
  return (
    <>
      <PageHeader title={a.title as string} description={`${fmtDateTime(a.starts_at as string)} – ${fmtTime(a.ends_at as string)}${a.location ? ` · ${a.location as string}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {a.customer_id && <Link href={`/clienti/${a.customer_id}`} className={buttonVariants({ variant: "outline" })}>Scheda cliente</Link>}
            {canWrite && status === "scheduled" && btn("Segna completato", "completed", "default")}
            {canWrite && status === "scheduled" && btn("Annulla appuntamento", "cancelled", "danger")}
            {canWrite && status !== "scheduled" && btn("Riapri", "scheduled")}
            {can(ctx.org.role, "data:delete") && <RemoveButton variant="danger" size="default" label="Elimina" action={deleteAppointmentAction.bind(null, id)} confirmMessage="Eliminare l'appuntamento? Non comparirà più negli elenchi (resta traccia nel registro delle operazioni)." />}
          </div>
        } />
      {toClose && <div className="mb-4"><Alert>L&apos;appuntamento è passato e non è ancora stato chiuso: segnalo come completato o annullalo.</Alert></div>}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge data-testid="appointment-status">{APPOINTMENT_STATUS_LABEL[status]}</Badge>
        {a.assignee_id && <Badge>Responsabile: {names.get(a.assignee_id as string) ?? "—"}</Badge>}
        {(cust as { archived_at?: string | null } | null)?.archived_at && <Badge>Cliente archiviato</Badge>}
      </div>
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <AppointmentForm mode="edit" action={updateAppointmentAction.bind(null, id)} readOnly={!canWrite || status === "cancelled"} customers={customers.map((c) => ({ id: c.id, name: c.name }))} members={members}
            defaults={{ title: a.title as string, description: a.description as string | null, customerId: a.customer_id as string | null, contactId: a.contact_id as string | null, date: s.date, startTime: s.time, endTime: e.time,
              location: a.location as string | null, assigneeId: a.assignee_id as string | null, notes: a.notes as string | null, reminder: offset === null ? "" : String(offset), participants: (parts ?? []).map((p) => p.user_id as string) }} />
        </Card>
        <Card className="h-fit">
          <h2 className="mb-3 font-medium">Storico</h2>
          {(events ?? []).length === 0 ? <p className="text-sm text-muted">Nessun evento.</p> : (
            <ul className="space-y-2 text-sm">{(events ?? []).map((ev) => <li key={ev.id as number}><p>{ev.summary as string}</p><p className="text-xs text-muted">{fmtDateTime(ev.created_at as string)}{ev.actor_id ? ` · ${names.get(ev.actor_id as string) ?? ""}` : ""}</p></li>)}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
