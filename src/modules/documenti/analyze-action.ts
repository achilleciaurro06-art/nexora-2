"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { fail, type ActionResult } from "@/lib/result";
import { analyzeDocument } from "./analysis";

export async function analyzeDocumentAction(documentId: string, _prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("ai:use");
  if (!can(ctx.org.role, "data:write")) return fail("Permesso negato");
  if (!rateLimit(`analyze:${ctx.userId}`, 10, 10 * 60_000)) return fail("Troppe analisi ravvicinate, attendi qualche minuto.");
  const res = await analyzeDocument({ db: await createClient(), orgId: ctx.org.organizationId, userId: ctx.userId, documentId });
  revalidatePath("/documenti");
  revalidatePath("/copilot");
  return res.ok ? { ok: true } : fail(res.error);
}
