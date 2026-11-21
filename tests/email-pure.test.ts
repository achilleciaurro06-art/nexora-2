import { describe, expect, it } from "vitest";
import { dedupeAddrs, isValidEmail, parseAddressList, formatAddr, addrsFromJson } from "@/modules/email/addresses";
import { htmlToText, safeHref, sandboxedDoc, sanitizeEmailHtml, snippetOf, textToHtml } from "@/modules/email/sanitize";
import { isForwardSubject, isReplySubject, normalizeSubject, parseReferences, pickThread, lookupIds } from "@/modules/email/threading";
import { counterparties, decideLink } from "@/modules/email/matching";
import { fillTemplate, fillTemplateText, forwardSubject, quotedBlock, replyRecipients, replySubject, withSignature, type Original } from "@/modules/email/compose";
import { decryptSecret, encryptSecret, parseKey, signState, verifyState } from "@/modules/email/crypto";
import { MAIL_PORTS, isPrivateIp, resolveMailHost, validHostname } from "@/modules/email/host-guard";
import { downloadMime, isDangerousFile, safeFilename, fmtBytes } from "@/modules/email/limits";

describe("indirizzi", () => {
  it("validazione e rifiuto di iniezioni di intestazioni", () => {
    for (const ok of ["a@b.it", "mario.rossi+test@azienda.co.uk", "x_y@sub.dominio.com"]) expect(isValidEmail(ok)).toBe(true);
    for (const bad of ["", "a@b", "a@@b.it", "a b@c.it", "a@b.it\r\nBcc: x@y.it", "a@b.it\n", "@b.it", "a@-b.it", `${"x".repeat(65)}@b.it`]) expect(isValidEmail(bad)).toBe(false);
  });
  it("elenco con nomi, virgole, punti e virgola, doppioni e non validi", () => {
    const r = parseAddressList('Mario Rossi <Mario@Uno.it>, "Bianchi, Luisa" <luisa@due.it>; mario@uno.it\nnon-valido, x@y');
    expect(r.ok.map((a) => a.address)).toEqual(["mario@uno.it", "luisa@due.it"]);
    expect(r.ok[1]!.name).toBe("Bianchi, Luisa");
    expect(r.invalid).toEqual(["non-valido", "x@y"]);
    expect(formatAddr(r.ok[0]!)).toBe("Mario Rossi <mario@uno.it>");
  });
  it("il nome non può contenere caratteri pericolosi", () => {
    const r = parseAddressList('"Evil\r\nBcc: a@b.it" <ok@b.it>');
    expect(r.ok.every((a) => !/[\r\n]/.test(a.name ?? ""))).toBe(true);
  });
  it("dedupe e lettura sicura dal JSON", () => {
    expect(dedupeAddrs([{ address: "A@b.it" }, { address: "a@b.it" }]).length).toBe(1);
    expect(addrsFromJson([{ address: "X@Y.it", name: "X" }, { address: "no" }, 5, null])).toEqual([{ address: "x@y.it", name: "X" }]);
    expect(addrsFromJson("boh")).toEqual([]);
  });
});

describe("sanitizzazione HTML", () => {
  const XSS = [
    '<script>alert(1)</script>ciao', '<img src=x onerror=alert(1)>', '<a href="javascript:alert(1)">x</a>', '<a href="  JaVaScRiPt:alert(1)">x</a>',
    '<a href="&#106;avascript:alert(1)">x</a>', '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', '<iframe src="https://evil"></iframe>t', '<svg onload=alert(1)><script>1</script></svg>',
    '<p onclick="x()">t</p>', '<style>body{display:none}</style>t', '<object data=x></object>', '<form action=x><button>go</button></form>',
  ];
  it.each(XSS)("neutralizza: %s", (payload) => {
    const out = sanitizeEmailHtml(payload);
    expect(out).not.toMatch(/<script|<iframe|<svg|<object|<style|<form|onerror|onclick|onload|javascript:|data:text|<img/i);
  });
  it("mantiene la formattazione semplice e i link sicuri", () => {
    const out = sanitizeEmailHtml('<p>Ciao <b>mondo</b> e <i>mondo</i></p><ul><li>uno</li></ul><a href="https://x.it/a?b=1&amp;c=2">link</a> <a href="mailto:a@b.it">m</a>');
    expect(out).toContain("<p>Ciao <b>mondo</b> e <i>mondo</i></p>");
    expect(out).toContain("<ul><li>uno</li></ul>");
    expect(out).toContain('href="https://x.it/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer"');
    expect(out).toContain('href="mailto:a@b.it"');
  });
  it("chiude i tag lasciati aperti, scappa il testo e non raddoppia le entità", () => {
    expect(sanitizeEmailHtml("<p><b>aperto")).toBe("<p><b>aperto</b></p>");
    expect(sanitizeEmailHtml("a < b & c &amp; d")).toBe("a &lt; b &amp; c &amp; d");
    expect(sanitizeEmailHtml("<p>x</p></div></p>")).toBe("<p>x</p>");
  });
  it("href: solo http, https, mailto", () => {
    expect(safeHref("https://a.it")).toBe("https://a.it");
    for (const bad of ["javascript:x", "vbscript:x", "data:x", "file:///etc/passwd", "//evil.com", "ftp://x"]) expect(safeHref(bad)).toBeNull();
  });
  it("testo, anteprima e documento sandbox con CSP", () => {
    expect(htmlToText("<p>Uno</p><p>Due<br>Tre</p><script>x</script>")).toBe("Uno\nDue\nTre");
    expect(snippetOf("  a   b \n c  ", 5)).toBe("a b c");
    expect(textToHtml("a\nb\n\nc <d>")).toBe("<p>a<br>b</p><p>c &lt;d&gt;</p>");
    const d = sandboxedDoc('<p>x</p><meta http-equiv="refresh" content="0;url=https://evil"><base href="https://evil">');
    expect(d).toContain("default-src 'none'");
    expect(d).not.toContain("refresh"); expect(d).not.toContain("https://evil");
  });
});

