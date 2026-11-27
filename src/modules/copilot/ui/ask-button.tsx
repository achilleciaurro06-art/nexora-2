"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COPILOT_EVENT } from "./dock";

/**
 * Apre il Copilot AI sulla pagina corrente con una domanda già pronta (il contesto è la pagina in cui ci si trova).
 * Stesso aspetto in tutte le sezioni: icona scintille + accento blu elettrico, così è chiaro che è l'assistente AI.
 */
export function AskCopilotButton({ question, label = "Chiedi al Copilot", variant = "ai", size = "sm" }: { question: string; label?: string; variant?: "ai" | "outline" | "default" | "ghost"; size?: "sm" | "default" }) {
  return (
    <Button type="button" variant={variant} size={size} title="Assistente AI di NEXORA" onClick={() => window.dispatchEvent(new CustomEvent(COPILOT_EVENT, { detail: { question } }))} data-testid="ask-copilot">
      <Sparkles className="size-3.5 shrink-0" aria-hidden />{label}
    </Button>
  );
}
