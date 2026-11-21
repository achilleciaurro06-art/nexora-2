import { beforeEach, describe, expect, it, vi } from "vitest";

const gen = vi.fn();
vi.mock("@/server/ai/index", () => ({
  getAiProvider: () => ({ name: "mockprov", generate: gen }),
  userMessageForAiError: (e: unknown) => (e instanceof Error && e.message === "overloaded" ? "Il modello AI è temporaneamente sovraccarico. Riprova tra qualche istante." : "Il servizio AI non è disponibile al momento. Riprova tra poco."),
}));
vi.mock("@/server/ai/usage", () => ({
  QUOTA_MESSAGE: "Crediti AI esauriti per questo mese: contatta l'amministratore per aumentare il limite.",
  estimateTokens: (...t: string[]) => Math.ceil(t.reduce((n, x) => n + x.length, 0) / 3),
  reserveCredits: vi.fn(), settleCredits: vi.fn(), releaseCredits: vi.fn(),
}));
import * as usage from "@/server/ai/usage";
import { runAi } from "@/server/ai/run";

const base = { orgId: "o", userId: "u", feature: "copilot", req: { system: "s".repeat(300), messages: [{ role: "user" as const, content: "d".repeat(300) }], maxOutputTokens: 500 } };
const reserve = usage.reserveCredits as unknown as ReturnType<typeof vi.fn>, settle = usage.settleCredits as unknown as ReturnType<typeof vi.fn>, release = usage.releaseCredits as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { gen.mockReset(); reserve.mockReset(); settle.mockReset(); release.mockReset(); });

describe("credits — reserve, settle, release (provider mocked: this tests OUR accounting, not a real model)", () => {
  it("reserves BEFORE calling the provider and settles with the provider's real consumption", async () => {
    reserve.mockResolvedValue({ ok: true, id: "r1", duplicate: false });
    gen.mockResolvedValue({ text: "ok", model: "gemini-x", inputTokens: 123, outputTokens: 45 });
    const r = await runAi(base);
    expect(r).toMatchObject({ ok: true, estimated: false });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reserve.mock.calls[0]![0].tokens).toBeGreaterThanOrEqual(200 + 500); // stima input + output massimo
    expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(gen.mock.invocationCallOrder[0]!);
    expect(settle).toHaveBeenCalledWith("r1", { inputTokens: 123, outputTokens: 45, provider: "mockprov", model: "gemini-x", estimated: false });
    expect(release).not.toHaveBeenCalled();
  });
  it("when the provider reports no usage, the consumption is ESTIMATED and flagged as such", async () => {
    reserve.mockResolvedValue({ ok: true, id: "r1", duplicate: false });
    gen.mockResolvedValue({ text: "y".repeat(90), model: "m", inputTokens: 0, outputTokens: 0 });
    const r = await runAi(base);
    expect(r).toMatchObject({ ok: true, estimated: true });
    expect(settle.mock.calls[0]![1]).toMatchObject({ estimated: true, inputTokens: 200, outputTokens: 30 });
  });
  it("exhausted credits: the provider is NEVER called (no cost) and the user gets a clear message", async () => {
    reserve.mockResolvedValue({ ok: false, reason: "limit" });
    const r = await runAi(base);
    expect(r).toMatchObject({ ok: false, kind: "quota" });
    if (!r.ok) expect(r.error).toContain("Crediti AI esauriti");
    expect(gen).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });
  it("a provider failure RELEASES the reservation (no charge for consumption that never happened)", async () => {
    reserve.mockResolvedValue({ ok: true, id: "r9", duplicate: false });
    gen.mockRejectedValue(Object.assign(new Error("overloaded"), { kind: "overloaded" }));
    const r = await runAi(base);
    expect(r).toMatchObject({ ok: false, kind: "provider", error: "Il modello AI è temporaneamente sovraccarico. Riprova tra qualche istante." });
    expect(release).toHaveBeenCalledWith("r9", "overloaded");
    expect(settle).not.toHaveBeenCalled();
    expect(gen).toHaveBeenCalledTimes(1); // nessuna chiamata duplicata incontrollata a questo livello
  });
  it("a repeated request key (double submit) is refused without calling the provider again", async () => {
    reserve.mockResolvedValue({ ok: true, id: "r1", duplicate: true });
    const r = await runAi({ ...base, requestKey: "copilot:abc:0" });
    expect(r).toMatchObject({ ok: false, kind: "duplicate" });
    expect(gen).not.toHaveBeenCalled();
    expect(reserve.mock.calls[0]![0].requestKey).toBe("copilot:abc:0");
  });
  it("if credits cannot be verified at all, nothing is spent", async () => {
    reserve.mockResolvedValue({ ok: false, reason: "error" });
    expect(await runAi(base)).toMatchObject({ ok: false, kind: "quota", error: "Impossibile verificare i crediti AI. Riprova." });
    expect(gen).not.toHaveBeenCalled();
  });
  it("attachments reserve extra tokens", async () => {
    reserve.mockResolvedValue({ ok: false, reason: "limit" });
    await runAi({ ...base, req: { ...base.req, attachment: { mimeType: "application/pdf", data: new Uint8Array(3) } } });
    const withAtt = reserve.mock.calls[0]![0].tokens;
    reserve.mockClear();
    await runAi(base);
    expect(withAtt).toBeGreaterThan(reserve.mock.calls[0]![0].tokens);
  });
});
