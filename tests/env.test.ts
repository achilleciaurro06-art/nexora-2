import { afterEach, describe, expect, it, vi } from "vitest";

const base = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "x".repeat(20), SUPABASE_SERVICE_ROLE_KEY: "y".repeat(20) };

async function load(extra: Record<string, string>) {
  vi.resetModules();
  for (const k of ["GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_FALLBACK_MODEL"]) delete process.env[k];
  Object.assign(process.env, base, extra);
  return (await import("@/server/env")).env();
}
afterEach(() => { for (const k of Object.keys({ ...base, GEMINI_API_KEY: 1, GEMINI_MODEL: 1, GEMINI_FALLBACK_MODEL: 1 })) delete process.env[k]; });

describe("env()", () => {
  it("treats empty optional variables as unset instead of failing", async () => {
    const e = await load({ GEMINI_API_KEY: "", GEMINI_MODEL: "", GEMINI_FALLBACK_MODEL: "" });
    expect(e.GEMINI_API_KEY).toBeUndefined();
    expect(e.GEMINI_MODEL).toBe("gemini-3.5-flash-lite");
    expect(e.GEMINI_FALLBACK_MODEL).toBe("gemini-3.8-flash");
  });
  it("accepts a real key and custom models", async () => {
    const e = await load({ GEMINI_API_KEY: "k".repeat(20), GEMINI_MODEL: "custom-model" });
    expect(e.GEMINI_API_KEY).toHaveLength(20);
    expect(e.GEMINI_MODEL).toBe("custom-model");
  });
  it("still rejects a missing required variable", async () => {
    vi.resetModules();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: base.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: base.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
    const { env } = await import("@/server/env");
    expect(() => env()).toThrow();
  });
});
