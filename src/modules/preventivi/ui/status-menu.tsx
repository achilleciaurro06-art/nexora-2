"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { QUOTE_STATUS_LABEL, type QuoteStatus } from "@/types/domain";
import { QUOTE_STATUS_ICON, QUOTE_STATUS_TONE } from "@/components/ui/status-badge";
import { TONE_CLASS, TONE_ICON } from "@/components/ui/status-chip";
import { changeQuoteStatusAction } from "../actions";

/** Stati selezionabili, nell'ordine del flusso commerciale. Le azioni e le regole sono quelle già esistenti. */
export const QUOTE_STATUS_OPTIONS: QuoteStatus[] = ["draft", "sent", "accepted", "expired", "rejected"];

/**
 * Cambio di stato immediato dalla riga o dalla scheda: il menu salva subito con la stessa azione del pulsante «Cambia stato»
 * (nessun sistema parallelo) e mostra la conferma. Un preventivo «Fatto» (accettato) resta bloccato come prima: ha fatture collegate.
 */
export function QuoteStatusMenu({ id, status, number }: { id: string; status: QuoteStatus; number: string }) {
  const [current, setCurrent] = useState(status);
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<"saved" | "error" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // se lo stato cambia dal server (dopo il salvataggio o da un altro punto) la vista si riallinea, senza effetti
  const [synced, setSynced] = useState(status);
  if (synced !== status) { setSynced(status); setCurrent(status); }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const tone = QUOTE_STATUS_TONE[current];
  const Icon = QUOTE_STATUS_ICON[current] ?? TONE_ICON[tone];

  function change(next: QuoteStatus) {
    if (next === current) return;
    const prev = current;
    setCurrent(next);
    setFeedback(null);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("status", next);
        await changeQuoteStatusAction(id, fd);
        setFeedback("saved");
      } catch {
        setCurrent(prev);
        setFeedback("error");
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFeedback(null), 2500);
    });
  }

  return (
    <span className="inline-flex items-center gap-2" data-testid="quote-status-menu">
      <span className={cn("nx-t relative inline-flex items-center rounded-sm border text-xs font-medium hover:brightness-95 focus-within:outline-2 focus-within:outline-primary/40", TONE_CLASS[tone], pending && "opacity-70")} data-status={current}>
        <Icon className="pointer-events-none absolute left-2 size-3" aria-hidden />
        <select value={current} disabled={pending} onChange={(e) => change(e.target.value as QuoteStatus)} aria-label={`Stato del preventivo ${number}: cambia`}
          className="h-6 cursor-pointer appearance-none bg-transparent pl-6 pr-6 text-xs font-medium focus:outline-none disabled:cursor-wait">
          {QUOTE_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{QUOTE_STATUS_LABEL[s]}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-1.5 size-3" aria-hidden />
      </span>
      <span role="status" aria-live="polite" className="text-xs">
        {feedback === "saved" && <span className="inline-flex items-center gap-1 text-success"><Check className="size-3" aria-hidden />Salvato</span>}
        {feedback === "error" && <span className="text-danger">Non salvato: riprova</span>}
      </span>
    </span>
  );
}
