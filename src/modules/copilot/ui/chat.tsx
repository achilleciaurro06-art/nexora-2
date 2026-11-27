"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { RichText } from "@/components/ui/rich-text";
import { ProposalCard, type ProposalView } from "./proposal-card";

export type Source = { label: string; href?: string };
export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; sources?: Source[] };

const SLOW_AFTER_S = 25;
/** Le «modalità» sono solo scorciatoie che precompilano la domanda: l'assistente è sempre lo stesso. */
const MODES = [
  { label: "Chat", lead: "", hint: "Domanda libera" },
  { label: "Analisi", lead: "Analizza i dati e dimmi: ", hint: "Precompila una richiesta di analisi" },
  { label: "Creazione", lead: "Prepara una bozza di ", hint: "Precompila una richiesta di creazione (resta una proposta da confermare)" },
  { label: "Operatività", lead: "Prepara le azioni necessarie per: ", hint: "Precompila una richiesta operativa (le azioni richiedono la tua conferma)" },
];

type DoneEvent = { type: "done"; reply: string; conversationId: string; sources: Source[]; proposals: ProposalView[]; droppedProposals: number };
type Event = { type: "status"; text: string } | DoneEvent | { type: "error"; error: string; conversationId?: string };

/**
 * Chat del Copilot. Riceve in streaming gli stati di avanzamento («Consulto i preventivi…»); la risposta compare quando è completa.
 * Le azioni proposte compaiono sotto la risposta e richiedono la conferma esplicita dell'utente.
 */
