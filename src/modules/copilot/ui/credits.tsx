import { Card } from "@/components/ui/card";

export type QuotaView = { limit: number; used: number; inputPrice: number | null; outputPrice: number | null };
export type UsageView = { id: string; created_at: string; feature: string; model: string; input_tokens: number; output_tokens: number; cost_micro_eur: number; status: string; tokens_source: string; cost_source: string };

export const FEATURE_LABEL: Record<string, string> = { copilot: "Copilot", document_analysis: "Analisi documenti", price_analysis: "Analisi prezzi", email_analysis: "Analisi email" };
const STATUS_LABEL: Record<string, string> = { completed: "completata", failed: "non riuscita (nessun addebito)", cancelled: "interrotta (nessun addebito)" };
const fmt = (n: number) => n.toLocaleString("it-IT");

/** Crediti AI: consumo, percentuale e stato del limite, costo STIMATO (solo se il gestore ha configurato i prezzi) e storico. */
export function CreditsPanel({ quota, usage, scope }: { quota: QuotaView | null; usage: UsageView[]; scope: "mine" | "organization" }) {
  if (!quota) return <Card className="h-fit"><h2 className="mb-2 text-sm font-medium">Crediti AI</h2><p className="text-sm text-muted">Nessun limite configurato per questa organizzazione.</p></Card>;
  const pct = quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 100;
  const left = Math.max(0, quota.limit - quota.used);
  const state = pct >= 100 ? "esauriti" : pct >= 80 ? "in esaurimento" : "disponibili";
  const estimated = usage.filter((u) => u.cost_source === "estimated");
  const cost = estimated.reduce((n, u) => n + Number(u.cost_micro_eur), 0) / 1_000_000;
  return (
    <Card className="h-fit" data-testid="credits">
      <h2 className="mb-2 text-sm font-medium">Crediti AI del mese</h2>
      <p className="text-sm"><strong data-testid="credits-used">{fmt(quota.used)}</strong> / {fmt(quota.limit)} token <span className="text-muted">({pct}%)</span></p>
      <div className="mt-2 h-2 rounded-full bg-border" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Crediti AI utilizzati">
        <div className={`h-2 rounded-full ${pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className={`mt-1 text-xs ${pct >= 100 ? "text-danger" : "text-muted"}`} data-testid="credits-state">
        {pct >= 100 ? "Crediti esauriti: le richieste AI sono sospese fino al prossimo mese o all'aumento del limite da parte dell'amministratore." : `Crediti ${state}: restano ${fmt(left)} token. Il consumo si azzera ogni mese.`}
      </p>
      {quota.inputPrice !== null && quota.outputPrice !== null
        ? <p className="mt-2 text-xs text-muted">Costo <strong>stimato</strong> sulle richieste elencate: circa {cost.toLocaleString("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 4 })} (calcolato con i prezzi configurati dal gestore, non è un addebito del fornitore).</p>
        : <p className="mt-2 text-xs text-muted">Costo in euro non calcolato: i prezzi per token non sono stati configurati.</p>}
      {usage.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1 text-xs font-medium text-muted">Ultime richieste{scope === "mine" ? " (tue)" : ""}</h3>
          <ul className="space-y-1 text-xs" data-testid="usage-history">
            {usage.map((u) => (
              <li key={u.id} className="flex flex-wrap justify-between gap-x-2">
                <span>{FEATURE_LABEL[u.feature] ?? u.feature} · {new Date(u.created_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="text-muted">{u.status === "completed" ? `${fmt(u.input_tokens + u.output_tokens)} token${u.tokens_source === "estimated" ? " (stima)" : ""}` : STATUS_LABEL[u.status] ?? u.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
