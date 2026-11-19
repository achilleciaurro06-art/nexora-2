"use client";

import { useActionState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { sendMessageAction } from "../actions";

export function ChatForm({ conversationId }: { conversationId?: string }) {
  const [state, action, pending] = useActionState(sendMessageAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state && !state.error) ref.current?.reset();
  }, [state]);
  const cid = conversationId ?? state?.conversationId ?? "";
  return (
    <form ref={ref} action={action} className="space-y-2">
      <input type="hidden" name="conversationId" value={cid} />
      <Textarea name="question" required maxLength={2000} placeholder="Chiedi al Copilot: es. «Quali preventivi devo sollecitare questa settimana?»" aria-label="Domanda" />
      {state?.error && <Alert>{state.error}</Alert>}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">Il Copilot propone, non modifica: ogni azione richiede la tua conferma.</p>
        <Button disabled={pending}>{pending ? "Penso…" : "Invia"}</Button>
      </div>
    </form>
  );
}
