import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card } from "@/components/ui/card";
import { AskCopilotButton } from "@/modules/copilot/ui/ask-button";
import { formatEur } from "@/lib/money";
import { todayIn, fmtDay } from "@/lib/datetime";

const days = (iso: string, today: string) => Math.floor((Date.parse(today) - Date.parse(iso.slice(0, 10))) / 86_400_000);

/**
 * Analisi intelligente del cliente: sintesi, criticità, opportunità e prossimo contatto, costruiti da regole sui dati reali
 * (nessuna chiamata al modello, nessun costo). Il Copilot permette di approfondire con una domanda già pronta.
 */
export async function CustomerAiPanel({ db, orgId, customerId, customerName, canUseAi }: { db: SupabaseClient; orgId: string; customerId: string; customerName: string; canUseAi: boolean }) {
  const now = new Date(), today = todayIn(now);
  const [{ data: quotes }, { data: bill }, { data: fus }, { data: ev }, { data: threads }] = await Promise.all([
    db.from("quotes").select("id, number, status, total_cents, issue_date, follow_up_date").eq("organization_id", orgId).eq("customer_id", customerId).is("deleted_at", null).order("issue_date", { ascending: false }).limit(300),
    db.from("quote_billings").select("amount_cents, payment_status, billed_at").eq("organization_id", orgId).eq("customer_id", customerId).limit(1000),
    db.from("follow_ups").select("id, title, due_on").eq("organization_id", orgId).eq("customer_id", customerId).is("deleted_at", null).in("status", ["todo", "scheduled", "in_progress", "waiting"]).order("due_on").limit(20),
    db.from("activity_events").select("created_at").eq("organization_id", orgId).eq("customer_id", customerId).order("created_at", { ascending: false }).limit(1),
    db.from("email_threads").select("id, last_message_at").eq("organization_id", orgId).eq("customer_id", customerId).order("last_message_at", { ascending: false }).limit(10),
  ]);
  const ids = (threads ?? []).map((t) => t.id as string);
  const { data: msgs } = ids.length ? await db.from("email_messages").select("thread_id, direction, message_at").eq("organization_id", orgId).in("thread_id", ids).neq("status", "failed").order("message_at", { ascending: false }).limit(200) : { data: [] };
  const last = new Map<string, { d: string; at: string }>();
  for (const m of msgs ?? []) if (!last.has(m.thread_id as string)) last.set(m.thread_id as string, { d: m.direction as string, at: m.message_at as string });
  const unanswered = [...last.values()].filter((l) => l.d === "inbound" && days(l.at, today) >= 2).length;

  const qs = quotes ?? [];
  const n = (st: string) => qs.filter((q) => q.status === st).length;
  const sum = (st: string) => qs.filter((q) => q.status === st).reduce((a, q) => a + Number(q.total_cents), 0);
  const sent = qs.filter((q) => q.status === "sent");
  const waiting = sent.filter((q) => days(q.issue_date as string, today) >= 7 && !(q.follow_up_date && (q.follow_up_date as string) >= today));
  const lateFu = (fus ?? []).filter((f) => (f.due_on as string) < today);
  const lastEvent = ev?.[0]?.created_at as string | undefined;
  const idle = lastEvent ? days(lastEvent, today) : null;
  const billed = (bill ?? []).reduce((a, b) => a + Number(b.amount_cents), 0), unpaid = (bill ?? []).filter((b) => b.payment_status === "unpaid").reduce((a, b) => a + Number(b.amount_cents), 0);
  const accepted = sum("accepted");

  const attention: string[] = [];
  if (lateFu.length) attention.push(`${lateFu.length} follow-up scaduti (il più vecchio: ${fmtDay(lateFu[0]!.due_on as string)}).`);
  if (waiting.length) attention.push(`${waiting.length} preventivi inviati da oltre 7 giorni senza risposta né follow-up (${formatEur(waiting.reduce((a, q) => a + Number(q.total_cents), 0))}).`);
  if (unanswered) attention.push(`${unanswered} conversazioni email senza una tua risposta da oltre 2 giorni.`);
  if (unpaid > 0) attention.push(`Fatture registrate non incassate: ${formatEur(unpaid)}.`);
  const opportunities: string[] = [];
  if (sent.length) opportunities.push(`${sent.length} preventivi in trattativa per ${formatEur(sum("sent"))}: un sollecito mirato può chiuderli.`);
  if (accepted > 0 && idle !== null && idle >= 60) opportunities.push(`Cliente con ${formatEur(accepted)} di preventivi accettati ma fermo da ${idle} giorni: buon candidato per un ricontatto.`);
  if (n("draft")) opportunities.push(`${n("draft")} preventivi ancora in bozza da completare e inviare.`);
  const nextContact = lateFu.length ? `Chiudi il follow-up scaduto «${lateFu[0]!.title as string}» (${fmtDay(lateFu[0]!.due_on as string)}).`
    : waiting.length ? `Sollecita il preventivo ${waiting[0]!.number as string}, inviato ${days(waiting[0]!.issue_date as string, today)} giorni fa.`
    : unanswered ? "Rispondi alla conversazione email in attesa." : (fus ?? []).length ? `Prossimo follow-up programmato: ${fmtDay(fus![0]!.due_on as string)}.`
    : idle !== null && idle >= 60 ? `Nessun contatto da ${idle} giorni: valuta un ricontatto.` : "Nessun contatto urgente: la relazione è attiva e non ci sono scadenze aperte.";

  return (
    <Card data-testid="customer-ai">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Analisi intelligente</h2>
        {canUseAi && <div className="flex flex-wrap gap-2"><AskCopilotButton question="Analizza questo cliente" label="Analizza con il Copilot" variant="default" /><AskCopilotButton question="Prepara un'email di follow-up per questo cliente" label="Prepara un'email" /></div>}
      </div>
      <p className="text-xs text-muted">Sintesi costruita con regole sui dati registrati (non è una previsione).</p>
      <ul className="mt-2 space-y-1 text-sm" data-testid="customer-ai-summary">
        <li>Preventivi: {qs.length} ({n("accepted")} accettati, {n("sent")} inviati, {n("rejected")} rifiutati). Accettato {formatEur(accepted)}; fatture registrate {formatEur(billed)}.</li>
        <li>Ultima attività registrata: {lastEvent ? `${idle} giorni fa (${fmtDay(lastEvent.slice(0, 10))})` : "nessuna"}.</li>
        <li>Email collegate: {(threads ?? []).length} conversazioni{(threads ?? []).length ? <> · <Link className="text-primary hover:underline" href="?tab=documenti">vedi comunicazioni</Link></> : ""}.</li>
      </ul>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div><h3 className="text-sm font-medium">Attenzione</h3>{attention.length ? <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-danger" data-testid="customer-ai-attention">{attention.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="mt-1 text-sm text-muted">Nessuna criticità rilevata.</p>}</div>
        <div><h3 className="text-sm font-medium">Opportunità</h3>{opportunities.length ? <ul className="mt-1 list-disc space-y-1 pl-5 text-sm" data-testid="customer-ai-opportunities">{opportunities.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="mt-1 text-sm text-muted">Nessuna opportunità evidente dai dati.</p>}</div>
      </div>
      <p className="mt-3 rounded-md bg-border/30 p-2 text-sm" data-testid="customer-ai-next"><strong>Prossimo contatto suggerito:</strong> {nextContact}</p>
      <p className="sr-only">{customerName}</p>
    </Card>
  );
}
