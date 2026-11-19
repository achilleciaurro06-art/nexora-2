import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { isUuid } from "@/lib/ids";
import { listCustomers } from "@/modules/clienti/repository";
import { listMembers, nameMap } from "@/modules/organizzazioni/queries";
import { deleteTaskAction, setTaskStatusAction, updateTaskAction } from "@/modules/attivita/actions";
import { TaskEditor } from "@/modules/attivita/ui/task-editor";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/modules/attivita/schemas";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Attività" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data: task } = await db.from("tasks")
    .select("id, title, description, status, priority, due_at, assignee_id, assigned_by, customer_id, quote_id, created_by, created_at, completed_at, customers(name), quotes(number)")
    .eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!task) notFound();

  const [customers, members, { data: quotes }, { data: events }] = await Promise.all([
    listCustomers(db, orgId),
    listMembers(db, orgId),
    db.from("quotes").select("id, number, title, customer_id").eq("organization_id", orgId).is("deleted_at", null).order("created_at", { ascending: false }).limit(300),
    db.from("activity_events").select("id, summary, created_at, actor_id").eq("organization_id", orgId).eq("entity", "task").eq("entity_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  const names = nameMap(members);
  const canWrite = can(ctx.org.role, "data:write");
  const customer = Array.isArray(task.customers) ? task.customers[0] : task.customers;
  const quote = Array.isArray(task.quotes) ? task.quotes[0] : task.quotes;
  const open = task.status === "todo" || task.status === "in_progress";
  const overdue = open && task.due_at && new Date(task.due_at as string) < new Date();

  return (
    <>
      <PageHeader
        title={task.title as string}
        description={`Creata il ${new Date(task.created_at as string).toLocaleDateString("it-IT")}${task.created_by ? ` da ${names.get(task.created_by as string) ?? "—"}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canWrite && (
              <form action={setTaskStatusAction.bind(null, id)}>
                <input type="hidden" name="status" value={task.status === "done" ? "todo" : "done"} />
                <Button variant="outline">{task.status === "done" ? "Riapri" : "Segna come completata"}</Button>
              </form>
            )}
            {can(ctx.org.role, "data:delete") && <form action={deleteTaskAction.bind(null, id)}><Button variant="danger">Elimina</Button></form>}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge>{STATUS_LABEL[task.status as keyof typeof STATUS_LABEL]}</Badge>
        <Badge>Priorità {PRIORITY_LABEL[task.priority as keyof typeof PRIORITY_LABEL].toLowerCase()}</Badge>
        {task.due_at && <Badge className={overdue ? "border-danger text-danger" : ""}>{overdue ? "Scaduta il " : "Scade il "}{new Date(task.due_at as string).toLocaleDateString("it-IT")}</Badge>}
        {task.assignee_id && <Badge>Assegnata a {names.get(task.assignee_id as string) ?? "—"}</Badge>}
        {customer && <Link className="text-primary underline" href={`/clienti/${task.customer_id}`}>Cliente: {(customer as { name: string }).name}</Link>}
        {quote && <Link className="text-primary underline" href={`/preventivi/${task.quote_id}`}>Preventivo {(quote as { number: string }).number}</Link>}
      </div>
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <TaskEditor
            mode="edit" action={updateTaskAction.bind(null, id)} readOnly={!canWrite}
            defaults={{
              title: task.title as string, description: task.description as string | null, priority: task.priority as string, status: task.status as string,
              dueDate: task.due_at ? (task.due_at as string).slice(0, 10) : null, assigneeId: task.assignee_id as string | null,
              customerId: task.customer_id as string | null, quoteId: task.quote_id as string | null,
            }}
            customers={customers.map((c) => ({ id: c.id, name: c.name }))}
            quotes={(quotes ?? []) as { id: string; number: string; title: string | null; customer_id: string }[]}
            members={members}
          />
        </Card>
        <Card className="h-fit">
          <h2 className="mb-3 font-medium">Storico</h2>
          {(events ?? []).length === 0 ? <p className="text-sm text-muted">Nessun evento.</p> : (
            <ul className="space-y-2 text-sm">
              {(events ?? []).map((e) => (
                <li key={e.id as number}>
                  <p>{e.summary as string}</p>
                  <p className="text-xs text-muted">{new Date(e.created_at as string).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}{e.actor_id ? ` · ${names.get(e.actor_id as string) ?? ""}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
