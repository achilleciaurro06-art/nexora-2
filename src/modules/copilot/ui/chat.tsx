"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { sendMessageAction } from "../actions";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; sources?: string[] };

const SOURCE_LABEL: Record<string, string> = {
  azienda: "dati generali", stale_customers: "clienti da ricontattare", pending_quotes: "preventivi in attesa", win_odds: "storico di accettazione",
  top_customers: "valore per cliente", tasks: "attività e scadenze", price_anomalies: "analisi prezzi", documents: "documenti", past_ai: "analisi precedenti", org_info: "dati aziendali",
};
const sourceLabel = (s: string) => (s.startsWith("scheda_cliente:") ? `scheda ${s.slice(15)}` : s.startsWith("preventivo:") ? `preventivo ${s.slice(11)}` : (SOURCE_LABEL[s] ?? s));

const SLOW_AFTER_S = 20;

export function ChatPanel({ conversationId: initialId, initialMessages, canUse }: { conversationId?: string; initialMessages: ChatMessage[]; canUse: boolean }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [conversationId, setConversationId] = useState<string | undefined>(initialId);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [elapsed, setElapsed] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, pending]);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [pending]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || pending) return;
    setError(null);
    setElapsed(0);
    setInput("");
    setMessages((m) => [...m, { id: `local-u-${m.length}`, role: "user", content: question }]);
    startTransition(async () => {
      try {
        const res = await sendMessageAction({ question, conversationId });
        if (res.conversationId) setConversationId(res.conversationId);
        if (res.error || !res.reply) {
          setError(res.error ?? "Nessuna risposta ricevuta.");
          setInput(question); // permette di riprovare senza riscrivere
          return;
        }
        setMessages((m) => [...m, { id: `local-a-${m.length}`, role: "assistant", content: res.reply!, sources: res.sources }]);
        router.refresh(); // aggiorna elenco conversazioni e suggerimenti
      } catch {
        setError("La richiesta è stata interrotta (connessione o tempo scaduto). La risposta potrebbe essere già stata salvata: ricarica la pagina per verificarlo.");
        setInput(question);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="max-h-[50dvh] min-h-40 space-y-3 overflow-y-auto" aria-live="polite">
        {messages.length === 0 && <p className="text-sm text-muted">Fai una domanda sui tuoi clienti, preventivi e attività.</p>}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "ml-8 rounded-lg bg-primary/10 p-3 text-sm" : "mr-8 rounded-lg border border-border p-3 text-sm"}>
            <p className="mb-1 text-xs text-muted">{m.role === "user" ? "Tu" : "Copilot"}</p>
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.role === "assistant" && m.sources && m.sources.length > 0 && <p className="mt-2 text-xs text-muted">Dati consultati: {m.sources.map(sourceLabel).join(", ")}</p>}
          </div>
        ))}
        {pending && (
          <div className="mr-8 rounded-lg border border-dashed border-border p-3 text-sm text-muted" role="status">
            Il Copilot sta pensando… {elapsed > 0 ? `${elapsed}s` : ""}
            {elapsed >= SLOW_AFTER_S && <span className="block text-xs">Sta impiegando più del solito: il servizio AI è probabilmente sotto carico.</span>}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {canUse ? (
        <form onSubmit={submit} className="space-y-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
            required maxLength={2000} disabled={pending} aria-label="Domanda"
            placeholder="Chiedi al Copilot: es. «Quali preventivi devo sollecitare questa settimana?»"
          />
          {error && <Alert>{error}</Alert>}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">Il Copilot propone, non modifica: ogni azione richiede la tua conferma. Invio per inviare, Maiusc+Invio per andare a capo.</p>
            <Button disabled={pending || !input.trim()}>{pending ? "Attendi…" : "Invia"}</Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted">Il tuo ruolo non può usare il Copilot.</p>
      )}
    </div>
  );
}
