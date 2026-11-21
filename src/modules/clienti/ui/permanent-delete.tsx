"use client";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { useFormAction } from "@/lib/use-form-action";
import { deleteCustomerPermanentlyAction } from "../actions";
import { DELETE_CONFIRM_WORD } from "../schemas";

/** Eliminazione definitiva: richiede di scrivere ELIMINA; l'esito è comunque ricontrollato dal database. */
export function PermanentDelete({ id, name, willRemove }: { id: string; name: string; willRemove: string[] }) {
  const { state, pending, onSubmit } = useFormAction(deleteCustomerPermanentlyAction.bind(null, id));
  return (
    <form onSubmit={(e) => { if (!window.confirm(`Eliminare DEFINITIVAMENTE «${name}»?\n\nL'operazione non si può annullare.`)) { e.preventDefault(); return; } onSubmit(e); }} className="space-y-3">
      <p className="text-sm">Questo cliente non ha preventivi, fatture, documenti né attività: può essere eliminato.{willRemove.length ? ` Verranno eliminati con lui: ${willRemove.join(", ")}.` : ""} <strong>L&apos;operazione è definitiva e non si può annullare</strong> (resta traccia nel registro delle operazioni).</p>
      <div className="max-w-xs"><Label htmlFor="confirm">Per confermare scrivi {DELETE_CONFIRM_WORD}</Label><Input id="confirm" name="confirm" autoComplete="off" /></div>
      {state && !state.ok && <Alert>{state.error}</Alert>}
      <Button variant="danger" disabled={pending}>{pending ? "Eliminazione…" : "Elimina definitivamente"}</Button>
    </form>
  );
}
