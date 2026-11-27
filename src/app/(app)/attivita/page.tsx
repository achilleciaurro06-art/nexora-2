import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listCustomers } from "@/modules/clienti/repository";
import { listMembers, nameMap } from "@/modules/organizzazioni/queries";
import { listTaskTypes } from "@/modules/agenda/queries";
import { setTaskStatusAction } from "@/modules/attivita/actions";
import { bucketTasks } from "@/modules/attivita/buckets";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/modules/attivita/schemas";
import { TaskForm } from "@/modules/attivita/ui/task-form";
import { Badge, Card, PageHeader, Table } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { fmtDate, fmtDateTime, fmtLongDay, utcToZonedParts } from "@/lib/datetime";
import { isUuid } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { AgendaNav } from "@/components/layout/agenda-nav";
import { StatusChip, type Tone } from "@/components/ui/status-chip";

export const metadata = { title: "Attività" };

const TASK_TONE: Record<string, Tone> = { todo: "warning", in_progress: "info", done: "success", cancelled: "neutral" };
type Row = {
  id: string; title: string; status: string; priority: keyof typeof PRIORITY_LABEL; due_at: string | null; due_has_time: boolean; created_at: string;
  assignee_id: string | null; customer_id: string | null; quote_id: string | null; type_id: string | null;
  customers: { name: string; deleted_at: string | null; archived_at: string | null } | { name: string; deleted_at: string | null; archived_at: string | null }[] | null;
  quotes: { number: string; deleted_at: string | null } | { number: string; deleted_at: string | null }[] | null;
  task_types: { label: string } | { label: string }[] | null;
};
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const VIEWS = [{ key: "scadenza", label: "Per scadenza" }, { key: "elenco", label: "Elenco" }, { key: "date", label: "Per data" }] as const;
const SORTS = [{ key: "scadenza", label: "Scadenza" }, { key: "priorita", label: "Priorità" }, { key: "titolo", label: "Titolo" }, { key: "creata", label: "Più recenti" }] as const;
const PRIO_RANK = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

