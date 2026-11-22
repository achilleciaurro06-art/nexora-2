"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { useFormAction } from "@/lib/use-form-action";
import { ContactSelect } from "@/modules/agenda/ui/contact-select";
import { analyzeEmailAction, confirmSuggestionAction, createFollowUpFromEmailAction, createTaskFromEmailAction, linkExistingAction, linkThreadAction, saveAttachmentToDocumentsAction, unlinkThreadAction } from "../actions";
import type { EmailAnalysis } from "../analysis";

/** Analisi AI di un messaggio o della conversazione: PROPONE, non esegue. Le azioni partono solo dai pulsanti, su richiesta esplicita. */
export function AnalysisPanel({ messageId, threadId, canCreateFollowUp, hasTask, hasFollowUp }: { messageId: string; threadId: string; canCreateFollowUp: boolean; hasTask: boolean; hasFollowUp: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok: true; analysis: EmailAnalysis } | { ok: false; error: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = (scope: "message" | "thread") => start(async () => { setNote(null); setRes(await analyzeEmailAction(messageId, scope)); });
  const create = (kind: "task" | "follow_up", title: string, days?: number) => start(async () => {
    const fd = new FormData(); fd.set("title", title); if (days) fd.set("days", String(days));
    const r = kind === "task" ? await createTaskFromEmailAction(threadId, null, fd) : await createFollowUpFromEmailAction(threadId, null, fd);
    setNote(r.ok ? (kind === "task" ? "Attività creata" : "Follow-up creato") : r.error);
    if (r.ok) router.refresh();
  });
  const a = res?.ok ? res.analysis : null;
  return (
    <div className="space-y-2" data-testid="analysis-panel">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run("message")}>{pending ? "Analisi in corso…" : "Analizza con l'AI"}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run("thread")}>Riassumi la conversazione</Button>
      </div>
      {res && !res.ok && <Alert>{res.error}</Alert>}
      {a && (
        <div className="space-y-2 rounded-md border border-border p-3 text-sm" data-testid="analysis-result">
          <p>{a.summary}</p>
          {a.requests.length > 0 && <div><p className="font-medium">Richieste del cliente</p><ul className="list-disc pl-5">{a.requests.map((r) => <li key={r}>{r}</li>)}</ul></div>}
          {a.quote_request && <p className="font-medium text-primary">Richiesta di preventivo rilevata</p>}
          {a.objections.length > 0 && <div><p className="font-medium">Obiezioni</p><ul className="list-disc pl-5">{a.objections.map((r) => <li key={r}>{r}</li>)}</ul></div>}
          <p className="text-muted">{a.needs_reply ? "Il messaggio attende una risposta." : "Nessuna risposta richiesta."} Urgenza: {a.urgency === "high" ? "alta" : a.urgency === "low" ? "bassa" : "normale"}.</p>
          <p className="text-xs text-muted">Proposte generate dall&apos;AI: non viene eseguita nessuna azione senza il tuo comando.</p>
          <div className="flex flex-wrap gap-2">
            {a.suggested_follow_up && canCreateFollowUp && !hasFollowUp && <Button type="button" size="sm" disabled={pending} onClick={() => create("follow_up", a.suggested_follow_up!.title, a.suggested_follow_up!.days)}>Crea follow-up: «{a.suggested_follow_up.title}» tra {a.suggested_follow_up.days} gg</Button>}
            {a.suggested_task && !hasTask && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => create("task", a.suggested_task!.title)}>Crea attività: «{a.suggested_task.title}»</Button>}
          </div>
        </div>
      )}
      {note && <p role="status" className="text-xs text-muted">{note}</p>}
    </div>
  );
}

