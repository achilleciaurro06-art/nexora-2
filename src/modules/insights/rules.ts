import { addDays } from "@/lib/datetime";
import { formatEur } from "@/lib/money";
import type { Evidence, InsightDraft, Snapshot, SnapQuote } from "./types";

/**
 * Regole degli insight: funzioni PURE su dati reali (nessuna chiamata AI, nessun costo, risultato riproducibile).
 * Ogni insight dichiara i dati che lo hanno generato (evidence) e la regola applicata (reason). Nessuna previsione:
 * si descrivono fatti misurati; con dati insufficienti la regola non produce nulla.
 */
export const RULE_PARAMS = {
  quoteWaitingDays: 7, staleDays: 60, staleHighDays: 90, emailUnansweredDays: 2, minDecidedForPercentile: 8, declineDropPct: 40, revenueDropPct: 25, minPriorBillings: 2, billLateDays: 30, unpaidDays: 30,
  maxPerRule: 6,
} as const;

const days = (fromDate: string, today: string) => Math.floor((Date.parse(today) - Date.parse(fromDate)) / 86_400_000);
const monthOf = (d: string) => d.slice(0, 7);
const prevMonth = (m: string) => { const [y, mo] = m.split("-").map(Number) as [number, number]; return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7); };

/** Valore storico del cliente: fatturato registrato + preventivi accettati (importi diversi, mai sommati ai fatturati dello stesso preventivo). */
export function customerValue(s: Snapshot): Map<string, number> {
  const billedByQuote = new Map<string, number>();
  for (const b of s.billings) if (b.quote_id) billedByQuote.set(b.quote_id, (billedByQuote.get(b.quote_id) ?? 0) + b.amount_cents);
  const v = new Map<string, number>();
  for (const x of s.quotes) if (x.status === "accepted") v.set(x.customer_id, (v.get(x.customer_id) ?? 0) + Math.max(x.total_cents, billedByQuote.get(x.id) ?? 0));
  return v;
}

function percentile75(values: number[]): number | null {
  if (values.length < RULE_PARAMS.minDecidedForPercentile) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.75)]!;
}

