"use client";

import { useActionState, useTransition, type FormEvent } from "react";

/**
 * Come useActionState, ma NON azzera i campi del modulo dopo l'invio.
 * React 19 svuota i moduli con `action={...}` a fine azione anche quando il server rifiuta i dati: chi aveva compilato
 * molti campi li perde per un solo errore. Qui l'invio passa da onSubmit, quindi i valori restano dov'erano.
 * Il pulsante che ha inviato (name/value) viene incluso nei dati, come in un invio nativo.
 */
export function useFormAction<S>(action: (prev: S | null, formData: FormData) => Promise<S | null>) {
  const [state, dispatch, pending] = useActionState<S | null, FormData>(action, null);
  const [, startTransition] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | HTMLInputElement | null;
    const data = new FormData(e.currentTarget, submitter ?? undefined);
    startTransition(() => dispatch(data));
  };
  return { state, pending, onSubmit };
}
