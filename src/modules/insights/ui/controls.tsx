"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { AskCopilotButton } from "@/modules/copilot/ui/ask-button";
import { refreshInsightsAction, setInsightStatusAction } from "../actions";

export function InsightControls({ id, question, canWrite }: { id: string; question: string | null; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (s: "done" | "dismissed") => start(async () => { await setInsightStatusAction(id, s); router.refresh(); });
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {question && <AskCopilotButton question={question} label="Approfondisci con il Copilot" />}
      {canWrite && <>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => set("done")} data-testid="insight-done">Fatto</Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => set("dismissed")} data-testid="insight-dismiss">Ignora</Button>
      </>}
    </div>
  );
}

export function RefreshInsights() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await refreshInsightsAction(); router.refresh(); })} data-testid="insights-refresh">{pending ? "Aggiorno…" : "Aggiorna"}</Button>;
}
