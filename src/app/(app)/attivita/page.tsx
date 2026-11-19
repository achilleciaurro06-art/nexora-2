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

  const [{ data: rc }, { data: rq }, { data: rt }] = await Promise.all([
    db.from("customers").select("id, name, created_at").eq("organization_id", orgId).is("deleted_at", null).order("created_at", { ascending: false }).limit(8),
    db.from("quotes").select("id, number, title, status, created_at").eq("organization_id", orgId).is("deleted_at", null).order("created_at", { ascending: false }).limit(8),
    db.from("tasks").select("id, title, status, created_at").eq("organization_id", orgId).is("deleted_at", null).order("created_at", { ascending: false }).limit(8),
  ]);
  const feed = [
    ...(rc ?? []).map((c) => ({ key: `c${c.id}`, at: c.created_at as string, text: `Nuovo cliente: ${c.name}`, href: `/clienti/${c.id}` })),
    ...(rq ?? []).map((q) => ({ key: `q${q.id}`, at: q.created_at as string, text: `Preventivo ${q.number}${q.title ? ` · ${q.title}` : ""}`, href: `/preventivi/${q.id}` })),
    ...(rt ?? []).map((t) => ({ key: `t${t.id}`, at: t.created_at as string, text: `Attività: ${t.title}`, href: undefined as string | undefined })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
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

      <h2 className="mb-2 mt-8 font-medium">Cronologia recente</h2>
      <Card>
        {feed.length === 0 ? <p className="text-sm text-muted">Ancora nessuna attività registrata.</p> : (
          <ul className="space-y-2 text-sm">
            {feed.map((f) => (
              <li key={f.key} className="flex justify-between gap-3">
                {f.href ? <a className="truncate text-primary hover:underline" href={f.href}>{f.text}</a> : <span className="truncate">{f.text}</span>}
                <span className="shrink-0 text-muted">{new Date(f.at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
