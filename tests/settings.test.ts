import { describe, expect, it } from "vitest";
import { formatIban, isValidIban, mergeOrgSettings, normalizeIban, parseOrgSettings, parseUserPrefs, sniffImage } from "@/modules/impostazioni/settings";

describe("IBAN", () => {
  it("accepts a valid Italian IBAN with spaces and lowercase, rejects wrong checksum/length/format", () => {
    expect(isValidIban("it60 x054 2811 1010 0000 0123 456")).toBe(true);
    expect(normalizeIban("it60 x054-2811.1010")).toBe("IT60X05428111010");
    expect(isValidIban("IT60X0542811101000000123457")).toBe(false); // cifra di controllo errata
    expect(isValidIban("IT60X05428111010000001234")).toBe(false);   // lunghezza IT errata
    expect(isValidIban("1234")).toBe(false);
    expect(isValidIban("DE89370400440532013000")).toBe(true);       // IBAN tedesco di esempio valido
  });
  it("formats in groups of four", () => {
    expect(formatIban("IT60X0542811101000000123456")).toBe("IT60 X054 2811 1010 0000 0123 456");
  });
});

describe("org settings parsing", () => {
  it("returns defaults for empty or garbage input", () => {
    for (const raw of [null, undefined, {}, "x", 42, []]) {
      const s = parseOrgSettings(raw);
      expect(s.quotes.default_vat_rate).toBe(22);
      expect(s.quotes.default_validity_days).toBe(30);
      expect(s.ai.tone).toBe("concise");
    }
  });
  it("keeps valid sections even when another one is corrupt", () => {
    const s = parseOrgSettings({ quotes: { default_vat_rate: 10, default_validity_days: 15 }, ai: { context: 123, tone: "bogus" }, email: { signature: "Cordiali saluti" } });
    expect(s.quotes).toMatchObject({ default_vat_rate: 10, default_validity_days: 15, pdf_template: "classic" });
    expect(s.ai).toEqual({ context: "", tone: "concise" });
    expect(s.email.signature).toBe("Cordiali saluti");
  });
  it("merges one section without losing the others", () => {
    const m = mergeOrgSettings({ legacy: 1, ai: { context: "a" } }, "quotes", { default_vat_rate: 4 });
    expect(m).toEqual({ legacy: 1, ai: { context: "a" }, quotes: { default_vat_rate: 4 } });
    expect(mergeOrgSettings(null, "ai", { tone: "detailed" })).toEqual({ ai: { tone: "detailed" } });
  });
});

describe("user preferences parsing", () => {
  it("defaults to everything on, 24h window, 12 months", () => {
    const p = parseUserPrefs({});
    expect(p.notifications).toMatchObject({ task_due_soon: true, task_assigned: true, due_soon_hours: 24 });
    expect(p.appearance.dashboard_range).toBe("365");
  });
  it("ignores out-of-range or wrong-typed values", () => {
    const p = parseUserPrefs({ notifications: { due_soon_hours: 9999, reminder: "no" }, appearance: { dashboard_range: "7" } });
    expect(p.notifications.due_soon_hours).toBe(24);
    expect(p.notifications.reminder).toBe(true);
    expect(p.appearance.dashboard_range).toBe("365");
    expect(parseUserPrefs({ notifications: { reminder: false, due_soon_hours: 6 } }).notifications).toMatchObject({ reminder: false, due_soon_hours: 6 });
  });
});

describe("image signature sniffing", () => {
  it("recognises png, jpeg and webp; rejects others", () => {
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("png");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("jpg");
    expect(sniffImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("webp");
    expect(sniffImage(Uint8Array.from([0x3c, 0x73, 0x76, 0x67, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull(); // svg: non ammesso
  });
});
