import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { SuggestionList, type SuggestionRow } from "@/modules/copilot/ui/suggestion-list";
import { ChatPanel, type ChatMessage } from "@/modules/copilot/ui/chat";
import { Card, PageHeader } from "@/components/ui/card";

export const metadata = { title: "Copilot AI" };
export const maxDuration = 60;

export default async function CopilotPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const [{ data: convs }, { data: quota }, { data: suggestions }] = await Promise.all([
    db.from("ai_conversations").select("id, title").eq("organization_id", orgId).eq("user_id", ctx.userId).order("updated_at", { ascending: false }).limit(15),
    db.from("ai_quotas").select("monthly_token_limit, tokens_used").eq("organization_id", orgId).maybeSingle(),
    db.from("ai_suggestions").select("id, kind, payload").eq("organization_id", orgId).eq("status", "pending").order("created_at", { ascending: false }).limit(10),
  ]);
  // ?c= vuoto = "nuova conversazione"; nessun parametro = ultima conversazione
  const active = c === undefined ? (convs?.[0]?.id as string | undefined) : c || undefined;
  const { data: messages } = active
    ? await db.from("ai_messages").select("id, role, content").eq("organization_id", orgId).eq("conversation_id", active).order("created_at")
    : { data: [] };
  const canAi = can(ctx.org.role, "ai:use");
  const canDecide = can(ctx.org.role, "data:write");
  const used = Number(quota?.tokens_used ?? 0);
  const limit = Number(quota?.monthly_token_limit ?? 0);

  return (
    <>
      <PageHeader title="Copilot AI" description={quota ? `Consumo mensile: ${used.toLocaleString("it-IT")} / ${limit.toLocaleString("it-IT")} token` : undefined} />
      <div className="grid gap-4 lg:grid-cols-[220px_1fr_300px]">
        <Card className="h-fit">
          <h2 className="mb-2 text-sm font-medium">Conversazioni</h2>
          <ul className="space-y-1 text-sm">
            <li><Link className="text-primary hover:underline" href="/copilot?c=">+ Nuova</Link></li>
            {(convs ?? []).map((v) => <li key={v.id as string} className="truncate"><Link className={`hover:underline ${v.id === active ? "font-medium" : "text-muted"}`} href={`/copilot?c=${v.id}`}>{(v.title as string) || "Senza titolo"}</Link></li>)}
          </ul>
        </Card>
        <Card>
          <ChatPanel key={active ?? "new"} conversationId={active} initialMessages={(messages ?? []) as ChatMessage[]} canUse={canAi} />
        </Card>
        <Card className="h-fit">
          <h2 className="mb-2 text-sm font-medium">Suggerimenti da approvare</h2>
          <SuggestionList suggestions={(suggestions ?? []) as SuggestionRow[]} canDecide={canDecide} />
        </Card>
      </div>
    </>
  );
}
