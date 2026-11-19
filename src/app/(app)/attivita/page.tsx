import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listCustomers } from "@/modules/clienti/repository";
import { listMembers, nameMap } from "@/modules/organizzazioni/queries";
import { setTaskStatusAction } from "@/modules/attivita/actions";
import { bucketTasks } from "@/modules/attivita/buckets";
import { PRIORITY_LABEL } from "@/modules/attivita/schemas";
import { TaskForm } from "@/modules/attivita/ui/task-form";
import { Badge, Card, PageHeader, Table } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Attività" };

type Row = {
  id: string; title: string; status: string; priority: keyof typeof PRIORITY_LABEL; due_at: string | null;
  assignee_id: string | null; customer_id: string | null; quote_id: string | null;
  customers: { name: string } | { name: string }[] | null; quotes: { number: string } | { number: string }[] | null;
};
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const { mine } = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;

  let q = db.from("tasks")
    .select("id, title, status, priority, due_at, assignee_id, customer_id, quote_id, customers(name), quotes(number)")
    .eq("organization_id", orgId).is("deleted_at", null).order("due_at", { nullsFirst: false }).limit(500);
  if (mine === "1") q = q.eq("assignee_id", ctx.userId);
  const [{ data }, customers, members, { data: feed }] = await Promise.all([
    q, listCustomers(db, orgId), listMembers(db, orgId),
    db.from("activity_events").select("id, summary, created_at, entity, entity_id, customer_id").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(12),
  ]);
  const names = nameMap(members);
  const rows = (data ?? []) as unknown as Row[];
  const b = bucketTasks(rows, new Date());
  b.done = b.done.slice(0, 30);
  const canWrite = can(ctx.org.role, "data:write");

  const section = (title: string, tasks: Row[], tone: "danger" | "default", empty: string) => (
    <section aria-label={title} className="mt-6">
      <h2 className={`mb-2 font-medium ${tone === "danger" && tasks.length ? "text-danger" : ""}`}>{title} <span className="text-sm font-normal text-muted">({tasks.length})</span></h2>
      <Table>
        <thead><tr><th>Attività</th><th>Cliente / Preventivo</th><th>Assegnata a</th><th>Scadenza</th><th>Priorità</th><th /></tr></thead>
        <tbody>
          {tasks.length === 0 && <tr><td colSpan={6} className="text-muted">{empty}</td></tr>}
          {tasks.map((t) => {
            const c = one(t.customers), qt = one(t.quotes);
            const done = t.status === "done" || t.status === "cancelled";
            return (
              <tr key={t.id}>
                <td className={done ? "text-muted line-through" : "font-medium"}><Link className="hover:underline" href={`/attivita/${t.id}`}>{t.title}</Link></td>
                <td className="text-sm">
                  {c ? <Link className="text-primary hover:underline" href={`/clienti/${t.customer_id}`}>{c.name}</Link> : "—"}
                  {qt && <> · <Link className="text-primary hover:underline" href={`/preventivi/${t.quote_id}`}>{qt.number}</Link></>}
                </td>
                <td>{t.assignee_id ? (names.get(t.assignee_id) ?? "—") : "—"}</td>
                <td className={tone === "danger" ? "text-danger" : ""}>{t.due_at ? new Date(t.due_at).toLocaleDateString("it-IT") : "—"}</td>
                <td><Badge>{PRIORITY_LABEL[t.priority]}</Badge></td>
                <td className="text-right">
                  {canWrite && (
                    <form action={setTaskStatusAction.bind(null, t.id)}>
                      <input type="hidden" name="status" value={t.status === "done" ? "todo" : "done"} />
                      <Button size="sm" variant="outline">{t.status === "done" ? "Riapri" : t.status === "cancelled" ? "Riapri" : "Fatto"}</Button>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </section>
  );

  return (
    <>
      <PageHeader title="Attività" description="Scadute, imminenti (7 giorni), altre aperte e completate."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={mine === "1" ? "/attivita" : "/attivita?mine=1"} className={buttonVariants({ variant: mine === "1" ? "default" : "outline" })}>Solo le mie</Link>
            {canWrite && <Link href="/attivita/nuova" className={buttonVariants()}>Nuova attività</Link>}
          </div>
        } />
      {canWrite && <Card className="mb-2"><TaskForm customers={customers.map((c) => ({ id: c.id, name: c.name }))} /></Card>}
      {section("Scadute", b.overdue, "danger", "Nessuna attività scaduta.")}
      {section("Imminenti", b.soon, "default", "Nessuna attività in scadenza nei prossimi 7 giorni.")}
      {section("Altre aperte", b.later, "default", "Nessuna altra attività aperta.")}
      {section("Completate (ultime 30)", b.done, "default", "Nessuna attività completata.")}

      <h2 className="mb-2 mt-8 font-medium">Cronologia recente</h2>
      <Card>
        {(feed ?? []).length === 0 ? <p className="text-sm text-muted">Ancora nessuna attività registrata.</p> : (
          <ul className="space-y-2 text-sm">
            {(feed ?? []).map((f) => {
              const href = f.entity === "quote" ? `/preventivi/${f.entity_id}` : f.entity === "task" ? `/attivita/${f.entity_id}` : f.customer_id ? `/clienti/${f.customer_id}` : undefined;
              return (
                <li key={f.id as number} className="flex justify-between gap-3">
                  {href ? <Link className="truncate text-primary hover:underline" href={href}>{f.summary as string}</Link> : <span className="truncate">{f.summary as string}</span>}
                  <span className="shrink-0 text-muted">{new Date(f.created_at as string).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
