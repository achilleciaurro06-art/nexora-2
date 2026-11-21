import { afterEach, describe, expect, it, vi } from "vitest";

const BASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "x".repeat(20), SUPABASE_SERVICE_ROLE_KEY: "y".repeat(20),
  EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"), GOOGLE_OAUTH_CLIENT_ID: "g".repeat(20), GOOGLE_OAUTH_CLIENT_SECRET: "gs".repeat(10),
  MS_OAUTH_CLIENT_ID: "m".repeat(20), MS_OAUTH_CLIENT_SECRET: "ms".repeat(10),
};
const KEYS = Object.keys(BASE_ENV).concat(["EMAIL_ALLOW_PRIVATE_HOSTS", "MS_OAUTH_TENANT", "CRON_SECRET"]);
async function load<T>(path: string, extra: Record<string, string> = {}, drop: string[] = []): Promise<T> {
  vi.resetModules();
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, BASE_ENV, extra);
  for (const d of drop) delete process.env[d];
  return (await import(path)) as T;
}
afterEach(() => { for (const k of KEYS) delete process.env[k]; vi.unstubAllGlobals(); });

type Call = { url: string; init?: RequestInit };
function mockFetch(routes: (c: Call) => { status?: number; json?: unknown; body?: BodyInit } | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const c = { url: String(url), init }; calls.push(c);
    const r = routes(c);
    if (!r) throw new Error(`fetch non previsto: ${c.url}`);
    return new Response(r.body ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  });
  return calls;
}
const acct = (cursor: Record<string, unknown> = {}) => ({ id: "a1", address: "ufficio@azienda.it", displayName: "Ufficio", settings: {}, cursor });
const oauthSecret = (over: Record<string, unknown> = {}) => ({ kind: "oauth" as const, refreshToken: "rt", accessToken: "at", expiresAt: Date.now() + 3_600_000, ...over });
const out = (over: Record<string, unknown> = {}) => ({
  from: { address: "ufficio@azienda.it", name: "Ufficio" }, to: [{ address: "cliente@x.it" }], cc: [], bcc: [{ address: "capo@azienda.it" }], subject: "Preventivo 2026/0001", html: "<p>Ciao</p>", text: "Ciao",
  attachments: [{ filename: "preventivo.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.4 test") }], messageId: "<id1@azienda.it>", inReplyTo: null, references: [], ...over,
});
const rfc = (subject: string, from = "mario@cliente.it", id = "<m1@cliente.it>", extra = "") => Buffer.from(`From: Mario <${from}>\r\nTo: ufficio@azienda.it\r\nSubject: ${subject}\r\nMessage-ID: ${id}\r\nDate: Mon, 10 May 2026 10:00:00 +0000\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\nTesto del messaggio`);

