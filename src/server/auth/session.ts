import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/server/supabase/server";
import { can, type Permission, type Role } from "./permissions";

export const ORG_COOKIE = "nx_org";

export type OrgMembership = { organizationId: string; name: string; role: Role };
export type Context = {
  userId: string;
  email: string | null;
  fullName: string | null;
  org: OrgMembership;
  orgs: OrgMembership[];
};

export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: (claims.email as string | undefined) ?? null };
});

/** Utente + organizzazione attiva. L'org nel cookie NON è fidata: viene riverificata dalle membership (RLS). */
export const getContext = cache(async (): Promise<Context | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const [{ data: memberships }, { data: profile }] = await Promise.all([
    supabase.from("memberships").select("organization_id, role, organizations(name)").eq("user_id", user.id),
    supabase.from("profiles").select("full_name, default_organization_id").eq("id", user.id).maybeSingle(),
  ]);
  const orgs: OrgMembership[] = (memberships ?? []).flatMap((m) => {
    const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
    return org ? [{ organizationId: m.organization_id, name: org.name, role: m.role as Role }] : [];
  });
  if (orgs.length === 0) return null;
  const wanted = (await cookies()).get(ORG_COOKIE)?.value ?? profile?.default_organization_id;
  const org = orgs.find((o) => o.organizationId === wanted) ?? orgs[0]!;
  return { userId: user.id, email: user.email, fullName: profile?.full_name ?? null, org, orgs };
});

export async function requireContext(): Promise<Context> {
  const ctx = await getContext();
  if (ctx) return ctx;
  const user = await getUser();
  if (!user) redirect("/login");
  // Utente autenticato ma senza azienda: niente cicli di redirect.
  redirect((await isPlatformAdmin(user.id).catch(() => false)) ? "/admin" : "/nessuna-azienda");
}

export async function requirePermission(permission: Permission): Promise<Context> {
  const ctx = await requireContext();
  if (!can(ctx.org.role, permission)) throw new Error("Permesso negato");
  return ctx;
}

/** Amministratori di piattaforma: tabella private, interrogata via RPC riservata al service role. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { createAdminClient } = await import("@/server/supabase/admin");
  const { data } = await createAdminClient().rpc("rpc_is_platform_admin", { p_user: userId });
  return data === true;
}
