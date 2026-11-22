"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { analyzeDocumentAction } from "../analyze-action";

export function AnalyzeForm({ documentId, label }: { documentId: string; label: string }) {
  const [state, action, pending] = useActionState(analyzeDocumentAction.bind(null, documentId), null);
  return (
    <form action={action} className="space-y-1">
      <Button size="sm" variant="outline" disabled={pending}>{pending ? "Analisi in corso…" : label}</Button>
      {state && !state.ok && <p role="alert" className="max-w-56 text-xs text-danger">{state.error}</p>}
      {state?.ok && state.data && <p role="status" className="text-xs text-success">Analisi completata. <Link className="underline" href={`/documenti/revisione/${state.data.suggestionId}`}>Rivedi i dati</Link></p>}
    </form>
  );
}
