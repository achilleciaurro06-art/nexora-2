import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent }; } }));
const envMock = { GEMINI_API_KEY: "k".repeat(20) as string | undefined, GEMINI_MODEL: "model-main", GEMINI_FALLBACK_MODEL: "model-fallback", AI_PROVIDER: undefined as string | undefined };
vi.mock("@/server/env", () => ({ env: () => envMock }));
import { GeminiProvider } from "@/server/ai/providers/gemini";
import { getAiProvider } from "@/server/ai";
import { AiProviderError, userMessageForAiError } from "@/server/ai/provider";

const req = { system: "s", messages: [{ role: "user" as const, content: "ciao" }], maxOutputTokens: 100 };
const httpErr = (status: number) => Object.assign(new Error(`{"error":{"code":${status}}}`), { status });
beforeEach(() => { generateContent.mockReset(); envMock.GEMINI_API_KEY = "k".repeat(20); envMock.AI_PROVIDER = undefined; vi.useRealTimers(); });

describe("Gemini adapter (SDK mocked: verifies OUR retry/fallback logic, not the real service)", () => {
  it("without a key it fails fast with an 'auth' error and makes NO call", async () => {
    envMock.GEMINI_API_KEY = undefined;
    await expect(new GeminiProvider().generate(req)).rejects.toMatchObject({ kind: "auth" });
    expect(generateContent).not.toHaveBeenCalled();
    expect(userMessageForAiError(new AiProviderError("x", "auth"))).toContain("non è configurato correttamente");
  });
  it("returns text, model and the provider's real token usage", async () => {
    generateContent.mockResolvedValue({ text: "risposta", usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 } });
    expect(await new GeminiProvider().generate(req)).toEqual({ text: "risposta", model: "model-main", inputTokens: 11, outputTokens: 7 });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it("auth errors (401/403) stop immediately: no retries, no fallback model, no duplicate calls", async () => {
    generateContent.mockRejectedValue(httpErr(403));
    await expect(new GeminiProvider().generate(req)).rejects.toMatchObject({ kind: "auth", status: 403 });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it("a missing model (404) goes straight to the fallback model once", async () => {
    generateContent.mockRejectedValueOnce(httpErr(404)).mockResolvedValueOnce({ text: "ok", usageMetadata: {} });
    const r = await new GeminiProvider().generate(req);
    expect(r.model).toBe("model-fallback");
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual(["model-main", "model-fallback"]);
  });
  it("overload (503) is retried a bounded number of times per model, then the whole request fails with a clear kind (never a fake success)", async () => {
    vi.useFakeTimers();
    generateContent.mockRejectedValue(httpErr(503));
    const p = new GeminiProvider().generate(req);
    const assertion = expect(p).rejects.toMatchObject({ kind: "overloaded" });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    // 2 modelli × (1 tentativo + 2 ripetizioni) = 6 chiamate al massimo: il fallback è limitato
    expect(generateContent.mock.calls.length).toBeLessThanOrEqual(6);
    expect(generateContent.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it("a non-retryable client error (400) is not retried", async () => {
    generateContent.mockRejectedValue(httpErr(400));
    await expect(new GeminiProvider().generate(req)).rejects.toMatchObject({ kind: "other" });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it("provider selection: Gemini by default; the simulated provider only when explicitly requested and never on production Vercel", () => {
    expect(getAiProvider().name).toBe("gemini");
    envMock.AI_PROVIDER = "mock";
    expect(getAiProvider().name).toBe("mock");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(getAiProvider().name).toBe("gemini");
    vi.unstubAllEnvs();
  });
});
