"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { confirmProposalAction, rejectProposalAction } from "../actions";

export type ProposalView = {
  id: string; kind: string; label: string; description: string; details: { label: string; value: string }[];
  status: "pending" | "accepted" | "rejected"; execution_status: "not_run" | "running" | "done" | "failed"; result?: { summary?: string; redirectTo?: string | null; error?: string } | null;
};

/**
 * Azione proposta dal Copilot. Mostra cosa verrà fatto e con quali dati; nulla accade senza il click dell'utente.
 * Dopo la conferma mostra l'ESITO reale restituito dal server (eseguita, già presente, errore).
 */
export function ProposalCard({ p, canConfirm }: { p: ProposalView; canConfirm: boolean }) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "done"; summary: string; href?: string } | { kind: "error"; error: string } | { kind: "rejected" }>(
    p.execution_status === "done" ? { kind: "done", summary: p.result?.summary ?? "Operazione eseguita.", href: p.result?.redirectTo ?? undefined }
      : p.status === "rejected" ? { kind: "rejected" } : p.execution_status === "failed" && p.result?.error ? { kind: "error", error: p.result.error } : { kind: "idle" });
  const [pending, start] = useTransition();
  const confirm = () => start(async () => {
    try {
      const r = await confirmProposalAction(p.id);
      setState(r.ok ? { kind: "done", summary: r.summary, href: r.redirectTo } : { kind: "error", error: r.error });
    } catch { setState({ kind: "error", error: "Operazione interrotta: controlla lo stato prima di riprovare." }); }
  });
  const reject = () => start(async () => { const r = await rejectProposalAction(p.id); setState(r.ok ? { kind: "rejected" } : { kind: "error", error: r.error ?? "Impossibile scartare." }); });

  return (
    <li className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm" data-testid="proposal" data-kind={p.kind}>
      <div className="mb-1 flex items-center gap-2"><Badge>Proposta</Badge><span className="font-medium">{p.label}</span></div>
      <p>{p.description}</p>
      {p.details.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {p.details.map((d, i) => <div key={i} className="contents"><dt className="text-muted">{d.label}</dt><dd className="whitespace-pre-wrap break-words">{d.value}</dd></div>)}
        </dl>
      )}
      {state.kind === "idle" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canConfirm ? <>
            <Button size="sm" onClick={confirm} disabled={pending} data-testid="proposal-confirm">{pending ? "Attendi…" : "Conferma ed esegui"}</Button>
            <Button size="sm" variant="outline" onClick={reject} disabled={pending}>Scarta</Button>
          </> : <p className="text-xs text-muted">Il tuo ruolo non può confermare operazioni.</p>}
          <span className="text-xs text-muted">Finché non confermi, non viene modificato nulla.</span>
        </div>
      )}
      {state.kind === "done" && <p className="mt-2 text-xs text-green-600" role="status" data-testid="proposal-done">✓ {state.summary} {state.href && <Link className="underline" href={state.href}>Apri</Link>}</p>}
      {state.kind === "error" && (
        <div className="mt-2 space-y-2"><p role="alert" className="text-xs text-danger" data-testid="proposal-error">{state.error}</p>
          {canConfirm && p.status === "pending" && <Button size="sm" variant="outline" onClick={confirm} disabled={pending}>Riprova</Button>}</div>
      )}
      {state.kind === "rejected" && <p className="mt-2 text-xs text-muted">Scartata.</p>}
    </li>
  );
}
