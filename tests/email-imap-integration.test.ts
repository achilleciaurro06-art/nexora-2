/**
 * Prova REALE dei protocolli SMTP e IMAP contro la posta di verifica locale (Dovecot + server SMTP di prova): vedi
 * scripts/verify-stack/mail-up.sh. Se la posta di prova non è avviata questi test vengono saltati (non falliscono).
 * Non prova Gmail né Microsoft 365, né un server di posta di produzione.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import net from "node:net";
import { beforeAll, describe, expect, it } from "vitest";

const up = (port: number) => new Promise<boolean>((res) => { const s = net.connect(port, "127.0.0.1"); s.on("connect", () => { s.destroy(); res(true); }); s.on("error", () => res(false)); setTimeout(() => { s.destroy(); res(false); }, 1500); });
const reachable = (await up(1143)) && (await up(2525));

const ENV = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "x".repeat(20), SUPABASE_SERVICE_ROLE_KEY: "y".repeat(20), EMAIL_ALLOW_PRIVATE_HOSTS: "true" };
const settings = { imap: { host: "127.0.0.1", port: 1143, security: "none" as const, username: "ufficio@test.local" }, smtp: { host: "127.0.0.1", port: 2525, security: "none" as const, username: "ufficio@test.local" } };
const acct = (cursor: Record<string, unknown> = {}) => ({ id: "t1", address: "ufficio@test.local", displayName: "Ufficio", settings, cursor });
const good = { kind: "password" as const, imapPassword: "secret123", smtpPassword: "secret123" };
const inject = (subject: string, extra: string[] = []) => execFileSync("node", ["scripts/verify-stack/mail-inject.mjs", "--from", "cliente@esterno.it", "--to", "ufficio@test.local", "--subject", subject, "--text", `corpo ${subject}`, ...extra], { encoding: "utf8" }).trim();
const outbox = () => readdirSync("/tmp/nx-mail/outbox").sort();

describe.skipIf(!reachable)("SMTP e IMAP reali (posta di prova locale)", () => {
  let provider: typeof import("@/modules/email/providers/smtp-imap")["smtpImapProvider"];
  beforeAll(async () => { Object.assign(process.env, ENV); provider = (await import("@/modules/email/providers/smtp-imap")).smtpImapProvider; });

  it("verifica la connessione (IMAP e SMTP) e rifiuta password sbagliate con un errore di autenticazione", async () => {
    await expect(provider.verify(good, acct())).resolves.toBeUndefined();
    await expect(provider.verify({ ...good, imapPassword: "sbagliata" }, acct())).rejects.toMatchObject({ kind: "auth" });
    await expect(provider.verify({ ...good, smtpPassword: "sbagliata" }, acct())).rejects.toMatchObject({ kind: "auth" });
  });

  it("invia davvero: il server SMTP riceve il messaggio con oggetto, intestazioni di risposta e allegato", async () => {
    const before = outbox().length;
    const id = `<send-${Date.now()}@test.local>`;
    const r = await provider.send(good, acct(), {
      from: { address: "ufficio@test.local", name: "Ufficio" }, to: [{ address: "cliente@esterno.it" }], cc: [{ address: "collega@esterno.it" }], bcc: [{ address: "nascosto@esterno.it" }],
      subject: "Preventivo reale 2026/0001", html: "<p>Buongiorno</p>", text: "Buongiorno", attachments: [{ filename: "preventivo.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.4 vero") }],
      inReplyTo: "<orig@esterno.it>", references: ["<orig@esterno.it>"], messageId: id,
    });
    expect(r.internetMessageId).toBe(id);
    const files = outbox().slice(before);
    expect(files.length).toBe(1);
    const eml = readFileSync(`/tmp/nx-mail/outbox/${files[0]}`, "utf8");
    expect(eml).toContain("Subject: Preventivo reale 2026/0001"); expect(eml).toContain(`Message-ID: ${id}`); expect(eml).toContain("In-Reply-To: <orig@esterno.it>"); expect(eml).toContain("filename=preventivo.pdf");
    expect(eml).not.toContain("Bcc:"); // il Ccn non compare nelle intestazioni
  });

  it("destinatario rifiutato dal server (550): errore definitivo e NON incerto", async () => {
    await expect(provider.send(good, acct(), {
      from: { address: "ufficio@test.local" }, to: [{ address: "nessuno@reject.test" }], cc: [], bcc: [], subject: "x", html: "<p>x</p>", text: "x", attachments: [], messageId: `<rej-${Date.now()}@test.local>`,
    })).rejects.toMatchObject({ kind: "permanent", uncertain: false });
  });

  it("sincronizzazione incrementale: solo i messaggi nuovi, nessuna rilettura, cursore per UID", async () => {
    const first = await provider.sync(good, acct(), { limit: 5 });
    expect(first.cursor.inbox).toMatchObject({ lastUid: expect.any(Number) });
    const tag = Date.now();
    inject(`Uno ${tag}`); inject(`Due ${tag}`, ["--message-id", `<due-${tag}@esterno.it>`]);
    const second = await provider.sync(good, acct(first.cursor), { limit: 50 });
    const inbox = second.messages.filter((m) => m.folder === "inbox");
    expect(inbox.length).toBe(2);
    expect(inbox.every((m) => m.providerMessageId.startsWith("imap:inbox:") && m.isRead === false)).toBe(true);
    expect(inbox[1]!.raw.toString()).toContain(`<due-${tag}@esterno.it>`);
    const third = await provider.sync(good, acct(second.cursor), { limit: 50 });
    expect(third.messages.filter((m) => m.folder === "inbox")).toHaveLength(0);
    inject(`Tre ${tag}`);
    const fourth = await provider.sync(good, acct(third.cursor), { limit: 50 });
    expect(fourth.messages.filter((m) => m.folder === "inbox").map((m) => m.raw.toString().includes(`Tre ${tag}`))).toEqual([true]);
  });

  it("la copia dell'inviato in «Inviata» viene letta come posta inviata (con lo stesso Message-ID: l'app non la importerà due volte)", async () => {
    const start = await provider.sync(good, acct(), { limit: 200 });
    const id = `<sent-copy-${Date.now()}@test.local>`;
    await provider.send(good, acct(), { from: { address: "ufficio@test.local" }, to: [{ address: "cliente@esterno.it" }], cc: [], bcc: [], subject: "Copia inviata", html: "<p>x</p>", text: "x", attachments: [], messageId: id });
    const after = await provider.sync(good, acct(start.cursor), { limit: 50 });
    const sent = after.messages.filter((m) => m.folder === "sent");
    expect(sent.length).toBe(1);
    expect(sent[0]!.raw.toString()).toContain(`Message-ID: ${id}`);
  });

  it("il server di posta interno è irraggiungibile se non si è in ambiente di prova (protezione SSRF)", async () => {
    process.env.EMAIL_ALLOW_PRIVATE_HOSTS = "false";
    const { resolveMailHost } = await import("@/modules/email/host-guard");
    await expect(resolveMailHost("127.0.0.1", 1143, false)).rejects.toThrow();
    process.env.EMAIL_ALLOW_PRIVATE_HOSTS = "true";
  });
});
