"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { askCopilot } from "./service";

export type ChatState = { error?: string; conversationId?: string } | null;

export async function sendMessageAction(_prev: ChatState, formData: FormData): Promise<ChatState> {
  const ctx = await requirePermission("ai:use");
  const parsed = z.object({ question: z.string().trim().min(1).max(2000), conversationId: z.uuid().optional().or(z.literal("")) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Scrivi una domanda (max 2000 caratteri)." };
  if (!rateLimit(`copilot:${ctx.userId}`, 20, 10 * 60_000)) return { error: "Troppe richieste, attendi qualche minuto." };

  const db = await createClient();
  const orgId = ctx.org.organizationId;
  let conversationId = parsed.data.conversationId || undefined;
  if (!conversationId) {
    const { data, error } = await db.from("ai_conversations").insert({ organization_id: orgId, user_id: ctx.userId, title: parsed.data.question.slice(0, 80) }).select("id").single();
    if (error || !data) return { error: "Impossibile avviare la conversazione." };
    conversationId = data.id as string;
  }

  const { data: past } = await db.from("ai_messages").select("role, content").eq("organization_id", orgId).eq("conversation_id", conversationId).order("created_at").limit(20);
  const result = await askCopilot({
    db, orgId, userId: ctx.userId, question: parsed.data.question,
    history: (past ?? []).map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string })),
  });
  if (!result.ok) return { error: result.error, conversationId };

  await db.from("ai_messages").insert([
    { organization_id: orgId, conversation_id: conversationId, role: "user", content: parsed.data.question },
    { organization_id: orgId, conversation_id: conversationId, role: "assistant", content: result.reply },
  ]);
  if (result.suggestions.length) {
    await db.from("ai_suggestions").insert(
      result.suggestions.map((s) => ({
        organization_id: orgId, kind: s.kind, payload: s, source_type: "conversation", source_id: conversationId, created_by: ctx.userId,
      })),
    );
  }
  revalidatePath("/copilot");
  return { conversationId };
}

/** Il modello propone, l'utente decide: l'applicazione avviene qui, con i permessi dell'utente. */
export async function decideSuggestionAction(id: string, formData: FormData) {
  const ctx = await requirePermission("data:write");
  const decision = formData.get("decision") === "accept" ? "accepted" : "rejected";
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data: s } = await db.from("ai_suggestions").select("kind, payload, status").eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (!s || s.status !== "pending") return;

  if (decision === "accepted" && s.kind === "task") {
    const p = z.object({ title: z.string().max(200), description: z.string().max(2000).optional(), due_date: z.string().optional() }).safeParse(s.payload);
    if (p.success) {
      const due = p.data.due_date ? new Date(`${p.data.due_date}T09:00:00`).toISOString() : null;
      const { error } = await db.from("tasks").insert({
        organization_id: orgId, title: p.data.title, description: p.data.description ?? null, due_at: due, created_by: ctx.userId, assignee_id: ctx.userId,
      });
      if (error) return;
    }
  }
  await db.from("ai_suggestions").update({ status: decision }).eq("organization_id", orgId).eq("id", id);
  revalidatePath("/copilot");
  revalidatePath("/attivita");
}
