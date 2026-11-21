import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listCustomers } from "@/modules/clienti/repository";
import { listMembers, nameMap } from "@/modules/organizzazioni/queries";
import { completeFollowUpQuickAction } from "@/modules/followup/actions";
import { FOLLOW_UP_STATUSES, OPEN_STATUSES, isOverdue, type FollowUpStatus } from "@/modules/followup/states";
import { FollowUpBadge } from "@/modules/followup/ui/follow-up-status";
import { PRIORITY_LABEL } from "@/modules/attivita/schemas";
import { Badge, PageHeader, Table } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { fmtDay, todayIn } from "@/lib/datetime";
import { isUuid } from "@/lib/ids";

export const metadata = { title: "Follow-up" };

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ stato?: string; resp?: string; prio?: string; cliente?: string; q?: string; ritardo?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const today = todayIn(new Date());
  const stato = sp.stato ?? "aperti";

  let q = db.from("follow_ups").select("id, title, status, due_on, priority, assignee_id, customer_id, reason, customers(name, archived_at)")
    .eq("organization_id", orgId).is("deleted_at", null).order("due_on").limit(500);
  if (stato === "aperti") q = q.in("status", OPEN_STATUSES as unknown as string[]);
  else if (stato !== "tutti" && FOLLOW_UP_STATUSES.some((s) => s.key === stato)) q = q.eq("status", stato);
  if (sp.resp === "me") q = q.eq("assignee_id", ctx.userId); else if (sp.resp === "none") q = q.is("assignee_id", null); else if (isUuid(sp.resp)) q = q.eq("assignee_id", sp.resp);
  if (sp.prio && sp.prio in PRIORITY_LABEL) q = q.eq("priority", sp.prio);
  if (isUuid(sp.cliente)) q = q.eq("customer_id", sp.cliente);
  if (sp.ritardo === "1") q = q.lt("due_on", today).in("status", OPEN_STATUSES as unknown as string[]);
  if (sp.q) { const s = sp.q.replace(/[%_,()]/g, ""); if (s) q = q.or(`title.ilike.%${s}%,reason.ilike.%${s}%`); }
  const [{ data }, customers, members] = await Promise.all([q, listCustomers(db, orgId), listMembers(db, orgId)]);
  const names = nameMap(members);
  const rows = data ?? [];
  const canWrite = can(ctx.org.role, "data:write");
  const overdueCount = rows.filter((r) => isOverdue(r.status as FollowUpStatus, r.due_on as string, today)).length;

  return (
    <>
      <PageHeader title="Follow-up" description="Ricontatti commerciali con sei stati: da fare, programmato, in corso, in attesa, completato, annullato."
        actions={canWrite ? <Link href="/followup/nuovo" className={buttonVariants()}>Nuovo follow-up</Link> : null} />
      {overdueCount > 0 && <p className="mb-3 text-sm font-medium text-danger" role="status">{overdueCount} follow-up in ritardo in questo elenco.</p>}
      <form className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6" role="search" aria-label="Filtri follow-up">
        <Input name="q" defaultValue={sp.q} placeholder="Cerca" aria-label="Cerca follow-up" />
        <Select name="stato" defaultValue={stato} aria-label="Stato"><option value="aperti">Solo aperti</option><option value="tutti">Tutti</option>{FOLLOW_UP_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select>
        <Select name="resp" defaultValue={sp.resp ?? ""} aria-label="Responsabile"><option value="">Tutti i responsabili</option><option value="me">Miei</option><option value="none">Non assegnati</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select>
        <Select name="prio" defaultValue={sp.prio ?? ""} aria-label="Priorità"><option value="">Tutte le priorità</option>{Object.entries(PRIORITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select name="cliente" defaultValue={sp.cliente ?? ""} aria-label="Cliente"><option value="">Tutti i clienti</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <div className="flex items-center gap-2"><label className="flex items-center gap-1 text-sm"><input type="checkbox" name="ritardo" value="1" defaultChecked={sp.ritardo === "1"} /> Solo in ritardo</label><button className={buttonVariants({ variant: "outline", size: "sm" })}>Applica</button></div>
      </form>
      <Table>
        <thead><tr><th>Follow-up</th><th>Cliente</th><th>Data prevista</th><th>Stato</th><th>Priorità</th><th>Responsabile</th>{canWrite && <th />}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="text-muted">Nessun follow-up. Registra una chiamata con «prossimo contatto» o creane uno dalla scheda cliente.</td></tr>}
          {rows.map((f) => {
            const c = Array.isArray(f.customers) ? f.customers[0] : f.customers;
            const st = f.status as FollowUpStatus;
            const late = isOverdue(st, f.due_on as string, today);
            const open = OPEN_STATUSES.includes(st);
            return (
              <tr key={f.id as string} data-overdue={late || undefined}>
                <td><Link className="font-medium text-primary hover:underline" href={`/followup/${f.id}`}>{f.title as string}</Link>{f.reason ? <span className="block text-xs text-muted">{f.reason as string}</span> : null}</td>
                <td>{c ? <Link className="hover:underline" href={`/clienti/${f.customer_id}`}>{(c as { name: string }).name}</Link> : "—"}{(c as { archived_at?: string | null } | null)?.archived_at ? <span className="text-muted"> (archiviato)</span> : null}</td>
                <td className={late ? "font-medium text-danger" : ""}>{fmtDay(f.due_on as string)}{(f.due_on as string) === today && open ? " (oggi)" : ""}</td>
                <td><FollowUpBadge status={st} overdue={late} /></td>
                <td><Badge className={f.priority === "urgent" && open ? "border-danger text-danger" : ""}>{PRIORITY_LABEL[f.priority as keyof typeof PRIORITY_LABEL]}</Badge></td>
                <td>{f.assignee_id ? (names.get(f.assignee_id as string) ?? "—") : "—"}</td>
                {canWrite && <td className="text-right">{open && <form action={completeFollowUpQuickAction.bind(null, f.id as string)}><Button size="sm" variant="outline">Completa</Button></form>}</td>}
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
