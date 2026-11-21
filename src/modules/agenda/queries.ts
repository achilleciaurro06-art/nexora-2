import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, todayIn } from "@/lib/datetime";
import { UPCOMING_DAYS, type AgendaItem } from "./agenda";

/**
 * Elementi dell'agenda letti dalla vista `agenda_items` (attività, follow-up, appuntamenti, follow-up dei preventivi): nessuna copia dei dati.
 * Finestra: aperti con data fino a +14 giorni (o senza data), più i completati negli ultimi 30 giorni.
 */
export async function listAgenda(db: SupabaseClient, orgId: string, now: Date): Promise<AgendaItem[]> {
  const today = todayIn(now);
  const until = addDays(today, UPCOMING_DAYS);
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const { data } = await db.from("agenda_items").select("*").eq("organization_id", orgId)
    .or(`and(is_open.eq.true,when_date.lte.${until}),and(is_open.eq.true,when_date.is.null),and(is_done.eq.true,completed_at.gte.${since})`)
    .limit(3000);
  return (data ?? []) as AgendaItem[];
}

export type TaskType = { id: string; key: string; label: string; system: boolean; active: boolean };
export async function listTaskTypes(db: SupabaseClient, orgId: string, onlyActive = false): Promise<TaskType[]> {
  let q = db.from("task_types").select("id, key, label, system, active").eq("organization_id", orgId).order("position").order("created_at");
  if (onlyActive) q = q.eq("active", true);
  const { data } = await q;
  return (data ?? []) as TaskType[];
}
