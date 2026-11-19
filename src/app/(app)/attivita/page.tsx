import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listCustomers } from "@/modules/clienti/repository";
import { setTaskStatusAction, deleteTaskAction } from "@/modules/attivita/actions";
import { TaskForm } from "@/modules/attivita/ui/task-form";
import { Badge, Card, PageHeader, Table } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Attività" };
const PRIORITY = { low: "Bassa", normal: "Normale", high: "Alta", urgent: "Urgente" } as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const { done } = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const statuses = done === "1" ? ["done", "cancelled"] : ["todo", "in_progress"];
  const [{ data: tasks }, customers] = await Promise.all([
    db.from("tasks").select("id, title, status, priority, due_at, customers(name)").eq("organization_id", orgId).is("deleted_at", null).in("status", statuses).order("due_at", { nullsFirst: false }).limit(200),
    listCustomers(db, orgId),
  ]);
  const canWrite = can(ctx.org.role, "data:write");
  const now = new Date();
  return (
    <>
      <PageHeader title="Attività" actions={<a className="text-sm text-primary underline" href={done === "1" ? "/attivita" : "/attivita?done=1"}>{done === "1" ? "Mostra aperte" : "Mostra completate"}</a>} />
      {canWrite && <Card className="mb-4"><TaskForm customers={customers.map((c) => ({ id: c.id, name: c.name }))} /></Card>}
      <Table>
        <thead><tr><th>Attività</th><th>Cliente</th><th>Scadenza</th><th>Priorità</th><th /></tr></thead>
        <tbody>
          {(tasks ?? []).length === 0 && <tr><td colSpan={5} className="text-muted">Nessuna attività.</td></tr>}
          {(tasks ?? []).map((t) => {
            const c = Array.isArray(t.customers) ? t.customers[0] : t.customers;
            const overdue = t.due_at && new Date(t.due_at as string) < now && t.status !== "done";
            return (
              <tr key={t.id as string}>
                <td className={t.status === "done" ? "line-through text-muted" : "font-medium"}>{t.title as string}</td>
                <td>{(c as { name: string } | null)?.name ?? "—"}</td>
                <td className={overdue ? "text-danger" : ""}>{t.due_at ? new Date(t.due_at as string).toLocaleDateString("it-IT") : "—"}</td>
                <td><Badge>{PRIORITY[t.priority as keyof typeof PRIORITY]}</Badge></td>
                <td className="flex justify-end gap-2">
                  {canWrite && (
                    <form action={setTaskStatusAction.bind(null, t.id as string)}>
                      <input type="hidden" name="status" value={t.status === "done" ? "todo" : "done"} />
                      <Button size="sm" variant="outline">{t.status === "done" ? "Riapri" : "Fatto"}</Button>
                    </form>
                  )}
                  {can(ctx.org.role, "data:delete") && <form action={deleteTaskAction.bind(null, t.id as string)}><Button size="sm" variant="ghost">Elimina</Button></form>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
