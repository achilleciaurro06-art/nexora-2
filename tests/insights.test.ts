import { describe, expect, it } from "vitest";
import { buildSummary, generateInsights, RULE_PARAMS } from "@/modules/insights/rules";
import { toSyncPayload } from "@/modules/insights/service";
import type { Snapshot, SnapQuote } from "@/modules/insights/types";
import { parsePageContext, suggestedQuestions } from "@/modules/copilot/page-context";

const NOW = new Date("2026-11-21T10:00:00Z");
const base = (over: Partial<Snapshot> = {}): Snapshot => ({ today: "2026-11-21", now: NOW, quotes: [], billings: [], stale: [], followUps: [], appointments24h: [], unansweredEmails: [], products: [], overdueTasks: 0, ...over });
const q = (o: Partial<SnapQuote> & { id: string }): SnapQuote => ({ number: `2026/${o.id}`, customer_id: "c1", customer_name: "Rossi Srl", status: "sent", total_cents: 100000, issue_date: "2026-11-01", follow_up_date: null, ...o });
const CID = "11111111-1111-4111-8111-111111111111";

describe("insight rules — no data, no insights (nothing invented)", () => {
  it("empty snapshot produces nothing and an empty summary", () => {
    expect(generateInsights(base())).toEqual([]);
    expect(buildSummary(base()).lines).toEqual([]);
  });
  it("revenue drop needs enough history: with a single prior invoice nothing is claimed", () => {
    const s = base({ billings: [{ id: "b1", customer_id: CID, customer_name: "X", quote_id: null, amount_cents: 500000, billed_at: "2026-09-10", payment_status: "paid", reference: null }] });
    expect(generateInsights(s).some((i) => i.rule === "revenue_drop")).toBe(false);
  });
  it("sales trend needs at least 5 quotes in the starting window", () => {
    const s = base({ quotes: [q({ id: "1", status: "accepted", issue_date: "2026-07-01" }), q({ id: "2", status: "accepted", issue_date: "2026-11-10" })] });
    expect(generateInsights(s).some((i) => i.rule === "sales_trend")).toBe(false);
  });
});