export function ChatPanel({ conversationId: initialId, initialMessages, initialProposals = [], canUse, canConfirm, path, suggestions, compact = false, modes = false, autoQuestion, onConversation }: {
  conversationId?: string; initialMessages: ChatMessage[]; initialProposals?: ProposalView[]; canUse: boolean; canConfirm: boolean; path?: string; suggestions: string[]; compact?: boolean; modes?: boolean;
  autoQuestion?: { text: string; nonce: number }; onConversation?: (id: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [proposals, setProposals] = useState<ProposalView[]>(initialProposals);
  const [conversationId, setConversationId] = useState<string | undefined>(initialId);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [dropped, setDropped] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastNonce = useRef<number>(0);
  const convRef = useRef<string | undefined>(initialId);

  // scorre il registro della chat (non la pagina) solo quando arrivano nuovi contenuti: mai al primo caricamento
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const el = endRef.current?.parentElement;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, pending, status, proposals]);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [pending]);

  const send = useCallback(async (question: string) => {
    if (!question || pending) return;
    setError(null); setElapsed(0); setInput(""); setStatus("Invio la domanda…"); setPending(true); setDropped(0);
    setMessages((m) => [...m, { id: `local-u-${m.length}`, role: "user", content: question }]);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const res = await fetch("/api/copilot/chat", {
        method: "POST", headers: { "content-type": "application/json" }, signal: ctrl.signal,
        body: JSON.stringify({ question, conversationId: convRef.current, requestId: crypto.randomUUID(), path: path ?? (typeof window !== "undefined" ? window.location.pathname : undefined) }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(j?.error ?? "Richiesta non riuscita.");
      }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ""; let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as Event;
          if (ev.type === "status") setStatus(ev.text);
          else if (ev.type === "done") {
            finished = true;
            convRef.current = ev.conversationId; setConversationId(ev.conversationId); onConversation?.(ev.conversationId);
            setMessages((m) => [...m, { id: `local-a-${m.length}`, role: "assistant", content: ev.reply, sources: ev.sources }]);
            setProposals((p) => [...p.filter((x) => !ev.proposals.some((n) => n.id === x.id)), ...ev.proposals]);
            setDropped(ev.droppedProposals);
          } else if (ev.type === "error") {
            finished = true;
            if (ev.conversationId) { convRef.current = ev.conversationId; setConversationId(ev.conversationId); }
            setError(ev.error); setInput(question);
          }
        }
      }
      if (!finished) { setError("La connessione si è interrotta prima della risposta. Se non compare, ricarica la pagina: potrebbe essere stata salvata."); setInput(question); }
    } catch (e) {
      if ((e as Error).name === "AbortError") setError("Richiesta interrotta. L'elaborazione sul server potrebbe comunque completarsi: ricarica per verificare.");
      else { setError(e instanceof Error && e.message ? e.message : "Richiesta non riuscita."); setInput(question); }
    } finally { setPending(false); setStatus(null); abortRef.current = null; }
  }, [pending, path, onConversation]);

  useEffect(() => {
    if (autoQuestion && autoQuestion.nonce !== lastNonce.current) { lastNonce.current = autoQuestion.nonce; void send(autoQuestion.text); }
  }, [autoQuestion, send]);

  const pendingProposals = proposals.filter((p) => p.status === "pending" || p.execution_status === "done" || p.status === "rejected");

  return (
    <div className="space-y-3">
      <div className={`${compact ? "max-h-[48dvh]" : "max-h-[55dvh]"} min-h-32 space-y-3 overflow-y-auto pr-1`} aria-live="polite" data-testid="chat-log">
        {messages.length === 0 && !pending && (
          <div className="space-y-3" data-testid="copilot-empty">
            <p className="text-sm font-medium">Cosa posso fare per te</p>
            {!compact && (
              <ul className="grid gap-2 text-xs text-muted sm:grid-cols-3">
                <li className="rounded-md border border-line p-2.5"><span className="block font-medium text-foreground">Capire</span>Rispondo con i dati reali: clienti, preventivi, fatturato, attività ed email.</li>
                <li className="rounded-md border border-line p-2.5"><span className="block font-medium text-foreground">Preparare</span>Scrivo bozze di email, solleciti e riepiloghi di appuntamenti.</li>
                <li className="rounded-md border border-line p-2.5"><span className="block font-medium text-foreground">Agire</span>Propongo attività e promemoria: si crea qualcosa solo dopo la tua conferma.</li>
              </ul>
            )}
            {canUse && <p className="text-xs text-muted">Tocca un suggerimento per iniziare, oppure scrivi tu la domanda qui sotto.</p>}
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => canUse && <button key={s} type="button" onClick={() => void send(s)} className="nx-t rounded-full border border-border px-3 py-1.5 text-left text-xs hover:border-primary/40 hover:bg-primary/[0.05]" data-testid="suggestion-chip">{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "ml-8 min-w-0 rounded-lg bg-primary/10 p-3 text-sm [overflow-wrap:anywhere]" : "mr-4 min-w-0 rounded-lg border border-border p-3 text-sm [overflow-wrap:anywhere]"} data-testid={m.role === "assistant" ? "assistant-message" : "user-message"}>
            <p className="mb-1 text-xs text-muted">{m.role === "user" ? "Tu" : "Copilot"}</p>
            {m.role === "user" ? <p className="whitespace-pre-wrap">{m.content}</p> : <RichText text={m.content} />}
            {m.role === "assistant" && m.sources && m.sources.length > 0 && (
              <p className="mt-2 text-xs text-muted" data-testid="sources">Dati consultati: {m.sources.map((s, i) => <span key={i}>{i > 0 && ", "}{s.href ? <Link className="underline" href={s.href}>{s.label}</Link> : s.label}</span>)}</p>
            )}
          </div>
        ))}
        {pendingProposals.length > 0 && (
          <div className="space-y-2" data-testid="proposals">
            <p className="text-xs font-medium text-muted">Azioni proposte — nulla viene eseguito senza la tua conferma</p>
            <ul className="space-y-2">{pendingProposals.map((p) => <ProposalCard key={p.id} p={p} canConfirm={canConfirm} />)}</ul>
          </div>
        )}
        {dropped > 0 && <p className="text-xs text-muted">{dropped === 1 ? "1 proposta scartata perché non verificabile" : `${dropped} proposte scartate perché non verificabili`} sui tuoi dati.</p>}
        {pending && (
          <div className="mr-4 rounded-lg border border-dashed border-border p-3 text-sm text-muted" role="status" data-testid="thinking">
            {status ?? "Il Copilot sta lavorando…"} {elapsed > 0 ? `${elapsed}s` : ""}
            {elapsed >= SLOW_AFTER_S && <span className="block text-xs">Sta impiegando più del solito: il servizio AI è probabilmente sotto carico.</span>}
            <button type="button" onClick={() => abortRef.current?.abort()} className="mt-1 block text-xs underline">Interrompi</button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {canUse && modes && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Modalità (scorciatoie)">
          <span className="text-muted">Modalità:</span>
          {MODES.map((m) => <button key={m.label} type="button" disabled={pending} onClick={() => { setInput(m.lead); document.getElementById("copilot-input")?.focus(); }} title={m.hint} className="nx-t rounded-sm border border-border px-2 py-1 font-medium text-muted hover:border-primary/40 hover:text-foreground disabled:opacity-50">{m.label}</button>)}
        </div>
      )}
      {canUse ? (
        <form onSubmit={(e) => { e.preventDefault(); void send(input.trim()); }} className="space-y-2">
          <Textarea id="copilot-input" value={input} onChange={(e) => setInput(e.target.value)} rows={compact ? 2 : 3}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
            required maxLength={2000} disabled={pending} aria-label="Domanda" placeholder="Chiedi al Copilot, es. «Quali preventivi devo sollecitare?»" />
          {error && <Alert>{error}</Alert>}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">{compact ? "Il Copilot propone: le azioni richiedono la tua conferma." : "Il Copilot legge i tuoi dati ma non modifica nulla da solo: ogni azione richiede la tua conferma. Invio per inviare, Maiusc+Invio per andare a capo."}</p>
            <Button disabled={pending || !input.trim()}>{pending ? "Attendi…" : "Invia"}</Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted">Il tuo ruolo non può usare il Copilot.</p>
      )}
      {conversationId && !compact && <p className="sr-only">Conversazione {conversationId}</p>}
    </div>
  );
}
