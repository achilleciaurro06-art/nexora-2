import "server-only";
import { z } from "zod";
import { defineTool } from "./types";
import { loadSnapshot } from "@/modules/insights/snapshot";
import { buildSummary, generateInsights } from "@/modules/insights/rules";
import { eur } from "./util";

export const getBusinessSummary = defineTool({
  name: "get_business_activity_summary",
  description: "Quadro d'insieme dell'attività con numeri reali: preventivi in attesa, follow-up e attività in ritardo, clienti da ricontattare, email senza risposta, fatturato registrato del mese vs mese scorso, appuntamenti imminenti, criticità e opportunità rilevate dalle regole.",
  args: "{}",
  permission: "data:read",
  schema: z.object({}),
  async run({ db, orgId, now }) {
    const snap = await loadSnapshot(db, orgId, now);
    const sum = buildSummary(snap);
    const found = generateInsights(snap);
    const n = sum.numbers;
    return { data: { sintesi: sum.lines.map((l) => l.text), numeri: { preventivi_inviati_in_attesa: n.sentQuotes, importo_in_attesa_eur: eur(n.sentCents), preventivi_senza_risposta_oltre_7_giorni: n.waitingQuotes, follow_up_scaduti: n.lateFollowUps,
      attivita_in_ritardo: snap.overdueTasks, clienti_di_valore_da_ricontattare: n.toRecontact, email_senza_risposta_caselle_condivise: n.unansweredEmails, appuntamenti_prossime_24h: n.appointments24h,
      fatture_non_incassate: n.unpaidInvoices, fatture_non_incassate_eur: eur(n.unpaidCents), fatturato_registrato_mese_corrente_eur: eur(n.billedThisMonthCents), fatturato_registrato_mese_precedente_eur: eur(n.billedLastMonthCents), variazione_pct_mese_su_mese_parziale: n.billedChangePct },
      rilevazioni: found.slice(0, 12).map((i) => ({ categoria: i.category, priorita: i.priority, titolo: i.title, descrizione: i.description, motivo: i.reason })),
      avvertenze: ["Le fatture sono registrate manualmente in NEXORA (non fiscali), con stato incassata/non incassata indicato dall'utente.", "Le email considerate sono solo quelle delle caselle condivise.", "Il mese corrente è parziale."] },
      sources: [{ label: "Dashboard", href: "/dashboard" }] };
  },
});

export const getInsightsTool = defineTool({
  name: "get_insights",
  description: "Segnalazioni proattive attualmente attive (opportunità, criticità, analisi) con motivazione e dati di riferimento.",
  args: "{}",
  permission: "data:read",
  schema: z.object({}),
  async run({ db, orgId }) {
    const { data } = await db.from("ai_insights").select("category, priority, title, description, reason, status, generated_at, action_href").eq("organization_id", orgId).gt("expires_at", new Date().toISOString()).in("status", ["new", "seen"]).limit(30);
    return { data: { segnalazioni: (data ?? []).map((i) => ({ categoria: i.category, priorita: i.priority, titolo: i.title, descrizione: i.description, motivo: i.reason, stato: i.status, generata_il: String(i.generated_at).slice(0, 10), link: i.action_href })),
      nota: (data ?? []).length === 0 ? "Nessuna segnalazione attiva (la generazione avviene all'apertura della dashboard)." : undefined }, sources: [{ label: "Segnalazioni", href: "/dashboard" }] };
  },
});
