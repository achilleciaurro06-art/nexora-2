import { describe, expect, it } from "vitest";
import { assemble, clampJson, customersMentioned, quoteNumbersIn, selectPacks } from "@/modules/copilot/packs";

describe("pack selection (only what the question needs)", () => {
  it.each([
    ["Quali clienti non contattiamo da più tempo?", ["stale_customers"]],
    ["Quali preventivi non hanno ancora ricevuto risposta?", ["pending_quotes"]],
    ["Quali preventivi hanno più probabilità di essere conclusi?", ["win_odds"]],
    ["Quali clienti hanno generato più fatturato potenziale?", ["top_customers"]],
    ["Quali attività dovrei svolgere oggi?", ["tasks"]],
    ["Quali preventivi hanno prezzi anomali?", ["price_anomalies"]],
    ["Quali opportunità commerciali sto trascurando?", ["stale_customers", "pending_quotes"]],
    ["Che documenti PDF ho caricato?", ["documents"]],
  ])("%s", (q, expected) => {
    const packs = selectPacks(q as string);
    for (const e of expected as string[]) expect(packs).toContain(e);
  });
  it("loads nothing extra for small talk", () => {
    expect(selectPacks("ciao, come stai?")).toEqual([]);
  });
  it("orders packs by priority and never duplicates", () => {
    const p = selectPacks("preventivi inviati in attesa, attività di oggi, prezzi e fatturato");
    expect(new Set(p).size).toBe(p.length);
    expect(p.indexOf("tasks")).toBeLessThan(p.indexOf("price_anomalies"));
  });
});

describe("question parsing", () => {
  it("finds quote numbers", () => {
    expect(quoteNumbersIn("Mi dici di 2026/0007 e 2026/0012? Non 1999/0001")).toEqual(["2026/0007", "2026/0012"]);
    expect(quoteNumbersIn("nessuno")).toEqual([]);
  });
  const customers = [
    { id: "1", name: "Rossi & Figli S.n.c." }, { id: "2", name: "Bianchi S.r.l." }, { id: "3", name: "Rossi Costruzioni" }, { id: "4", name: "Studio" },
  ];
  it("matches customers by name tokens, ignoring legal suffixes", () => {
    expect(customersMentioned("che storico abbiamo con Bianchi?", customers).map((c) => c.id)).toEqual(["2"]);
    expect(customersMentioned("preventivi di Rossi e Figli", customers).map((c) => c.id)).toContain("1");
    expect(customersMentioned("e Rossi Costruzioni?", customers)[0]?.id).toBe("3");
  });
  it("does not match on generic words or when absent", () => {
    expect(customersMentioned("fammi uno studio dei preventivi", customers)).toEqual([]);
    expect(customersMentioned("ciao", customers)).toEqual([]);
  });
});

describe("context budget", () => {
  it("clamps long arrays progressively and strings hard", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ n: i, text: "x".repeat(50) }));
    const out = clampJson(rows, 1000);
    expect(out.length).toBeLessThanOrEqual(1001);
    expect(clampJson("a".repeat(100), 10).length).toBeLessThanOrEqual(11);
    expect(clampJson({ a: 1 }, 100)).toBe('{"a":1}');
  });
  it("drops lowest-priority blocks when over budget and reports them", () => {
    const r = assemble([{ name: "a", json: "x".repeat(60) }, { name: "b", json: "y".repeat(60) }, { name: "c", json: "z" }], 100);
    expect(r.included).toEqual(["a", "c"]);
    expect(r.dropped).toEqual(["b"]);
    expect(r.text.length).toBeLessThanOrEqual(100);
  });
});
