"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/result";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/** Pulsante di rimozione con conferma esplicita; mostra l'eventuale errore restituito dal server. */
export function RemoveButton({ action, confirmMessage, label = "Elimina", variant = "ghost", size = "sm" }: {
  action: Action; confirmMessage: string; label?: string; variant?: "default" | "ghost" | "danger" | "outline"; size?: "sm" | "default";
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} onSubmit={(e) => { if (!window.confirm(confirmMessage)) e.preventDefault(); }} className="inline">
      <Button variant={variant} size={size} disabled={pending} className={variant === "ghost" ? "text-danger" : undefined}>{pending ? "Rimozione…" : label}</Button>
      {state && !state.ok && <span role="alert" className="ml-2 text-xs text-danger">{state.error}</span>}
    </form>
  );
}
