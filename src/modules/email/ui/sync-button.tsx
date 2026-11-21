"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { markThreadReadAction, syncMineAction } from "../actions";

/** Sincronizzazione manuale di tutte le caselle a cui hai accesso; `auto` la esegue una volta all'apertura se i dati sono vecchi. */
export function SyncButton({ auto }: { auto?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const ran = useRef(false);
  const run = () => start(async () => {
    try { const r = await syncMineAction(); setMsg(r.busy && !r.imported ? "Sincronizzazione già in corso: riprova tra poco" : r.imported ? `${r.imported} nuovi messaggi` : "Nessun nuovo messaggio"); if (r.imported) router.refresh(); }
    catch { setMsg("Sincronizzazione non riuscita"); }
  });
  useEffect(() => { if (auto && !ran.current) { ran.current = true; run(); } }, [auto]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={run} disabled={pending}>{pending ? "Sincronizzazione…" : "Sincronizza"}</Button>
      {msg && <span role="status" className="text-xs text-muted" data-testid="sync-status">{msg}</span>}
    </span>
  );
}

/** Segna come letta la conversazione appena aperta. */
export function MarkRead({ threadId, unread }: { threadId: string; unread: number }) {
  const router = useRouter();
  useEffect(() => { if (unread > 0) markThreadReadAction(threadId, true).then(() => router.refresh()).catch(() => undefined); }, [threadId, unread, router]);
  return null;
}
