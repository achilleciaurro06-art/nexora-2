"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { generateToken, hashSecret } from "@/modules/auth/crypto";
import { isUuid } from "@/lib/ids";

export type InviteState = { ok: false; error: string } | { ok: true; link: string } | null;

const inviteSchema = z.object({ email: z.email("Email non valida").transform((v) => v.toLowerCase()), role: z.enum(["admin", "member", "viewer"]) });

export async function inviteMemberAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const ctx = await requirePermission("members:manage");
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dati non validi" };
  const token = generateToken();
  const { error } = await (await createClient()).from("invitations").insert({
    organization_id: ctx.org.organizationId, email: parsed.data.email, role: parsed.data.role,
    token_hash: hashSecret(token), expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), invited_by: ctx.userId,
  });
  if (error) return { ok: false, error: "Impossibile creare l'invito" };
  revalidatePath("/impostazioni/team");
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return { ok: true, link: `${base}/invito/${token}` };
}

export async function changeRoleAction(membershipId: string, formData: FormData) {
  const ctx = await requirePermission("members:manage");
  const role = z.enum(["owner", "admin", "member", "viewer"]).safeParse(formData.get("role"));
  if (!role.success || !isUuid(membershipId)) return;
  await (await createClient()).from("memberships").update({ role: role.data }).eq("organization_id", ctx.org.organizationId).eq("id", membershipId);
  revalidatePath("/impostazioni/team");
}

export async function removeMemberAction(membershipId: string) {
  const ctx = await requirePermission("members:manage");
  if (!isUuid(membershipId)) return;
  await (await createClient()).from("memberships").delete().eq("organization_id", ctx.org.organizationId).eq("id", membershipId);
  revalidatePath("/impostazioni/team");
}

export async function revokeInvitationAction(id: string) {
  const ctx = await requirePermission("members:manage");
  if (!isUuid(id)) return;
  await (await createClient()).from("invitations").delete().eq("organization_id", ctx.org.organizationId).eq("id", id);
  revalidatePath("/impostazioni/team");
}