describe("insight rules — facts with evidence", () => {
  it("flags valuable customers without activity, with the data behind it", () => {
    const s = base({ quotes: [q({ id: "1", customer_id: CID, status: "accepted", total_cents: 800000, issue_date: "2026-03-01" })], stale: [{ customer_id: CID, name: "Rossi Srl", last_activity: "2026-08-01T00:00:00Z", open_quotes: 0 }] });
    const i = generateInsights(s).find((x) => x.rule === "stale_customer")!;
    expect(i.dedupe_key).toBe(`stale_customer:${CID}`);
    expect(i.category).toBe("opportunity");
    expect(i.priority).toBe("high"); // 112 giorni ≥ soglia alta
    expect(i.description).toContain("112 giorni");
    expect(i.description).toContain("8.000,00");
    expect(i.evidence[0]).toEqual({ label: "Rossi Srl", href: `/clienti/${CID}` });
    expect(i.reason).toContain(String(RULE_PARAMS.staleDays));
  });
  it("does NOT flag a customer without any commercial value (no history to justify it)", () => {
    const s = base({ stale: [{ customer_id: CID, name: "Nuovo", last_activity: "2026-01-01T00:00:00Z", open_quotes: 0 }] });
    expect(generateInsights(s).some((x) => x.rule === "stale_customer")).toBe(false);
  });
  it("flags sent quotes waiting ≥ 7 days without follow-up, high priority only for top-quartile amounts (with enough data)", () => {
    const quotes = [
      ...Array.from({ length: 9 }, (_, k) => q({ id: `a${k}`, status: "accepted", total_cents: 10000 + k * 1000, issue_date: "2026-06-01" })),
      q({ id: "w1", total_cents: 900000, issue_date: "2026-11-05" }), q({ id: "w2", total_cents: 5000, issue_date: "2026-11-05" }),
      q({ id: "w3", total_cents: 900000, issue_date: "2026-11-05", follow_up_date: "2026-11-30" }), q({ id: "w4", total_cents: 900000, issue_date: "2026-11-18" }),
    ];
    const out = generateInsights(base({ quotes })).filter((x) => x.rule === "quote_waiting");
    const keys = out.map((x) => x.dedupe_key).sort();
    expect(keys).toEqual(["quote_waiting:w1", "quote_waiting:w2"]); // w3 ha follow-up futuro, w4 è recente
    expect(out.find((x) => x.dedupe_key === "quote_waiting:w1")!.priority).toBe("high");
    expect(out.find((x) => x.dedupe_key === "quote_waiting:w2")!.priority).toBe("normal");
  });
  it("without enough decided history no amount is called 'high'", () => {
    const out = generateInsights(base({ quotes: [q({ id: "w1", total_cents: 99999999, issue_date: "2026-11-05" })] })).filter((x) => x.rule === "quote_waiting");
    expect(out[0]!.priority).toBe("normal");
  });
  it("aggregates late follow-ups (customers + quotes) in ONE stable insight", () => {
    const s = base({ followUps: [{ id: "f1", title: "Chiamare", customer_id: CID, customer_name: "Rossi", due_on: "2026-11-10" }, { id: "f2", title: "Mail", customer_id: CID, customer_name: "Rossi", due_on: "2026-11-25" }],
      quotes: [q({ id: "x", follow_up_date: "2026-11-15" })] });
    const i = generateInsights(s).filter((x) => x.rule === "followups_late");
    expect(i).toHaveLength(1);
    expect(i[0]!.dedupe_key).toBe("followups_late");
    expect(i[0]!.title).toBe("2 follow-up scaduti"); // f1 + follow-up del preventivo; f2 è futuro
    expect(i[0]!.priority).toBe("high"); // 11 giorni
  });
  it("flags unanswered emails, unpaid invoices and imminent appointments", () => {
    const s = base({
      unansweredEmails: [{ thread_id: "t1", subject: "Info", customer_id: CID, customer_name: "Rossi", last_inbound_at: "2026-11-16T09:00:00Z" }, { thread_id: "t2", subject: "Fresco", customer_id: null, customer_name: null, last_inbound_at: "2026-11-21T08:00:00Z" }],
      billings: [{ id: "b1", customer_id: CID, customer_name: "Rossi", quote_id: null, amount_cents: 120000, billed_at: "2026-09-01", payment_status: "unpaid", reference: "F1" }, { id: "b2", customer_id: CID, customer_name: "Rossi", quote_id: null, amount_cents: 50000, billed_at: "2026-09-02", payment_status: "paid", reference: null }],
      appointments24h: [{ id: "a1", title: "Visita", starts_at: "2026-11-22T09:00:00Z", customer_name: "Rossi" }],
    });
    const rules = generateInsights(s).map((x) => x.rule);
    expect(rules).toContain("email_unanswered");
    expect(generateInsights(s).filter((x) => x.rule === "email_unanswered")).toHaveLength(1); // t2 è troppo recente
    const unpaid = generateInsights(s).find((x) => x.rule === "invoices_unpaid")!;
    expect(unpaid.title).toContain("1 fatture");
    expect(unpaid.description).toContain("1.200,00");
    expect(unpaid.reason).toContain("non gestisce scadenze");
    expect(rules).toContain("appointments_soon");
  });
  it("revenue drop between complete months is reported as a measured fact with its threshold", () => {
    const mk = (id: string, amount: number, date: string) => ({ id, customer_id: CID, customer_name: "R", quote_id: null, amount_cents: amount, billed_at: date, payment_status: "paid", reference: null });
    const s = base({ billings: [mk("1", 400000, "2026-09-05"), mk("2", 400000, "2026-09-20"), mk("3", 200000, "2026-10-10")] });
    const i = generateInsights(s).find((x) => x.rule === "revenue_drop")!;
    expect(i.dedupe_key).toBe("revenue_drop:2026-10");
    expect(i.description).toContain("-75%");
    expect(i.reason).toContain("non una previsione");
  });
  it("every insight carries title, description, reason, evidence-or-link and a TTL (no empty fields)", () => {
    const s = base({
      quotes: [q({ id: "1", customer_id: CID, status: "accepted", total_cents: 800000, issue_date: "2026-03-01" }), q({ id: "w", issue_date: "2026-11-01" })],
      stale: [{ customer_id: CID, name: "Rossi Srl", last_activity: "2026-08-01T00:00:00Z", open_quotes: 1 }],
      followUps: [{ id: "f1", title: "x", customer_id: CID, customer_name: "R", due_on: "2026-11-01" }],
      products: [{ id: "p1", name: "A", description: null, category: null, unit_price_cents: 0 }, { id: "p2", name: "B", description: null, category: null, unit_price_cents: 0 }, { id: "p3", name: "C", description: null, category: "x", unit_price_cents: 5 }],
    });
    const all = generateInsights(s);
    expect(all.length).toBeGreaterThanOrEqual(4);
    const keys = new Set(all.map((i) => i.dedupe_key));
    expect(keys.size).toBe(all.length); // nessuna chiave duplicata nella stessa generazione
    for (const i of all) {
      expect(i.title.length).toBeGreaterThan(3); expect(i.description.length).toBeGreaterThan(3); expect(i.reason.length).toBeGreaterThan(10);
      expect(i.evidence.length > 0 || i.action_href).toBeTruthy(); expect(i.ttl_hours).toBeGreaterThan(0);
      if (i.action_href) expect(i.action_href).toMatch(/^\/[A-Za-z0-9/_?=&.%-]*$/); // il vincolo del database accetta solo percorsi interni
    }
  });
  it("generation is deterministic: the same data yields the same insights (dedupe-friendly)", () => {
    const s = base({ quotes: [q({ id: "w", issue_date: "2026-11-01" })] });
    expect(generateInsights(s)).toEqual(generateInsights(s));
  });
  it("sync payload sets expiry from TTL and trims fields", () => {
    const p = toSyncPayload(generateInsights(base({ quotes: [q({ id: "w", issue_date: "2026-11-01" })] })), NOW);
    expect(p[0]!.expires_at).toBe(new Date(NOW.getTime() + 72 * 3_600_000).toISOString());
  });
});

