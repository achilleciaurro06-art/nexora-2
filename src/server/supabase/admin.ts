import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/server/env";

/**
 * Client service-role: salta la RLS. Usabile SOLO da moduli autorizzati (vedi regola ESLint)
 * e solo dopo un controllo esplicito dei permessi.
 */
export function createAdminClient() {
  const e = env();
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