export function generateInsights(s: Snapshot): InsightDraft[] {
  const out: InsightDraft[] = [];
  const cust = (id: string): Evidence => ({ label: s.quotes.find((x) => x.customer_id === id)?.customer_name ?? s.stale.find((x) => x.customer_id === id)?.name ?? "Cliente", href: `/clienti/${id}` });
  const value = customerValue(s);

  // 1. clienti di valore fermi da tempo
  const staleRows = s.stale.filter((c) => (value.get(c.customer_id) ?? 0) > 0 && days(c.last_activity.slice(0, 10), s.today) >= RULE_PARAMS.staleDays);
  for (const c of staleRows.sort((a, b) => (value.get(b.customer_id) ?? 0) - (value.get(a.customer_id) ?? 0)).slice(0, RULE_PARAMS.maxPerRule)) {
    const d = days(c.last_activity.slice(0, 10), s.today), v = value.get(c.customer_id) ?? 0;
    out.push({ dedupe_key: `stale_customer:${c.customer_id}`, rule: "stale_customer", category: "opportunity", priority: d >= RULE_PARAMS.staleHighDays ? "high" : "normal",
      title: `Ricontatta ${c.name}`, description: `Nessuna attività registrata da ${d} giorni. Valore storico: ${formatEur(v)} tra preventivi accettati e fatturato registrato.${c.open_quotes > 0 ? ` Ha ${c.open_quotes} preventivo/i aperto/i.` : ""}`,
      reason: `Cliente con storico commerciale positivo e senza attività da almeno ${RULE_PARAMS.staleDays} giorni (ultima: ${c.last_activity.slice(0, 10)}).`,
      evidence: [{ label: c.name, href: `/clienti/${c.customer_id}` }], action_label: "Apri la scheda cliente", action_href: `/clienti/${c.customer_id}`, copilot_question: `Analizza il cliente ${c.name} e suggerisci come ricontattarlo.`, ttl_hours: 72 });
  }

  // 2. preventivi inviati fermi
  const sent = s.quotes.filter((x) => x.status === "sent");
  const p75 = percentile75(s.quotes.filter((x) => x.status !== "draft").map((x) => x.total_cents));
  const waiting = sent.filter((x) => days(x.issue_date, s.today) >= RULE_PARAMS.quoteWaitingDays && !(x.follow_up_date && x.follow_up_date >= s.today)).sort((a, b) => b.total_cents - a.total_cents);
  for (const x of waiting.slice(0, RULE_PARAMS.maxPerRule)) {
    const d = days(x.issue_date, s.today), big = p75 !== null && x.total_cents >= p75;
    out.push({ dedupe_key: `quote_waiting:${x.id}`, rule: "quote_waiting", category: "opportunity", priority: big ? "high" : "normal",
      title: `Preventivo ${x.number} senza risposta (${x.customer_name})`, description: `Inviato da ${d} giorni, ${formatEur(x.total_cents)}, nessun follow-up programmato.${big ? " Tra i preventivi di importo più alto dell'azienda." : ""}`,
      reason: `Preventivo inviato da almeno ${RULE_PARAMS.quoteWaitingDays} giorni, ancora senza esito e senza una data di follow-up futura.${big ? ` L'importo è nel quarto più alto (≥ ${formatEur(p75!)}) dei preventivi emessi.` : ""}`,
      evidence: [{ label: `Preventivo ${x.number}`, href: `/preventivi/${x.id}` }, cust(x.customer_id)], action_label: "Apri il preventivo", action_href: `/preventivi/${x.id}`, copilot_question: `Prepara un'email di sollecito per il preventivo ${x.number} del cliente ${x.customer_name} e un follow-up.`, ttl_hours: 72 });
  }
  if (waiting.length > RULE_PARAMS.maxPerRule) {
    const rest = waiting.slice(RULE_PARAMS.maxPerRule);
    out.push({ dedupe_key: "quote_waiting:more", rule: "quote_waiting", category: "opportunity", priority: "low", title: `Altri ${rest.length} preventivi inviati senza risposta`, description: `Totale ${formatEur(rest.reduce((n, x) => n + x.total_cents, 0))}.`,
      reason: `Preventivi inviati da almeno ${RULE_PARAMS.quoteWaitingDays} giorni, senza esito né follow-up.`, evidence: rest.slice(0, 5).map((x) => ({ label: `${x.number} · ${x.customer_name}`, href: `/preventivi/${x.id}` })),
      action_label: "Vedi i preventivi inviati", action_href: "/preventivi?status=sent", copilot_question: "Quali preventivi sono ancora senza risposta?", ttl_hours: 72 });
  }

  // 3. follow-up scaduti (clienti + preventivi)
  const lateFu = s.followUps.filter((f) => f.due_on < s.today).sort((a, b) => a.due_on.localeCompare(b.due_on));
  const lateQuoteFu = s.quotes.filter((x) => (x.status === "sent" || x.status === "draft") && x.follow_up_date && x.follow_up_date < s.today);
  const lateTotal = lateFu.length + lateQuoteFu.length;
  if (lateTotal > 0) {
    const oldest = Math.max(...lateFu.map((f) => days(f.due_on, s.today)), ...lateQuoteFu.map((x) => days(x.follow_up_date!, s.today)), 0);
    out.push({ dedupe_key: "followups_late", rule: "followups_late", category: "attention", priority: oldest >= 7 ? "high" : "normal", title: `${lateTotal} follow-up scaduti`,
      description: `${lateFu.length} follow-up e ${lateQuoteFu.length} follow-up di preventivi hanno superato la data prevista; il più vecchio da ${oldest} giorni.`,
      reason: "Follow-up ancora aperti con data di scadenza precedente a oggi.", evidence: [...lateFu.slice(0, 4).map((f) => ({ label: `${f.title} · ${f.customer_name} (${f.due_on})`, href: `/clienti/${f.customer_id}` })), ...lateQuoteFu.slice(0, 2).map((x) => ({ label: `Preventivo ${x.number} (${x.follow_up_date})`, href: `/preventivi/${x.id}` }))],
      action_label: "Apri i promemoria in ritardo", action_href: "/promemoria?vista=ritardo", copilot_question: "Quali follow-up sono in ritardo e cosa dovrei fare per primo?", ttl_hours: 48 });
  }

  // 4. email senza risposta
  const unanswered = s.unansweredEmails.filter((e) => days(e.last_inbound_at.slice(0, 10), s.today) >= RULE_PARAMS.emailUnansweredDays).sort((a, b) => a.last_inbound_at.localeCompare(b.last_inbound_at));
  for (const e of unanswered.slice(0, RULE_PARAMS.maxPerRule)) {
    const d = days(e.last_inbound_at.slice(0, 10), s.today);
    out.push({ dedupe_key: `email_unanswered:${e.thread_id}`, rule: "email_unanswered", category: "attention", priority: d >= 5 ? "high" : "normal", title: `Email senza risposta${e.customer_name ? ` da ${e.customer_name}` : ""}`,
      description: `L'ultimo messaggio ricevuto risale a ${d} giorni fa e non c'è una tua risposta.`, reason: `Conversazione (casella condivisa) il cui ultimo messaggio è in arrivo da almeno ${RULE_PARAMS.emailUnansweredDays} giorni.`,
      evidence: [{ label: e.customer_name ?? "Conversazione", href: `/email/${e.thread_id}` }], action_label: "Apri la conversazione", action_href: `/email/${e.thread_id}`, copilot_question: "Quali richieste dei clienti non hanno ancora ricevuto risposta?", ttl_hours: 48 });
  }

  // 5. appuntamenti nelle prossime 24 ore
  if (s.appointments24h.length) {
    const a = s.appointments24h;
    out.push({ dedupe_key: `appointments_soon:${s.today}`, rule: "appointments_soon", category: "attention", priority: "normal", title: a.length === 1 ? "1 appuntamento nelle prossime 24 ore" : `${a.length} appuntamenti nelle prossime 24 ore`,
      description: a.slice(0, 3).map((x) => `${x.title}${x.customer_name ? ` (${x.customer_name})` : ""}`).join("; "), reason: "Appuntamenti programmati entro le prossime 24 ore.",
      evidence: a.slice(0, 4).map((x) => ({ label: x.title, href: `/appuntamenti/${x.id}` })), action_label: "Apri gli appuntamenti", action_href: "/appuntamenti?vista=elenco", copilot_question: `Prepara un briefing per l'appuntamento "${a[0]!.title}".`, ttl_hours: 24 });
  }

  // 6. fatturato: ultimo mese completo vs precedente
  const byMonth = new Map<string, { sum: number; n: number }>();
  for (const b of s.billings) { const e = byMonth.get(monthOf(b.billed_at)) ?? { sum: 0, n: 0 }; e.sum += b.amount_cents; e.n++; byMonth.set(monthOf(b.billed_at), e); }
  const curMonth = monthOf(s.today), lastFull = prevMonth(curMonth), before = prevMonth(lastFull);
  const L = byMonth.get(lastFull), P = byMonth.get(before);
  if (P && P.n >= RULE_PARAMS.minPriorBillings && P.sum > 0) {
    const chg = Math.round(((( L?.sum ?? 0) - P.sum) / P.sum) * 100);
    if (chg <= -RULE_PARAMS.revenueDropPct) out.push({ dedupe_key: `revenue_drop:${lastFull}`, rule: "revenue_drop", category: "attention", priority: chg <= -50 ? "high" : "normal", title: `Fatturato registrato in calo a ${lastFull}`,
      description: `${formatEur(L?.sum ?? 0)} contro ${formatEur(P.sum)} del mese precedente (${chg}%). È fatturato registrato in NEXORA, non un dato fiscale.`,
      reason: `Confronto tra mesi completi consecutivi (${before} → ${lastFull}); soglia di segnalazione: calo di almeno ${RULE_PARAMS.revenueDropPct}% con almeno ${RULE_PARAMS.minPriorBillings} registrazioni nel mese di partenza. È un fatto misurato, non una previsione.`,
      evidence: [{ label: "Andamento commerciale", href: "/dashboard" }], action_label: "Vedi l'andamento", action_href: "/dashboard", copilot_question: "Confronta il fatturato dell'ultimo mese con quello precedente e spiega cosa è cambiato.", ttl_hours: 24 * 14 });
  }

  // 7. clienti con attività in forte calo (accettati ultimi 180gg vs 180gg precedenti)
  const cutA = addDays(s.today, -180), cutB = addDays(s.today, -360);
  const agg = new Map<string, { recent: number; prior: number; priorN: number; name: string }>();
  for (const x of s.quotes) if (x.status === "accepted") {
    const e = agg.get(x.customer_id) ?? { recent: 0, prior: 0, priorN: 0, name: x.customer_name };
    if (x.issue_date >= cutA) e.recent += x.total_cents; else if (x.issue_date >= cutB) { e.prior += x.total_cents; e.priorN++; }
    agg.set(x.customer_id, e);
  }
  const declining = [...agg.entries()].filter(([, e]) => e.priorN >= 2 && e.prior > 0 && ((e.recent - e.prior) / e.prior) * 100 <= -RULE_PARAMS.declineDropPct).sort((a, b) => b[1].prior - a[1].prior).slice(0, 4);
  for (const [id, e] of declining) {
    const chg = Math.round(((e.recent - e.prior) / e.prior) * 100);
    out.push({ dedupe_key: `customer_decline:${id}:${monthOf(s.today)}`, rule: "customer_decline", category: "opportunity", priority: "normal", title: `${e.name} ha ridotto gli acquisti`,
      description: `Preventivi accettati negli ultimi 180 giorni: ${formatEur(e.recent)}, contro ${formatEur(e.prior)} nei 180 giorni precedenti (${chg}%).`, reason: `Confronto tra due finestre di 180 giorni con almeno 2 preventivi accettati nella prima; soglia: calo di almeno ${RULE_PARAMS.declineDropPct}%. Non indica la causa.`,
      evidence: [{ label: e.name, href: `/clienti/${id}` }], action_label: "Apri la scheda cliente", action_href: `/clienti/${id}`, copilot_question: `Analizza il cliente ${e.name}: perché potrebbe aver diminuito gli acquisti?`, ttl_hours: 24 * 14 });
  }

  // 8. accettati non ancora fatturati (registrazione mancante)
  const billedQ = new Map<string, number>();
  for (const b of s.billings) if (b.quote_id) billedQ.set(b.quote_id, (billedQ.get(b.quote_id) ?? 0) + b.amount_cents);
  const toBill = s.quotes.filter((x) => x.status === "accepted" && days(x.issue_date, s.today) >= RULE_PARAMS.billLateDays && (billedQ.get(x.id) ?? 0) < x.total_cents);
  if (toBill.length) {
    const residual = toBill.reduce((n, x) => n + (x.total_cents - (billedQ.get(x.id) ?? 0)), 0);
    out.push({ dedupe_key: "accepted_not_billed", rule: "accepted_not_billed", category: "attention", priority: "normal", title: `${toBill.length} preventivi accettati senza fatturato registrato`,
      description: `Residuo da registrare: ${formatEur(residual)}. Verifica se sono stati fatturati e registra l'importo (NEXORA registra le fatture manualmente, non le emette).`,
      reason: `Preventivi accettati da oltre ${RULE_PARAMS.billLateDays} giorni con fatturato registrato inferiore al totale.`, evidence: toBill.slice(0, 4).map((x: SnapQuote) => ({ label: `${x.number} · ${x.customer_name}`, href: `/preventivi/${x.id}` })),
      action_label: "Apri i preventivi accettati", action_href: "/preventivi?status=accepted", copilot_question: "Quali preventivi accettati non risultano ancora fatturati?", ttl_hours: 24 * 7 });
  }

  // 8b. fatture registrate non incassate (stato indicato dall'utente: NEXORA non verifica i pagamenti in banca)
  const unpaid = s.billings.filter((b) => b.payment_status === "unpaid" && days(b.billed_at, s.today) >= RULE_PARAMS.unpaidDays).sort((a, b) => a.billed_at.localeCompare(b.billed_at));
  if (unpaid.length) {
    const tot = unpaid.reduce((n, b) => n + b.amount_cents, 0), oldest = days(unpaid[0]!.billed_at, s.today);
    out.push({ dedupe_key: "invoices_unpaid", rule: "invoices_unpaid", category: "attention", priority: oldest >= 60 ? "high" : "normal", title: `${unpaid.length} fatture registrate non incassate da oltre ${RULE_PARAMS.unpaidDays} giorni`,
      description: `Totale ${formatEur(tot)}; la più vecchia è del ${unpaid[0]!.billed_at} (${oldest} giorni). Lo stato «non incassata» è quello indicato in NEXORA: se hai già ricevuto il pagamento, aggiornalo.`,
      reason: `Fatture registrate con stato «non incassata» e data di fatturazione di almeno ${RULE_PARAMS.unpaidDays} giorni fa. NEXORA non gestisce scadenze di pagamento né verifica gli incassi in banca.`,
      evidence: unpaid.slice(0, 5).map((b) => ({ label: `${b.customer_name} · ${formatEur(b.amount_cents)} (${b.billed_at})`, href: `/clienti/${b.customer_id}` })),
      action_label: "Apri la fatturazione", action_href: "/preventivi?status=accepted", copilot_question: "Quali fatture risultano ancora non incassate?", ttl_hours: 24 * 3 });
  }

  // 9. andamento preventivi: ultimi 3 mesi vs 3 precedenti (solo con dati sufficienti)
  const win = (from: string, to: string) => s.quotes.filter((x) => x.status !== "draft" && x.issue_date >= from && x.issue_date < to);
  const r3 = win(addDays(s.today, -90), addDays(s.today, 1)), p3 = win(addDays(s.today, -180), addDays(s.today, -90));
  if (p3.length >= 5 && r3.length >= 1) {
    const sr = r3.reduce((n, x) => n + x.total_cents, 0), sp = p3.reduce((n, x) => n + x.total_cents, 0), chg = sp > 0 ? Math.round(((sr - sp) / sp) * 100) : 0;
    if (Math.abs(chg) >= 20) out.push({ dedupe_key: `sales_trend:${monthOf(s.today)}`, rule: "sales_trend", category: "analysis", priority: "low", title: chg > 0 ? "Preventivi emessi in crescita" : "Preventivi emessi in calo",
      description: `Ultimi 90 giorni: ${r3.length} preventivi per ${formatEur(sr)}; 90 giorni precedenti: ${p3.length} per ${formatEur(sp)} (${chg > 0 ? "+" : ""}${chg}%).`,
      reason: "Confronto tra due finestre consecutive di 90 giorni sui preventivi emessi (esclusi i bozze); segnalato per variazioni di almeno 20%, con almeno 5 preventivi nella finestra di partenza.",
      evidence: [{ label: "Andamento commerciale", href: "/dashboard" }], action_label: "Apri la dashboard", action_href: "/dashboard", copilot_question: "Confronta i preventivi degli ultimi tre mesi con i tre precedenti.", ttl_hours: 24 * 14 });
  }

  // 10. catalogo incompleto
  const incomplete = s.products.filter((p) => !p.description || !p.category || p.unit_price_cents === 0);
  if (incomplete.length >= 3) out.push({ dedupe_key: "catalog_gaps", rule: "catalog_gaps", category: "analysis", priority: "low", title: `${incomplete.length} voci di catalogo da completare`,
    description: `${s.products.filter((p) => !p.description).length} senza descrizione, ${s.products.filter((p) => !p.category).length} senza categoria, ${s.products.filter((p) => p.unit_price_cents === 0).length} con prezzo a 0.`, reason: "Voci attive del catalogo con descrizione, categoria o prezzo mancanti.",
    evidence: incomplete.slice(0, 4).map((p) => ({ label: p.name, href: "/catalogo" })), action_label: "Apri il catalogo", action_href: "/catalogo", copilot_question: "Controlla il catalogo e proponi descrizioni e categorie per le voci incomplete.", ttl_hours: 24 * 7 });

  return out;
}

