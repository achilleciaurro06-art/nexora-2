import { describe, expect, it } from "vitest";
import { clampJson } from "@/modules/copilot/packs";

describe("tool result budget (cost control)", () => {
  it("clamps long arrays progressively and strings hard", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ n: i, text: "x".repeat(50) }));
    expect(clampJson(rows, 1000).length).toBeLessThanOrEqual(1001);
    expect(clampJson("a".repeat(100), 10).length).toBeLessThanOrEqual(11);
    expect(clampJson({ a: 1 }, 100)).toBe('{"a":1}');
  });
  it("shrinks the biggest inner array of an object first and keeps the JSON parseable", () => {
    const obj = { totale: 500, righe: Array.from({ length: 300 }, (_, i) => ({ i, t: "y".repeat(40) })), piccolo: [1, 2] };
    const out = clampJson(obj, 2000);
    expect(out.length).toBeLessThanOrEqual(2001);
    const parsed = JSON.parse(out);
    expect(parsed.totale).toBe(500);
    expect(parsed._troncato).toBe(true);
    expect(parsed.righe.length).toBeLessThan(300);
  });
});
