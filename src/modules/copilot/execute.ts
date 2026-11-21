import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimAction, finishAction } from "@/server/ai/privileged";
import { applySuggestion } from "./apply";

export type ExecuteResult = { ok: true; summary: string; redirectTo?: string } | { ok: false; error: string };

/**
 * Esegue una proposta DOPO la conferma dell'utente autenticato (la chiamata arriva solo dalla server action, mai dal modello).
 * 1. prenotazione atomica nel DB: una sola esecuzione per proposta, doppio click/richieste concorrenti non duplicano;
 * 2. esecuzione con il client dell'utente (RLS e permessi dell'utente, non quelli del modello);
 * 3. esito registrato (eseguita / fallita con motivo) e ritentabile solo se fallita.
 */
export async function executeProposal(a: { db: SupabaseClient; orgId: string; userId: string; id: string; overrides?: Record<string, string> }): Promise<ExecuteResult> {
  const claim = await claimAction(a.orgId, a.id, a.userId);
  if (!claim.ok) return { ok: false, error: "Impossibile avviare l'operazione. Riprova." };
  const row = claim.row;
  if (!row) {
    const { data: cur } = await a.db.from("ai_suggestions").select("execution_status, status").eq("organization_id", a.orgId).eq("id", a.id).maybeSingle();
    if (!cur) return { ok: false, error: "Proposta non trovata" };
    if (cur.execution_status === "done") return { ok: false, error: "Questa operazione è già stata eseguita." };
    if (cur.execution_status === "running") return { ok: false, error: "Operazione già in corso." };
    return { ok: false, error: "Questa proposta è già stata gestita." };
  }
  let res: Awaited<ReturnType<typeof applySuggestion>>;
  try {
    res = await applySuggestion({ db: a.db, orgId: a.orgId, userId: a.userId, kind: row.kind, payload: row.payload, overrides: a.overrides ?? {} });
  } catch (e) {
    console.error("proposal execution crashed", e instanceof Error ? e.message.slice(0, 200) : "unknown");
    res = { ok: false, error: "Errore imprevisto durante l'esecuzione." };
  }
  await finishAction(a.orgId, a.id, a.userId, res.ok, res.ok ? { summary: res.summary ?? "Operazione eseguita", redirectTo: res.redirectTo ?? null } : { error: res.error });
  return res.ok ? { ok: true, summary: res.summary ?? "Operazione eseguita.", redirectTo: res.redirectTo } : { ok: false, error: res.error };
}