export type Summary = {
  lines: { text: string; tone: "good" | "bad" | "neutral"; href?: string }[];
  numbers: { unpaidInvoices: number; unpaidCents: number; sentQuotes: number; sentCents: number; waitingQuotes: number; lateFollowUps: number; toRecontact: number; billedThisMonthCents: number; billedLastMonthCents: number; billedChangePct: number | null; appointments24h: number; unansweredEmails: number };
};

/** Sintesi aziendale: ogni riga è un numero misurato sui dati (nessun testo generato). Una riga compare solo se ha un dato su cui poggiare. */
export function buildSummary(s: Snapshot): Summary {
  const sent = s.quotes.filter((x) => x.status === "sent");
  const waiting = sent.filter((x) => days(x.issue_date, s.today) >= RULE_PARAMS.quoteWaitingDays);
  const lateFu = s.followUps.filter((f) => f.due_on < s.today).length + s.quotes.filter((x) => (x.status === "sent" || x.status === "draft") && x.follow_up_date && x.follow_up_date < s.today).length;
  const value = customerValue(s);
  const toRecontact = s.stale.filter((c) => (value.get(c.customer_id) ?? 0) > 0 && days(c.last_activity.slice(0, 10), s.today) >= RULE_PARAMS.staleDays).length;
  const m = (k: string) => s.billings.filter((b) => monthOf(b.billed_at) === k).reduce((n, b) => n + b.amount_cents, 0);
  const cur = monthOf(s.today), prev = prevMonth(cur);
  const dayOfMonth = Number(s.today.slice(8, 10));
  const billedCur = m(cur), billedPrev = m(prev);
  const changePct = billedPrev > 0 ? Math.round(((billedCur - billedPrev) / billedPrev) * 100) : null;
  const unanswered = s.unansweredEmails.filter((e) => days(e.last_inbound_at.slice(0, 10), s.today) >= RULE_PARAMS.emailUnansweredDays).length;
  const unpaidAll = s.billings.filter((b) => b.payment_status === "unpaid");
  const lines: Summary["lines"] = [];
  if (sent.length) lines.push({ text: `${sent.length} preventivi inviati in attesa di esito (${formatEur(sent.reduce((n, x) => n + x.total_cents, 0))})${waiting.length ? `, di cui ${waiting.length} da oltre ${RULE_PARAMS.quoteWaitingDays} giorni` : ""}.`, tone: waiting.length ? "bad" : "neutral", href: "/preventivi?status=sent" });
  if (lateFu) lines.push({ text: `${lateFu} follow-up scaduti.`, tone: "bad", href: "/promemoria?vista=ritardo" });
  if (s.overdueTasks) lines.push({ text: `${s.overdueTasks} attività in ritardo.`, tone: "bad", href: "/attivita" });
  if (toRecontact) lines.push({ text: `${toRecontact} clienti di valore da ricontattare (nessuna attività da oltre ${RULE_PARAMS.staleDays} giorni).`, tone: "neutral", href: "/clienti" });
  if (unanswered) lines.push({ text: `${unanswered} conversazioni email (caselle condivise) senza risposta da oltre ${RULE_PARAMS.emailUnansweredDays} giorni.`, tone: "bad", href: "/email" });
  if (unpaidAll.length) lines.push({ text: `${unpaidAll.length} fatture registrate non incassate (${formatEur(unpaidAll.reduce((n, b) => n + b.amount_cents, 0))}).`, tone: "bad", href: "/preventivi?status=accepted" });
  if (s.appointments24h.length) lines.push({ text: `${s.appointments24h.length} appuntamenti nelle prossime 24 ore.`, tone: "neutral", href: "/appuntamenti?vista=elenco" });
  if (billedPrev > 0 && dayOfMonth >= 1) lines.push({ text: `Fatturato registrato del mese in corso: ${formatEur(billedCur)} (mese precedente completo: ${formatEur(billedPrev)}${changePct !== null && dayOfMonth >= 20 ? `, ${changePct > 0 ? "+" : ""}${changePct}% a oggi` : ""}).`, tone: changePct !== null && dayOfMonth >= 20 ? (changePct < 0 ? "bad" : "good") : "neutral", href: "/dashboard" });
  else if (billedCur > 0) lines.push({ text: `Fatturato registrato del mese in corso: ${formatEur(billedCur)}.`, tone: "neutral", href: "/dashboard" });
  return { lines, numbers: { unpaidInvoices: unpaidAll.length, unpaidCents: unpaidAll.reduce((n, b) => n + b.amount_cents, 0), sentQuotes: sent.length, sentCents: sent.reduce((n, x) => n + x.total_cents, 0), waitingQuotes: waiting.length, lateFollowUps: lateFu, toRecontact, billedThisMonthCents: billedCur, billedLastMonthCents: billedPrev, billedChangePct: changePct, appointments24h: s.appointments24h.length, unansweredEmails: unanswered } };
}
