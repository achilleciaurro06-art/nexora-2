import { describe, expect, it } from "vitest";
import { mapGeminiUsage } from "@/server/ai/providers/gemini-usage";

describe("conteggio dei token di Gemini", () => {
  it("con il totale: il ragionamento è già dentro e non viene sommato due volte", () => {
    // prompt 100 + risposta 50 + ragionamento 400 = totale 550
    const u = mapGeminiUsage({ promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 400, totalTokenCount: 550 });
    expect(u).toEqual({ inputTokens: 100, outputTokens: 450, source: "total", inconsistent: false });
    expect(u.inputTokens + u.outputTokens).toBe(550);
  });
  it("i token degli strumenti sono ingresso, separati dal prompt, e non si contano due volte", () => {
    const u = mapGeminiUsage({ promptTokenCount: 100, toolUsePromptTokenCount: 30, candidatesTokenCount: 50, thoughtsTokenCount: 20, totalTokenCount: 200 });
    expect(u.inputTokens).toBe(130);
    expect(u.outputTokens).toBe(70);
    expect(u.inputTokens + u.outputTokens).toBe(200);
  });
  it("il contenuto in cache è già nel prompt: non va sommato", () => {
    const u = mapGeminiUsage({ promptTokenCount: 1000, cachedContentTokenCount: 800, candidatesTokenCount: 40, totalTokenCount: 1040 });
    expect(u.inputTokens).toBe(1000);
    expect(u.outputTokens).toBe(40);
  });
  it("totale maggiore delle parti: il totale è il riferimento (nessun consumo perso)", () => {
    const u = mapGeminiUsage({ promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 700 });
    expect(u.outputTokens).toBe(600);
    expect(u.source).toBe("total");
  });
  it("totale mancante: fallback esplicito sulla somma dei campi, con il ragionamento incluso", () => {
    const u = mapGeminiUsage({ promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 400 });
    expect(u).toEqual({ inputTokens: 100, outputTokens: 450, source: "parts", inconsistent: false });
  });
  it("totale inferiore alla somma delle parti (incoerente): si usano le parti, il ragionamento non si perde, il caso è segnalato", () => {
    const u = mapGeminiUsage({ promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 400, totalTokenCount: 150 });
    expect(u.outputTokens).toBe(450);
    expect(u.source).toBe("parts");
    expect(u.inconsistent).toBe(true);
  });
  it("nessun dato: source «none» (il chiamante usa una stima dichiarata come tale)", () => {
    expect(mapGeminiUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, source: "none", inconsistent: false });
    expect(mapGeminiUsage({})).toMatchObject({ source: "none" });
  });
  it("valori non numerici o negativi sono ignorati", () => {
    const u = mapGeminiUsage({ promptTokenCount: -5, candidatesTokenCount: Number.NaN, thoughtsTokenCount: 10 });
    expect(u).toMatchObject({ inputTokens: 0, outputTokens: 10 });
  });
});
