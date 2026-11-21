import { describe, expect, it } from "vitest";
import { DEFAULT_TERMS, resolveTerms, termsToStore } from "@/modules/settore/terms";
import { SECTORS, SECTOR_KEYS } from "@/modules/settore/presets";
import { displayValue, parseCustomValues, slugKey, type CustomFieldDef } from "@/modules/settore/custom-fields";

const def = (o: Partial<CustomFieldDef>): CustomFieldDef => ({ entity: "customer", key: "k", label: "K", field_type: "text", options: [], required: false, active: true, ...o });

describe("terminologia", () => {
  it("usa i predefiniti per valori mancanti, vuoti o pericolosi", () => {
    expect(resolveTerms(undefined)).toEqual(DEFAULT_TERMS);
    expect(resolveTerms({ customer_plural: "  Committenti ", quote_singular: "", quote_plural: "<b>x</b>", customer_singular: 5 })).toEqual({ ...DEFAULT_TERMS, customer_plural: "Committenti" });
  });
  it("salva solo le differenze dai predefiniti", () => {
    expect(termsToStore({ customer_plural: "Clienti", quote_plural: "Offerte", quote_singular: "" })).toEqual({ quote_plural: "Offerte" });
  });
});

describe("preset di settore", () => {
  it("sono coerenti: chiavi valide, univoche per entità, select con opzioni, prezzi segnaposto a zero", () => {
    for (const k of SECTOR_KEYS) {
      const seen = new Set<string>();
      for (const f of SECTORS[k].fields) {
        expect(f.key).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
        expect(seen.has(`${f.entity}.${f.key}`)).toBe(false);
        seen.add(`${f.entity}.${f.key}`);
        if (f.field_type === "select") expect(f.options?.length).toBeGreaterThan(0);
      }
      for (const t of SECTORS[k].templates) for (const i of t.items) expect(i.unit_price_cents).toBe(0);
    }
  });
});

describe("campi personalizzati", () => {
  it("genera chiavi tecniche univoche", () => {
    expect(slugKey("Tipo di infisso", [])).toBe("tipo_di_infisso");
    expect(slugKey("Città", ["citta"])).toBe("citta_2");
    expect(slugKey("123", [])).toBe("campo");
    expect(slugKey("!!!", ["campo", "campo_2"])).toBe("campo_3");
  });
  const defs = [
    def({ key: "t", label: "Testo", required: true }),
    def({ key: "n", label: "Numero", field_type: "number" }),
    def({ key: "d", label: "Data", field_type: "date" }),
    def({ key: "s", label: "Scelta", field_type: "select", options: ["A", "B"] }),
    def({ key: "b", label: "Sì/No", field_type: "boolean" }),
  ];
  const ok = { cf_t: "x", cf_n: "1,5", cf_d: "2026-05-01", cf_s: "B", cf_b: "on" };
  it("accetta valori validi e converte i tipi", () => {
    expect(parseCustomValues(defs, ok)).toEqual({ ok: true, values: { t: "x", n: 1.5, d: "2026-05-01", s: "B", b: true } });
  });
  it("rifiuta obbligatori mancanti, numeri, date e scelte non valide", () => {
    for (const bad of [{ ...ok, cf_t: " " }, { ...ok, cf_n: "abc" }, { ...ok, cf_d: "1/5/2026" }, { ...ok, cf_d: "2026-99-99" }, { ...ok, cf_s: "C" }, { ...ok, cf_t: "x".repeat(501) }]) {
      expect(parseCustomValues(defs, bad).ok).toBe(false);
    }
  });
  it("campi opzionali vuoti vengono omessi, il booleano non spuntato è false", () => {
    const r = parseCustomValues(defs, { cf_t: "x" });
    expect(r).toEqual({ ok: true, values: { t: "x", b: false } });
  });
  it("conserva i valori di campi disattivati o sconosciuti e ignora chiavi non definite nell'input", () => {
    const r = parseCustomValues([def({ key: "t" }), def({ key: "old", active: false })], { cf_t: "n", cf_old: "hack", cf_zzz: "x" }, { old: "vecchio", t: "prima", gone: 3, bad: { a: 1 } });
    expect(r).toEqual({ ok: true, values: { old: "vecchio", gone: 3, t: "n" } });
  });
  it("mostra i valori in italiano", () => {
    expect(displayValue(defs[4]!, true)).toBe("Sì");
    expect(displayValue(defs[1]!, 1234.5)).toBe("1.234,5");
    expect(displayValue(defs[0]!, undefined)).toBe("—");
  });
});
