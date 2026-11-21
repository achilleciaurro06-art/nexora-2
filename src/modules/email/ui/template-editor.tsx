"use client";

import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import type { ActionResult } from "@/lib/result";
import { useFormAction } from "@/lib/use-form-action";
import { htmlToText, textToHtml } from "../sanitize";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/** Modifica di un modello: il testo si scrive in chiaro (paragrafi separati da una riga vuota) e viene convertito in HTML semplice. */
export function TemplateEditor({ id, name, subject, body, action, readOnly, reset }: { id: string; name: string; subject: string; body: string; action: Action; readOnly?: boolean; reset?: boolean }) {
  const { state, pending, onSubmit } = useFormAction(async (prev: ActionResult | null, fd: FormData) => {
    fd.set("bodyHtml", textToHtml(String(fd.get("bodyText") ?? "")));
    return action(prev, fd);
  });
  return (
    <form onSubmit={(e) => { onSubmit(e); if (reset) { const f = e.currentTarget; setTimeout(() => f.reset(), 600); } }} className="grid gap-3 sm:grid-cols-2" aria-label={id === "new" ? "Nuovo modello" : `Modello ${name}`}>
      <div><Label htmlFor={`tn-${id}`}>Nome</Label><Input id={`tn-${id}`} name="name" defaultValue={name} required maxLength={100} disabled={readOnly} /></div>
      <div><Label htmlFor={`ts-${id}`}>Oggetto</Label><Input id={`ts-${id}`} name="subject" defaultValue={subject} maxLength={300} disabled={readOnly} /></div>
      <div className="sm:col-span-2"><Label htmlFor={`tb-${id}`}>Testo</Label><Textarea id={`tb-${id}`} name="bodyText" rows={6} defaultValue={htmlToText(body)} disabled={readOnly} /></div>
      {state && !state.ok && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
      {state?.ok && <div className="sm:col-span-2"><Alert kind="success">Modello salvato</Alert></div>}
      {!readOnly && <div className="sm:col-span-2"><Button size="sm" disabled={pending}>{pending ? "Salvataggio…" : "Salva modello"}</Button></div>}
    </form>
  );
}
