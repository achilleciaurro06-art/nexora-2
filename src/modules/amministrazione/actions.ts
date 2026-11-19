"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContextOrUser, assertPlatformAdmin } from "./guard";
import { createAdminClient } from "@/server/supabase/admin";
import { generateActivationCode } from "@/modules/auth/crypto";
import { hashSecret } from "@/modules/auth/crypto";

export type CodeState = { ok: false; error: string } | { ok: true; code: string; email: string } | null;

const schema = z.object({
  email: z.email("Email non valida").transform((v) => v.toLowerCase()),
  days: z.coerce.number().int().min(1).max(90).default(14),
  note: z.string().trim().max(200).optional(),
});

export async function createActivationCodeAction(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const user = await requireContextOrUser();
  await assertPlatformAdmin(user.id);
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dati non validi" };

  const code = generateActivationCode();
  const { error } = await createAdminClient().rpc("rpc_create_activation_code", {
    p_code_hash: hashSecret(code), p_expires_at: new Date(Date.now() + parsed.data.days * 86_400_000).toISOString(),
    p_max_uses: 1, p_bound_email: parsed.data.email, p_note: parsed.data.note ?? "", p_created_by: user.id,
  });
  if (error) return { ok: false, error: "Impossibile creare il codice" };
  revalidatePath("/admin");
  return { ok: true, code, email: parsed.data.email };
}

export async function setOrganizationStatusAction(orgId: string, formData: FormData) {
  const user = await requireContextOrUser();
  await assertPlatformAdmin(user.id);
  const status = z.enum(["active", "suspended"]).safeParse(formData.get("status"));
  if (!status.success) return;
  await createAdminClient().from("organizations").update({ status: status.data }).eq("id", orgId);
  revalidatePath("/admin");
}

export async function setAiQuotaAction(orgId: string, formData: FormData) {
  const user = await requireContextOrUser();
  await assertPlatformAdmin(user.id);
  const limit = z.coerce.number().int().min(0).max(1_000_000_000).safeParse(formData.get("limit"));
  if (!limit.success) return;
  await createAdminClient().from("ai_quotas").update({ monthly_token_limit: limit.data, updated_at: new Date().toISOString() }).eq("organization_id", orgId);
  revalidatePath("/admin");
}
