"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormAction } from "@/lib/use-form-action";
import { rescheduleItemAction } from "../actions";

/** Riprogrammazione rapida (nuova data) direttamente dalla riga del centro Promemoria. */
export function QuickReschedule({ kind, id, current, title }: { kind: string; id: string; current: string; title: string }) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useFormAction(rescheduleItemAction.bind(null, kind, id));
  if (!open) return <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Riprogramma: ${title}`}>Riprogramma</Button>;
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-1">
      <Input name="date" type="date" required defaultValue={current} aria-label={`Nuova data per ${title}`} className="h-8 w-36 text-xs" />
      <Button size="sm" variant="outline" disabled={pending}>Sposta</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Chiudi</Button>
      {state && !state.ok && <span role="alert" className="w-full text-xs text-danger">{state.error}</span>}
    </form>
  );
}
