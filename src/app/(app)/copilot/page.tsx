import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { SuggestionList, type SuggestionRow } from "@/modules/copilot/ui/suggestion-list";
import { ChatPanel, type ChatMessage } from "@/modules/copilot/ui/chat";
import type { ProposalView } from "@/modules/copilot/ui/proposal-card";
import { CreditsPanel, type UsageView } from "@/modules/copilot/ui/credits";
import { suggestedQuestions } from "@/modules/copilot/page-context";
import { PROPOSAL_LABEL, proposalDetails } from "@/modules/copilot/proposals";
import { Card, PageHeader } from "@/components/ui/card";

export const metadata = { title: "Copilot AI" };
export const maxDuration = 60;

export default async function CopilotPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const isAdmin = can(ctx.org.role, "members:manage");
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const [{ data: convs }, { data: quota }, { data: suggestions }, { data: usage }] = await Promise.all([
    db.from("ai_conversations").select("id, title, updated_at").eq("organization_id", orgId).eq("user_id", ctx.userId).order("updated_at", { ascending: false }).limit(30),
    db.from("ai_quotas").select("monthly_token_limit, tokens_used, input_price_micro_per_mtok, output_price_micro_per_mtok").eq("organization_id", orgId).maybeSingle(),
    db.from("ai_suggestions").select("id, kind, payload").eq("organization_id", orgId).eq("status", "pending").is("conversation_id", null).order("created_at", { ascending: false }).limit(10),
    db.from("ai_usage").select("id, created_at, feature, model, input_tokens, output_tokens, cost_micro_eur, status, tokens_source, cost_source").eq("organization_id", orgId).gte("created_at", monthStart).order("created_at", { ascending: false }).limit(12),
  ]);
  // ?c= vuoto = "nuova conversazione"; nessun parametro = ultima conversazione
  const active = c === undefined ? (convs?.[0]?.id as string | undefined) : c || undefined;
  const [{ data: messages }, { data: props }] = active
    ? await Promise.all([
      db.from("ai_messages").select("id, role, content, sources").eq("organization_id", orgId).eq("conversation_id", active).order("created_at"),
      db.from("ai_suggestions").select("id, kind, payload, description, status, execution_status, execution_result").eq("organization_id", orgId).eq("conversation_id", active).order("created_at"),
    ])
    : [{ data: [] }, { data: [] }];
  const canAi = can(ctx.org.role, "ai:use");
  const canDecide = can(ctx.org.role, "data:write");
  const proposals: ProposalView[] = (props ?? []).map((p) => ({
    id: p.id as string, kind: p.kind as string, label: PROPOSAL_LABEL[p.kind as string] ?? (p.kind as string), description: (p.description as string | null) ?? "", details: proposalDetails(p.kind as string, (p.payload ?? {}) as Record<string, unknown>),
    status: p.status as ProposalView["status"], execution_status: p.execution_status as ProposalView["execution_status"], result: p.execution_result as ProposalView["result"],
  }));
  const chatMessages: ChatMessage[] = (messages ?? []).map((m) => ({ id: m.id as string, role: m.role as "user" | "assistant", content: m.content as string, sources: (m.sources ?? []) as ChatMessage["sources"] }));

  return (
    <>
      <PageHeader title="Copilot AI" description="L'assistente che conosce la tua azienda: legge i dati reali con gli strumenti autorizzati e prepara azioni da confermare." />
      <div className="grid gap-4 lg:grid-cols-[220px_1fr_320px]">
        <Card className="h-fit">
          <h2 className="mb-2 text-sm font-medium">Conversazioni</h2>
          <ul className="space-y-1 text-sm">
            <li><Link className="text-primary hover:underline" href="/copilot?c=" data-testid="new-conversation">+ Nuova</Link></li>
            {(convs ?? []).map((v) => <li key={v.id as string} className="truncate"><Link className={`hover:underline ${v.id === active ? "font-medium" : "text-muted"}`} href={`/copilot?c=${v.id}`}>{(v.title as string) || "Senza titolo"}</Link></li>)}
          </ul>
        </Card>
        <Card>
          <ChatPanel key={active ?? "new"} conversationId={active} initialMessages={chatMessages} initialProposals={proposals} canUse={canAi} canConfirm={canDecide} path="/copilot" suggestions={suggestedQuestions({ page: "generic" })} />
        </Card>
        <div className="space-y-4">
          <CreditsPanel quota={quota ? { limit: Number(quota.monthly_token_limit), used: Number(quota.tokens_used), inputPrice: quota.input_price_micro_per_mtok === null ? null : Number(quota.input_price_micro_per_mtok), outputPrice: quota.output_price_micro_per_mtok === null ? null : Number(quota.output_price_micro_per_mtok) } : null}
            usage={(usage ?? []) as UsageView[]} scope={isAdmin ? "organization" : "mine"} />
          {(suggestions ?? []).length > 0 && (
            <Card className="h-fit">
              <h2 className="mb-2 text-sm font-medium">Suggerimenti da approvare</h2>
              <SuggestionList suggestions={(suggestions ?? []) as SuggestionRow[]} canDecide={canDecide} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
