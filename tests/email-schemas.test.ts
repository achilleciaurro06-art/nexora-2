import { describe, expect, it } from "vitest";
import { accountEditSchema, composeSchema, connectImapSchema, linkSchema, signatureSchema, templateSchema } from "@/modules/email/schemas";

const uuid = () => crypto.randomUUID();
const compose = { accountId: uuid(), idempotencyKey: uuid(), to: "a@b.it", subject: "Oggetto", bodyHtml: "<p>x</p>" };

describe("composizione", () => {
  it("accetta un messaggio valido e converte gli indirizzi", () => {
    const r = composeSchema.parse({ ...compose, to: "Mario <mario@x.it>, luisa@y.it", cc: "capo@z.it" });
    expect(r.to.map((a) => a.address)).toEqual(["mario@x.it", "luisa@y.it"]); expect(r.cc).toHaveLength(1); expect(r.bcc).toEqual([]); expect(r.uploaded).toEqual([]); expect(r.documentIds).toEqual([]);
  });
  it("blocca indirizzi non validi in A, Cc e Ccn, con il campo giusto nel messaggio", () => {
    for (const [f, label] of [["to", "A"], ["cc", "Cc"], ["bcc", "Ccn"]] as const) {
      const r = composeSchema.safeParse({ ...compose, [f]: "buono@x.it, rotto" });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]!.message).toContain(`${label}: indirizzo non valido`);
    }
  });
  it("richiede casella e chiave di idempotenza (protezione dagli invii doppi)", () => {
    expect(composeSchema.safeParse({ ...compose, accountId: "x" }).success).toBe(false);
    expect(composeSchema.safeParse({ ...compose, idempotencyKey: "" }).success).toBe(false);
    expect(composeSchema.safeParse({ ...compose, idempotencyKey: undefined }).success).toBe(false);
  });
  it("limiti di lunghezza, allegati e flag", () => {
    expect(composeSchema.safeParse({ ...compose, subject: "x".repeat(999) }).success).toBe(false);
    expect(composeSchema.safeParse({ ...compose, bodyHtml: "x".repeat(300_001) }).success).toBe(false);
    expect(composeSchema.safeParse({ ...compose, uploaded: "non json" }).success).toBe(false);
    expect(composeSchema.safeParse({ ...compose, uploaded: JSON.stringify([{ storage_path: "p", name: "n", mime: "m", size: -1 }]) }).success).toBe(false);
    expect(composeSchema.parse({ ...compose, documentIds: JSON.stringify([uuid(), "non-uuid"]) }).documentIds).toEqual([]); // elenco non valido: scartato per intero
    expect(composeSchema.parse({ ...compose, attachQuotePdf: "on", markQuoteSent: "on" })).toMatchObject({ attachQuotePdf: "on", markQuoteSent: "on" });
    expect(composeSchema.safeParse({ ...compose, customerId: "x" }).success).toBe(false);
  });
});

describe("collegamento IMAP/SMTP", () => {
  const ok = { address: "Ufficio@Azienda.it", imapHost: "imap.azienda.it", imapPort: "993", imapSecurity: "ssl", imapUser: "ufficio", imapPassword: "pw", smtpHost: "smtp.azienda.it", smtpPort: "587", smtpSecurity: "starttls", smtpUser: "ufficio", smtpPassword: "pw" };
  it("normalizza e accetta", () => { const r = connectImapSchema.parse(ok); expect(r.address).toBe("ufficio@azienda.it"); expect(r.imapPort).toBe(993); expect(r.smtpSecurity).toBe("starttls"); });
  it.each([["indirizzo", { address: "x" }], ["server con caratteri strani", { imapHost: "a b;rm -rf" }], ["porta 0", { smtpPort: "0" }], ["porta 70000", { imapPort: "70000" }], ["sicurezza sconosciuta", { smtpSecurity: "boh" }], ["password mancante", { imapPassword: "" }], ["utente mancante", { smtpUser: "" }], ["server vuoto", { smtpHost: "" }]])("rifiuta: %s", (_n, patch) => {
    expect(connectImapSchema.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
});

describe("altri moduli", () => {
  it("impostazioni casella, firma, modello e collegamento", () => {
    expect(accountEditSchema.safeParse({ visibility: "shared" }).success).toBe(true);
    expect(accountEditSchema.safeParse({ visibility: "pubblica" }).success).toBe(false);
    expect(accountEditSchema.safeParse({ visibility: "shared", signature: "x".repeat(2001) }).success).toBe(false);
    expect(signatureSchema.safeParse({ signature: "Mario\nVendite" }).success).toBe(true); expect(signatureSchema.safeParse({ signature: "x".repeat(2001) }).success).toBe(false);
    expect(templateSchema.safeParse({ name: "ok" }).success).toBe(true); expect(templateSchema.safeParse({ name: " " }).success).toBe(false); expect(templateSchema.safeParse({ name: "n", bodyHtml: "x".repeat(20_001) }).success).toBe(false);
    expect(linkSchema.parse({})).toEqual({ customerId: null, contactId: null, quoteId: null });
    expect(linkSchema.safeParse({ customerId: "x" }).success).toBe(false); expect(linkSchema.safeParse({ customerId: uuid(), contactId: uuid() }).success).toBe(true);
  });
});
