import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Genera (idempotente) le notifiche dell'utente corrente e restituisce il numero di non lette.
 * Nessun cron: il calcolo avviene all'apertura dell'app. Se la funzione non è disponibile restituisce 0.
 */
export async function refreshAndCountUnread(db: SupabaseClient, userId: string): Promise<number> {
  await db.rpc("refresh_my_notifications");
  const { count } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null);
  return count ?? 0;
}
