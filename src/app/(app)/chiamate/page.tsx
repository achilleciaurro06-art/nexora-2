import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listCustomers } from "@/modules/clienti/repository";
import { listMembers, nameMap } from "@/modules/organizzazioni/queries";
import { CALL_DIRECTION_LABEL, CALL_OUTCOMES, CALL_OUTCOME_LABEL, type CallOutcome } from "@/modules/agenda/types";
import { Alert, PageHeader, Table } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { dayRangeUtc, fmtDateTime } from "@/lib/datetime";
import { isUuid } from "@/lib/ids";

export const metadata = { title: "Chiamate" };

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ dir?: string; esito?: string; resp?: string; cliente?: string; da?: string; a?: string; registrata?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  let q = db.from("call_logs").select("id, called_at, direction, outcome, duration_seconds, notes, user_id, customer_id, follow_up_id, customers(name), customer_contacts(full_name)")
    .eq("organization_id", orgId).order("called_at", { ascending: false }).limit(300);
  if (sp.dir === "inbound" || sp.dir === "outbound") q = q.eq("direction", sp.dir);
  if (sp.esito && sp.esito in CALL_OUTCOME_LABEL) q = q.eq("outcome", sp.esito);
  if (sp.resp === "me") q = q.eq("user_id", ctx.userId); else if (isUuid(sp.resp)) q = q.eq("user_id", sp.resp);
  if (isUuid(sp.cliente)) q = q.eq("customer_id", sp.cliente);
  if (sp.da && /^\d{4}-\d{2}-\d{2}$/.test(sp.da)) q = q.gte("called_at", dayRangeUtc(sp.da).from);
  if (sp.a && /^\d{4}-\d{2}-\d{2}$/.test(sp.a)) q = q.lt("called_at", dayRangeUtc(sp.a).to);
  const [{ data }, customers, members] = await Promise.all([q, listCustomers(db, orgId), listMembers(db, orgId)]);
  const names = nameMap(members);
  const rows = data ?? [];
  const canWrite = can(ctx.org.role, "data:write");
  const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? (v[0] ?? null) : v);
  return (
    <>
      <PageHeader title="Chiamate" description="Registro manuale delle telefonate con i clienti (non è collegato a un centralino)."
        actions={canWrite ? <Link href="/chiamate/nuova" className={buttonVariants()}>Registra chiamata</Link> : null} />
      {sp.registrata && <div className="mb-4"><Alert kind="success">Chiamata registrata.</Alert></div>}
      <form className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6" role="search" aria-label="Filtri chiamate">
        <Select name="dir" defaultValue={sp.dir ?? ""} aria-label="Direzione"><option value="">Entrata e uscita</option>{Object.entries(CALL_DIRECTION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select name="esito" defaultValue={sp.esito ?? ""} aria-label="Esito"><option value="">Tutti gli esiti</option>{CALL_OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</Select>
        <Select name="resp" defaultValue={sp.resp ?? ""} aria-label="Collaboratore"><option value="">Tutti i collaboratori</option><option value="me">Le mie</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select>
        <Select name="cliente" defaultValue={sp.cliente ?? ""} aria-label="Cliente"><option value="">Tutti i clienti</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Input name="da" type="date" defaultValue={sp.da} aria-label="Dal" /><div className="flex min-w-0 gap-2"><Input className="min-w-0" name="a" type="date" defaultValue={sp.a} aria-label="Al" /><button className={buttonVariants({ variant: "outline" })}>Filtra</button></div>
      </form>
      <Table>
        <thead><tr><th>Quando</th><th>Cliente</th><th>Direzione</th><th>Esito</th><th>Durata</th><th>Collaboratore</th><th>Note</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="text-muted">Nessuna chiamata registrata{sp.dir || sp.esito || sp.resp || sp.cliente || sp.da || sp.a ? " con questi filtri" : ""}.</td></tr>}
          {rows.map((c) => {
            const cu = one(c.customers as { name: string } | { name: string }[] | null), ct = one(c.customer_contacts as { full_name: string } | { full_name: string }[] | null);
            return (
              <tr key={c.id as string}>
                <td>{fmtDateTime(c.called_at as string)}</td>
                <td><Link className="font-medium text-primary hover:underline" href={`/clienti/${c.customer_id}`}>{cu?.name ?? "—"}</Link>{ct ? <span className="block text-xs text-muted">{ct.full_name}</span> : null}</td>
                <td>{CALL_DIRECTION_LABEL[c.direction as keyof typeof CALL_DIRECTION_LABEL]}</td>
                <td>{CALL_OUTCOME_LABEL[c.outcome as CallOutcome]}{c.follow_up_id ? <> · <Link className="text-primary hover:underline" href={`/followup/${c.follow_up_id}`}>follow-up</Link></> : null}</td>
                <td>{c.duration_seconds == null ? "—" : `${Math.round((c.duration_seconds as number) / 60)} min`}</td>
                <td>{c.user_id ? (names.get(c.user_id as string) ?? "—") : "—"}</td>
                <td className="max-w-xs truncate text-sm text-muted" title={(c.notes as string | null) ?? undefined}>{(c.notes as string | null) ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
