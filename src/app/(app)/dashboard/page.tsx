import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { Card, PageHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { formatEur } from "@/lib/money";
import { isoDayOffset } from "@/lib/dates";
import { QUOTE_STATUS_LABEL, type QuoteStatus } from "@/types/domain";
import { RANGES, countByMonth, monthBuckets, parseRange, periodSummary, quotesByMonth, rangeStart } from "@/modules/dashboard/metrics";
import { TrendChart } from "@/modules/dashboard/trend-chart";
import { parseUserPrefs } from "@/modules/impostazioni/settings";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const { data: prof } = await db.from("profiles").select("preferences").eq("id", ctx.userId).maybeSingle();
  const range = parseRange(sp.range ?? parseUserPrefs(prof?.preferences).appearance.dashboard_range);
  const orgId = ctx.org.organizationId;
  const now = new Date();
  const start = rangeStart(range.days, now);
  const startIso = start.toISOString();
  const startDay = startIso.slice(0, 10);
  const in7 = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const in7d = isoDayOffset(7);

  const [customers, quotes, openTasks, reminders, followUpsCount, followUpList, customerDates, doneTasks, recontact, events, billings] = await Promise.all([
    db.from("customers").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null),
    db.from("quotes").select("status, total_cents, issue_date").eq("organization_id", orgId).is("deleted_at", null).limit(5000),
    db.from("tasks").select("id, title, due_at, priority").eq("organization_id", orgId).is("deleted_at", null).in("status", ["todo", "in_progress"]).order("due_at", { nullsFirst: false }).limit(200),
    db.from("reminders").select("id, remind_at, tasks(title)").eq("organization_id", orgId).eq("status", "pending").lte("remind_at", in7).order("remind_at").limit(5),
    db.from("quotes").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null).in("status", ["draft", "sent"]).not("follow_up_date", "is", null).lte("follow_up_date", in7d),
    db.from("quotes").select("id, number, follow_up_date, customers(name)").eq("organization_id", orgId).is("deleted_at", null).in("status", ["draft", "sent"]).not("follow_up_date", "is", null).lte("follow_up_date", in7d).order("follow_up_date").limit(5),
    db.from("customers").select("created_at").eq("organization_id", orgId).is("deleted_at", null).gte("created_at", startIso).limit(5000),
    db.from("tasks").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null).eq("status", "done").gte("completed_at", startIso),
    db.rpc("customers_to_recontact", { p_org: orgId, p_days: 60, p_limit: 5 }),
    db.from("activity_events").select("id, summary, created_at, entity, entity_id, customer_id").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(8),
    db.from("quote_billings").select("amount_cents").eq("organization_id", orgId).gte("billed_at", startDay).limit(5000),
  ]);

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

  // periodo selezionato
  const inRange = q.filter((x) => x.issue_date >= startDay);
  const ps = periodSummary(inRange);
  const buckets = monthBuckets(start, now);
  const trend = quotesByMonth(inRange, buckets);
  const acquired = countByMonth((customerDates.data ?? []).map((c) => c.created_at as string), buckets);
  const acquiredTotal = acquired.reduce((n, r) => n + r.count, 0);

  const kpis = [
    { label: "Clienti", value: String(customers.count ?? 0), href: "/clienti" },
    { label: "Preventivi in attesa", value: formatEur(sum("sent")), sub: `${count("sent")} inviati`, href: "/preventivi?status=sent" },
    { label: `Accettati ${year}`, value: formatEur(acceptedYear), href: "/preventivi?status=accepted" },
    { label: "Tasso di accettazione", value: rate === null ? "—" : `${rate}%`, sub: decided ? `${decided} decisi` : "nessun dato" },
    { label: "Follow-up in scadenza", value: String(followUpsCount.count ?? 0), sub: "entro 7 giorni", href: "/promemoria" },
    { label: "Attività aperte", value: String(tasks.length), sub: `${overdue.length} in ritardo`, href: "/attivita" },
  ];
  const period = [
    { label: "Preventivi emessi", value: String(ps.count), sub: formatEur(ps.totalCents) },
    { label: "Accettati", value: formatEur(ps.acceptedCents), sub: `${ps.byStatus.accepted ?? 0} preventivi` },
    { label: "Fatturato registrato", value: formatEur((billings.data ?? []).reduce((n, b) => n + Number(b.amount_cents), 0)), sub: "importi realmente fatturati" },
    { label: "Rifiutati / scaduti", value: String((ps.byStatus.rejected ?? 0) + (ps.byStatus.expired ?? 0)), sub: `${ps.byStatus.rejected ?? 0} rifiutati` },
    { label: "In attesa", value: String((ps.byStatus.sent ?? 0) + (ps.byStatus.draft ?? 0)), sub: `${ps.byStatus.sent ?? 0} inviati · ${ps.byStatus.draft ?? 0} bozze` },
    { label: "Conversione", value: ps.conversionPct === null ? "—" : `${ps.conversionPct}%`, sub: ps.decided ? `su ${ps.decided} decisi` : "nessun preventivo deciso" },
    { label: "Nuovi clienti", value: String(acquiredTotal), sub: "nel periodo" },
    { label: "Attività completate", value: String(doneTasks.count ?? 0), sub: `${tasks.length} ancora aperte` },
  ];
  const recontactRows = (recontact.data ?? []) as { customer_id: string; name: string; last_activity: string; open_quotes: number }[];

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

      <section aria-label="Andamento nel periodo" className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Andamento commerciale</h2>
          <nav className="flex flex-wrap gap-2" aria-label="Periodo">
            {RANGES.map((r) => (
              <Link key={r.key} href={`/dashboard?range=${r.key}`} aria-current={r.key === range.key ? "true" : undefined}
                className={buttonVariants({ variant: r.key === range.key ? "default" : "outline", size: "sm" })}>{r.label}</Link>
            ))}
          </nav>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {period.map((k) => (
            <Card key={k.label} className="p-4"><p className="text-sm text-muted">{k.label}</p><p className="mt-1 text-xl font-semibold">{k.value}</p>{k.sub && <p className="mt-0.5 text-xs text-muted">{k.sub}</p>}</Card>
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card><TrendChart rows={trend} mode="value" caption="Valore dei preventivi per mese" /></Card>
          <Card><TrendChart rows={acquired} mode="count" caption="Nuovi clienti per mese" /></Card>
        </div>
      </section>

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
                  <Link className="truncate hover:underline" href={`/attivita/${t.id}`}>{t.title as string}</Link>
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
        <Card>
          <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">Follow-up imminenti</h2><Link className="text-sm text-primary hover:underline" href="/promemoria">Tutti</Link></div>
          {(followUpList.data ?? []).length === 0 ? <p className="text-sm text-muted">Nessun follow-up in scadenza nei prossimi 7 giorni.</p> : (
            <ul className="space-y-2 text-sm">
              {(followUpList.data ?? []).map((f) => {
                const c = Array.isArray(f.customers) ? f.customers[0] : f.customers;
                const late = (f.follow_up_date as string) < isoDayOffset(0);
                return (
                  <li key={f.id as string} className="flex justify-between gap-3">
                    <Link className="truncate hover:underline" href={`/preventivi/${f.id}`}>{f.number as string}{c ? ` · ${(c as { name: string }).name}` : ""}</Link>
                    <span className={late ? "text-danger" : "text-muted"}>{new Date(f.follow_up_date as string).toLocaleDateString("it-IT")}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-1 font-medium">Clienti da ricontattare</h2>
          <p className="mb-3 text-xs text-muted">Nessuna interazione registrata da oltre 60 giorni.</p>
          {recontactRows.length === 0 ? <p className="text-sm text-muted">Nessun cliente da ricontattare.</p> : (
            <ul className="space-y-2 text-sm">
              {recontactRows.map((c) => (
                <li key={c.customer_id} className="flex justify-between gap-3">
                  <Link className="truncate text-primary hover:underline" href={`/clienti/${c.customer_id}`}>{c.name}</Link>
                  <span className="shrink-0 text-muted">{Math.floor((now.getTime() - new Date(c.last_activity).getTime()) / 86_400_000)} gg{Number(c.open_quotes) > 0 ? ` · ${c.open_quotes} aperti` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-medium">Ultime operazioni</h2>
          {(events.data ?? []).length === 0 ? <p className="text-sm text-muted">Nessuna operazione registrata.</p> : (
            <ul className="space-y-2 text-sm">
              {(events.data ?? []).map((e) => {
                const href = e.entity === "quote" ? `/preventivi/${e.entity_id}` : e.entity === "task" ? `/attivita/${e.entity_id}` : e.customer_id ? `/clienti/${e.customer_id}` : undefined;
                return (
                  <li key={e.id as number} className="flex justify-between gap-3">
                    {href ? <Link className="truncate hover:underline" href={href}>{e.summary as string}</Link> : <span className="truncate">{e.summary as string}</span>}
                    <span className="shrink-0 text-muted">{new Date(e.created_at as string).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
