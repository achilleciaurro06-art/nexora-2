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
import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DigitalTexture } from "@/components/brand/digital-texture";
import { ConversationList, CopilotWorkspace } from "@/modules/copilot/ui/workspace";

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

  // fonti realmente consultate nella conversazione (dai messaggi salvati): nessun dato aggiunto
  const seen = new Set<string>(); const sourcesAll: { label: string; href?: string }[] = [];
  for (const m of chatMessages) for (const x of m.sources ?? []) { const k = `${x.label}|${x.href ?? ""}`; if (!seen.has(k)) { seen.add(k); sourcesAll.push(x); } }

  return (
    <>
      <header className="nx-surface-dark relative -mx-4 -mt-4 mb-5 overflow-hidden px-5 py-5 md:-mx-8 md:-mt-8 md:px-8">
        <DigitalTexture intensity="medium" />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky"><Sparkles className="size-3.5" />NEXORA Copilot</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Copilot AI</h1>
            <p className="mt-0.5 max-w-2xl text-sm text-slate-300">L&apos;assistente che conosce la tua azienda: legge i dati reali con gli strumenti autorizzati e prepara azioni da confermare.</p>
          </div>
        </div>
      </header>
      <CopilotWorkspace
        left={<ConversationList items={(convs ?? []).map((v) => ({ id: v.id as string, title: (v.title as string) || "" }))} activeId={active} />}
        right={
          <>
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Contesto della conversazione</h2>
              {sourcesAll.length === 0 ? <p className="text-sm text-muted">Quando il Copilot consulta i tuoi dati, qui compaiono le fonti realmente utilizzate.</p> : (
                <ul className="space-y-1.5 text-sm" data-testid="context-sources">{sourcesAll.map((x, i) => <li key={i}>{x.href ? <Link className="text-primary hover:underline" href={x.href}>{x.label}</Link> : x.label}</li>)}</ul>
              )}
            </Card>
            <CreditsPanel quota={quota ? { limit: Number(quota.monthly_token_limit), used: Number(quota.tokens_used), inputPrice: quota.input_price_micro_per_mtok === null ? null : Number(quota.input_price_micro_per_mtok), outputPrice: quota.output_price_micro_per_mtok === null ? null : Number(quota.output_price_micro_per_mtok) } : null}
              usage={(usage ?? []) as UsageView[]} scope={isAdmin ? "organization" : "mine"} />
            {(suggestions ?? []).length > 0 && (
              <Card className="h-fit p-4">
                <h2 className="mb-2 text-sm font-semibold">Suggerimenti da approvare</h2>
                <SuggestionList suggestions={(suggestions ?? []) as SuggestionRow[]} canDecide={canDecide} />
              </Card>
            )}
          </>
        }
      >
        <ChatPanel key={active ?? "new"} conversationId={active} initialMessages={chatMessages} initialProposals={proposals} canUse={canAi} canConfirm={canDecide} path="/copilot" suggestions={suggestedQuestions({ page: "generic" })} modes />
      </CopilotWorkspace>
    </>
  );
}
