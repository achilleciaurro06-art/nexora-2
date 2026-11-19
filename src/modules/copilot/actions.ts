"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { askCopilot } from "./service";
import { extractionSchema } from "@/modules/documenti/analysis";
import { saveQuote } from "@/modules/preventivi/repository";

export type ChatResult = { error?: string; reply?: string; conversationId?: string };

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
    db, orgId, userId: ctx.userId, question: parsed.data.question,
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
  return { reply: result.reply, conversationId };
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
  if (decision === "accepted" && s.kind === "quote_draft") {
    const p = extractionSchema.safeParse(s.payload);
    if (!p.success) return;
    // cliente: si riusa quello esistente con lo stesso nome, altrimenti lo si crea (azione esplicita dell'utente)
    const name = (p.data.client_name ?? "").trim();
    let customerId: string | null = null;
    if (name) {
      const { data: found } = await db.from("customers").select("id").eq("organization_id", orgId).is("deleted_at", null).ilike("name", name.replace(/[%_]/g, "")).limit(1).maybeSingle();
      customerId = (found?.id as string | undefined) ?? null;
      if (!customerId) {
        const { data: created } = await db.from("customers").insert({ organization_id: orgId, name, created_by: ctx.userId }).select("id").single();
        customerId = (created?.id as string | undefined) ?? null;
      }
    }
    if (!customerId) return; // senza cliente non si crea nulla: l'utente può creare il preventivo a mano
    const items = p.data.items?.length
      ? p.data.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPriceCents: Math.round(i.unit_price * 100), discountPercent: 0, vatRate: 22 }))
      : [{ description: p.data.description || p.data.quote_title || "Prestazione", quantity: 1, unitPriceCents: Math.round((p.data.amount ?? 0) * 100), discountPercent: 0, vatRate: 22 }];
    const { data: quoteId, error } = await saveQuote(db, orgId, null, {
      customerId, title: p.data.quote_title ?? null, issueDate: null, validUntil: null, followUpDate: null, notes: p.data.description ?? null, terms: null, items,
    });
    if (error || !quoteId) return;
    await db.from("ai_suggestions").update({ status: "accepted" }).eq("organization_id", orgId).eq("id", id);
    revalidatePath("/preventivi");
    redirect(`/preventivi/${quoteId as string}`);
  }
  await db.from("ai_suggestions").update({ status: decision }).eq("organization_id", orgId).eq("id", id);
  revalidatePath("/copilot");
  revalidatePath("/attivita");
  revalidatePath("/documenti");
}