type SP = { vista?: string; q?: string; stato?: string; tipo?: string; cliente?: string; resp?: string; prio?: string; ordine?: string; mine?: string };

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const vista = VIEWS.find((v) => v.key === sp.vista)?.key ?? "scadenza";
  const ordine = SORTS.find((s) => s.key === sp.ordine)?.key ?? "scadenza";
  const resp = sp.mine === "1" ? "me" : sp.resp;

  let q = db.from("tasks")
    .select("id, title, status, priority, due_at, due_has_time, created_at, assignee_id, customer_id, quote_id, type_id, customers(name, deleted_at, archived_at), quotes(number, deleted_at), task_types(label)")
    .eq("organization_id", orgId).is("deleted_at", null).order("due_at", { nullsFirst: false }).limit(500);
  if (resp === "me") q = q.eq("assignee_id", ctx.userId); else if (resp === "none") q = q.is("assignee_id", null); else if (isUuid(resp)) q = q.eq("assignee_id", resp);
  if (sp.stato === "aperte") q = q.in("status", ["todo", "in_progress"]); else if (sp.stato && sp.stato in STATUS_LABEL) q = q.eq("status", sp.stato);
  if (isUuid(sp.tipo)) q = q.eq("type_id", sp.tipo);
  if (isUuid(sp.cliente)) q = q.eq("customer_id", sp.cliente);
  if (sp.prio && sp.prio in PRIORITY_LABEL) q = q.eq("priority", sp.prio);
  if (sp.q) { const s = sp.q.replace(/[%_,()]/g, ""); if (s) q = q.or(`title.ilike.%${s}%,description.ilike.%${s}%`); }
  const [{ data }, customers, members, types, { data: feed }] = await Promise.all([
    q, listCustomers(db, orgId), listMembers(db, orgId), listTaskTypes(db, orgId),
    db.from("activity_events").select("id, summary, created_at, entity, entity_id, customer_id").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(12),
  ]);
  const names = nameMap(members);
  let rows = ((data ?? []) as unknown as Row[]).filter((r) => r.status !== "cancelled" || sp.stato === "cancelled");
  const sorters: Record<string, (a: Row, b: Row) => number> = {
    scadenza: (a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"),
    priorita: (a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"),
    titolo: (a, b) => a.title.localeCompare(b.title),
    creata: (a, b) => b.created_at.localeCompare(a.created_at),
  };
  rows = [...rows].sort(sorters[ordine]!);
  const now = new Date();
  const canWrite = can(ctx.org.role, "data:write");
  const href = (over: Partial<SP>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, mine: undefined, resp, ...over })) if (v) p.set(k, String(v));
    const s = p.toString();
    return s ? `/attivita?${s}` : "/attivita";
  };
  const hasFilters = !!(sp.q || sp.stato || sp.tipo || sp.cliente || resp || sp.prio);

  const Cell = ({ t }: { t: Row }) => {
    const c = one(t.customers), qt = one(t.quotes);
    return (
      <td className="text-sm">
        {c ? (c.deleted_at ? <span className="text-muted">{c.name} (rimosso)</span> : <Link className="text-primary hover:underline" href={`/clienti/${t.customer_id}`}>{c.name}</Link>) : "—"}
        {c?.archived_at && <span className="text-muted"> (archiviato)</span>}
        {qt && <> · {qt.deleted_at ? <span className="text-muted">{qt.number} (rimosso)</span> : <Link className="text-primary hover:underline" href={`/preventivi/${t.quote_id}`}>{qt.number}</Link>}</>}
      </td>
    );
  };
  const table = (tasks: Row[], tone: "danger" | "default", empty: string) => (
    <Table>
      <thead><tr><th>Attività</th><th>Tipologia</th><th>Cliente / Preventivo</th><th>Assegnata a</th><th>Scadenza</th><th>Priorità</th><th /></tr></thead>
      <tbody>
        {tasks.length === 0 && <tr><td colSpan={7} className="text-muted">{empty}</td></tr>}
        {tasks.map((t) => {
          const done = t.status === "done" || t.status === "cancelled";
          return (
            <tr key={t.id}>
              <td className={done ? "text-muted" : "font-medium"}><Link className={done ? "line-through hover:underline" : "hover:underline"} href={`/attivita/${t.id}`}>{t.title}</Link> <StatusChip tone={TASK_TONE[t.status] ?? "neutral"} className="ml-1 align-middle">{STATUS_LABEL[t.status as keyof typeof STATUS_LABEL] ?? t.status}</StatusChip></td>
              <td className="text-sm">{one(t.task_types)?.label ?? "Attività generica"}</td>
              <Cell t={t} />
              <td>{t.assignee_id ? (names.get(t.assignee_id) ?? "—") : "—"}</td>
              <td className={tone === "danger" ? "text-danger" : ""}>{t.due_at ? (t.due_has_time ? fmtDateTime(t.due_at) : fmtDate(t.due_at)) : "—"}</td>
              <td><Badge className={t.priority === "urgent" && !done ? "border-danger text-danger" : ""}>{PRIORITY_LABEL[t.priority]}</Badge></td>
              <td className="text-right">
                {canWrite && (
                  <form action={setTaskStatusAction.bind(null, t.id)}>
                    <input type="hidden" name="status" value={done ? "todo" : "done"} />
                    <Button size="sm" variant="outline">{done ? "Riapri" : "Fatto"}</Button>
                  </form>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
  const section = (title: string, tasks: Row[], tone: "danger" | "default", empty: string) => (
    <section aria-label={title} className="mt-6">
      <h2 className={`mb-2 font-medium ${tone === "danger" && tasks.length ? "text-danger" : ""}`}>{title} <span className="text-sm font-normal text-muted">({tasks.length})</span></h2>
      {table(tasks, tone, empty)}
    </section>
  );

  let body: React.ReactNode;
  if (vista === "scadenza") {
    const b = bucketTasks(rows, now);
    b.done = b.done.slice(0, 30);
    body = <>{section("Scadute", b.overdue, "danger", "Nessuna attività scaduta.")}{section("Imminenti", b.soon, "default", "Nessuna attività in scadenza nei prossimi 7 giorni.")}{section("Altre aperte", b.later, "default", "Nessuna altra attività aperta.")}{section("Completate (ultime 30)", b.done, "default", "Nessuna attività completata.")}</>;
  } else if (vista === "date") {
    const groups = new Map<string, Row[]>();
    for (const t of rows) { const k = t.due_at ? utcToZonedParts(t.due_at).date : "senza"; (groups.get(k) ?? groups.set(k, []).get(k)!).push(t); }
    const keys = [...groups.keys()].sort((a, b) => (a === "senza" ? 1 : b === "senza" ? -1 : a.localeCompare(b)));
    body = keys.length === 0 ? <Card className="mt-6"><p className="text-sm text-muted">Nessuna attività con questi filtri.</p></Card> : (
      <>{keys.map((k) => section(k === "senza" ? "Senza scadenza" : fmtLongDay(groups.get(k)![0]!.due_at!), groups.get(k)!, "default", ""))}</>
    );
  } else {
    body = <div className="mt-6">{table(rows, "default", hasFilters ? "Nessuna attività con questi filtri." : "Nessuna attività. Creane una qui sopra.")}</div>;
  }

  return (
    <>
      <AgendaNav active="attivita" />
      <PageHeader title="Attività" description="Attività operative e commerciali. Gli appuntamenti, le chiamate e i follow-up hanno le loro sezioni; il centro Promemoria li riunisce."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={href({ resp: resp === "me" ? undefined : "me" })} className={buttonVariants({ variant: resp === "me" ? "default" : "outline" })}>Solo le mie</Link>
            {canWrite && <Link href="/attivita/nuova" className={buttonVariants()}>Nuova attività</Link>}
          </div>
        } />
      {canWrite && <Card className="mb-4"><TaskForm customers={customers.map((c) => ({ id: c.id, name: c.name }))} /></Card>}
      <nav className="mb-3 flex gap-2" aria-label="Vista delle attività">
        {VIEWS.map((v) => <Link key={v.key} href={href({ vista: v.key })} aria-current={v.key === vista ? "page" : undefined} className={buttonVariants({ variant: v.key === vista ? "default" : "outline", size: "sm" })}>{v.label}</Link>)}
      </nav>
      <form className="mb-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-4" role="search" aria-label="Filtri delle attività">
        <input type="hidden" name="vista" value={vista} />
        <Input name="q" defaultValue={sp.q} placeholder="Cerca nel titolo o nella descrizione" aria-label="Cerca attività" />
        <Select name="stato" defaultValue={sp.stato ?? ""} aria-label="Stato"><option value="">Tutti gli stati</option><option value="aperte">Solo aperte</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select name="tipo" defaultValue={sp.tipo ?? ""} aria-label="Tipologia"><option value="">Tutte le tipologie</option>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>
        <Select name="cliente" defaultValue={sp.cliente ?? ""} aria-label="Cliente"><option value="">Tutti i clienti</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select name="resp" defaultValue={resp ?? ""} aria-label="Responsabile"><option value="">Tutti i responsabili</option><option value="me">Le mie</option><option value="none">Non assegnate</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select>
        <Select name="prio" defaultValue={sp.prio ?? ""} aria-label="Priorità"><option value="">Tutte le priorità</option>{Object.entries(PRIORITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select name="ordine" defaultValue={ordine} aria-label="Ordina per">{SORTS.map((s) => <option key={s.key} value={s.key}>Ordina: {s.label}</option>)}</Select>
        <div className="flex gap-2"><button className={buttonVariants({ variant: "outline" })}>Applica</button>{hasFilters && <Link className={cn(buttonVariants({ variant: "ghost" }))} href={`/attivita?vista=${vista}`}>Azzera</Link>}</div>
      </form>
      {body}

      <h2 className="mb-2 mt-8 font-medium">Cronologia recente</h2>
      <Card>
        {(feed ?? []).length === 0 ? <p className="text-sm text-muted">Ancora nessuna attività registrata.</p> : (
          <ul className="space-y-2 text-sm">
            {(feed ?? []).map((f) => {
              const href2 = f.entity === "quote" ? `/preventivi/${f.entity_id}` : f.entity === "task" ? `/attivita/${f.entity_id}` : f.entity === "appointment" ? `/appuntamenti/${f.entity_id}` : f.entity === "follow_up" ? `/followup/${f.entity_id}` : f.customer_id ? `/clienti/${f.customer_id}` : undefined;
              return (
                <li key={f.id as number} className="flex justify-between gap-3">
                  {href2 ? <Link className="truncate text-primary hover:underline" href={href2}>{f.summary as string}</Link> : <span className="truncate">{f.summary as string}</span>}
                  <span className="shrink-0 text-muted">{fmtDateTime(f.created_at as string)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
