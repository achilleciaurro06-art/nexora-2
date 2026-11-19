import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { Card, PageHeader } from "@/components/ui/card";
import { formatEur } from "@/lib/money";
import { QUOTE_STATUS_LABEL, type QuoteStatus } from "@/types/domain";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86_400_000).toISOString();

  const today = now.toISOString().slice(0, 10);
  const in7d = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const [customers, quotes, openTasks, reminders, followUps] = await Promise.all([
    db.from("customers").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null),
    db.from("quotes").select("status, total_cents, issue_date").eq("organization_id", orgId).is("deleted_at", null),
    db.from("tasks").select("id, title, due_at, priority").eq("organization_id", orgId).is("deleted_at", null).in("status", ["todo", "in_progress"]).order("due_at", { nullsFirst: false }).limit(200),
    db.from("reminders").select("id, remind_at, tasks(title)").eq("organization_id", orgId).eq("status", "pending").lte("remind_at", in7).order("remind_at").limit(5),
    db.from("quotes").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null).in("status", ["draft", "sent"]).not("follow_up_date", "is", null).lte("follow_up_date", in7d),
  ]);
  void today;

  const q = (quotes.data ?? []) as { status: QuoteStatus; total_cents: number; issue_date: string }[];
  const sum = (s: QuoteStatus) => q.filter((x) => x.status === s).reduce((n, x) => n + Number(x.total_cents), 0);
  const count = (s: QuoteStatus) => q.filter((x) => x.status === s).length;
  const year = now.getFullYear();
  const acceptedYear = q.filter((x) => x.status === "accepted" && new Date(x.issue_date).getFullYear() === year).reduce((n, x) => n + Number(x.total_cents), 0);
  const decided = count("accepted") + count("rejected");
  const rate = decided ? Math.round((count("accepted") / decided) * 100) : null;
  const tasks = openTasks.data ?? [];
  const overdue = tasks.filter((t) => t.due_at && new Date(t.due_at as string) < now);
  const statuses: QuoteStatus[] = ["draft", "sent", "accepted", "rejected", "expired"];
  const maxCount = Math.max(1, ...statuses.map(count));

  const kpis = [
    { label: "Clienti", value: String(customers.count ?? 0), href: "/clienti" },
    { label: "Preventivi in attesa", value: formatEur(sum("sent")), sub: `${count("sent")} inviati`, href: "/preventivi?status=sent" },
    { label: `Accettati ${year}`, value: formatEur(acceptedYear), href: "/preventivi?status=accepted" },
    { label: "Tasso di accettazione", value: rate === null ? "—" : `${rate}%`, sub: decided ? `${decided} decisi` : "nessun dato" },
    { label: "Follow-up in scadenza", value: String(followUps.count ?? 0), sub: "entro 7 giorni", href: "/promemoria" },
    { label: "Attività aperte", value: String(tasks.length), sub: `${overdue.length} in ritardo`, href: "/attivita" },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description={`Panoramica di ${ctx.org.name}`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((k) => {
          const body = (
            <Card className="h-full">
              <p className="text-sm text-muted">{k.label}</p>
              <p className="mt-1 text-2xl font-semibold">{k.value}</p>
              {k.sub && <p className="mt-1 text-xs text-muted">{k.sub}</p>}
            </Card>
          );
          return k.href ? <Link key={k.label} href={k.href}>{body}</Link> : <div key={k.label}>{body}</div>;
        })}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-medium">Preventivi per stato</h2>
          <ul className="space-y-2" aria-label="Preventivi per stato">
            {statuses.map((s) => (
              <li key={s} className="grid grid-cols-[90px_1fr_auto] items-center gap-3 text-sm">
                <span>{QUOTE_STATUS_LABEL[s]}</span>
                <span className="h-2 rounded-full bg-border"><span className="block h-2 rounded-full bg-primary" style={{ width: `${(count(s) / maxCount) * 100}%` }} /></span>
                <span className="text-muted">{count(s)} · {formatEur(sum(s))}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 font-medium">Da fare</h2>
          {tasks.length === 0 ? <p className="text-sm text-muted">Nessuna attività aperta.</p> : (
            <ul className="space-y-2 text-sm">
              {tasks.slice(0, 6).map((t) => (
                <li key={t.id as string} className="flex justify-between gap-3">
                  <span className="truncate">{t.title as string}</span>
                  <span className={t.due_at && new Date(t.due_at as string) < now ? "text-danger" : "text-muted"}>{t.due_at ? new Date(t.due_at as string).toLocaleDateString("it-IT") : "—"}</span>
                </li>
              ))}
            </ul>
          )}
          {(reminders.data ?? []).length > 0 && (
            <>
              <h3 className="mb-2 mt-4 text-sm font-medium">Promemoria (7 giorni)</h3>
              <ul className="space-y-1 text-sm text-muted">
                {(reminders.data ?? []).map((r) => {
                  const t = Array.isArray(r.tasks) ? r.tasks[0] : r.tasks;
                  return <li key={r.id as string}>{new Date(r.remind_at as string).toLocaleDateString("it-IT")} · {(t as { title: string } | null)?.title}</li>;
                })}
              </ul>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
