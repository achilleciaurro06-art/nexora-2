import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listMembers, nameMap } from "@/modules/organizzazioni/queries";
import { listAgenda, listTaskTypes } from "@/modules/agenda/queries";
import { AGENDA_KIND_LABEL, UPCOMING_DAYS, agendaCounts, applyFilters, bucketAgenda, needsAction, type AgendaItem, type View } from "@/modules/agenda/agenda";
import { completeItemAction } from "@/modules/agenda/actions";
import { QuickReschedule } from "@/modules/agenda/ui/quick-reschedule";
import { FOLLOW_UP_LABEL, type FollowUpStatus } from "@/modules/followup/states";
import { PRIORITY_LABEL } from "@/modules/attivita/schemas";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { fmtDay, fmtTime, todayIn } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export const metadata = { title: "Promemoria" };
const TABS: { key: View; label: string; slug: string }[] = [
  { key: "today", label: "Oggi", slug: "oggi" }, { key: "overdue", label: "In ritardo", slug: "ritardo" },
  { key: "upcoming", label: "Prossimi", slug: "prossimi" }, { key: "done", label: "Completati", slug: "completati" },
];
type SP = { vista?: string; resp?: string; tipo?: string; prio?: string };

export default async function RemindersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const now = new Date();
  const today = todayIn(now);
  const [all, members, types] = await Promise.all([listAgenda(db, orgId, now), listMembers(db, orgId), listTaskTypes(db, orgId)]);
  const names = nameMap(members);
  const resp = sp.resp === "me" ? ctx.userId : sp.resp;
  const filters = { assignee: resp, type: sp.tipo, priority: sp.prio };
  const items = applyFilters(all, filters);
  const buckets = bucketAgenda(items, now);
  const counts = agendaCounts(items, now);
  const active = TABS.find((t) => t.slug === sp.vista) ?? TABS[0]!;
  const list = buckets[active.key];
  const canWrite = can(ctx.org.role, "data:write");
  const callsToMake = applyFilters(all, { assignee: resp, type: "call", priority: sp.prio }).filter((i) => i.is_open).length;
  const mine = all.filter((i) => i.is_open && i.assignee_id === ctx.userId).length;
  const href = (slug: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ vista: slug, resp: sp.resp, tipo: sp.tipo, prio: sp.prio })) if (v) p.set(k, v);
    return `/promemoria?${p.toString()}`;
  };
  const count = (v: View) => counts[v];

  const When = ({ i }: { i: AgendaItem }) => (
    <span>{i.when_date ? fmtDay(i.when_date) : "Senza data"}{i.when_at && (i.kind === "appointment" || i.has_time) ? ` ${fmtTime(i.when_at)}` : ""}</span>
  );

  return (
    <>
      <PageHeader title="Promemoria" description={`Il lavoro di oggi in un solo posto: attività, follow-up, appuntamenti e telefonate da fare. Prossimi = entro ${UPCOMING_DAYS} giorni.`} />
      <dl className="mb-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6" data-testid="reminder-counters">
        {([["Oggi", counts.today, "today"], ["In ritardo", counts.overdue, "overdue"], ["Prossimi", counts.upcoming, "upcoming"], ["Completati", counts.done, "done"]] as const).map(([k, n, key]) => (
          <Card key={k} className={cn("p-3", key === "overdue" && n > 0 && "border-danger")}><dt className="text-muted">{k}</dt><dd className={cn("mt-0.5 text-2xl font-semibold", key === "overdue" && n > 0 && "text-danger")} data-testid={`count-${key}`}>{n}</dd></Card>
        ))}
        <Card className="p-3"><dt className="text-muted">Richiedono azione</dt><dd className="mt-0.5 text-2xl font-semibold" data-testid="count-action">{counts.needsAction}</dd><dd className="text-xs text-muted">{counts.urgent} urgenti</dd></Card>
        <Card className="p-3"><dt className="text-muted">Telefonate da fare</dt><dd className="mt-0.5 text-2xl font-semibold" data-testid="count-calls">{callsToMake}</dd><dd className="text-xs text-muted">{mine} aperte assegnate a te</dd></Card>
      </dl>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap gap-1" aria-label="Vista dei promemoria">
          {TABS.map((t) => <Link key={t.key} href={href(t.slug)} aria-current={t.key === active.key ? "page" : undefined} className={buttonVariants({ variant: t.key === active.key ? "default" : "outline", size: "sm" })}>{t.label} ({count(t.key)})</Link>)}
        </nav>
        <form className="ml-auto flex flex-wrap items-center gap-2" role="search" aria-label="Filtri">
          <input type="hidden" name="vista" value={active.slug} />
          <Select name="resp" defaultValue={sp.resp ?? ""} aria-label="Responsabile" className="w-44"><option value="">Tutti i responsabili</option><option value="me">Assegnati a me</option><option value="none">Non assegnati</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select>
          <Select name="tipo" defaultValue={sp.tipo ?? ""} aria-label="Tipologia" className="w-48">
            <option value="">Tutte le tipologie</option>
            <optgroup label="Elementi">{(["task", "follow_up", "appointment", "quote_followup"] as const).map((k) => <option key={k} value={k}>{AGENDA_KIND_LABEL[k]}</option>)}</optgroup>
            <optgroup label="Tipologie di attività">{types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</optgroup>
          </Select>
          <Select name="prio" defaultValue={sp.prio ?? ""} aria-label="Priorità" className="w-40"><option value="">Tutte le priorità</option>{Object.entries(PRIORITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <button className={buttonVariants({ variant: "outline", size: "sm" })}>Applica</button>
        </form>
      </div>

      <section aria-label={active.label}>
        {list.length === 0 ? (
          <Card><p className="text-sm text-muted" data-testid="empty-state">
            {active.key === "today" && "Niente in programma per oggi. Buon lavoro!"}
            {active.key === "overdue" && "Nessun elemento in ritardo."}
            {active.key === "upcoming" && `Niente in programma nei prossimi ${UPCOMING_DAYS} giorni.`}
            {active.key === "done" && "Nessun elemento completato di recente."}
            {all.length === 0 && " Crea un'attività, un appuntamento o un follow-up per iniziare."}
          </p></Card>
        ) : (
          <ul className="space-y-2">
            {list.map((i) => {
              const urgent = i.priority === "urgent" && i.is_open;
              const action = needsAction(i, now);
              const overdue = active.key === "overdue";
              return (
                <li key={`${i.kind}-${i.id}`} data-testid="reminder-item" data-kind={i.kind} data-action={action || undefined}
                  className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3", overdue ? "border-danger" : "border-border", urgent && "ring-1 ring-danger")}>
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge>{i.kind === "task" && i.type_key === "call" ? "Telefonata" : AGENDA_KIND_LABEL[i.kind]}</Badge>
                      <Link className="truncate font-medium text-primary hover:underline" href={i.href}>{i.title}</Link>
                      {urgent && <Badge className="border-danger text-danger">Urgente</Badge>}
                      {i.is_open && (action ? <Badge className="border-danger text-danger">Da fare ora</Badge> : <Badge>Programmato</Badge>)}
                      {i.kind === "follow_up" && <Badge>{FOLLOW_UP_LABEL[i.status as FollowUpStatus]}</Badge>}
                    </p>
                    <p className="text-xs text-muted">
                      <span className={overdue ? "font-medium text-danger" : ""}><When i={i} /></span>
                      {i.customer_name ? <> · <Link className="hover:underline" href={`/clienti/${i.customer_id}`}>{i.customer_name}</Link>{i.customer_archived ? " (archiviato)" : ""}</> : null}
                      {i.assignee_id ? ` · ${names.get(i.assignee_id) ?? "—"}` : " · non assegnato"}
                      {i.priority !== "normal" ? ` · priorità ${PRIORITY_LABEL[i.priority].toLowerCase()}` : ""}
                    </p>
                  </div>
                  {canWrite && i.is_open && (
                    <div className="flex flex-wrap items-center gap-1">
                      {i.kind !== "quote_followup" && <form action={completeItemAction.bind(null, i.kind, i.id)}><Button size="sm" variant="outline" aria-label={`Completa: ${i.title}`}>Completa</Button></form>}
                      {i.when_date && <QuickReschedule kind={i.kind} id={i.id} current={i.when_date < today ? today : i.when_date} title={i.title} />}
                      <Link href={i.href} className={buttonVariants({ variant: "ghost", size: "sm" })}>{i.kind === "quote_followup" ? "Apri" : "Modifica"}</Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