export function LinkForm({ threadId, customers, quotes, current }: {
  threadId: string; customers: { id: string; name: string }[]; quotes: { id: string; number: string; title: string | null }[];
  current: { customerId: string | null; contactId: string | null; quoteId: string | null };
}) {
  const link = useFormAction(linkThreadAction.bind(null, threadId));
  const unlink = useFormAction(unlinkThreadAction.bind(null, threadId));
  const [customerId, setCustomerId] = useState(current.customerId ?? "");
  const state = link.state ?? unlink.state;
  return (
    <div className="space-y-3">
      <form onSubmit={link.onSubmit} className="space-y-3" aria-label="Collega a un cliente">
        <div><Label htmlFor="lk-customer">Cliente</Label>
          <Select id="lk-customer" name="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Nessuno</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <ContactSelect customerId={customerId} defaultValue={current.contactId ?? ""} />
        {customerId === (current.customerId ?? "") && quotes.length > 0 && (
          <div><Label htmlFor="lk-quote">Preventivo</Label><Select id="lk-quote" name="quoteId" defaultValue={current.quoteId ?? ""}><option value="">Nessuno</option>{quotes.map((q) => <option key={q.id} value={q.id}>{q.number}{q.title ? ` · ${q.title}` : ""}</option>)}</Select></div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={link.pending}>Salva collegamento</Button>
        </div>
      </form>
      {current.customerId && <form onSubmit={unlink.onSubmit}><Button size="sm" variant="ghost" disabled={unlink.pending}>Scollega dal cliente</Button></form>}
      {state && !state.ok && <Alert>{state.error}</Alert>}
      {state?.ok && <Alert kind="success">Collegamento aggiornato</Alert>}
    </div>
  );
}

export function SuggestionList({ threadId, candidates }: { threadId: string; candidates: { customer_id: string; contact_id: string | null; name: string; archived: boolean }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2 rounded-md border border-warning bg-warning/10 p-3 text-sm" data-testid="link-suggestions">
      <p className="font-medium">A quale cliente appartiene questa conversazione?</p>
      <p className="text-xs text-muted">L&apos;indirizzo corrisponde a più clienti: scegli tu, non collego nulla in automatico.</p>
      <ul className="space-y-1">
        {candidates.map((c) => (
          <li key={c.customer_id} className="flex items-center justify-between gap-2">
            <span>{c.name}{c.archived ? " (archiviato)" : ""}</span>
            <Button size="sm" variant="outline" disabled={pending || c.archived} onClick={() => start(async () => { const r = await confirmSuggestionAction(threadId, c.customer_id, c.contact_id); if (r.ok) router.refresh(); else setErr(r.error); })}>Collega</Button>
          </li>
        ))}
      </ul>
      {err && <Alert>{err}</Alert>}
    </div>
  );
}

/** Attività e follow-up dalla conversazione, senza duplicati: se esiste già un elemento collegato si propone di aprirlo. */
export function WorkPanel({ threadId, hasCustomer, task, followUp, openTasks, openFollowUps }: {
  threadId: string; hasCustomer: boolean; task: { id: string; title: string } | null; followUp: { id: string; title: string } | null;
  openTasks: { id: string; title: string }[]; openFollowUps: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isErr, setIsErr] = useState(false);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => start(async () => { const r = await fn(); setIsErr(!r.ok); setMsg(r.ok ? okMsg : r.error ?? "Operazione non riuscita"); if (r.ok) router.refresh(); });
  const link = (kind: "task" | "follow_up") => (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); act(() => linkExistingAction(threadId, kind, null, fd), "Collegato"); };
  return (
    <div className="space-y-3 text-sm" data-testid="work-panel">
      <div>
        <p className="font-medium">Attività</p>
        {task ? <p><a className="text-primary hover:underline" href={`/attivita/${task.id}`}>{task.title}</a></p> : (
          <>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => createTaskFromEmailAction(threadId, null, new FormData()), "Attività creata")}>Crea attività dalla conversazione</Button>
            {openTasks.length > 0 && (
              <form onSubmit={link("task")} className="mt-2 flex gap-2"><Select name="id" aria-label="Collega attività esistente"><option value="">Collega un&apos;attività esistente…</option>{openTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select><Button size="sm" variant="ghost" disabled={pending}>Collega</Button></form>
            )}
          </>
        )}
      </div>
      <div>
        <p className="font-medium">Follow-up</p>
        {followUp ? <p><a className="text-primary hover:underline" href={`/followup/${followUp.id}`}>{followUp.title}</a></p> : !hasCustomer ? <p className="text-muted">Collega prima la conversazione a un cliente.</p> : (
          <>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => createFollowUpFromEmailAction(threadId, null, new FormData()), "Follow-up creato")}>Crea follow-up (tra 3 giorni)</Button>
            {openFollowUps.length > 0 && (
              <form onSubmit={link("follow_up")} className="mt-2 flex gap-2"><Select name="id" aria-label="Collega follow-up esistente"><option value="">Collega un follow-up esistente…</option>{openFollowUps.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select><Button size="sm" variant="ghost" disabled={pending}>Collega</Button></form>
            )}
          </>
        )}
      </div>
      {msg && <p role={isErr ? "alert" : "status"} className={isErr ? "text-xs text-danger" : "text-xs text-muted"}>{msg}</p>}
    </div>
  );
}

export function SaveAttachmentButton({ id, name }: { id: string; name: string }) {
  const { state, pending, onSubmit } = useFormAction(saveAttachmentToDocumentsAction.bind(null, id));
  return (
    <form onSubmit={onSubmit} className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" disabled={pending} aria-label={`Salva ${name} nei documenti`}>Salva nei documenti</Button>
      {state?.ok && <span role="status" className="text-xs text-success">Salvato</span>}
      {state && !state.ok && <span role="alert" className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
