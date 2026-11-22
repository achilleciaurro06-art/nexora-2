"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { DigitalTexture } from "@/components/brand/digital-texture";
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
    <section ref={ref} aria-label="Chat con il Copilot" data-testid="dashboard-chat" className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
      <div className="nx-surface-dark relative overflow-hidden px-5 py-4">
        <DigitalTexture intensity="medium" />
        <div className="relative z-10">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky"><Sparkles className="size-3.5" />NEXORA Intelligence</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Chiedi a NEXORA</h2>
          <p className="text-xs text-slate-300">Conosce i dati della tua azienda e propone azioni che confermi tu.</p>
        </div>
      </div>
      <div className="p-4">
        <ChatPanel initialMessages={[]} canUse canConfirm={canConfirm} path="/dashboard" suggestions={suggestedQuestions({ page: "dashboard" })} compact autoQuestion={auto} />
      </div>
    </section>
  );
}
