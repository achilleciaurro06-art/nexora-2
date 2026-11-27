import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakePdf, fakePng } from "./ai-fixtures";

const reserve = vi.fn(); const settle = vi.fn(); const release = vi.fn(); const quota = vi.fn();
const provider = { name: "gemini", generate: vi.fn() };
vi.mock("@/server/ai/usage", async () => {
  const actual = await vi.importActual<typeof import("@/server/ai/usage")>("@/server/ai/usage");
  return { ...actual, reserveCredits: (...a: unknown[]) => reserve(...a), settleCredits: (...a: unknown[]) => settle(...a), releaseCredits: (...a: unknown[]) => release(...a), quotaStatus: (...a: unknown[]) => quota(...a) };
});
vi.mock("@/server/ai/index", () => ({ getAiProvider: () => provider, userMessageForAiError: () => "errore" }));
import { runAi } from "@/server/ai/run";

const base = { orgId: "o", userId: "u", feature: "document_analysis" };
const req = (attachment?: { mimeType: string; data: Uint8Array }, extra: object = {}) => ({ system: "S".repeat(300), messages: [{ role: "user" as const, content: "estrai" }], maxOutputTokens: 2500, attachment, ...extra });

beforeEach(() => {
  for (const f of [reserve, settle, release, quota, provider.generate]) f.mockReset();
  reserve.mockResolvedValue({ ok: true, id: "r1", duplicate: false });
  settle.mockResolvedValue(true); release.mockResolvedValue(true); quota.mockResolvedValue({ used: 50_000, limit: 200_000 });
  provider.generate.mockResolvedValue({ text: "{}", model: "m", inputTokens: 10_000, outputTokens: 500 });
});

describe("runAi: stima prima della chiamata", () => {
  it("un PDF da 20 pagine prenota almeno 30.000 token per l'allegato (non più 4.000)", async () => {
    await runAi({ ...base, req: req({ mimeType: "application/pdf", data: fakePdf(20) }) });
    const tokens = reserve.mock.calls[0]![0].tokens as number;
    expect(tokens).toBeGreaterThanOrEqual(30_000 + 2500);
    expect(tokens).toBeLessThan(30_000 + 2500 + 500);
  });
  it("oltre 25 pagine: rifiutato PRIMA di prenotare e di chiamare il provider (nessun addebito)", async () => {
    const r = await runAi({ ...base, req: req({ mimeType: "application/pdf", data: fakePdf(26) }) });
    expect(r).toMatchObject({ ok: false, kind: "attachment" });
    expect(reserve).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });
  it("una foto 4000×3000 prenota il peso a riquadri (6.192), non i 2.000 minimi", async () => {
    await runAi({ ...base, req: req({ mimeType: "image/png", data: fakePng(4000, 3000) }) });
    expect(reserve.mock.calls[0]![0].tokens).toBeGreaterThanOrEqual(6192 + 2500);
  });
  it("lo schema JSON della risposta fa parte della stima", async () => {
    await runAi({ ...base, req: req(undefined) });
    const senza = reserve.mock.calls[0]![0].tokens as number;
    reserve.mockClear();
    await runAi({ ...base, req: req(undefined, { jsonSchema: { type: "object", properties: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`campo_${i}`, { type: "string", description: "x".repeat(40) }])) } }) });
    expect(reserve.mock.calls[0]![0].tokens as number).toBeGreaterThan(senza + 500);
  });
});

describe("runAi: quota e contabilizzazione", () => {
  it("quota insufficiente: nessuna chiamata al provider e nessun consumo registrato", async () => {
    reserve.mockResolvedValue({ ok: false, reason: "limit" });
    const r = await runAi({ ...base, req: req({ mimeType: "application/pdf", data: fakePdf(20) }) });
    expect(r).toMatchObject({ ok: false, kind: "quota" });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });
  it("errore del provider: crediti rimborsati, nessun conteggio", async () => {
    provider.generate.mockRejectedValue(Object.assign(new Error("boom"), { kind: "overloaded" }));
    const r = await runAi({ ...base, req: req({ mimeType: "application/pdf", data: fakePdf(3) }) });
    expect(r).toMatchObject({ ok: false, kind: "provider" });
    expect(release).toHaveBeenCalledWith("r1", "overloaded");
    expect(settle).not.toHaveBeenCalled();
  });
  it("consumo reale entro la prenotazione: nessuna segnalazione", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await runAi({ ...base, req: req({ mimeType: "application/pdf", data: fakePdf(10) }) });
    expect(r).toMatchObject({ ok: true });
    expect((r as { overshoot?: unknown }).overshoot).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  it("consumo reale SUPERIORE alla prenotazione: il conteggio resta quello reale (non si nasconde) e lo scarto è segnalato", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    quota.mockResolvedValue({ used: 210_000, limit: 200_000 });
    provider.generate.mockResolvedValue({ text: "{}", model: "m", inputTokens: 60_000, outputTokens: 4_000, usageSource: "total" });
    const r = await runAi({ ...base, req: req({ mimeType: "application/pdf", data: fakePdf(5) }) });
    expect(settle).toHaveBeenCalledWith("r1", expect.objectContaining({ inputTokens: 60_000, outputTokens: 4_000, estimated: false }));
    const o = (r as { overshoot?: { reserved: number; actual: number } }).overshoot;
    expect(o?.actual).toBe(64_000);
    expect(o!.reserved).toBeLessThan(64_000);
    const logged = String(warn.mock.calls[0]?.[1] ?? "");
    expect(warn.mock.calls[0]?.[0]).toBe("ai_overshoot");
    expect(logged).toContain('"overLimit":true');
    expect(logged).not.toMatch(/estrai|SSSS/); // nessun contenuto nei log
    warn.mockRestore();
  });
  it("provider senza conteggio: si usa la stima (allegato incluso), dichiarata come stimata", async () => {
    provider.generate.mockResolvedValue({ text: "ok", model: "m", inputTokens: 0, outputTokens: 0 });
    const r = await runAi({ ...base, req: req({ mimeType: "application/pdf", data: fakePdf(10) }) });
    expect(r).toMatchObject({ ok: true, estimated: true });
    expect(settle.mock.calls[0]![1].inputTokens).toBeGreaterThanOrEqual(15_000);
    expect(settle.mock.calls[0]![1].estimated).toBe(true);
  });
});
