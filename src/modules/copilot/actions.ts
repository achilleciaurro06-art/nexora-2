"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { askCopilot } from "./service";
import { applySuggestion } from "./apply";
import { fail, type ActionResult } from "@/lib/result";
import { isUuid } from "@/lib/ids";

export type ChatResult = { error?: string; reply?: string; conversationId?: string; sources?: string[] };

const chatInput = z.object({ question: z.string().trim().min(1).max(2000), conversationId: z.uuid().optional() });

export async function sendMessageAction(input: { question: string; conversationId?: string }): Promise<ChatResult> {
  const ctx = await requirePermission("ai:use");
  const parsed = chatInput.safeParse(input);
  if (!parsed.success) return { error: "Scrivi una domanda (max 2000 caratteri)." };
  if (!rateLimit(`copilot:${ctx.userId}`, 20, 10 * 60_000)) return { error: "Troppe richieste, attendi qualche minuto." };

  const db = await createClient();
  const orgId = ctx.org.organizationId;
  let conversationId = parsed.data.conversationId;
  if (conversationId) {
    // la conversazione deve essere dell'utente (RLS) e dell'organizzazione attiva
    const { data: own } = await db.from("ai_conversations").select("id").eq("organization_id", orgId).eq("id", conversationId).maybeSingle();
    if (!own) conversationId = undefined;
  }
  if (!conversationId) {
    const { data, error } = await db.from("ai_conversations").insert({ organization_id: orgId, user_id: ctx.userId, title: parsed.data.question.slice(0, 80) }).select("id").single();
    if (error || !data) return { error: "Impossibile avviare la conversazione." };
    conversationId = data.id as string;
  }

  const { data: past } = await db.from("ai_messages").select("role, content").eq("organization_id", orgId).eq("conversation_id", conversationId).order("created_at").limit(20);
  const result = await askCopilot({
    db, orgId, userId: ctx.userId, userName: ctx.fullName, question: parsed.data.question,
    history: (past ?? []).map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string })),
  });
  if (!result.ok) return { error: result.error, conversationId };

  // due insert distinti: created_at diverso, ordine garantito (domanda prima della risposta)
  await db.from("ai_messages").insert({ organization_id: orgId, conversation_id: conversationId, role: "user", content: parsed.data.question });
  await db.from("ai_messages").insert({ organization_id: orgId, conversation_id: conversationId, role: "assistant", content: result.reply });
  await db.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", conversationId);
  if (result.suggestions.length) {
    await db.from("ai_suggestions").insert(
      result.suggestions.map((s) => ({
        organization_id: orgId, kind: s.kind, payload: s, source_type: "conversation", source_id: conversationId, created_by: ctx.userId,
      })),
    );
  }
  return { reply: result.reply, conversationId, sources: result.packs };
}

/**
 * Il modello propone, l'utente decide: l'applicazione avviene qui, con i permessi dell'utente.
 * - bozze da documento/Copilot: si passa sempre dalla schermata di revisione;
 * - proposte di prezzo: si applicano dal pannello dell'analisi prezzi.
 */
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
    const res = await applySuggestion({ db, orgId, userId: ctx.userId, kind: s.kind as string, payload: s.payload, overrides });
    if (!res.ok) return fail(res.error);
    redirectTo = res.redirectTo;
  }
  await db.from("ai_suggestions").update({ status: decision }).eq("organization_id", orgId).eq("id", id);
  revalidatePath("/copilot"); revalidatePath("/attivita"); revalidatePath("/documenti"); revalidatePath("/dashboard");
  if (redirectTo) redirect(redirectTo);
  return { ok: true };
}
