"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { isUuid } from "@/lib/ids";
import { utcToZonedParts, zonedToUtcIso } from "@/lib/datetime";

const KINDS = ["task", "follow_up", "appointment", "quote_followup"] as const;
type Kind = (typeof KINDS)[number];
const parseKind = (k: string): Kind | null => ((KINDS as readonly string[]).includes(k) ? (k as Kind) : null);
function refreshAll() { for (const p of ["/promemoria", "/dashboard", "/attivita", "/followup", "/appuntamenti", "/clienti"]) revalidatePath(p); }

/** Azione rapida del centro Promemoria: completa l'elemento nel suo modulo di origine (nessuna copia). */
export async function completeItemAction(kind: string, id: string) {
  const ctx = await requirePermission("data:write");
  const k = parseKind(kind);
  if (!k || !isUuid(id)) return;
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  if (k === "task") await db.from("tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", id);
  else if (k === "follow_up") await db.rpc("set_follow_up_status", { p_id: id, p_status: "done", p_note: null });
  else if (k === "appointment") await db.from("appointments").update({ status: "completed" }).eq("organization_id", orgId).eq("id", id);
  refreshAll();
}

const newDate = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => new Date(v).toISOString().slice(0, 10) === v) });

/** Riprogramma un elemento mantenendo l'ora (se c'è): attività, follow-up (con cronologia), appuntamento, follow-up di preventivo. */
export async function rescheduleItemAction(kind: string, id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  const k = parseKind(kind);
  if (!k || !isUuid(id)) return fail("Elemento non valido");
  const parsed = newDate.safeParse({ date: formData.get("date") });
  if (!parsed.success) return fail("Data non valida");
  const date = parsed.data.date;
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  if (k === "follow_up") {
    const { error } = await db.rpc("reschedule_follow_up", { p_id: id, p_new_date: date, p_note: "Riprogrammato dal centro Promemoria" });
    if (error) return fail("Impossibile riprogrammare (follow-up chiuso o non trovato)");
  } else if (k === "task") {
    const { data: t } = await db.from("tasks").select("due_at, due_has_time").eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
    if (!t) return fail("Attività non trovata");
    const time = t.due_at && t.due_has_time ? utcToZonedParts(t.due_at as string).time : "09:00";
    const { error } = await db.from("tasks").update({ due_at: zonedToUtcIso(`${date}T${time}`) }).eq("organization_id", orgId).eq("id", id);
    if (error) return fail("Impossibile riprogrammare l'attività");
  } else if (k === "appointment") {
    const { data: a } = await db.from("appointments").select("starts_at, ends_at").eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
    if (!a) return fail("Appuntamento non trovato");
    const s = utcToZonedParts(a.starts_at as string), e = utcToZonedParts(a.ends_at as string);
    const { error } = await db.from("appointments").update({ starts_at: zonedToUtcIso(`${date}T${s.time}`), ends_at: zonedToUtcIso(`${date}T${e.time}`) }).eq("organization_id", orgId).eq("id", id);
    if (error) return fail("Impossibile spostare l'appuntamento");
  } else {
    const { error } = await db.from("quotes").update({ follow_up_date: date }).eq("organization_id", orgId).eq("id", id).is("deleted_at", null);
    if (error) return fail("Impossibile riprogrammare il follow-up del preventivo");
  }
  refreshAll();
  return { ok: true };
}
