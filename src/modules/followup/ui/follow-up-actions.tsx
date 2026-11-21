"use client";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { useFormAction } from "@/lib/use-form-action";
import { changeFollowUpStatusAction, rescheduleFollowUpAction } from "../actions";
import { FOLLOW_UP_LABEL, allowedTransitions, type FollowUpStatus } from "../states";

/** Cambio di stato (solo le transizioni consentite) con nota facoltativa che finisce nella cronologia. */
export function StatusPanel({ id, status }: { id: string; status: FollowUpStatus }) {
  const { state, pending, onSubmit } = useFormAction(changeFollowUpStatusAction.bind(null, id));
  const closed = status === "done" || status === "cancelled";
  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-label="Cambia stato">
      <div><Label htmlFor="note">Nota (facoltativa, resta nella cronologia)</Label><Input id="note" name="note" maxLength={500} /></div>
      <div className="flex flex-wrap gap-2">
        {allowedTransitions(status).map((s) => (
          <Button key={s} name="status" value={s} size="sm" variant={s === "done" ? "default" : s === "cancelled" ? "danger" : "outline"} disabled={pending}
            onClick={(e) => { if (s === "cancelled" && !window.confirm("Annullare il follow-up? Resta nello storico e si può riaprire.")) e.preventDefault(); }}>
            {closed ? "Riapri (Da fare)" : s === "done" ? "Completa" : s === "cancelled" ? "Annulla follow-up" : `Segna «${FOLLOW_UP_LABEL[s]}»`}
          </Button>
        ))}
      </div>
      {state && !state.ok && <Alert>{state.error}</Alert>}
      {state?.ok && <Alert kind="success">Stato aggiornato</Alert>}
    </form>
  );
}

/** Riprogrammazione: la data precedente resta nella cronologia. */
export function ReschedulePanel({ id, dueOn }: { id: string; dueOn: string }) {
  const { state, pending, onSubmit } = useFormAction(rescheduleFollowUpAction.bind(null, id));
  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" aria-label="Riprogramma">
      <div><Label htmlFor="dueOn">Nuova data</Label><Input id="dueOn" name="dueOn" type="date" required defaultValue={dueOn} /></div>
      <div><Label htmlFor="rnote">Motivo (facoltativo)</Label><Input id="rnote" name="note" maxLength={500} /></div>
      {state && !state.ok && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
      {state?.ok && <div className="sm:col-span-2"><Alert kind="success">Follow-up riprogrammato</Alert></div>}
      <div className="sm:col-span-2"><Button size="sm" variant="outline" disabled={pending}>{pending ? "Salvataggio…" : "Riprogramma"}</Button></div>
    </form>
  );
}
