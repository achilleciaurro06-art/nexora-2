import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listMembers, nameMap } from "@/modules/organizzazioni/queries";
import { Card, PageHeader, Table } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Registro delle operazioni" };

const PAGE = 50;
const ENTITY: Record<string, string> = {
  organizations: "Impostazioni aziendali", memberships: "Collaboratori", invitations: "Inviti", customers: "Clienti", customer_contacts: "Referenti",
  customer_notes: "Note cliente", quotes: "Preventivi", tasks: "Attività", reminders: "Promemoria", documents: "Documenti", ai_suggestions: "Suggerimenti AI",
};
const ACTION: Record<string, string> = { insert: "Creazione", update: "Modifica", delete: "Eliminazione" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; p?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const all = can(ctx.org.role, "audit:read");
  const page = Math.max(0, Number.parseInt(sp.p ?? "0", 10) || 0);
  const entity = sp.entity && sp.entity in ENTITY ? sp.entity : undefined;

  // La RLS decide cosa si vede: owner/admin tutte le operazioni dell'organizzazione, gli altri ruoli solo le proprie.
  let q = db.from("audit_logs").select("id, action, entity, entity_id, changed_fields, actor_id, created_at", { count: "exact" })
    .eq("organization_id", orgId).order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
  if (entity) q = q.eq("entity", entity);
  const [{ data, count }, members] = await Promise.all([q, listMembers(db, orgId)]);
  const names = nameMap(members);
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ entity, p: page ? String(page) : undefined, ...over })) if (v) p.set(k, v);
    return `/organizzazione/audit${p.size ? `?${p}` : ""}`;
  };
  const total = count ?? 0;

  return (
    <>
      <PageHeader title="Registro delle operazioni"
        description={all ? "Tutte le operazioni effettuate nella tua organizzazione." : "Le operazioni da te effettuate (il registro completo è riservato a titolare e amministratori)."}
        actions={<Link href="/organizzazione" className={buttonVariants({ variant: "outline" })}>← Organizzazione</Link>} />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Filtra per tipo">
        <Link href={href({ entity: undefined, p: undefined })} className={buttonVariants({ variant: !entity ? "default" : "outline", size: "sm" })}>Tutte</Link>
        {Object.entries(ENTITY).map(([k, l]) => <Link key={k} href={href({ entity: k, p: undefined })} className={buttonVariants({ variant: entity === k ? "default" : "outline", size: "sm" })}>{l}</Link>)}
      </nav>
      <Table>
        <thead><tr><th>Quando</th><th>Chi</th><th>Operazione</th><th>Su cosa</th><th>Campi modificati</th></tr></thead>
        <tbody>
          {(data ?? []).length === 0 && <tr><td colSpan={5} className="text-muted">Nessuna operazione.</td></tr>}
          {(data ?? []).map((r) => (
            <tr key={r.id as number}>
              <td className="whitespace-nowrap text-muted">{new Date(r.created_at as string).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</td>
              <td>{r.actor_id ? (names.get(r.actor_id as string) ?? "Utente rimosso") : "Sistema"}</td>
              <td>{ACTION[r.action as string] ?? (r.action as string)}</td>
              <td>{ENTITY[r.entity as string] ?? (r.entity as string)}</td>
              <td className="text-muted">{((r.changed_fields as string[] | null) ?? []).join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Card className="mt-4 flex items-center justify-between p-3 text-sm">
        <span className="text-muted">{total === 0 ? "0" : `${page * PAGE + 1}–${Math.min(total, page * PAGE + PAGE)}`} di {total}</span>
        <span className="flex gap-2">
          {page > 0 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={href({ p: page - 1 ? String(page - 1) : undefined })}>← Precedenti</Link>}
          {(page + 1) * PAGE < total && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={href({ p: String(page + 1) })}>Successive →</Link>}
        </span>
      </Card>
    </>
  );
}