describe("configurazione OAuth", () => {
  it("elenca con precisione le variabili mancanti", async () => {
    const o = await load<typeof import("@/modules/email/providers/oauth")>("@/modules/email/providers/oauth", {}, ["GOOGLE_OAUTH_CLIENT_SECRET", "MS_OAUTH_CLIENT_ID", "MS_OAUTH_CLIENT_SECRET", "EMAIL_ENCRYPTION_KEY"]);
    expect(o.missingConfig("gmail")).toEqual(["EMAIL_ENCRYPTION_KEY", "GOOGLE_OAUTH_CLIENT_SECRET"]);
    expect(o.missingConfig("outlook")).toEqual(["EMAIL_ENCRYPTION_KEY", "MS_OAUTH_CLIENT_ID", "MS_OAUTH_CLIENT_SECRET"]);
    expect(() => o.oauthConfig("gmail")).toThrow(/non configurato/i);
  });
  it("URL di autorizzazione: accesso offline, scope minimi e state", async () => {
    const o = await load<typeof import("@/modules/email/providers/oauth")>("@/modules/email/providers/oauth");
    const g = new URL(o.buildAuthUrl("gmail", "STATE123", "https://app.it/cb"));
    expect(g.origin + g.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(g.searchParams.get("state")).toBe("STATE123"); expect(g.searchParams.get("access_type")).toBe("offline"); expect(g.searchParams.get("redirect_uri")).toBe("https://app.it/cb");
    expect(g.searchParams.get("scope")).toContain("gmail.send"); expect(g.searchParams.get("scope")).not.toContain("mail.google.com");
    const m = new URL(o.buildAuthUrl("outlook", "S", "https://app.it/cb"));
    expect(m.pathname).toContain("/common/oauth2/v2.0/authorize"); expect(m.searchParams.get("scope")).toContain("Mail.Send"); expect(m.searchParams.get("scope")).toContain("offline_access");
  });
  it("token: usa la cache, rinnova alla scadenza, segnala la revoca come errore di autorizzazione", async () => {
    const o = await load<typeof import("@/modules/email/providers/oauth")>("@/modules/email/providers/oauth");
    const calls = mockFetch((c) => (c.url.includes("oauth2.googleapis.com/token") ? { json: { access_token: "NEW", expires_in: 3600 } } : undefined));
    expect((await o.accessToken("gmail", oauthSecret())).refreshed).toBe(false); expect(calls.length).toBe(0);
    const r = await o.accessToken("gmail", oauthSecret({ expiresAt: Date.now() - 1 }));
    expect(r).toMatchObject({ token: "NEW", refreshed: true }); expect(r.secret.refreshToken).toBe("rt");
    expect(String(calls[0]!.init!.body)).toContain("grant_type=refresh_token");
    mockFetch(() => ({ status: 400, json: { error: "invalid_grant" } }));
    await expect(o.accessToken("gmail", oauthSecret({ expiresAt: 0 }))).rejects.toMatchObject({ kind: "auth" });
    mockFetch(() => ({ status: 503, json: {} }));
    await expect(o.accessToken("gmail", oauthSecret({ expiresAt: 0 }))).rejects.toMatchObject({ kind: "temporary" });
  });
  it("scambio del codice: serve il refresh token, altrimenti errore chiaro", async () => {
    const o = await load<typeof import("@/modules/email/providers/oauth")>("@/modules/email/providers/oauth");
    mockFetch(() => ({ json: { access_token: "a", refresh_token: "r", expires_in: 100 } }));
    expect(await o.exchangeCode("gmail", "code", "https://app.it/cb")).toMatchObject({ kind: "oauth", refreshToken: "r" });
    mockFetch(() => ({ json: { access_token: "a" } }));
    await expect(o.exchangeCode("gmail", "code", "https://app.it/cb")).rejects.toMatchObject({ kind: "auth" });
    mockFetch(() => ({ status: 400, json: { error: "bad" } }));
    await expect(o.exchangeCode("outlook", "code", "https://app.it/cb")).rejects.toMatchObject({ kind: "auth" });
  });
  it("classificazione degli errori HTTP", async () => {
    const o = await load<typeof import("@/modules/email/providers/oauth")>("@/modules/email/providers/oauth");
    expect(o.classifyHttp(401, "x").kind).toBe("auth"); expect(o.classifyHttp(403, "x").kind).toBe("auth");
    expect(o.classifyHttp(429, "x").kind).toBe("temporary"); expect(o.classifyHttp(502, "x").kind).toBe("temporary"); expect(o.classifyHttp(400, "x").kind).toBe("permanent");
  });
});

describe("Gmail (API simulata: NON è una prova con Google reale)", () => {
  type G = typeof import("@/modules/email/providers/gmail");
  it("invio: MIME corretto con allegato e Bcc, thread per le risposte; esito dopo la conferma", async () => {
    const { gmailProvider } = await load<G>("@/modules/email/providers/gmail");
    const calls = mockFetch((c) => (c.url.endsWith("/messages/send") ? { json: { id: "G1", threadId: "TH1" } } : undefined));
    const r = await gmailProvider.send(oauthSecret(), acct(), out({ providerThreadId: "TH0", inReplyTo: "<orig@x>", references: ["<orig@x>"] }) as never);
    expect(r).toMatchObject({ providerMessageId: "G1", providerThreadId: "TH1", internetMessageId: "<id1@azienda.it>" });
    const body = JSON.parse(String(calls[0]!.init!.body)) as { raw: string; threadId: string };
    expect(body.threadId).toBe("TH0");
    const mime = Buffer.from(body.raw, "base64url").toString("utf8");
    expect(mime).toContain("Subject: Preventivo 2026/0001"); expect(mime).toContain("filename=preventivo.pdf"); expect(mime).toContain("In-Reply-To: <orig@x>"); expect(mime).toContain("Message-ID: <id1@azienda.it>");
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer at");
  });
  it("invio: 401 = autorizzazione; 5xx = incerto (non si rinvia da soli); 400 = rifiutato", async () => {
    const { gmailProvider } = await load<G>("@/modules/email/providers/gmail");
    mockFetch(() => ({ status: 401, json: {} }));
    await expect(gmailProvider.send(oauthSecret(), acct(), out() as never)).rejects.toMatchObject({ kind: "auth", uncertain: false });
    mockFetch(() => ({ status: 503, json: {} }));
    await expect(gmailProvider.send(oauthSecret(), acct(), out() as never)).rejects.toMatchObject({ kind: "temporary", uncertain: true });
    mockFetch(() => ({ status: 400, json: {} }));
    await expect(gmailProvider.send(oauthSecret(), acct(), out() as never)).rejects.toMatchObject({ kind: "permanent" });
  });
  it("sincronizzazione iniziale: ultimi messaggi di INBOX e SENT, direzione e lettura dalle etichette", async () => {
    const { gmailProvider } = await load<G>("@/modules/email/providers/gmail");
    const m = (id: string, labels: string[]) => ({ json: { id, threadId: `T-${id}`, labelIds: labels, raw: rfc(`Oggetto ${id}`, "mario@cliente.it", `<${id}@c>`).toString("base64url"), internalDate: "1778407200000" } });
    mockFetch((c) => {
      if (c.url.includes("labelIds=INBOX")) return { json: { messages: [{ id: "i1" }] } };
      if (c.url.includes("labelIds=SENT")) return { json: { messages: [{ id: "s1" }] } };
      if (c.url.endsWith("/profile")) return { json: { historyId: "500" } };
      if (c.url.includes("/messages/i1")) return m("i1", ["INBOX", "UNREAD"]);
      if (c.url.includes("/messages/s1")) return m("s1", ["SENT"]);
      return undefined;
    });
    const r = await gmailProvider.sync(oauthSecret(), acct(), { limit: 50 });
    expect(r.cursor).toEqual({ historyId: "500" });
    expect(r.messages.map((x) => [x.providerMessageId, x.folder, x.isRead, x.providerThreadId])).toEqual([["i1", "inbox", false, "T-i1"], ["s1", "sent", true, "T-s1"]]);
  });
  it("sincronizzazione incrementale con la cronologia; bozze escluse; cursore aggiornato", async () => {
    const { gmailProvider } = await load<G>("@/modules/email/providers/gmail");
    const calls = mockFetch((c) => {
      if (c.url.includes("/history?")) return { json: { history: [{ messagesAdded: [{ message: { id: "n1", labelIds: ["INBOX"] } }, { message: { id: "d1", labelIds: ["DRAFT"] } }] }], historyId: "612" } };
      if (c.url.includes("/messages/n1")) return { json: { id: "n1", threadId: "T9", labelIds: ["INBOX"], raw: rfc("Nuovo").toString("base64url") } };
      return undefined;
    });
    const r = await gmailProvider.sync(oauthSecret(), acct({ historyId: "600" }), { limit: 50 });
    expect(r.messages.map((x) => x.providerMessageId)).toEqual(["n1"]); expect(r.cursor).toEqual({ historyId: "612" });
    expect(calls[0]!.url).toContain("startHistoryId=600");
  });
  it("cronologia scaduta (404): riparte dagli ultimi messaggi senza perdere i nuovi", async () => {
    const { gmailProvider } = await load<G>("@/modules/email/providers/gmail");
    mockFetch((c) => {
      if (c.url.includes("/history?")) return { status: 404, json: {} };
      if (c.url.includes("labelIds=")) return { json: { messages: [] } };
      if (c.url.endsWith("/profile")) return { json: { historyId: "900" } };
      return undefined;
    });
    const r = await gmailProvider.sync(oauthSecret(), acct({ historyId: "1" }), { limit: 50 });
    expect(r.cursor).toEqual({ historyId: "900" });
  });
  it("token rinnovato durante l'operazione: il nuovo segreto viene restituito per essere salvato", async () => {
    const { gmailProvider } = await load<G>("@/modules/email/providers/gmail");
    mockFetch((c) => (c.url.includes("oauth2.googleapis.com/token") ? { json: { access_token: "FRESH", expires_in: 3600 } } : c.url.endsWith("/messages/send") ? { json: { id: "G2", threadId: "T" } } : undefined));
    const r = await gmailProvider.send(oauthSecret({ expiresAt: 0 }), acct(), out() as never);
    expect(r.secret).toMatchObject({ kind: "oauth", accessToken: "FRESH", refreshToken: "rt" });
  });
  it("credenziali di un altro tipo: errore di autorizzazione", async () => {
    const { gmailProvider } = await load<G>("@/modules/email/providers/gmail");
    await expect(gmailProvider.sync({ kind: "password", imapPassword: "x", smtpPassword: "y" }, acct(), { limit: 5 })).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("Outlook / Microsoft 365 (API simulata: NON è una prova con Microsoft reale)", () => {
  type O = typeof import("@/modules/email/providers/outlook");
  it("invio: crea la bozza (che ha già l'id definitivo) e la invia", async () => {
    const { outlookProvider } = await load<O>("@/modules/email/providers/outlook");
    const calls = mockFetch((c) => (c.url.endsWith("/me/messages") ? { status: 201, json: { id: "AAA", conversationId: "CV1", internetMessageId: "<real@outlook>" } } : c.url.endsWith("/AAA/send") ? { status: 202, body: "" } : undefined));
    const r = await outlookProvider.send(oauthSecret(), acct(), out() as never);
    expect(r).toMatchObject({ providerMessageId: "AAA", providerThreadId: "CV1", internetMessageId: "<real@outlook>" });
    const draft = JSON.parse(String(calls[0]!.init!.body)) as { subject: string; toRecipients: unknown[]; bccRecipients: unknown[]; attachments: { name: string; contentBytes: string }[] };
    expect(draft.subject).toBe("Preventivo 2026/0001"); expect(draft.toRecipients).toHaveLength(1); expect(draft.bccRecipients).toHaveLength(1);
    expect(draft.attachments[0]!.name).toBe("preventivo.pdf"); expect(Buffer.from(draft.attachments[0]!.contentBytes, "base64").toString()).toContain("%PDF");
    expect(calls[1]!.url).toContain("/AAA/send");
  });
  it("invio: errore dopo la creazione della bozza ma prima della conferma = esito incerto", async () => {
    const { outlookProvider } = await load<O>("@/modules/email/providers/outlook");
    mockFetch((c) => (c.url.endsWith("/me/messages") ? { status: 201, json: { id: "AAA" } } : { status: 503, json: {} }));
    await expect(outlookProvider.send(oauthSecret(), acct(), out() as never)).rejects.toMatchObject({ kind: "temporary", uncertain: true });
    mockFetch(() => ({ status: 403, json: {} }));
    await expect(outlookProvider.send(oauthSecret(), acct(), out() as never)).rejects.toMatchObject({ kind: "auth" });
  });
  it("sincronizzazione delta: legge il MIME, salta bozze e rimossi, salva il deltaLink", async () => {
    const { outlookProvider } = await load<O>("@/modules/email/providers/outlook");
    const calls = mockFetch((c) => {
      if (c.url.includes("/inbox/messages/delta")) return { json: { value: [{ id: "x1", conversationId: "C1", isRead: false, receivedDateTime: "2026-05-10T10:00:00Z" }, { id: "x2", isDraft: true }, { id: "x3", "@removed": { reason: "deleted" } }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=T1" } };
      if (c.url.includes("/sentitems/messages/delta")) return { json: { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=T2" } };
      if (c.url.endsWith("/messages/x1/$value")) return { body: rfc("Da Outlook") };
      return undefined;
    });
    const r = await outlookProvider.sync(oauthSecret(), acct(), { limit: 50 });
    expect(r.messages).toHaveLength(1); expect(r.messages[0]).toMatchObject({ providerMessageId: "x1", providerThreadId: "C1", folder: "inbox", isRead: false });
    expect(r.cursor).toEqual({ inbox: "https://graph.microsoft.com/v1.0/delta?token=T1", sent: "https://graph.microsoft.com/v1.0/delta?token=T2" });
    expect(calls[0]!.url).toContain("receivedDateTime ge");
    // seconda lettura: riparte dal deltaLink
    const calls2 = mockFetch((c) => (c.url.includes("token=") ? { json: { value: [], "@odata.deltaLink": `${c.url}x` } } : undefined));
    await outlookProvider.sync(oauthSecret(), acct(r.cursor), { limit: 50 });
    expect(calls2.map((c) => c.url)).toEqual(["https://graph.microsoft.com/v1.0/delta?token=T1".replace("https://graph.microsoft.com/v1.0", "https://graph.microsoft.com/v1.0"), "https://graph.microsoft.com/v1.0/delta?token=T2"]);
  });
  it("delta scaduto (410): riparte da capo invece di fallire", async () => {
    const { outlookProvider } = await load<O>("@/modules/email/providers/outlook");
    let first = true;
    mockFetch((c) => {
      if (c.url.includes("token=") && first) { first = false; return { status: 410, json: {} }; }
      if (c.url.includes("/delta")) return { json: { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=NEW" } };
      return undefined;
    });
    const r = await outlookProvider.sync(oauthSecret(), acct({ inbox: "https://graph.microsoft.com/v1.0/delta?token=OLD" }), { limit: 50 });
    expect(r.cursor).toMatchObject({ inbox: "https://graph.microsoft.com/v1.0/delta?token=NEW" });
  });
});

describe("interpretazione dei messaggi (MIME)", () => {
  it("testo, html, allegati, riferimenti e intestazioni", async () => {
    const { parseRaw } = await load<typeof import("@/modules/email/providers/parse")>("@/modules/email/providers/parse");
    const raw = Buffer.from([
      "From: =?UTF-8?Q?Mario_Perch=C3=A9?= <Mario@Cliente.IT>", "To: Ufficio <ufficio@azienda.it>, altro@azienda.it", "Cc: capo@cliente.it", "Reply-To: segreteria@cliente.it",
      "Subject: =?UTF-8?Q?Preventivo_citt=C3=A0?=", "Message-ID: <abc@cliente.it>", "In-Reply-To: <prev@azienda.it>", "References: <old@x> <prev@azienda.it>", "Date: Mon, 10 May 2026 10:00:00 +0200",
      "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="B1"', "", "--B1", "Content-Type: multipart/alternative; boundary=\"B2\"", "", "--B2", "Content-Type: text/plain; charset=utf-8", "", "Testo semplice", "--B2",
      "Content-Type: text/html; charset=utf-8", "", "<p>Testo <b>html</b></p>", "--B2--", "--B1", 'Content-Type: application/pdf; name="offerta.pdf"', 'Content-Disposition: attachment; filename="offerta.pdf"', "Content-Transfer-Encoding: base64", "",
      Buffer.from("%PDF-1.4 finto").toString("base64"), "--B1--", ""].join("\r\n"));
    const p = await parseRaw(raw);
    expect(p.from).toEqual({ address: "mario@cliente.it", name: "Mario Perché" });
    expect(p.to.map((a) => a.address)).toEqual(["ufficio@azienda.it", "altro@azienda.it"]); expect(p.cc.map((a) => a.address)).toEqual(["capo@cliente.it"]); expect(p.replyTo?.address).toBe("segreteria@cliente.it");
    expect(p.subject).toBe("Preventivo città"); expect(p.messageId).toBe("<abc@cliente.it>"); expect(p.inReplyTo).toBe("<prev@azienda.it>"); expect(p.references).toEqual(["<old@x>", "<prev@azienda.it>"]);
    expect(p.text).toContain("Testo semplice"); expect(p.html).toContain("<b>html</b>");
    expect(p.attachments).toHaveLength(1); expect(p.attachments[0]).toMatchObject({ filename: "offerta.pdf", contentType: "application/pdf" }); expect(p.attachments[0]!.content.toString()).toContain("%PDF");
  });
  it("intestazioni mancanti o false non rompono nulla: mittente sconosciuto, data futura ignorata", async () => {
    const { parseRaw } = await load<typeof import("@/modules/email/providers/parse")>("@/modules/email/providers/parse");
    const p = await parseRaw(Buffer.from("Subject: x\r\nDate: Mon, 10 May 2099 10:00:00 +0000\r\n\r\ncorpo"));
    expect(p.from.address).toBe("sconosciuto@invalid.invalid"); expect(p.date.getTime()).toBeLessThan(Date.now() + 86_400_000); expect(p.to).toEqual([]);
  });
  it("le immagini incorporate (firme) non diventano allegati", async () => {
    const { parseRaw } = await load<typeof import("@/modules/email/providers/parse")>("@/modules/email/providers/parse");
    const raw = Buffer.from(["From: a@b.it", "Subject: inline", 'Content-Type: multipart/related; boundary="R"', "", "--R", "Content-Type: text/html", "", '<p>x<img src="cid:logo"></p>', "--R", "Content-Type: image/png", "Content-ID: <logo>", "Content-Disposition: inline; filename=\"logo.png\"", "Content-Transfer-Encoding: base64", "", Buffer.from("PNG").toString("base64"), "--R--", ""].join("\r\n"));
    expect((await parseRaw(raw)).attachments).toHaveLength(0);
  });
});

describe("errori SMTP/IMAP", () => {
  it("classificazione: autenticazione, destinatario rifiutato, connessione, esito incerto dopo i dati", async () => {
    const { classifySmtpError, classifyImapError } = await load<typeof import("@/modules/email/providers/smtp-imap")>("@/modules/email/providers/smtp-imap");
    expect(classifySmtpError({ code: "EAUTH" })).toMatchObject({ kind: "auth", uncertain: false });
    expect(classifySmtpError({ code: "EENVELOPE" })).toMatchObject({ kind: "permanent", uncertain: false });
    expect(classifySmtpError({ responseCode: 550, command: "RCPT TO" })).toMatchObject({ kind: "permanent", uncertain: false });
    expect(classifySmtpError({ code: "ECONNECTION", command: "CONN" })).toMatchObject({ kind: "temporary", uncertain: false });
    expect(classifySmtpError({ code: "ETIMEDOUT", command: "DATA" })).toMatchObject({ kind: "temporary", uncertain: true });
    expect(classifySmtpError(new Error("boh"))).toMatchObject({ uncertain: true });
    expect(classifyImapError({ authenticationFailed: true })).toMatchObject({ kind: "auth" });
    expect(classifyImapError({ code: "ETIMEDOUT" })).toMatchObject({ kind: "temporary" });
  });
});
