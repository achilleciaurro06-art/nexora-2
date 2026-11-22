import Link from "next/link";
import { createClient } from "@/server/supabase/server";
import { can, permissionMatrix, ROLES, ROLE_LABEL, type Role } from "@/server/auth/permissions";
import type { Context } from "@/server/auth/session";
import { changeRoleAction, removeMemberAction, revokeInvitationAction } from "../actions";
import { InviteForm } from "./invite-form";
import { Avatar } from "@/components/ui/avatar";
import { Badge, Card, Table } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

/** Membri, ruoli, inviti, permessi e ultime operazioni dell'organizzazione attiva (sezione "Team" delle Impostazioni). */
export async function TeamSection({ ctx }: { ctx: Context }) {
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const manage = can(ctx.org.role, "members:manage");
  const [{ data: members }, { data: invites }, { data: logs }] = await Promise.all([
    db.from("memberships").select("id, role, user_id, profiles(full_name, job_title, avatar_path)").eq("organization_id", orgId).order("created_at"),
    manage ? db.from("invitations").select("id, email, role, expires_at").eq("organization_id", orgId).is("accepted_at", null).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    can(ctx.org.role, "audit:read") ? db.from("audit_logs").select("id, action, entity, changed_fields, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(8) : Promise.resolve({ data: [] }),
  ]);
  const avatarPaths = (members ?? []).flatMap((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return (p as { avatar_path: string | null } | null)?.avatar_path ? [(p as { avatar_path: string }).avatar_path] : []; });
  const signed = avatarPaths.length ? (await db.storage.from("avatars").createSignedUrls(avatarPaths, 3600)).data ?? [] : [];
  const avatarUrl = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const matrix = permissionMatrix();

  return (
    <div className="space-y-8">
      <section aria-label="Membri">
        <h2 className="mb-2 font-medium">Collaboratori</h2>
        <Table>
          <thead><tr><th>Nome</th><th>Ruolo</th>{manage && <th />}</tr></thead>
          <tbody>
            {(members ?? []).map((m) => {
              const p = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { full_name: string | null; job_title: string | null; avatar_path: string | null } | null;
              const isSelf = m.user_id === ctx.userId;
              return (
                <tr key={m.id as string}>
                  <td>
                    <span className="flex items-center gap-2">
                      <Avatar name={p?.full_name} url={p?.avatar_path ? avatarUrl.get(p.avatar_path) : null} />
                      <span>{p?.full_name ?? "—"} {isSelf && <Badge>tu</Badge>}{p?.job_title ? <span className="block text-xs text-muted">{p.job_title}</span> : null}</span>
                    </span>
                  </td>
                  <td>{manage && !isSelf ? (
                    <form action={changeRoleAction.bind(null, m.id as string)} className="flex gap-2">
                      <Select name="role" defaultValue={m.role as string} aria-label="Ruolo" className="w-40">
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </Select>
                      <Button size="sm" variant="outline">Salva</Button>
                    </form>
                  ) : ROLE_LABEL[m.role as Role]}</td>
                  {manage && <td className="text-right">{!isSelf && <form action={removeMemberAction.bind(null, m.id as string)}><Button size="sm" variant="ghost">Rimuovi</Button></form>}</td>}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </section>

      {manage && (
        <section aria-label="Inviti">
          <h2 className="mb-2 font-medium">Invita una persona</h2>
          <Card><InviteForm /></Card>
          {(invites ?? []).length > 0 && (
            <>
              <h3 className="mb-2 mt-4 text-sm font-medium">Inviti in sospeso</h3>
              <Table><tbody>
                {(invites ?? []).map((i) => (
                  <tr key={i.id as string}>
                    <td>{i.email as string}</td><td>{ROLE_LABEL[i.role as Role]}</td>
                    <td className="text-muted">scade il {new Date(i.expires_at as string).toLocaleDateString("it-IT")}</td>
                    <td className="text-right"><form action={revokeInvitationAction.bind(null, i.id as string)}><Button size="sm" variant="ghost">Revoca</Button></form></td>
                  </tr>
                ))}
              </tbody></Table>
            </>
          )}
        </section>
      )}

      <section aria-label="Ruoli e permessi">
        <h2 className="mb-1 font-medium">Ruoli e permessi</h2>
        <p className="mb-2 text-sm text-muted">I permessi sono definiti dal ruolo e uguali per tutte le aziende.</p>
        <Table>
          <thead><tr><th>Cosa si può fare</th>{ROLES.map((r) => <th key={r} className="text-center">{ROLE_LABEL[r]}</th>)}</tr></thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.permission}>
                <td>{row.label}</td>
                {ROLES.map((r) => <td key={r} className="text-center">{row.roles[r] ? <span aria-label="Sì" className="text-success">●</span> : <span aria-label="No" className="text-muted">—</span>}</td>)}
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section aria-label="Operazioni">
        <div className="mb-2 flex items-center justify-between"><h2 className="font-medium">Ultime operazioni</h2><Link className="text-sm text-primary hover:underline" href="/organizzazione/audit">{(logs ?? []).length > 0 ? "Vedi tutto →" : "Le mie operazioni →"}</Link></div>
        {(logs ?? []).length > 0 && (
          <Table><tbody>
            {(logs ?? []).map((l) => (
              <tr key={l.id as number}>
                <td className="text-muted">{new Date(l.created_at as string).toLocaleString("it-IT")}</td>
                <td>{l.action as string} · {l.entity as string}</td>
                <td className="text-muted">{((l.changed_fields as string[] | null) ?? []).join(", ")}</td>
              </tr>
            ))}
          </tbody></Table>
        )}
      </section>
    </div>
  );
}
