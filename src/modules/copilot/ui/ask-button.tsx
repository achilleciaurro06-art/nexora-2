"use client";

import { Button } from "@/components/ui/button";
import { COPILOT_EVENT } from "./dock";

/** Apre il Copilot sulla pagina corrente con una domanda già pronta (il contesto è la pagina in cui ci si trova). */
export function AskCopilotButton({ question, label = "Chiedi al Copilot", variant = "outline", size = "sm" }: { question: string; label?: string; variant?: "outline" | "default" | "ghost"; size?: "sm" | "default" }) {
  return <Button type="button" variant={variant} size={size} onClick={() => window.dispatchEvent(new CustomEvent(COPILOT_EVENT, { detail: { question } }))} data-testid="ask-copilot">{label}</Button>;
}
