import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applySuggestion } from "@/modules/copilot/apply";
import { resolveByName } from "@/modules/copilot/packs";

/** Un client che fallisce se usato: prova che la validazione avviene PRIMA di qualsiasi accesso ai dati. */
const noDb = new Proxy({}, { get() { throw new Error("DB must not be touched"); } }) as unknown as SupabaseClient;
const base = { db: noDb, orgId: "o", userId: "u" };

describe("applySuggestion input validation (before touching data)", () => {
  it("rejects tasks without a usable title or with a malformed date", async () => {
    expect(await applySuggestion({ ...base, kind: "task", payload: {}, overrides: {} })).toEqual({ ok: false, error: "Titolo non valido" });
    expect(await applySuggestion({ ...base, kind: "task", payload: { title: "x".repeat(201) }, overrides: {} })).toMatchObject({ ok: false });
    expect(await applySuggestion({ ...base, kind: "task", payload: { title: "ok", due_date: "domani" }, overrides: {} })).toEqual({ ok: false, error: "Data non valida" });
  });
  it("rejects follow-ups in the past or with bad dates", async () => {
    expect(await applySuggestion({ ...base, kind: "quote_followup", payload: { quote_number: "2026/0001", follow_up_date: "2001-01-01" }, overrides: {} }))
      .toEqual({ ok: false, error: "La data di follow-up non può essere nel passato" });
    expect(await applySuggestion({ ...base, kind: "quote_followup", payload: { quote_number: "2026/0001" }, overrides: {} })).toEqual({ ok: false, error: "Data non valida" });
  });
  it("rejects empty or oversized notes", async () => {
    expect(await applySuggestion({ ...base, kind: "customer_note", payload: { customer_name: "X" }, overrides: {} })).toMatchObject({ ok: false });
    expect(await applySuggestion({ ...base, kind: "customer_note", payload: { customer_name: "X", body: "y".repeat(4001) }, overrides: {} })).toMatchObject({ ok: false });
  });
  it("user overrides take precedence over the model's proposal", async () => {
    const r = await applySuggestion({ ...base, kind: "quote_followup", payload: { quote_number: "2026/0001", follow_up_date: "2999-01-01" }, overrides: { follow_up_date: "2001-01-01" } });
    expect(r).toEqual({ ok: false, error: "La data di follow-up non può essere nel passato" });
  });
  it("never applies unsupported kinds and accepts insights without touching data", async () => {
    expect(await applySuggestion({ ...base, kind: "price_review", payload: {}, overrides: {} })).toMatchObject({ ok: false });
    expect(await applySuggestion({ ...base, kind: "insight", payload: {}, overrides: {} })).toEqual({ ok: true });
  });
});

describe("resolveByName (names from the model are never trusted blindly)", () => {
  const c = [{ id: "1", name: "Rossi Costruzioni S.r.l." }, { id: "2", name: "Rossi Impianti" }, { id: "3", name: "Bianchi" }];
  it("resolves exact and unique partial names; refuses ambiguity or weak input", () => {
    expect(resolveByName(c, "rossi costruzioni srl")?.id).toBe("1");
    expect(resolveByName(c, "Bianchi SRL")?.id).toBe("3");
    expect(resolveByName(c, "Rossi")).toBeNull();
    expect(resolveByName(c, "Verdi")).toBeNull();
    expect(resolveByName(c, "ab")).toBeNull();
    expect(resolveByName(c, undefined)).toBeNull();
  });
});
