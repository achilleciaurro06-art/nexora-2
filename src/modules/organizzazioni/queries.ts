import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Member = { userId: string; name: string; role: string };

/** Membri dell'organizzazione con nome (la RLS di profiles consente la lettura ai colleghi). */
export async function listMembers(db: SupabaseClient, orgId: string): Promise<Member[]> {
  const { data } = await db.from("memberships").select("user_id, role, profiles(full_name)").eq("organization_id", orgId).order("created_at");
  return (data ?? []).map((m) => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return { userId: m.user_id as string, role: m.role as string, name: ((p as { full_name: string | null } | null)?.full_name ?? "Utente") };
  });
}

export function nameMap(members: Member[]): Map<string, string> {
  return new Map(members.map((m) => [m.userId, m.name]));
}
