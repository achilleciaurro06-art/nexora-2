import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { changeRoleAction, removeMemberAction, revokeInvitationAction } from "@/modules/organizzazioni/actions";
import { InviteForm } from "@/modules/organizzazioni/ui/invite-form";
import { Badge, Card, PageHeader, Table } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

export const metadata = { title: "Organizzazione" };
const ROLE = { owner: "Titolare", admin: "Amministratore", member: "Membro", viewer: "Sola lettura" } as const;

export default async function OrganizationPage() {
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const manage = can(ctx.org.role, "members:manage");
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const [{ data: members }, { data: invites }, { data: logs }, { data: usage }, { data: quota }] = await Promise.all([
    db.from("memberships").select("id, role, user_id, profiles(full_name)").eq("organization_id", orgId).order("created_at"),
    manage ? db.from("invitations").select("id, email, role, expires_at").eq("organization_id", orgId).is("accepted_at", null).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    can(ctx.org.role, "audit:read") ? db.from("audit_logs").select("id, action, entity, changed_fields, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(15) : Promise.resolve({ data: [] }),
    manage ? db.from("ai_usage").select("feature, input_tokens, output_tokens").eq("organization_id", orgId).gte("created_at", monthStart) : Promise.resolve({ data: [] }),
    db.from("ai_quotas").select("monthly_token_limit, tokens_used").eq("organization_id", orgId).maybeSingle(),
  ]);
  const usageByFeature = new Map<string, { calls: number; tokens: number }>();
  for (const u of usage ?? []) {
    const cur = usageByFeature.get(u.feature as string) ?? { calls: 0, tokens: 0 };
    cur.calls += 1;
    cur.tokens += Number(u.input_tokens) + Number(u.output_tokens);
    usageByFeature.set(u.feature as string, cur);
  }
  return (
    <>
      <PageHeader title="Organizzazione" description={ctx.org.name} />
      <h2 className="mb-2 font-medium">Membri</h2>
      <Table>
        <thead><tr><th>Nome</th><th>Ruolo</th>{manage && <th />}</tr></thead>
        <tbody>
          {(members ?? []).map((m) => {
            const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
            const isSelf = m.user_id === ctx.userId;
            return (
              <tr key={m.id as string}>
                <td>{(p as { full_name: string | null } | null)?.full_name ?? "—"} {isSelf && <Badge>tu</Badge>}</td>
                <td>{manage && !isSelf ? (
                  <form action={changeRoleAction.bind(null, m.id as string)} className="flex gap-2">
                    <Select name="role" defaultValue={m.role as string} aria-label="Ruolo" className="w-40">
                      {(["owner", "admin", "member", "viewer"] as const).map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
                    </Select>
                    <Button size="sm" variant="outline">Salva</Button>
                  </form>
                ) : ROLE[m.role as keyof typeof ROLE]}</td>
                {manage && <td className="text-right">{!isSelf && <form action={removeMemberAction.bind(null, m.id as string)}><Button size="sm" variant="ghost">Rimuovi</Button></form>}</td>}
              </tr>
            );
          })}
        </tbody>
      </Table>

      {manage && (
        <>
          <h2 className="mb-2 mt-8 font-medium">Invita una persona</h2>
          <Card><InviteForm /></Card>
          {(invites ?? []).length > 0 && (
            <>
              <h3 className="mb-2 mt-4 text-sm font-medium">Inviti in sospeso</h3>
              <Table><tbody>
                {(invites ?? []).map((i) => (
                  <tr key={i.id as string}>
                    <td>{i.email as string}</td><td>{ROLE[i.role as keyof typeof ROLE]}</td>
                    <td className="text-muted">scade il {new Date(i.expires_at as string).toLocaleDateString("it-IT")}</td>
                    <td className="text-right"><form action={revokeInvitationAction.bind(null, i.id as string)}><Button size="sm" variant="ghost">Revoca</Button></form></td>
                  </tr>
                ))}
              </tbody></Table>
            </>
          )}
        </>
      )}

      {manage && (
        <>
          <h2 className="mb-2 mt-8 font-medium">Consumi AI del mese</h2>
          <Card>
            <p className="mb-3 text-sm">Quota: <strong>{Number(quota?.tokens_used ?? 0).toLocaleString("it-IT")}</strong> / {Number(quota?.monthly_token_limit ?? 0).toLocaleString("it-IT")} token (prenotati)</p>
            {usageByFeature.size === 0 ? <p className="text-sm text-muted">Nessun utilizzo questo mese.</p> : (
              <ul className="space-y-1 text-sm">
                {[...usageByFeature.entries()].map(([f, v]) => <li key={f} className="flex justify-between"><span>{f === "copilot" ? "Copilot" : f === "document_analysis" ? "Analisi documenti" : f}</span><span className="text-muted">{v.calls} richieste · {v.tokens.toLocaleString("it-IT")} token</span></li>)}
              </ul>
            )}
          </Card>
        </>
      )}

      {(logs ?? []).length > 0 && (
        <>
          <h2 className="mb-2 mt-8 font-medium">Ultime attività (audit)</h2>
          <Table><tbody>
            {(logs ?? []).map((l) => (
              <tr key={l.id as number}>
                <td className="text-muted">{new Date(l.created_at as string).toLocaleString("it-IT")}</td>
                <td>{l.action as string} · {l.entity as string}</td>
                <td className="text-muted">{((l.changed_fields as string[] | null) ?? []).join(", ")}</td>
              </tr>
            ))}
          </tbody></Table>
        </>
      )}
    </>
  );
}
