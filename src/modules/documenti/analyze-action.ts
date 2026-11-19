"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { analyzeDocument } from "./analysis";

export async function analyzeDocumentAction(documentId: string) {
  const ctx = await requirePermission("ai:use");
  if (!can(ctx.org.role, "data:write")) return;
  if (!rateLimit(`analyze:${ctx.userId}`, 10, 10 * 60_000)) return;
  await analyzeDocument({ db: await createClient(), orgId: ctx.org.organizationId, userId: ctx.userId, documentId });
  revalidatePath("/documenti");
  revalidatePath("/copilot");
}
