"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { isUuid } from "@/lib/ids";
import { executeProposal } from "./execute";

/**
 * Il modello propone, l'utente decide: la CONFERMA arriva solo da qui (utente autenticato, permesso data:write, verificato lato server).
 * Un testo del modello — o contenuto in una email — non è mai una conferma.
 */
export async function confirmProposalAction(id: string): Promise<{ ok: true; summary: string; redirectTo?: string } | { ok: false; error: string }> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return { ok: false, error: "Proposta non valida" };
  const db = await createClient();
  const { data: s } = await db.from("ai_suggestions").select("kind").eq("organization_id", ctx.org.organizationId).eq("id", id).maybeSingle();
  if (!s) return { ok: false, error: "Proposta non trovata" };
  if (s.kind === "quote_draft") return { ok: true, summary: "Apro la schermata di revisione.", redirectTo: `/documenti/revisione/${id}` };
  if (s.kind === "price_review" || s.kind === "insight") return { ok: false, error: "Questa proposta si gestisce dal punto in cui è stata generata." };
  const r = await executeProposal({ db, orgId: ctx.org.organizationId, userId: ctx.userId, id });
  for (const p of ["/copilot", "/attivita", "/followup", "/promemoria", "/appuntamenti", "/dashboard", "/catalogo", "/preventivi", "/clienti", "/email"]) revalidatePath(p);
  return r;
}

export async function rejectProposalAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return { ok: false, error: "Proposta non valida" };
  const db = await createClient();
  const { data, error } = await db.from("ai_suggestions").update({ status: "rejected" }).eq("organization_id", ctx.org.organizationId).eq("id", id).eq("status", "pending").eq("execution_status", "not_run").select("id");
  revalidatePath("/copilot");
  return error || !data?.length ? { ok: false, error: "La proposta non è più in attesa." } : { ok: true };
}

/** Suggerimenti storici (analisi documenti/prezzi) gestiti dalla lista «Suggerimenti da approvare». */
export async function decideSuggestionAction(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Suggerimento non valido");
  const decision = formData.get("decision") === "accept" ? "accepted" : "rejected";
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data: s } = await db.from("ai_suggestions").select("kind, payload, status").eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (!s) return fail("Suggerimento non trovato");
  if (s.status !== "pending") return fail("Questo suggerimento è già stato gestito");

  let redirectTo: string | undefined;
  if (decision === "accepted") {
    if (s.kind === "quote_draft") redirect(`/documenti/revisione/${id}`);
    if (s.kind === "price_review") return fail("Applica o ignora il prezzo dal pannello «Analisi dei prezzi» del preventivo.");
    const overrides: Record<string, string> = {};
    for (const [k, v] of formData.entries()) if (typeof v === "string" && ["title", "due_date", "follow_up_date", "body", "description"].includes(k)) overrides[k] = v;
    const res = await executeProposal({ db, orgId, userId: ctx.userId, id, overrides });
    if (!res.ok) return fail(res.error);
    redirectTo = res.redirectTo;
  } else {
    const { data } = await db.from("ai_suggestions").update({ status: "rejected" }).eq("organization_id", orgId).eq("id", id).eq("status", "pending").eq("execution_status", "not_run").select("id");
    if (!data?.length) return fail("Questo suggerimento è già stato gestito");
  }
  revalidatePath("/copilot"); revalidatePath("/attivita"); revalidatePath("/documenti"); revalidatePath("/dashboard");
  if (redirectTo) redirect(redirectTo);
  return { ok: true };
}
