import Link from "next/link";
import { AskCopilotButton } from "@/modules/copilot/ui/ask-button";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { isUuid } from "@/lib/ids";
import { listCustomerOptions } from "@/modules/clienti/repository";
import { addrsFromJson, formatAddrList } from "@/modules/email/addresses";
import { sandboxedDoc } from "@/modules/email/sanitize";
import { fmtBytes } from "@/modules/email/limits";
import { AnalysisPanel, LinkForm, SaveAttachmentButton, SuggestionList, WorkPanel } from "@/modules/email/ui/thread-panels";
import { MarkRead } from "@/modules/email/ui/sync-button";
import { Alert, Badge, Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/datetime";

export default async function ThreadPage({ params, searchParams }: { params: Promise<{ threadId: string }>; searchParams: Promise<{ inviata?: string }> }) {
  const { threadId } = await params;
  const sp = await searchParams;
  if (!isUuid(threadId)) notFound();
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data: t } = await db.from("email_threads").select("*, email_accounts(address, display_name)").eq("id", threadId).eq("organization_id", orgId).maybeSingle();
  if (!t) notFound();
  const [{ data: msgs }, customers, { data: quotes }, { data: openTasks }, { data: openFus }, taskRow, fuRow] = await Promise.all([
    db.from("email_messages").select("*").eq("organization_id", orgId).eq("thread_id", threadId).order("message_at"),
    listCustomerOptions(db, orgId, t.customer_id as string | null),
    t.customer_id ? db.from("quotes").select("id, number, title").eq("organization_id", orgId).eq("customer_id", t.customer_id as string).is("deleted_at", null).order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
    t.customer_id ? db.from("tasks").select("id, title").eq("organization_id", orgId).eq("customer_id", t.customer_id as string).is("deleted_at", null).in("status", ["todo", "in_progress"]).limit(30) : Promise.resolve({ data: [] }),
    t.customer_id ? db.from("follow_ups").select("id, title").eq("organization_id", orgId).eq("customer_id", t.customer_id as string).is("deleted_at", null).in("status", ["todo", "scheduled", "in_progress", "waiting"]).limit(30) : Promise.resolve({ data: [] }),
    t.task_id ? db.from("tasks").select("id, title").eq("id", t.task_id as string).maybeSingle() : Promise.resolve({ data: null }),
    t.follow_up_id ? db.from("follow_ups").select("id, title").eq("id", t.follow_up_id as string).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const messages = msgs ?? [];
  const { data: atts } = messages.length ? await db.from("email_attachments").select("id, message_id, filename, mime_type, size_bytes").eq("organization_id", orgId).in("message_id", messages.map((m) => m.id as string)) : { data: [] };
  const attByMsg = new Map<string, typeof atts>();
  for (const a of atts ?? []) attByMsg.set(a.message_id as string, [...(attByMsg.get(a.message_id as string) ?? []), a]);
  const acc = Array.isArray(t.email_accounts) ? t.email_accounts[0] : t.email_accounts;
  const customer = customers.find((c) => c.id === t.customer_id);
  const canWrite = can(ctx.org.role, "data:write");
  const lastMsg = messages[messages.length - 1];
  const candidates = ((t.link_candidates ?? []) as { customer_id: string; contact_id: string | null; name: string; archived: boolean }[]);

  return (
    <>
      <MarkRead threadId={threadId} unread={t.unread_count as number} />
      {sp.inviata && <div className="mb-4"><Alert kind="success">Email inviata.</Alert></div>}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{(t.subject as string) || "(senza oggetto)"}</h2>
          <p className="text-xs text-muted">Casella: {acc?.display_name ? `${acc.display_name} <${acc.address}>` : acc?.address} · {messages.length} messaggi</p>
        </div>
        <Link href="/email" className={buttonVariants({ variant: "ghost", size: "sm" })}>← Torna alla posta</Link>
      </div>
      <div className="grid gap-6 xl:grid-cols-[3fr_1fr]">
        <div className="space-y-3" data-testid="messages">
          {messages.map((m, i) => {
            const from = m.from_name ? `${m.from_name} <${m.from_address}>` : (m.from_address as string);
            const files = attByMsg.get(m.id as string) ?? [];
            return (
              <details key={m.id as string} open={i === messages.length - 1} className="rounded-lg border border-border bg-card" data-testid="message" data-direction={m.direction as string}>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span className="min-w-0 truncate"><strong>{m.direction === "inbound" ? from : `Tu (${m.from_address})`}</strong><span className="text-muted"> · {m.snippet as string}</span></span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                    {m.status === "failed" && <Badge className="border-danger text-danger">Invio non confermato</Badge>}
                    {m.status === "sending" && <Badge>Invio in corso</Badge>}
                    {m.direction === "outbound" && m.status === "sent" && <Badge>Inviata</Badge>}
                    {fmtDateTime(m.message_at as string)}
                  </span>
                </summary>
                <div className="space-y-3 border-t border-border p-3">
                  <dl className="grid gap-x-3 text-xs sm:grid-cols-[4rem_1fr]">
                    <dt className="text-muted">Da</dt><dd>{from}</dd>
                    <dt className="text-muted">A</dt><dd>{formatAddrList(addrsFromJson(m.to_addrs)) || "—"}</dd>
                    {addrsFromJson(m.cc_addrs).length > 0 && <><dt className="text-muted">Cc</dt><dd>{formatAddrList(addrsFromJson(m.cc_addrs))}</dd></>}
                    {addrsFromJson(m.bcc_addrs).length > 0 && m.direction === "outbound" && <><dt className="text-muted">Ccn</dt><dd>{formatAddrList(addrsFromJson(m.bcc_addrs))}</dd></>}
                  </dl>
                  {m.status === "failed" && <Alert>{(m.error as string) || "L'invio non è stato confermato dal provider."}</Alert>}
                  {m.body_html ? (
                    <iframe title={`Messaggio: ${m.subject as string}`} sandbox="" srcDoc={sandboxedDoc(m.body_html as string)} className="h-[28rem] w-full resize-y rounded border border-border bg-white" loading="lazy" />
                  ) : <pre className="whitespace-pre-wrap break-words text-sm font-sans" data-testid="message-text">{(m.body_text as string) ?? ""}</pre>}
                  {files.length > 0 && (
                    <ul className="space-y-1 text-sm" data-testid="attachments">
                      {files.map((f) => (
                        <li key={f.id as string} className="flex flex-wrap items-center gap-2">
                          <a className="text-primary hover:underline" href={`/email/allegati/${f.id}`} download>📎 {f.filename as string}</a>
                          <span className="text-xs text-muted">{fmtBytes(Number(f.size_bytes))}</span>
                          {canWrite && <SaveAttachmentButton id={f.id as string} name={f.filename as string} />}
                        </li>
                      ))}
                    </ul>
                  )}
                  {canWrite && (
                    <div className="flex flex-wrap gap-2">
                      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/email/nuova?rispondi=${m.id}`}>Rispondi</Link>
                      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/email/nuova?rispondi=${m.id}&modo=tutti`}>Rispondi a tutti</Link>
                      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/email/nuova?inoltra=${m.id}`}>Inoltra</Link>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
        <div className="space-y-4">
          <Card>
            <h3 className="mb-2 font-medium">Cliente</h3>
            {customer ? <p className="mb-2 text-sm" data-testid="linked-customer"><Link className="text-primary hover:underline" href={`/clienti/${customer.id}`}>{customer.name}</Link>{customer.archived_at ? " (archiviato)" : ""} <span className="text-xs text-muted">· {t.link_status === "auto" ? "collegata in automatico" : t.link_status === "manual" ? "collegata a mano" : ""}</span></p> : <p className="mb-2 text-sm text-muted">Non collegata a un cliente.</p>}
            {t.link_status === "suggested" && !t.customer_id && candidates.length > 0 && canWrite && <div className="mb-3"><SuggestionList threadId={threadId} candidates={candidates} /></div>}
            {canWrite ? <LinkForm threadId={threadId} customers={customers.map((c) => ({ id: c.id, name: c.name }))} quotes={(quotes ?? []) as { id: string; number: string; title: string | null }[]} current={{ customerId: t.customer_id as string | null, contactId: t.contact_id as string | null, quoteId: t.quote_id as string | null }} /> : null}
            {t.quote_id && <p className="mt-2 text-sm"><Link className="text-primary hover:underline" href={`/preventivi/${t.quote_id}`}>Vai al preventivo collegato</Link></p>}
          </Card>
          {canWrite && <Card><h3 className="mb-2 font-medium">Lavoro collegato</h3><WorkPanel threadId={threadId} hasCustomer={!!t.customer_id} task={taskRow.data as { id: string; title: string } | null} followUp={fuRow.data as { id: string; title: string } | null} openTasks={(openTasks ?? []) as { id: string; title: string }[]} openFollowUps={(openFus ?? []) as { id: string; title: string }[]} /></Card>}
          {lastMsg && can(ctx.org.role, "ai:use") && <Card><h3 className="mb-2 font-medium">Copilot</h3><div className="mb-3 flex flex-wrap gap-2"><AskCopilotButton question="Riassumi questa conversazione" label="Riassumi" /><AskCopilotButton question="Preparami una risposta professionale a questa conversazione" label="Prepara una risposta" /><AskCopilotButton question="Quali richieste e obiezioni commerciali ci sono in questa conversazione?" label="Richieste e obiezioni" /><AskCopilotButton question="Suggerisci un'attività collegata a questa conversazione" label="Suggerisci un'attività" /></div><AnalysisPanel messageId={lastMsg.id as string} threadId={threadId} canCreateFollowUp={!!t.customer_id} hasTask={!!t.task_id} hasFollowUp={!!t.follow_up_id} /></Card>}
        </div>
      </div>
    </>
  );
}
