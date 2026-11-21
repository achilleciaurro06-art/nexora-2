import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { getContext } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { env } from "@/server/env";
import { runCopilot } from "@/modules/copilot/service";
import { parsePageContext } from "@/modules/copilot/page-context";
import { prepareProposals } from "@/modules/copilot/prepare";
import { describePage } from "@/modules/copilot/describe-page";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const body = z.object({ question: z.string().trim().min(1).max(2000), conversationId: z.uuid().optional(), requestId: z.uuid(), path: z.string().max(300).optional() });

const json = (data: unknown, status: number) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * Chat del Copilot con avanzamento in streaming (NDJSON): eventi `status` durante l'elaborazione, poi `done` o `error`.
 * Difese: stessa origine, sessione e ruolo verificati, limite di frequenza, id richiesta (idempotenza dei crediti).
 */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return json({ error: "Origine non consentita" }, 403);
  const ctx = await getContext();
  if (!ctx) return json({ error: "Sessione scaduta: accedi di nuovo." }, 401);
  if (!can(ctx.org.role, "ai:use")) return json({ error: "Il tuo ruolo non può usare il Copilot." }, 403);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Scrivi una domanda (max 2000 caratteri)." }, 400);
  if (!rateLimit(`copilot:${ctx.userId}`, env().AI_RATE_LIMIT_PER_10MIN ?? 20, 10 * 60_000)) return json({ error: "Troppe richieste, attendi qualche minuto." }, 429);

  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const page = parsePageContext(parsed.data.path);
  const pageLabel = await describePage(db, orgId, page);
  const effectivePage = pageLabel ? page : { page: page.page };

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
      let conversationId = parsed.data.conversationId;
      try {
        if (conversationId) {
          const { data: own } = await db.from("ai_conversations").select("id").eq("organization_id", orgId).eq("id", conversationId).maybeSingle();
          if (!own) conversationId = undefined;
        }
        if (!conversationId) {
          const { data, error } = await db.from("ai_conversations").insert({ organization_id: orgId, user_id: ctx.userId, title: parsed.data.question.slice(0, 80), page_context: { page: effectivePage.page, entityType: effectivePage.entityType ?? null } }).select("id").single();
          if (error || !data) { send({ type: "error", error: "Impossibile avviare la conversazione." }); return controller.close(); }
          conversationId = data.id as string;
        }
        send({ type: "status", text: "Leggo la tua domanda…" });
        const { data: past } = await db.from("ai_messages").select("role, content").eq("organization_id", orgId).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(10);
        const history = (past ?? []).reverse().map((m) => ({ role: m.role as "user" | "assistant", content: (m.content as string).slice(0, 3000) }));
        const result = await runCopilot({
          db, orgId, userId: ctx.userId, role: ctx.org.role, userName: ctx.fullName, history, question: parsed.data.question, page: effectivePage, pageLabel, requestId: parsed.data.requestId,
          onEvent: (e) => send(e),
        });
        if (!result.ok) { send({ type: "error", error: result.error, conversationId, kind: result.kind }); return controller.close(); }
        send({ type: "status", text: "Preparo la risposta…" });
        await db.from("ai_messages").insert({ organization_id: orgId, conversation_id: conversationId, role: "user", content: parsed.data.question });
        const { proposals, dropped } = await prepareProposals({ db, orgId, userId: ctx.userId, conversationId }, result.actions);
        await db.from("ai_messages").insert({ organization_id: orgId, conversation_id: conversationId, role: "assistant", content: result.reply, sources: result.sources.slice(0, 20) });
        await db.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", conversationId);
        send({ type: "done", reply: result.reply, conversationId, sources: result.sources, proposals, droppedProposals: dropped, tools: result.toolsUsed.length });
      } catch (e) {
        console.error("copilot route error", e instanceof Error ? e.message.slice(0, 200) : "unknown");
        send({ type: "error", error: "Si è verificato un errore. Riprova tra poco.", conversationId });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}
