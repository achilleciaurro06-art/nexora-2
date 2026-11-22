import { beforeEach, describe, expect, it, vi } from "vitest";

// Il servizio chiama la RPC privilegiata: qui è simulata e ne registriamo le chiamate (nessun database reale).
const setStatus = vi.fn(async (..._a: unknown[]) => true);
vi.mock("@/server/ai/privileged", () => ({
  claimInsightsRun: vi.fn(), syncInsights: vi.fn(), setInsightStatus: (...a: unknown[]) => setStatus(...a),
}));

import { listInsights, markSeen } from "@/modules/insights/service";
import type { InsightRow, InsightStatus } from "@/modules/insights/types";

const ORG = "00000000-0000-4000-8000-0000000000a1", USER = "00000000-0000-4000-8000-0000000000b1";
const FUTURE = "2999-01-01T00:00:00Z", PAST = "2000-01-01T00:00:00Z";
const row = (id: string, status: InsightStatus, expires_at = FUTURE): InsightRow => ({
  id, dedupe_key: `k-${id}`, rule: "r", category: "attention", priority: "normal", title: `t${id}`, description: "", reason: "", evidence: [],
  action_label: null, action_href: null, copilot_question: null, status, generated_at: "2026-11-20T10:00:00Z", refreshed_at: "2026-11-20T10:00:00Z", expires_at,
});

/** Costruttore di query minimo che rispetta eq / gt / in / limit, per verificare i filtri applicati da listInsights. */
function db(rows: InsightRow[]) {
  const calls: Record<string, unknown[][]> = {};
  return {
    calls,
    client: {
      from: () => {
        const filters: ((r: InsightRow) => boolean)[] = [];
        let max = Infinity;
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (k: string, v: unknown) => { calls.eq = [...(calls.eq ?? []), [k, v]]; filters.push((r) => (r as unknown as Record<string, unknown>)[k] === v || k === "organization_id"); return chain; },
          gt: (k: string, v: string) => { calls.gt = [...(calls.gt ?? []), [k, v]]; filters.push((r) => (r as unknown as Record<string, string>)[k]! > v); return chain; },
          in: (k: string, v: unknown[]) => { calls.in = [...(calls.in ?? []), [k, v]]; filters.push((r) => v.includes((r as unknown as Record<string, unknown>)[k])); return chain; },
          limit: (n: number) => { max = n; return chain; },
          then: (res: (v: unknown) => unknown) => res({ data: rows.filter((r) => filters.every((f) => f(r))).slice(0, max), error: null }),
        };
        return chain;
      },
    } as never,
  };
}

beforeEach(() => setStatus.mockClear());

describe("markSeen — da «nuovo» a «visualizzato»", () => {
  it("un insight nuovo passa a «seen» (una sola chiamata, con organizzazione, id e utente)", async () => {
    await markSeen(ORG, USER, [row("1", "new")]);
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith(ORG, "1", "seen", USER);
  });

  it("un insight già «seen» non viene toccato (idempotente: riaprire la dashboard non riscrive nulla)", async () => {
    await markSeen(ORG, USER, [row("1", "seen")]);
    await markSeen(ORG, USER, [row("1", "seen")]);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("le decisioni dell'utente (done, dismissed) non vengono mai riportate a «seen»", async () => {
    await markSeen(ORG, USER, [row("1", "done"), row("2", "dismissed")]);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("in un elenco misto aggiorna solo i «new»; elenco vuoto = nessuna chiamata", async () => {
    await markSeen(ORG, USER, [row("1", "new"), row("2", "seen"), row("3", "done"), row("4", "new"), row("5", "dismissed")]);
    expect(setStatus.mock.calls.map((c) => c[1])).toEqual(["1", "4"]);
    setStatus.mockClear();
    await markSeen(ORG, USER, []);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("segna al massimo 12 insight per apertura", async () => {
    await markSeen(ORG, USER, Array.from({ length: 20 }, (_, i) => row(String(i), "new")));
    expect(setStatus).toHaveBeenCalledTimes(12);
  });

  it("l'esito della RPC non cambia il risultato (nessuna eccezione se l'aggiornamento è rifiutato)", async () => {
    setStatus.mockResolvedValueOnce(false);
    await expect(markSeen(ORG, USER, [row("1", "new")])).resolves.toBeUndefined();
  });
});

describe("insight scaduti", () => {
  it("listInsights esclude gli scaduti e gli insight chiusi: alla dashboard (e a markSeen) arrivano solo quelli attivi", async () => {
    const d = db([row("scaduto", "new", PAST), row("attivo", "new"), row("visto", "seen"), row("fatto", "done"), row("ignorato", "dismissed")]);
    const list = await listInsights(d.client, ORG);
    expect(list.map((r) => r.id).sort()).toEqual(["attivo", "visto"]);
    expect(d.calls.gt?.[0]?.[0]).toBe("expires_at");
    expect(d.calls.in?.[0]).toEqual(["status", ["new", "seen"]]);
  });

  it("pipeline completa: un insight scaduto «new» non viene mai segnato, quello attivo sì", async () => {
    const d = db([row("scaduto", "new", PAST), row("attivo", "new")]);
    await markSeen(ORG, USER, await listInsights(d.client, ORG));
    expect(setStatus.mock.calls.map((c) => c[1])).toEqual(["attivo"]);
  });

  it("includeResolved mostra anche gli insight chiusi, ma mai gli scaduti", async () => {
    const d = db([row("scaduto", "new", PAST), row("fatto", "done"), row("attivo", "new")]);
    const list = await listInsights(d.client, ORG, { includeResolved: true });
    expect(list.map((r) => r.id).sort()).toEqual(["attivo", "fatto"]);
  });

  it("markSeen non controlla da sé la scadenza: la responsabilità del filtro è di listInsights (comportamento attuale, documentato)", async () => {
    await markSeen(ORG, USER, [row("scaduto", "new", PAST)]);
    expect(setStatus).toHaveBeenCalledWith(ORG, "scaduto", "seen", USER);
  });
});
