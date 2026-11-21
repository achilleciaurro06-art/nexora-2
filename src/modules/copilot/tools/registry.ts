import "server-only";
import { z } from "zod";
import { can } from "@/server/auth/permissions";
import type { AnyTool, Source, ToolCtx } from "./types";
import { getClientDetails, getClientHistory, getRecontactCandidates, searchClients, topClients } from "./clients";
import { analyzeQuote, getQuoteDetails, searchQuotes } from "./quotes";
import { getInvoiceSummary, getSalesStatistics } from "./billing";
import { getAppointmentBriefing, getMyDay, getPendingFollowups, getUpcomingAppointments } from "./agenda";
import { getEmailThread, searchEmails } from "./emails";
import { getCatalogProducts } from "./catalog";
import { getBusinessSummary, getInsightsTool } from "./summary";
import { clampJson } from "../packs";

export const TOOLS: AnyTool[] = [
  searchClients, getClientDetails, getClientHistory, getRecontactCandidates, topClients,
  searchQuotes, getQuoteDetails, analyzeQuote, getInvoiceSummary, getSalesStatistics,
  getMyDay, getPendingFollowups, getUpcomingAppointments, getAppointmentBriefing,
  searchEmails, getEmailThread, getCatalogProducts, getBusinessSummary, getInsightsTool,
];
const byName = new Map(TOOLS.map((t) => [t.name, t]));

export function toolCatalog(): string {
  return TOOLS.map((t) => `- ${t.name} ${t.args}: ${t.description}`).join("\n");
}

export const TOOL_RESULT_MAX_CHARS = 6000;
export type ToolRun = { tool: string; ok: boolean; json: string; sources: Source[]; error?: string };

/**
 * Esegue UNO strumento richiesto dal modello. Il modello può solo scegliere tra gli strumenti registrati:
 * nome sconosciuto, permesso mancante o parametri non validi → errore restituito al modello, nessuna esecuzione.
 * Il permesso è controllato lato server sul ruolo reale dell'utente (mai su ciò che dichiara il modello).
 */
export async function runTool(ctx: ToolCtx, name: unknown, rawArgs: unknown, registry: ReadonlyMap<string, AnyTool> = byName): Promise<ToolRun> {
  const t = typeof name === "string" ? registry.get(name) : undefined;
  if (!t) return { tool: String(name).slice(0, 60), ok: false, json: JSON.stringify({ errore: "Strumento sconosciuto" }), sources: [], error: "unknown_tool" };
  if (!can(ctx.role, t.permission)) return { tool: t.name, ok: false, json: JSON.stringify({ errore: "Permesso non sufficiente per questo strumento" }), sources: [], error: "forbidden" };
  const parsed = (t.schema as z.ZodType).safeParse(rawArgs ?? {});
  if (!parsed.success) return { tool: t.name, ok: false, json: JSON.stringify({ errore: "Parametri non validi", dettaglio: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`) }), sources: [], error: "invalid_args" };
  try {
    const out = await Promise.race([
      t.run(ctx, parsed.data),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 12_000)),
    ]);
    return { tool: t.name, ok: true, json: clampJson(out.data, TOOL_RESULT_MAX_CHARS), sources: out.sources ?? [] };
  } catch (e) {
    console.error(`tool ${t.name} failed`, e instanceof Error ? e.message.slice(0, 160) : "unknown");
    return { tool: t.name, ok: false, json: JSON.stringify({ errore: "Dati momentaneamente non disponibili" }), sources: [], error: "failed" };
  }
}
