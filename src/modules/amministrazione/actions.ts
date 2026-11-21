"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContextOrUser, assertPlatformAdmin } from "./guard";
import { createAdminClient } from "@/server/supabase/admin";
import { generateActivationCode } from "@/modules/auth/crypto";
import { hashSecret } from "@/modules/auth/crypto";
import { isUuid } from "@/lib/ids";

/** Ogni operazione di piattaforma è tracciata in un registro separato (non visibile alle aziende). */
async function logPlatformAction(actor: string, action: string, orgId: string | null, details: Record<string, unknown>) {
  await createAdminClient().rpc("rpc_log_platform_action", { p_actor: actor, p_action: action, p_org: orgId, p_details: details });
}

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
  await logPlatformAction(user.id, "create_activation_code", null, { bound_email: parsed.data.email, days: parsed.data.days, note: parsed.data.note ?? "" });
  revalidatePath("/admin");
  return { ok: true, code, email: parsed.data.email };
}

export async function setOrganizationStatusAction(orgId: string, formData: FormData) {
  const user = await requireContextOrUser();
  await assertPlatformAdmin(user.id);
  const status = z.enum(["active", "suspended"]).safeParse(formData.get("status"));
  if (!status.success) return;
  if (!isUuid(orgId)) return;
  const { error } = await createAdminClient().from("organizations").update({ status: status.data }).eq("id", orgId);
  if (!error) await logPlatformAction(user.id, "set_organization_status", orgId, { status: status.data });
  revalidatePath("/admin");
}

export async function setAiQuotaAction(orgId: string, formData: FormData) {
  const user = await requireContextOrUser();
  await assertPlatformAdmin(user.id);
  const limit = z.coerce.number().int().min(0).max(1_000_000_000).safeParse(formData.get("limit"));
  if (!limit.success) return;
  if (!isUuid(orgId)) return;
  // prezzi per milione di token (micro-euro): facoltativi, servono SOLO a stimare il costo; vuoti = costo non calcolato
  const price = (k: string) => { const raw = String(formData.get(k) ?? "").trim().replace(",", "."); if (raw === "") return null; const n = Number(raw); return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? Math.round(n * 1_000_000) : undefined; };
  const inP = price("input_price"), outP = price("output_price");
  if (inP === undefined || outP === undefined) return;
  const bothOrNone = (inP === null) === (outP === null);
  if (!bothOrNone) return;
  const { error } = await createAdminClient().from("ai_quotas").update({ monthly_token_limit: limit.data, input_price_micro_per_mtok: inP, output_price_micro_per_mtok: outP, updated_at: new Date().toISOString() }).eq("organization_id", orgId);
  if (!error) await logPlatformAction(user.id, "set_ai_quota", orgId, { monthly_token_limit: limit.data, input_price_eur_per_mtok: inP === null ? null : inP / 1_000_000, output_price_eur_per_mtok: outP === null ? null : outP / 1_000_000 });
  revalidatePath("/admin");
}
