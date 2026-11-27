import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { formatEur } from "@/lib/money";
import { isoDayOffset } from "@/lib/dates";
import { QUOTE_STATUS_LABEL, type QuoteStatus } from "@/types/domain";
import { listAgenda } from "@/modules/agenda/queries";
import { agendaCounts, applyFilters, bucketAgenda } from "@/modules/agenda/agenda";
import { addDays, fmtDay, fmtTime, todayIn } from "@/lib/datetime";
import { listMembers, nameMap } from "@/modules/organizzazioni/queries";
import { RANGES, countByMonth, monthBuckets, parseRange, periodSummary, quotesByMonth, rangeStart } from "@/modules/dashboard/metrics";
import { TrendChart } from "@/modules/dashboard/trend-chart";
import { parseUserPrefs } from "@/modules/impostazioni/settings";
import { can } from "@/server/auth/permissions";
import { loadSnapshot } from "@/modules/insights/snapshot";
import { buildSummary } from "@/modules/insights/rules";
import { ensureInsights, listInsights, markSeen } from "@/modules/insights/service";
import { AiSection } from "@/modules/insights/ui/ai-section";
import { DashboardChat } from "@/modules/copilot/ui/dashboard-chat";
import { DigitalTexture } from "@/components/brand/digital-texture";
import { Avatar } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/status-badge";
import { Bell, ChevronRight, FileText, Plus, Target, Upload, Users, Wallet } from "lucide-react";

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
    db.from("customers").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null).is("archived_at", null),
    db.from("quotes").select("status, total_cents, issue_date").eq("organization_id", orgId).is("deleted_at", null).limit(5000),
    db.from("tasks").select("id, title, due_at, priority").eq("organization_id", orgId).is("deleted_at", null).in("status", ["todo", "in_progress"]).order("due_at", { nullsFirst: false }).limit(200),
    db.from("reminders").select("id, remind_at, tasks(title)").eq("organization_id", orgId).eq("status", "pending").lte("remind_at", in7).order("remind_at").limit(5),
    db.from("quotes").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null).in("status", ["draft", "sent"]).not("follow_up_date", "is", null).lte("follow_up_date", in7d),
    db.from("quotes").select("id, number, follow_up_date, customers(name)").eq("organization_id", orgId).is("deleted_at", null).in("status", ["draft", "sent"]).not("follow_up_date", "is", null).lte("follow_up_date", in7d).order("follow_up_date").limit(5),
    db.from("customers").select("created_at").eq("organization_id", orgId).is("deleted_at", null).is("archived_at", null).gte("created_at", startIso).limit(5000),
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
  // lavoro di oggi: dati reali della vista agenda_items (attività, follow-up, appuntamenti, follow-up dei preventivi)
  const [agenda, agendaMembers] = await Promise.all([listAgenda(db, orgId, now), listMembers(db, orgId)]);
  const agendaNames = nameMap(agendaMembers);
  const ac = agendaCounts(agenda, now);
  const ab = bucketAgenda(agenda, now);
  const todayStr = todayIn(now);
  const nextApps = agenda.filter((i) => i.kind === "appointment" && i.is_open && i.when_date && i.when_date >= todayStr && i.when_date <= addDays(todayStr, 7)).sort((a, b) => (a.when_at ?? "").localeCompare(b.when_at ?? "")).slice(0, 5);
  const followUpsDue = agenda.filter((i) => (i.kind === "follow_up") && i.is_open && i.when_date && i.when_date <= todayStr).length;
  const workload = new Map<string, number>();
  for (const i of [...ab.overdue, ...ab.today, ...ab.upcoming]) workload.set(i.assignee_id ?? "none", (workload.get(i.assignee_id ?? "none") ?? 0) + 1);
  const workloadRows = [...workload.entries()].map(([k, n]) => ({ name: k === "none" ? "Non assegnati" : (agendaNames.get(k) ?? "—"), n })).sort((a, b) => b.n - a.n);
  const mineToday = applyFilters(ab.today, { assignee: ctx.userId }).length;
  const recontactRows = (recontact.data ?? []) as { customer_id: string; name: string; last_activity: string; open_quotes: number }[];

  // assistente AI: sintesi e segnalazioni su dati reali (regole, nessun costo AI); rigenerate al massimo ogni 30 minuti
  const snapshot = await loadSnapshot(db, orgId, now).catch(() => null);
  if (snapshot) await ensureInsights(db, orgId, now, undefined, snapshot).catch(() => undefined);
  const insights = await listInsights(db, orgId).catch(() => []);
  const seenBefore = new Set(insights.filter((i) => i.status !== "new").map((i) => i.id));
  await markSeen(orgId, ctx.userId, insights).catch(() => undefined);

  // elenchi di sola lettura per le sezioni «ultimi preventivi» e «clienti recenti» (stessi dati, stessa RLS)
  const [{ data: latestQuotes }, { data: recentCustomers }, { count: unreadCount }] = await Promise.all([
    db.from("quotes").select("id, number, title, status, total_cents, customers(name)").eq("organization_id", orgId).is("deleted_at", null).order("created_at", { ascending: false }).limit(5),
    db.from("customers").select("id, name, email, created_at").eq("organization_id", orgId).is("deleted_at", null).is("archived_at", null).order("created_at", { ascending: false }).limit(5),
    db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId).is("read_at", null),
  ]);
  const issuedCents = q.filter((x) => x.status !== "draft").reduce((n, x) => n + Number(x.total_cents), 0);
  const hour = Number(new Intl.DateTimeFormat("it-IT", { hour: "numeric", hour12: false, timeZone: "Europe/Rome" }).format(now));
  const greeting = hour < 5 ? "Buonanotte" : hour < 13 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera";
  const firstName = (ctx.fullName ?? "").trim().split(/\s+/)[0] || null;
  const canWriteData = can(ctx.org.role, "data:write");
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

  const mainKpis = [
    { label: "Valore dei preventivi", value: formatEur(issuedCents), sub: "emessi (non è fatturato)", href: "/preventivi", icon: Wallet },
    { label: "Preventivi in attesa", value: formatEur(sum("sent")), sub: `${count("sent")} attivi · ${count("draft")} bozze`, href: "/preventivi?status=sent", icon: FileText },
    { label: "Clienti", value: String(customers.count ?? 0), sub: "attivi", href: "/clienti", icon: Users },
    { label: "Tasso di accettazione", value: rate === null ? "—" : `${rate}%`, sub: decided ? `${decided} preventivi decisi` : "nessun dato", icon: Target },
  ];
  const secondary = [
    { label: `Accettati ${year}`, value: formatEur(acceptedYear), href: "/preventivi?status=accepted" },
    { label: "Follow-up in scadenza", value: String(followUpsCount.count ?? 0), sub: "entro 7 giorni", href: "/promemoria" },
    { label: "Attività aperte", value: String(tasks.length), sub: `${overdue.length} in ritardo`, href: "/attivita" },
  ];

  return (
    <>
      {/* intestazione scura compatta con trama digitale discreta */}
      <header className="nx-surface-dark relative -mx-4 -mt-4 mb-6 overflow-hidden rounded-b-xl px-5 py-6 md:-mx-8 md:-mt-8 md:px-8" data-testid="dash-header">
        <DigitalTexture intensity="low" />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-sky/90">{ctx.org.name}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white md:text-[1.7rem]">{greeting}{firstName ? `, ${firstName}` : ""}</h1>
            <p className="mt-0.5 text-sm text-slate-300">Panoramica di {ctx.org.name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <nav className="flex gap-1 rounded-md bg-white/[0.08] p-1" aria-label="Periodo">
              {RANGES.map((r) => (
                <Link key={r.key} href={`/dashboard?range=${r.key}`} aria-current={r.key === range.key ? "true" : undefined}
                  className={`nx-t rounded-sm px-2.5 py-1.5 text-xs font-medium ${r.key === range.key ? "bg-white text-carbon" : "text-slate-200 hover:bg-white/10"}`}>{r.label}</Link>
              ))}
            </nav>
            {canWriteData && (
              <>
                <Link href="/clienti/nuovo" className={`${buttonVariants({ size: "default", variant: "ghost" })} border border-white/20 text-white hover:bg-white/10`}><Users className="size-4" />Nuovo cliente</Link>
                <Link href="/documenti" className={`${buttonVariants({ size: "default", variant: "ghost" })} border border-white/20 text-white hover:bg-white/10`}><Upload className="size-4" />Carica documento</Link>
                <Link href="/preventivi/nuovo" className={buttonVariants({ size: "default" })}><Plus className="size-4" />Nuovo preventivo</Link>
              </>
            )}
            <Link href="/notifiche" aria-label="Apri le notifiche" className="nx-t relative rounded-md border border-white/15 p-2.5 text-slate-200 hover:bg-white/10"><Bell className="size-[18px]" />{(unreadCount ?? 0) > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-sm bg-sky px-1 text-center text-[10px] font-bold text-carbon">{unreadCount}</span>}</Link>
            <Link href="/impostazioni/profilo" aria-label="Apri il profilo" className="nx-t rounded-full ring-2 ring-white/20 hover:ring-sky/70"><Avatar name={ctx.fullName ?? ctx.email} size={36} /></Link>
          </div>
        </div>
      </header>

      <section aria-label="Il lavoro di oggi" className="mb-8" data-testid="today-work">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Cosa fare oggi</h2><Link className="text-sm font-medium text-primary hover:underline" href="/promemoria">Apri i promemoria</Link></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/promemoria?vista=oggi"><Card className="nx-t h-full p-4 hover:border-primary/40"><p className="text-sm text-muted">Da completare oggi</p><p className="mt-1 text-xl font-semibold" data-testid="dash-today">{ac.today}</p><p className="mt-0.5 text-xs text-muted">{mineToday} assegnati a te</p></Card></Link>
          <Link href="/promemoria?vista=ritardo"><Card className={ac.overdue > 0 ? "nx-t h-full border-danger/50 p-4" : "nx-t h-full p-4 hover:border-primary/40"}><p className="text-sm text-muted">Scaduti</p><p className={ac.overdue > 0 ? "mt-1 text-xl font-semibold text-danger" : "mt-1 text-xl font-semibold"} data-testid="dash-overdue">{ac.overdue}</p><p className="mt-0.5 text-xs text-muted">{ac.urgent} urgenti</p></Card></Link>
          <Link href="/followup"><Card className="nx-t h-full p-4 hover:border-primary/40"><p className="text-sm text-muted">Follow-up da effettuare</p><p className="mt-1 text-xl font-semibold" data-testid="dash-followups">{followUpsDue}</p><p className="mt-0.5 text-xs text-muted">con data di oggi o passata</p></Card></Link>
          <Link href="/appuntamenti?vista=elenco"><Card className="nx-t h-full p-4 hover:border-primary/40"><p className="text-sm text-muted">Appuntamenti (7 giorni)</p><p className="mt-1 text-xl font-semibold" data-testid="dash-appointments">{nextApps.length}</p><p className="mt-0.5 text-xs text-muted">{nextApps[0] ? `Prossimo: ${fmtDay(nextApps[0].when_date!)} ${fmtTime(nextApps[0].when_at!)}` : "nessuno in programma"}</p></Card></Link>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card>
            <h3 className="mb-2 text-sm font-semibold">Prossimi appuntamenti</h3>
            {nextApps.length === 0 ? <p className="text-sm text-muted">Nessun appuntamento nei prossimi 7 giorni.</p> : (
              <ul className="space-y-1.5 text-sm">{nextApps.map((a) => <li key={a.id} className="flex justify-between gap-3"><Link className="truncate text-primary hover:underline" href={a.href}>{a.title}</Link><span className="shrink-0 text-muted">{fmtDay(a.when_date!)} {fmtTime(a.when_at!)}</span></li>)}</ul>
            )}
          </Card>
          <Card data-testid="workload">
            <h3 className="mb-2 text-sm font-semibold">Carico di lavoro (elementi aperti per responsabile)</h3>
            {workloadRows.length === 0 ? <p className="text-sm text-muted">Nessun elemento aperto.</p> : (
              <ul className="space-y-1.5 text-sm">{workloadRows.map((w) => <li key={w.name} className="flex justify-between gap-3"><span>{w.name}</span><span className="text-muted">{w.n}</span></li>)}</ul>
            )}
          </Card>
        </div>
      </section>

      <section aria-label="Richiedono attenzione" className="mb-8" data-testid="attention">
        <h2 className="mb-3 text-lg font-semibold">Richiedono attenzione</h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Follow-up imminenti</h2><Link className="text-sm font-medium text-primary hover:underline" href="/promemoria">Tutti</Link></div>
          {(followUpList.data ?? []).length === 0 ? <p className="text-sm text-muted">Nessun follow-up in scadenza nei prossimi 7 giorni.</p> : (
            <ul className="space-y-2 text-sm">
              {(followUpList.data ?? []).map((f) => {
                const c = Array.isArray(f.customers) ? f.customers[0] : f.customers;
                const late = (f.follow_up_date as string) < isoDayOffset(0);
                return (
                  <li key={f.id as string} className="flex justify-between gap-3">
                    <Link className="truncate hover:underline" href={`/preventivi/${f.id}`}>{f.number as string}{c ? ` · ${(c as { name: string }).name}` : ""}</Link>
                    <span className={late ? "font-medium text-danger" : "text-muted"}>{new Date(f.follow_up_date as string).toLocaleDateString("it-IT")}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-1 font-semibold">Clienti da ricontattare</h2>
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
        </div>
      </section>

      <h2 className="mb-3 text-lg font-semibold">Andamento dell&apos;attività</h2>
      {/* indicatori principali */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {mainKpis.map((k) => {
          const Icon = k.icon;
          const body = (
            <Card className="nx-t h-full hover:border-primary/40">
              <div className="flex items-start justify-between"><p className="text-sm font-medium text-muted">{k.label}</p><span className="inline-flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="size-4" /></span></div>
              <p className="mt-2 text-[1.75rem] font-semibold leading-none tracking-tight">{k.value}</p>
              {k.sub && <p className="mt-2 text-xs text-muted">{k.sub}</p>}
            </Card>
          );
          return k.href ? <Link key={k.label} href={k.href} className="block">{body}</Link> : <div key={k.label}>{body}</div>;
        })}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {secondary.map((k) => (
          <Link key={k.label} href={k.href} className="nx-t flex items-baseline justify-between gap-3 rounded-lg border border-border/70 bg-white/50 px-4 py-3 hover:border-primary/40 hover:bg-white">
            <span className="text-sm text-muted">{k.label}</span>
            <span className="text-right"><span className="font-semibold">{k.value}</span>{k.sub && <span className="ml-2 text-xs text-muted">{k.sub}</span>}</span>
          </Link>
        ))}
      </div>

      {/* area centrale: performance commerciale + NEXORA Intelligence */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section aria-label="Andamento nel periodo" className="space-y-4">
          <Card className="p-6">
            <h2 className="mb-4 text-lg font-semibold">Andamento commerciale</h2>
            <TrendChart rows={trend} mode="value" caption="Valore dei preventivi per mese" />
          </Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {period.map((k) => (
              <Card key={k.label} className="p-4"><p className="text-xs font-medium text-muted">{k.label}</p><p className="mt-1 text-lg font-semibold">{k.value}</p>{k.sub && <p className="mt-0.5 text-xs text-muted">{k.sub}</p>}</Card>
            ))}
          </div>
          <Card><TrendChart rows={acquired} mode="count" caption="Nuovi clienti per mese" /></Card>
        </section>
        <aside aria-label="NEXORA Intelligence" className="space-y-4">
          {can(ctx.org.role, "ai:use") ? <DashboardChat canConfirm={canWriteData} /> : (
            <Card><h2 className="font-semibold">NEXORA Intelligence</h2><p className="mt-1 text-sm text-muted">Il tuo ruolo non prevede l&apos;uso del Copilot: le segnalazioni qui sotto restano consultabili.</p></Card>
          )}
        </aside>
      </div>

      {snapshot && <AiSection summary={buildSummary(snapshot)} insights={insights} seenBefore={seenBefore} canWrite={canWriteData} canUseAi={can(ctx.org.role, "ai:use")} />}


      {/* area inferiore: ultimi preventivi, clienti recenti, prossime attività */}
      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-3"><h2 className="font-semibold">Ultimi preventivi</h2><Link className="inline-flex items-center text-sm font-medium text-primary hover:underline" href="/preventivi">Tutti<ChevronRight className="size-4" /></Link></div>
          {(latestQuotes ?? []).length === 0 ? <p className="p-5 text-sm text-muted">Nessun preventivo ancora.</p> : (
            <ul className="divide-y divide-line">
              {(latestQuotes ?? []).map((x) => (
                <li key={x.id as string}><Link href={`/preventivi/${x.id}`} className="nx-t flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-primary/[0.03]">
                  <span className="min-w-0"><span className="block truncate font-medium">{x.number as string}{one(x.customers as { name: string } | { name: string }[])?.name ? ` · ${one(x.customers as { name: string } | { name: string }[])!.name}` : ""}</span><span className="block truncate text-xs text-muted">{(x.title as string | null) ?? "Senza oggetto"}</span></span>
                  <span className="shrink-0 text-right"><span className="block font-medium">{formatEur(x.total_cents as number)}</span><StatusBadge status={x.status as QuoteStatus} className="mt-0.5" /></span>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-3"><h2 className="font-semibold">Clienti recenti</h2><Link className="inline-flex items-center text-sm font-medium text-primary hover:underline" href="/clienti">Tutti<ChevronRight className="size-4" /></Link></div>
          {(recentCustomers ?? []).length === 0 ? <p className="p-5 text-sm text-muted">Nessun cliente ancora.</p> : (
            <ul className="divide-y divide-line">
              {(recentCustomers ?? []).map((c) => (
                <li key={c.id as string}><Link href={`/clienti/${c.id}`} className="nx-t flex items-center gap-3 px-5 py-3 text-sm hover:bg-primary/[0.03]">
                  <Avatar name={c.name as string} size={32} />
                  <span className="min-w-0"><span className="block truncate font-medium">{c.name as string}</span><span className="block truncate text-xs text-muted">{(c.email as string | null) ?? "—"}</span></span>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-3"><h2 className="font-semibold">Da fare</h2><Link className="inline-flex items-center text-sm font-medium text-primary hover:underline" href="/attivita">Tutte<ChevronRight className="size-4" /></Link></div>
          {tasks.length === 0 ? <p className="p-5 text-sm text-muted">Nessuna attività aperta.</p> : (
            <ul className="divide-y divide-line">
              {tasks.slice(0, 6).map((t) => (
                <li key={t.id as string}><Link href={`/attivita/${t.id}`} className="nx-t flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-primary/[0.03]"><span className="truncate">{t.title as string}</span>
                  <span className={`shrink-0 text-xs ${t.due_at && new Date(t.due_at as string) < now ? "font-medium text-danger" : "text-muted"}`}>{t.due_at ? new Date(t.due_at as string).toLocaleDateString("it-IT") : "—"}</span></Link></li>
              ))}
            </ul>
          )}
          {(reminders.data ?? []).length > 0 && (
            <div className="border-t border-line px-5 py-3">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Promemoria (7 giorni)</h3>
              <ul className="space-y-1 text-sm text-muted">
                {(reminders.data ?? []).map((r) => {
                  const t = Array.isArray(r.tasks) ? r.tasks[0] : r.tasks;
                  return <li key={r.id as string}>{new Date(r.remind_at as string).toLocaleDateString("it-IT")} · {(t as { title: string } | null)?.title}</li>;
                })}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Preventivi per stato</h2>
          <ul className="space-y-2.5" aria-label="Preventivi per stato">
            {statuses.map((st) => (
              <li key={st} className="grid grid-cols-[90px_1fr_auto] items-center gap-3 text-sm">
                <span>{QUOTE_STATUS_LABEL[st]}</span>
                <span className="h-2 rounded-sm bg-line"><span className="block h-2 rounded-sm bg-primary" style={{ width: `${(count(st) / maxCount) * 100}%` }} /></span>
                <span className="text-muted">{count(st)} · {formatEur(sum(st))}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Ultime operazioni</h2>
          {(events.data ?? []).length === 0 ? <p className="text-sm text-muted">Nessuna operazione registrata.</p> : (
            <ul className="space-y-2 text-sm">
              {(events.data ?? []).map((e) => {
                const href = e.entity === "quote" ? `/preventivi/${e.entity_id}` : e.entity === "task" ? `/attivita/${e.entity_id}` : e.customer_id ? `/clienti/${e.customer_id}` : undefined;
                return (
                  <li key={e.id as number} className="flex justify-between gap-3">
                    {href ? <Link className="truncate hover:underline" href={href}>{e.summary as string}</Link> : <span className="truncate">{e.summary as string}</span>}
                    <span className="shrink-0 text-xs text-muted">{new Date(e.created_at as string).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</span>
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