describe("conversazioni", () => {
  it("oggetto normalizzato e riconoscimento di risposte/inoltri", () => {
    expect(normalizeSubject("RE: Fwd: R: Preventivo  2026")).toBe("preventivo 2026");
    expect(normalizeSubject("Re[2]: x")).toBe("x");
    expect(isReplySubject("Re: x")).toBe(true); expect(isReplySubject("Preventivo")).toBe(false);
    expect(isForwardSubject("Fwd: x")).toBe(true); expect(isForwardSubject("I: x")).toBe(true);
  });
  it("riferimenti: solo identificativi ben formati, senza doppioni", () => {
    expect(parseReferences("<a@x> <b@x>  <a@x> junk")).toEqual(["<a@x>", "<b@x>"]);
    expect(parseReferences(["<a@x>", "bad"])).toEqual(["<a@x>"]);
    expect(parseReferences(null)).toEqual([]);
    expect(lookupIds({ inReplyTo: "<a@x>", references: ["<b@x>", "<a@x>"] })).toEqual(["<a@x>", "<b@x>"]);
  });
  it("sceglie la conversazione per identificativo di thread o per riferimenti, mai per oggetto", () => {
    const known = { byProviderThread: new Map([["T1", "thread-1"]]), byMessageId: new Map([["<m1@x>", "thread-1"], ["<m9@x>", "thread-9"]]) };
    expect(pickThread({ providerThreadId: "T1" }, known)).toBe("thread-1");
    expect(pickThread({ inReplyTo: "<m1@x>" }, known)).toBe("thread-1");
    expect(pickThread({ references: ["<m9@x>", "<zz@x>"] }, known)).toBe("thread-9");
    expect(pickThread({ inReplyTo: "<sconosciuto@x>" }, known)).toBeNull();
    expect(pickThread({}, known)).toBeNull();
    // il riferimento più vicino prevale
    expect(pickThread({ references: ["<m9@x>", "<m1@x>"] }, known)).toBe("thread-1");
  });
});

describe("collegamento automatico al cliente", () => {
  const row = (customer: string, contact: string | null, name = customer) => ({ address: "x@y.it", customer_id: customer, contact_id: contact, customer_name: name, archived: false });
  it("nessun indirizzo noto: nessun collegamento", () => expect(decideLink([])).toEqual({ status: "none", customerId: null, contactId: null, candidates: [] }));
  it("un solo cliente (anche tramite referente): collegamento certo", () => {
    expect(decideLink([row("c1", null)])).toMatchObject({ status: "auto", customerId: "c1", contactId: null });
    expect(decideLink([row("c1", "k1"), row("c1", null)])).toMatchObject({ status: "auto", customerId: "c1", contactId: "k1" });
    expect(decideLink([row("c1", "k1"), row("c1", "k2")])).toMatchObject({ status: "auto", customerId: "c1", contactId: null });
  });
  it("più clienti: proposta da confermare, nessun collegamento automatico", () => {
    const d = decideLink([row("c1", null, "Uno"), row("c2", null, "Due"), row("c1", "k1", "Uno")]);
    expect(d.status).toBe("suggested"); expect(d.customerId).toBeNull();
    expect(d.candidates.map((c) => c.name)).toEqual(["Uno", "Due"]);
  });
  it("controparte: ricevuti → mittente; inviati → destinatari; mai la casella stessa", () => {
    const m = { from: { address: "mario@uno.it" }, to: [{ address: "Vendite@alfa.it" }], cc: [{ address: "collega@alfa.it" }] };
    expect(counterparties({ direction: "inbound", ...m }, ["vendite@alfa.it"])).toEqual(["mario@uno.it"]);
    expect(counterparties({ direction: "outbound", from: { address: "vendite@alfa.it" }, to: [{ address: "mario@uno.it" }], cc: [{ address: "x@y.it" }] }, ["vendite@alfa.it"])).toEqual(["mario@uno.it", "x@y.it"]);
    expect(counterparties({ direction: "inbound", from: { address: "vendite@alfa.it" }, to: [{ address: "cliente@z.it" }], cc: [] }, ["vendite@alfa.it"])).toEqual(["cliente@z.it"]);
  });
});

