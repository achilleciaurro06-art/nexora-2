"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { ChatPanel } from "./chat";
import { COPILOT_EVENT } from "./dock";
import { suggestedQuestions } from "../page-context";

/**
 * Chat del Copilot integrata in cima alla dashboard (stessa conversazione persistente e stesse regole del pannello laterale).
 * I pulsanti «Chiedi al Copilot» / «Approfondisci» della dashboard scrivono qui invece di aprire il pannello flottante.
 */
export function DashboardChat({ canConfirm }: { canConfirm: boolean }) {
  const [auto, setAuto] = useState<{ text: string; nonce: number } | undefined>();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const h = (e: Event) => {
      const q = (e as CustomEvent<{ question?: string }>).detail?.question;
      if (q) setAuto({ text: q, nonce: Date.now() });
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(COPILOT_EVENT, h);
    return () => window.removeEventListener(COPILOT_EVENT, h);
  }, []);
  return (
    <section ref={ref} aria-label="Chat con il Copilot" className="mb-6" data-testid="dashboard-chat">
      <Card>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Chiedi al Copilot</h2>
          <p className="text-xs text-muted">Conosce i dati della tua azienda e propone azioni che confermi tu.</p>
        </div>
        <ChatPanel initialMessages={[]} canUse canConfirm={canConfirm} path="/dashboard" suggestions={suggestedQuestions({ page: "dashboard" })} compact autoQuestion={auto} />
      </Card>
    </section>
  );
}
