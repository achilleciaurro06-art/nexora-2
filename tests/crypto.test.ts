import { describe, expect, it } from "vitest";
import { generateActivationCode, generateToken, hashSecret } from "@/modules/auth/crypto";

describe("crypto helpers", () => {
  it("hashes deterministically and never returns the secret", () => {
    expect(hashSecret(" ABCD ")).toBe(hashSecret("ABCD"));
    expect(hashSecret("ABCD")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("generates well-formed, unique codes", () => {
    const codes = new Set(Array.from({ length: 200 }, generateActivationCode));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(generateToken().length).toBeGreaterThanOrEqual(40);
  });
});