describe("composizione: rispondi, rispondi a tutti, inoltra, modelli, firma", () => {
  const orig: Original = { direction: "inbound", from: { address: "mario@uno.it", name: "Mario" }, to: [{ address: "vendite@alfa.it" }, { address: "collega@alfa.it" }], cc: [{ address: "capo@uno.it" }, { address: "vendite@alfa.it" }],
    subject: "Re: Richiesta", messageAt: "2026-05-10T10:00:00Z", bodyHtml: "<p>Ciao</p><script>alert(1)</script>", bodyText: null };
  it("rispondi: solo al mittente", () => expect(replyRecipients(orig, "vendite@alfa.it", "reply")).toEqual({ to: [{ address: "mario@uno.it", name: "Mario" }], cc: [] }));
  it("rispondi a tutti: senza la propria casella e senza doppioni", () => {
    const r = replyRecipients(orig, "Vendite@alfa.it", "reply_all");
    expect(r.to.map((a) => a.address)).toEqual(["mario@uno.it", "collega@alfa.it"]);
    expect(r.cc.map((a) => a.address)).toEqual(["capo@uno.it"]);
  });
  it("rispondi a un messaggio inviato da noi: agli stessi destinatari", () => {
    const sent: Original = { ...orig, direction: "outbound", from: { address: "vendite@alfa.it" }, to: [{ address: "mario@uno.it" }], cc: [] };
    expect(replyRecipients(sent, "vendite@alfa.it", "reply").to).toEqual([{ address: "mario@uno.it" }]);
  });
  it("Reply-To ha la precedenza sul mittente; l'inoltro non ha destinatari", () => {
    expect(replyRecipients({ ...orig, replyTo: { address: "ufficio@uno.it" } }, "vendite@alfa.it", "reply").to[0]!.address).toBe("ufficio@uno.it");
    expect(replyRecipients(orig, "vendite@alfa.it", "forward")).toEqual({ to: [], cc: [] });
  });
  it("oggetti Re:/Fwd: senza accumulo di prefissi", () => {
    expect(replySubject("Re: RE: Richiesta")).toBe("Re: Richiesta"); expect(replySubject("Richiesta")).toBe("Re: Richiesta");
    expect(forwardSubject("Fwd: Fw: X")).toBe("Fwd: X");
  });
  it("citazione: HTML sanitizzato, intestazioni scappate", () => {
    const q = quotedBlock({ ...orig, from: { address: "a@b.it", name: '<b>x</b>' }, subject: "<i>s</i>" }, "forward");
    expect(q).not.toContain("<script"); expect(q).toContain("Messaggio inoltrato"); expect(q).toContain("&lt;b&gt;x&lt;/b&gt;"); expect(q).toContain("<blockquote><p>Ciao</p></blockquote>");
  });
  it("modelli: segnaposto sostituiti e scappati, sconosciuti vuoti", () => {
    expect(fillTemplate("Ciao {{referente}} da {{ azienda }} {{boh}}", { referente: "<Mario>", azienda: "Alfa & C" })).toBe("Ciao &lt;Mario&gt; da Alfa &amp; C ");
    expect(fillTemplateText("Preventivo {{numero_preventivo}}", { numero_preventivo: "2026/0001" })).toBe("Preventivo 2026/0001");
  });
  it("firma aggiunta in modo sicuro e solo se presente", () => {
    expect(withSignature("<p>x</p>", "")).toBe("<p>x</p>");
    expect(withSignature("<p>x</p>", "Mario\n<b>Vendite</b>")).toBe("<p>x</p><p>-- <br>Mario<br>&lt;b&gt;Vendite&lt;/b&gt;</p>");
  });
});