describe("business summary — every line is a measured number", () => {
  it("counts only what exists and links to the module", () => {
    const s = base({ quotes: [q({ id: "1", total_cents: 250000, issue_date: "2026-11-01" }), q({ id: "2", total_cents: 50000, issue_date: "2026-11-19" })], overdueTasks: 3,
      billings: [{ id: "b", customer_id: CID, customer_name: "R", quote_id: null, amount_cents: 70000, billed_at: "2026-11-02", payment_status: "unpaid", reference: null }] });
    const r = buildSummary(s);
    expect(r.numbers.sentQuotes).toBe(2);
    expect(r.numbers.waitingQuotes).toBe(1);
    expect(r.numbers.unpaidInvoices).toBe(1);
    expect(r.lines.map((l) => l.text).join("|")).toContain("2 preventivi inviati in attesa di esito (3.000,00");
    expect(r.lines.some((l) => l.text === "3 attività in ritardo.")).toBe(true);
    expect(r.lines.find((l) => l.text.includes("non incassate"))!.href).toBeDefined();
  });
  it("month-over-month change is only worded once the month is advanced enough", () => {
    const b = (id: string, amount: number, date: string) => ({ id, customer_id: CID, customer_name: "R", quote_id: null, amount_cents: amount, billed_at: date, payment_status: "paid", reference: null });
    const early = buildSummary(base({ today: "2026-11-05", billings: [b("1", 100000, "2026-10-10"), b("2", 20000, "2026-11-02")] }));
    expect(early.lines.find((l) => l.text.includes("Fatturato"))!.text).not.toContain("%");
    const late = buildSummary(base({ today: "2026-11-25", billings: [b("1", 100000, "2026-10-10"), b("2", 20000, "2026-11-02")] }));
    expect(late.lines.find((l) => l.text.includes("Fatturato"))!.text).toContain("-80%");
  });
});

describe("page context (the client sends only the path; the server interprets it)", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  it("recognises entity pages and list pages", () => {
    expect(parsePageContext(`/clienti/${id}`)).toEqual({ page: "cliente", entityType: "customer", entityId: id });
    expect(parsePageContext(`/preventivi/${id}`)).toEqual({ page: "preventivo", entityType: "quote", entityId: id });
    expect(parsePageContext(`/email/${id}?x=1`)).toEqual({ page: "thread", entityType: "thread", entityId: id });
    expect(parsePageContext(`/appuntamenti/${id}`)).toEqual({ page: "appuntamento", entityType: "appointment", entityId: id });
    expect(parsePageContext("/dashboard")).toEqual({ page: "dashboard" });
    expect(parsePageContext("/clienti")).toEqual({ page: "clienti" });
  });
  it("ignores malformed ids, subpages and non-paths", () => {
    expect(parsePageContext("/clienti/not-a-uuid")).toEqual({ page: "clienti" });
    expect(parsePageContext(`/preventivi/${id}/pdf`)).toEqual({ page: "preventivi" });
    expect(parsePageContext(`/email/nuova`)).toEqual({ page: "email" });
    expect(parsePageContext("/amministrazione/x")).toEqual({ page: "generic" });
    expect(parsePageContext(123)).toEqual({ page: "generic" });
    expect(parsePageContext("x".repeat(400))).toEqual({ page: "generic" });
  });
  it("suggests questions that fit the page", () => {
    expect(suggestedQuestions({ page: "preventivo" }).join(" ")).toContain("preventivo");
    expect(suggestedQuestions({ page: "thread" }).join(" ")).toContain("risposta");
    expect(suggestedQuestions({ page: "generic" }).length).toBeGreaterThan(2);
  });
});
