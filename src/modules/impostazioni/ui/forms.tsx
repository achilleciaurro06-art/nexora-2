"use client";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import type { ActionResult } from "@/lib/result";
import { uploadAvatarAction, uploadLogoAction } from "../actions";
import { useFormAction } from "@/lib/use-form-action";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Action = (prev: any, formData: FormData) => Promise<ActionResult<any>>;

/** Modulo generico delle impostazioni: i campi arrivano come figli (server component), l'esito si mostra qui. */
export function ActionForm({ action, children, submitLabel = "Salva", readOnly = false, successMessage = "Salvato" }: {
  action: Action; children: React.ReactNode; submitLabel?: string; readOnly?: boolean; successMessage?: string;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      {children}
      {state && !state.ok && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
      {state?.ok && <div className="sm:col-span-2"><Alert kind="success">{typeof state.data === "string" ? state.data : successMessage}</Alert></div>}
      {!readOnly && <div className="sm:col-span-2"><Button disabled={pending}>{pending ? "Salvataggio…" : submitLabel}</Button></div>}
    </form>
  );
}

function UploadForm({ action, field, label, accept, button, success }: { action: Action; field: string; label: string; accept: string; button: string; success: string }) {
  const { state, pending, onSubmit } = useFormAction(action);
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <Label htmlFor={field}>{label}</Label>
      <Input id={field} name={field} type="file" accept={accept} required className="h-auto py-1.5" />
      {state && !state.ok && <Alert>{state.error}</Alert>}
      {state?.ok && <Alert kind="success">{success}</Alert>}
      <Button variant="outline" disabled={pending}>{pending ? "Carico…" : button}</Button>
    </form>
  );
}

export const LogoForm = () => <UploadForm action={uploadLogoAction} field="logo" label="Carica un nuovo logo (PNG o JPEG, max 1 MB)" accept="image/png,image/jpeg" button="Carica logo" success="Logo aggiornato" />;
export const AvatarForm = () => <UploadForm action={uploadAvatarAction} field="avatar" label="Carica un'immagine (PNG, JPEG o WebP, max 2 MB)" accept="image/png,image/jpeg,image/webp" button="Carica immagine" success="Immagine aggiornata" />;