describe("cifratura dei segreti", () => {
  const key = parseKey(Buffer.alloc(32, 7).toString("base64"))!;
  it("round trip, nessun testo in chiaro e IV casuale", () => {
    const a = encryptSecret('{"password":"s3gr3t0"}', key), b = encryptSecret('{"password":"s3gr3t0"}', key);
    expect(a).not.toContain("s3gr3t0"); expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(decryptSecret(a, key)).toBe('{"password":"s3gr3t0"}');
  });
  it("rifiuta dati manomessi, chiave sbagliata e formati sconosciuti", () => {
    const a = encryptSecret("x", key);
    const raw = Buffer.from(a.slice(3), "base64"); raw[raw.length - 1]! ^= 1;
    expect(() => decryptSecret(`v1:${raw.toString("base64")}`, key)).toThrow();
    expect(() => decryptSecret(a, Buffer.alloc(32, 9))).toThrow();
    expect(() => decryptSecret("v9:abc", key)).toThrow(); expect(() => decryptSecret("v1:abc", key)).toThrow();
  });
  it("chiave: 32 byte in base64 o 64 esadecimali, altrimenti non valida", () => {
    expect(parseKey("a".repeat(64))).not.toBeNull(); expect(parseKey(undefined)).toBeNull(); expect(parseKey("corta")).toBeNull();
  });
  it("state OAuth firmato, a scadenza e non falsificabile", () => {
    const now = 1_700_000_000_000;
    const s = signState({ org: "o1", user: "u1" }, key, 600, now);
    expect(verifyState<{ org: string }>(s, key, now + 1000)?.org).toBe("o1");
    expect(verifyState(s, key, now + 601_000)).toBeNull();
    expect(verifyState(s, Buffer.alloc(32, 1), now)).toBeNull();
    const [body, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ org: "altra", user: "u1", exp: 9_999_999_999 })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, key, now)).toBeNull();
    expect(verifyState(`${body}`, key, now)).toBeNull(); expect(verifyState("", key)).toBeNull();
  });
});

describe("protezione dalle richieste verso reti interne (SSRF)", () => {
  it("indirizzi privati e di loopback", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "172.31.255.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd12::1", "::ffff:127.0.0.1", "224.0.0.1"]) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "93.184.216.34", "2606:4700::1111"]) expect(isPrivateIp(ip)).toBe(false);
  });
  it("rifiuta host interni, porte non di posta e nomi non validi (a meno che l'ambiente lo consenta)", async () => {
    await expect(resolveMailHost("127.0.0.1", 587, false)).rejects.toThrow();
    await expect(resolveMailHost("localhost", 587, false)).rejects.toThrow();
    await expect(resolveMailHost("srv.interno.local", 587, false)).rejects.toThrow();
    await expect(resolveMailHost("93.184.216.34", 6379, false)).rejects.toThrow(/Porta/);
    await expect(resolveMailHost("bad host!", 587, false)).rejects.toThrow();
    await expect(resolveMailHost("127.0.0.1", 1143, true)).resolves.toBe("127.0.0.1");
    await expect(resolveMailHost("93.184.216.34", 587, false)).resolves.toBe("93.184.216.34");
    expect([...MAIL_PORTS].sort((a, b) => a - b)).toEqual([25, 143, 465, 587, 993, 2525]);
    expect(validHostname("mail.azienda.it")).toBe(true); expect(validHostname("a..b")).toBe(false);
  });
});

describe("allegati", () => {
  it("file pericolosi, nomi sicuri e tipi forzati a download generico", () => {
    for (const n of ["virus.exe", "a.BAT", "x.js", "s.ps1", "doc.pdf.exe"]) expect(isDangerousFile(n)).toBe(true);
    for (const n of ["offerta.pdf", "foto.jpg", "tabella.xlsx", "senzaestensione"]) expect(isDangerousFile(n)).toBe(false);
    expect(safeFilename("../../etc/passwd")).toBe("passwd"); expect(safeFilename('a"b<c>.pdf')).toBe("a_b_c_.pdf"); expect(safeFilename("")).toBe("allegato"); expect(safeFilename("...")).toBe("allegato");
    expect(downloadMime("text/html")).toBe("application/octet-stream"); expect(downloadMime("image/svg+xml")).toBe("application/octet-stream"); expect(downloadMime("application/pdf")).toBe("application/pdf");
    expect(fmtBytes(500)).toBe("500 B"); expect(fmtBytes(2048)).toBe("2 KB"); expect(fmtBytes(5 * 1048576)).toBe("5.0 MB");
  });
});
