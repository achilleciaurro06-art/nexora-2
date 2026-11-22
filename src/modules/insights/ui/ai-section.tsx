import Link from "next/link";
import { Badge, Card } from "@/components/ui/card";
import { AskCopilotButton } from "@/modules/copilot/ui/ask-button";
import type { Summary } from "../rules";
import type { InsightRow } from "../types";
import { InsightControls, RefreshInsights } from "./controls";

const PRIO_LABEL = { high: "Priorità alta", normal: "Priorità media", low: "Priorità bassa" } as const;

function InsightItem({ i, fresh, canWrite }: { i: InsightRow; fresh: boolean; canWrite: boolean }) {
  return (
    <li className="rounded-md border border-border p-3 text-sm" data-testid="insight" data-rule={i.rule}>
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {fresh && <Badge className="border-primary text-primary">Nuovo</Badge>}
        <Badge className={i.priority === "high" ? "border-danger text-danger" : ""}>{PRIO_LABEL[i.priority]}</Badge>
      </div>
      <p className="font-medium">{i.title}</p>
      <p className="mt-0.5 text-muted">{i.description}</p>
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer text-muted">Perché lo vedo?</summary>
        <p className="mt-1">{i.reason}</p>
        {i.evidence.length > 0 && <p className="mt-1">Dati: {i.evidence.map((e, k) => <span key={k}>{k > 0 && " · "}{e.href ? <Link className="underline" href={e.href}>{e.label}</Link> : e.label}</span>)}</p>}
        <p className="mt-1 text-muted">Generato il {new Date(i.generated_at).toLocaleDateString("it-IT")} dalle regole di NEXORA sui dati registrati (non è una previsione).</p>
      </details>
      {i.action_href && <p className="mt-2"><Link href={i.action_href} className="text-primary underline">{i.action_label ?? "Apri"}</Link></p>}
      <InsightControls id={i.id} question={i.copilot_question} canWrite={canWrite} />
    </li>
  );
}

const SHOWN = 3;
/** Le prime segnalazioni (per priorità) sono sempre visibili; le altre si aprono con un clic: la dashboard resta leggibile. */
function List({ items, seenBefore, canWrite }: { items: InsightRow[]; seenBefore: Set<string>; canWrite: boolean }) {
  const rest = items.slice(SHOWN);
  return (
    <>
      <ul className="space-y-2">{items.slice(0, SHOWN).map((i) => <InsightItem key={i.id} i={i} fresh={!seenBefore.has(i.id)} canWrite={canWrite} />)}</ul>
      {rest.length > 0 && (
        <details className="mt-2" data-testid="insights-more">
          <summary className="cursor-pointer text-sm text-primary">Altre {rest.length} segnalazioni</summary>
          <ul className="mt-2 space-y-2">{rest.map((i) => <InsightItem key={i.id} i={i} fresh={!seenBefore.has(i.id)} canWrite={canWrite} />)}</ul>
        </details>
      )}
    </>
  );
}

/**
 * Centro di controllo AI della dashboard. Tutto ciò che compare deriva da dati reali e regole dichiarate (nessun testo inventato):
 * la sintesi è calcolata, le segnalazioni citano i dati e la regola, e ognuna si può approfondire con il Copilot.
 */
export function AiSection({ summary, insights, seenBefore, canWrite, canUseAi }: { summary: Summary; insights: InsightRow[]; seenBefore: Set<string>; canWrite: boolean; canUseAi: boolean }) {
  const opps = insights.filter((i) => i.category === "opportunity");
  const attn = insights.filter((i) => i.category === "attention");
  const analysis = insights.filter((i) => i.category === "analysis");
  const actions = insights.filter((i) => i.action_href).slice(0, 5);
  return (
    <section aria-label="Assistente AI" className="mt-8" data-testid="ai-section">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Assistente AI</h2>
        <div className="flex items-center gap-2"><RefreshInsights />{canUseAi && <AskCopilotButton question="Come sta andando la mia attività?" label="Chiedi al Copilot" variant="default" />}</div>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card data-testid="ai-summary">
          <h3 className="mb-2 text-sm font-medium">Sintesi dell&apos;attività</h3>
          {summary.lines.length === 0 ? <p className="text-sm text-muted">Non ci sono ancora dati sufficienti per una sintesi: appena registri preventivi, follow-up e fatturato compariranno qui.</p> : (
            <ul className="space-y-1.5 text-sm">{summary.lines.map((l, k) => <li key={k} className="flex gap-2"><span aria-hidden className={l.tone === "bad" ? "text-danger" : l.tone === "good" ? "text-success" : "text-muted"}>●</span><span>{l.href ? <Link href={l.href} className="hover:underline">{l.text}</Link> : l.text}</span></li>)}</ul>
          )}
          <p className="mt-3 text-xs text-muted">Numeri calcolati sui dati registrati in NEXORA. Il fatturato è quello registrato dall&apos;utente, non un dato fiscale.</p>
        </Card>
        <Card data-testid="ai-opportunities">
          <h3 className="mb-2 text-sm font-medium">Opportunità</h3>
          {opps.length + analysis.length === 0 ? <p className="text-sm text-muted">Nessuna opportunità rilevata al momento.</p> : <List items={[...opps, ...analysis]} seenBefore={seenBefore} canWrite={canWrite} />}
        </Card>
        <Card data-testid="ai-attention">
          <h3 className="mb-2 text-sm font-medium">Attenzione</h3>
          {attn.length === 0 ? <p className="text-sm text-muted">Nessuna criticità rilevata al momento.</p> : <List items={attn} seenBefore={seenBefore} canWrite={canWrite} />}
        </Card>
      </div>
      {actions.length > 0 && (
        <Card className="mt-3" data-testid="ai-actions">
          <h3 className="mb-2 text-sm font-medium">Azioni consigliate</h3>
          <ul className="flex flex-wrap gap-2 text-sm">{actions.map((i) => <li key={i.id}><Link href={i.action_href!} className="inline-flex rounded-full border border-border px-3 py-1 hover:bg-border/40">{i.action_label ?? "Apri"} — <span className="ml-1 text-muted">{i.title.length > 48 ? `${i.title.slice(0, 48)}…` : i.title}</span></Link></li>)}</ul>
        </Card>
      )}
    </section>
  );
}
