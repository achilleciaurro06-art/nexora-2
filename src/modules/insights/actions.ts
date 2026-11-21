"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/auth/session";
import { setInsightStatus } from "@/server/ai/privileged";
import { createClient } from "@/server/supabase/server";
import { ensureInsights } from "./service";
import { rateLimit } from "@/lib/rate-limit";

const status = z.enum(["seen", "done", "dismissed", "new"]);

/** Stato di un insight (visualizzato, completato, ignorato). Le scritture passano da una funzione del service_role dopo il controllo del ruolo. */
export async function setInsightStatusAction(id: string, next: string): Promise<{ ok: boolean }> {
  const ctx = await requirePermission("data:write");
  const s = status.safeParse(next);
  if (!s.success || !z.uuid().safeParse(id).success) return { ok: false };
  const ok = await setInsightStatus(ctx.org.organizationId, id, s.data, ctx.userId);
  revalidatePath("/dashboard");
  return { ok };
}

/** Rigenerazione su richiesta (con limite di frequenza): 1 minuto tra una rigenerazione e l'altra. */
export async function refreshInsightsAction(): Promise<{ ok: boolean; ran: boolean }> {
  const ctx = await requirePermission("data:read");
  if (!rateLimit(`insights:${ctx.userId}`, 5, 10 * 60_000)) return { ok: false, ran: false };
  const r = await ensureInsights(await createClient(), ctx.org.organizationId, new Date(), 60);
  revalidatePath("/dashboard");
  return { ok: !r.error, ran: r.ran };
}
