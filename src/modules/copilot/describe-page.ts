import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PageContext } from "./page-context";

/** Etichetta leggibile dell'elemento aperto, letta con i permessi dell'utente: se non è accessibile il contesto viene scartato. */
export async function describePage(db: SupabaseClient, orgId: string, p: PageContext): Promise<string | null> {
  if (!p.entityId || !p.entityType) return null;
  if (p.entityType === "customer") { const { data } = await db.from("customers").select("name").eq("organization_id", orgId).eq("id", p.entityId).maybeSingle(); return data ? `cliente «${data.name}»` : null; }
  if (p.entityType === "quote") { const { data } = await db.from("quotes").select("number, customers(name)").eq("organization_id", orgId).eq("id", p.entityId).maybeSingle(); const c = Array.isArray(data?.customers) ? data?.customers[0] : data?.customers; return data ? `preventivo ${data.number}${c ? ` di ${(c as { name: string }).name}` : ""}` : null; }
  if (p.entityType === "appointment") { const { data } = await db.from("appointments").select("title").eq("organization_id", orgId).eq("id", p.entityId).maybeSingle(); return data ? `appuntamento «${data.title}»` : null; }
  const { data } = await db.from("email_threads").select("subject").eq("organization_id", orgId).eq("id", p.entityId).maybeSingle();
  return data ? `conversazione email con oggetto «${String(data.subject).replace(/[«»\n\r]/g, " ").slice(0, 120)}»` : null;
}
