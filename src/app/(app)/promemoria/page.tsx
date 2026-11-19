import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { Card, PageHeader, Table } from "@/components/ui/card";
import { formatEur } from "@/lib/money";
import { isoDayOffset, isoOffset } from "@/lib/dates";
import { StatusBadge } from "@/components/ui/status-badge";
import type { QuoteStatus } from "@/types/domain";

export const metadata = { title: "Promemoria" };

export default async function RemindersPage() {
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const today = new Date().toISOString().slice(0, 10);
  const in14 = isoDayOffset(14);
  const in14Ts = isoOffset(14);

  const [{ data: followUps }, { data: reminders }, { data: dueTasks }] = await Promise.all([
    db.from("quotes").select("id, number, title, status, total_cents, follow_up_date, customers(name)")
      .eq("organization_id", orgId).is("deleted_at", null).in("status", ["draft", "sent"])
      .not("follow_up_date", "is", null).lte("follow_up_date", in14).order("follow_up_date"),
    db.from("reminders").select("id, remind_at, tasks(title)").eq("organization_id", orgId).eq("status", "pending")
      .lte("remind_at", in14Ts).order("remind_at"),
    db.from("tasks").select("id, title, due_at, priority").eq("organization_id", orgId).is("deleted_at", null)
      .in("status", ["todo", "in_progress"]).not("due_at", "is", null).lte("due_at", in14Ts).order("due_at"),
  ]);

  return (
    <>
      <PageHeader title="Promemoria" description="Follow-up sui preventivi, attività in scadenza e promemoria dei prossimi 14 giorni." />
      <h2 className="mb-2 font-medium">Follow-up preventivi</h2>
      <Table>
        <thead><tr><th>Quando</th><th>Preventivo</th><th>Cliente</th><th>Stato</th><th className="text-right">Totale</th></tr></thead>
        <tbody>
          {(followUps ?? []).length === 0 && <tr><td colSpan={5} className="text-muted">Nessun follow-up in scadenza. Imposta una data nel preventivo.</td></tr>}
          {(followUps ?? []).map((q) => {
            const c = Array.isArray(q.customers) ? q.customers[0] : q.customers;
            const date = q.follow_up_date as string;
            return (
              <tr key={q.id as string}>
                <td className={date < today ? "font-medium text-danger" : date === today ? "font-medium text-primary" : ""}>
                  {new Date(date).toLocaleDateString("it-IT")} {date < today ? "(scaduto)" : date === today ? "(oggi)" : ""}
                </td>
                <td><Link className="text-primary hover:underline" href={`/preventivi/${q.id}`}>{q.number as string}{q.title ? ` · ${q.title}` : ""}</Link></td>
                <td>{(c as { name: string } | null)?.name ?? "—"}</td>
                <td><StatusBadge status={q.status as QuoteStatus} /></td>
                <td className="text-right">{formatEur(q.total_cents as number)}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-medium">Attività in scadenza</h2>
          {(dueTasks ?? []).length === 0 ? <p className="text-sm text-muted">Nessuna attività in scadenza.</p> : (
            <ul className="space-y-1 text-sm">
              {(dueTasks ?? []).map((t) => (
                <li key={t.id as string} className="flex justify-between gap-3">
                  <span className="truncate">{t.title as string}</span>
                  <span className={new Date(t.due_at as string) < new Date() ? "text-danger" : "text-muted"}>{new Date(t.due_at as string).toLocaleDateString("it-IT")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-2 font-medium">Promemoria programmati</h2>
          {(reminders ?? []).length === 0 ? <p className="text-sm text-muted">Nessun promemoria.</p> : (
            <ul className="space-y-1 text-sm">
              {(reminders ?? []).map((r) => {
                const t = Array.isArray(r.tasks) ? r.tasks[0] : r.tasks;
                return <li key={r.id as string} className="flex justify-between gap-3"><span className="truncate">{(t as { title: string } | null)?.title}</span><span className="text-muted">{new Date(r.remind_at as string).toLocaleDateString("it-IT")}</span></li>;
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
