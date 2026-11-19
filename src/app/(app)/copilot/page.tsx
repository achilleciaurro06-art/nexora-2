import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { decideSuggestionAction } from "@/modules/copilot/actions";
import { ChatForm } from "@/modules/copilot/ui/chat";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatEur } from "@/lib/money";

export const metadata = { title: "Copilot AI" };

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
  const active = c ?? convs?.[0]?.id;
  const { data: messages } = active
    ? await db.from("ai_messages").select("id, role, content").eq("organization_id", orgId).eq("conversation_id", active).order("created_at")
    : { data: [] };
  const canAi = can(ctx.org.role, "ai:use");
  const canDecide = can(ctx.org.role, "data:write");
  const used = Number(quota?.tokens_used ?? 0);
  const limit = Number(quota?.monthly_token_limit ?? 0);
  void formatEur;

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
        <Card className="space-y-4">
          <div className="max-h-[50dvh] space-y-3 overflow-y-auto" aria-live="polite">
            {(messages ?? []).length === 0 && <p className="text-sm text-muted">Fai una domanda sui tuoi clienti, preventivi e attività.</p>}
            {(messages ?? []).map((m) => (
              <div key={m.id as string} className={m.role === "user" ? "ml-8 rounded-lg bg-primary/10 p-3 text-sm" : "mr-8 rounded-lg border border-border p-3 text-sm"}>
                <p className="mb-1 text-xs text-muted">{m.role === "user" ? "Tu" : "Copilot"}</p>
                <p className="whitespace-pre-wrap">{m.content as string}</p>
              </div>
            ))}
          </div>
          {canAi ? <ChatForm key={active ?? "new"} conversationId={c === "" ? undefined : active} /> : <p className="text-sm text-muted">Il tuo ruolo non può usare il Copilot.</p>}
        </Card>
        <Card className="h-fit">
          <h2 className="mb-2 text-sm font-medium">Suggerimenti da approvare</h2>
          {(suggestions ?? []).length === 0 ? <p className="text-sm text-muted">Nessun suggerimento in attesa.</p> : (
            <ul className="space-y-3 text-sm">
              {(suggestions ?? []).map((s) => {
                const p = s.payload as { title?: string; description?: string; due_date?: string };
                return (
                  <li key={s.id as string} className="rounded-md border border-border p-3">
                    <Badge>{s.kind === "task" ? "Attività" : "Spunto"}</Badge>
                    <p className="mt-1 font-medium">{p.title}</p>
                    {p.description && <p className="text-muted">{p.description}</p>}
                    {p.due_date && <p className="text-xs text-muted">Scadenza: {p.due_date}</p>}
                    {canDecide && (
                      <form action={decideSuggestionAction.bind(null, s.id as string)} className="mt-2 flex gap-2">
                        <Button size="sm" name="decision" value="accept">{s.kind === "task" ? "Crea attività" : "Ok"}</Button>
                        <Button size="sm" variant="outline" name="decision" value="reject">Scarta</Button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
