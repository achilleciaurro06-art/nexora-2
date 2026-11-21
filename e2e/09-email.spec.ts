import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { sql } from "./helpers";

test.use({ storageState: "e2e/.auth/owner.json" });
test.describe.configure({ mode: "serial" });

const TAG = Date.now();
const ADDR = "ufficio@test.local";
const RECEIVED = `Richiesta preventivo infissi ${TAG}`;
const first = (s: string) => s.split("\n")[0]!;
const org = () => sql("select id from public.organizations where name = 'Azienda Prova S.r.l.'");
const rossi = () => sql("select id from public.customers where name = 'Rossi Costruzioni S.r.l.'");
const inject = (subject: string, o: { from?: string; html?: string; attach?: string; id?: string; replyTo?: string } = {}) =>
  execFileSync("node", ["scripts/verify-stack/mail-inject.mjs", "--from", o.from ?? "mario@rossi-costruzioni.it", "--to", ADDR, "--subject", subject, "--text", `corpo di ${subject}`,
    ...(o.html ? ["--html", o.html] : []), ...(o.attach ? ["--attach", o.attach] : []), ...(o.id ? ["--message-id", o.id] : []), ...(o.replyTo ? ["--in-reply-to", o.replyTo] : [])], { encoding: "utf8" }).trim();
const eml = () => readdirSync("/tmp/nx-mail/outbox").sort().map((f) => ({ f, text: readFileSync(`/tmp/nx-mail/outbox/${f}`, "utf8") }));
const sync = async (page: Page) => { await page.getByRole("button", { name: "Sincronizza", exact: true }).click(); await expect(page.getByTestId("sync-status")).toBeVisible({ timeout: 30_000 }); };
const threadId = (subject: string) => first(sql(`select id from public.email_threads where subject = '${subject}' order by created_at desc limit 1`));
const countMsgs = (subject: string) => Number(sql(`select count(*) from public.email_messages where subject = '${subject}'`));

test("caselle: Google e Microsoft segnalano cosa manca; il collegamento IMAP/SMTP viene VERIFICATO e le credenziali restano cifrate", async ({ page }) => {
  await page.goto("/email/caselle");
  await expect(page.getByTestId("missing-gmail")).toContainText("GOOGLE_OAUTH_CLIENT_ID");
  await expect(page.getByTestId("missing-outlook")).toContainText("MS_OAUTH_CLIENT_ID");
  await page.getByText("Altra casella (IMAP/SMTP)").click();
  const fill = async (imapPw: string, smtpPw: string) => {
    await page.getByLabel("Indirizzo email *").fill(ADDR);
    await page.getByLabel("Nome del mittente").fill("Ufficio Prova");
    await page.locator("#imapHost").fill("127.0.0.1"); await page.locator("#imapPort").fill("1143"); await page.locator("#imapSecurity").selectOption("none");
    await page.locator("#imapUser").fill(ADDR); await page.locator("#imapPassword").fill(imapPw);
    await page.locator("#smtpHost").fill("127.0.0.1"); await page.locator("#smtpPort").fill("2525"); await page.locator("#smtpSecurity").selectOption("none");
    await page.locator("#smtpUser").fill(ADDR); await page.locator("#smtpPassword").fill(smtpPw);
  };
  await fill("sbagliata", "secret123");
  await page.getByRole("button", { name: "Verifica e collega" }).click();
  await expect(page.getByText(/Accesso IMAP rifiutato/)).toBeVisible({ timeout: 30_000 });
  await page.locator("#imapPassword").fill("secret123"); await page.locator("#smtpPassword").fill("sbagliata");
  await page.getByRole("button", { name: "Verifica e collega" }).click();
  await expect(page.getByText(/Accesso al server SMTP rifiutato/)).toBeVisible({ timeout: 30_000 });
  expect(sql("select count(*) from public.email_accounts")).toBe("0"); // nulla viene salvato se la verifica fallisce
  await page.locator("#smtpPassword").fill("secret123");
  await page.getByRole("button", { name: "Verifica e collega" }).click();
  await page.waitForURL(/\/email\/caselle\?collegata=1/, { timeout: 30_000 });
  const card = page.getByTestId("account").filter({ hasText: ADDR });
  await expect(card).toContainText("Collegata"); await expect(card).toContainText("Predefinita per l'invio");
  // sicurezza: segreto cifrato, nessuna password in chiaro nel database né nella pagina
  const cipher = sql("select ciphertext from private.email_account_secrets");
  expect(cipher.startsWith("v1:")).toBe(true); expect(cipher).not.toContain("secret123");
  expect(sql("select settings::text from public.email_accounts")).not.toContain("secret123");
  expect(await page.content()).not.toContain("secret123");
});

test("ricezione: sincronizzazione reale, collegamento automatico al cliente, nessun duplicato, non letto/letto", async ({ page }) => {
  writeFileSync("/tmp/nx-mail/offerta.pdf", "%PDF-1.4 contenuto-allegato-vero");
  // la prima sincronizzazione parte da sola al collegamento: si attende che finisca per avere un esito deterministico
  await expect.poll(() => sql("select (sync_started_at is null and last_sync_at is not null)::text from public.email_accounts"), { timeout: 30_000 }).toBe("true");
  const mid = inject(RECEIVED, { attach: "/tmp/nx-mail/offerta.pdf" });
  await page.goto("/email");
  await sync(page);
  await page.reload();
  const row = page.getByTestId("threads").locator("li", { hasText: RECEIVED });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-unread", "true");
  await expect(row).toContainText("Rossi Costruzioni S.r.l.");
  await expect(page.getByTestId("unread-badge")).toBeVisible();
  expect(sql(`select link_status || ':' || (contact_id is not null)::text from public.email_threads where subject = '${RECEIVED}'`)).toBe("auto:true"); // cliente e referente, da indirizzo esatto
  // idempotenza: una seconda sincronizzazione non importa di nuovo lo stesso messaggio
  expect(countMsgs(RECEIVED)).toBe(1);
  await sync(page); await sync(page);
  expect(countMsgs(RECEIVED)).toBe(1);
  expect(sql(`select internet_message_id from public.email_messages where subject = '${RECEIVED}'`)).toBe(mid);
  expect(sql("select last_sync_at is not null from public.email_accounts")).toBe("t");
  // apertura: allegato scaricabile e autorizzato, lettura registrata
  await page.goto(`/email/${threadId(RECEIVED)}`);
  await expect(page.getByTestId("linked-customer")).toContainText("Rossi Costruzioni");
  await expect(page.getByTestId("message-text")).toContainText(`corpo di ${RECEIVED}`);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /offerta\.pdf/ }).click()]);
  expect(readFileSync(await dl.path(), "utf8")).toBe("%PDF-1.4 contenuto-allegato-vero");
  await expect.poll(() => sql(`select is_read from public.email_messages where subject = '${RECEIVED}'`)).toBe("t");
  const attId = sql(`select id from public.email_attachments limit 1`);
  const ok = await page.request.get(`/email/allegati/${attId}`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-disposition"]).toContain("attachment"); expect(ok.headers()["x-content-type-options"]).toBe("nosniff"); expect(ok.headers()["cache-control"]).toContain("no-store");
  // nessun accesso senza autenticazione: ne' al file, ne' all'URL del bucket
  const anon = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } });
  const denied = await anon.request.get(`http://127.0.0.1:3100/email/allegati/${attId}`, { maxRedirects: 0 });
  expect([302, 307, 401, 404]).toContain(denied.status());
  await anon.close();
  const path = sql(`select storage_path from public.email_attachments limit 1`);
  const pub = await page.request.get(`http://127.0.0.1:54321/storage/v1/object/public/email-attachments/${path}`);
  expect(pub.status()).toBeGreaterThanOrEqual(400);
});

test("sicurezza dei contenuti: l'HTML ricevuto non esegue script né carica risorse remote", async ({ page }) => {
  const subj = `HTML ostile ${TAG}`;
  inject(subj, { html: "<p>Ciao</p><script>window.__pwned = 1</script><img src='http://127.0.0.1:9/tracking.png' onerror='window.__pwned=2'><a href='javascript:window.__pwned=3'>clic</a>" });
  await page.goto("/email"); await sync(page);
  await page.goto(`/email/${threadId(subj)}`);
  const frame = page.locator("iframe[title^='Messaggio']");
  await expect(frame).toBeVisible();
  expect(await frame.getAttribute("sandbox")).toBe(""); // sandbox totale: niente script, niente same-origin
  const src = (await frame.getAttribute("srcdoc")) ?? "";
  expect(src).toContain("default-src 'none'"); expect(src).toContain("Ciao");
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  const inner = page.frameLocator("iframe[title^='Messaggio']");
  await expect(inner.locator("body")).toContainText("Ciao");
});

test("risposta nella stessa conversazione: invio reale, intestazioni corrette, nessun duplicato dopo la sincronizzazione", async ({ page }) => {
  const tid = threadId(RECEIVED);
  const origId = sql(`select internet_message_id from public.email_messages where subject = '${RECEIVED}'`);
  await page.goto(`/email/${tid}`);
  await page.getByRole("link", { name: "Rispondi", exact: true }).click();
  await expect(page.getByLabel("A", { exact: true })).toHaveValue(/mario@rossi-costruzioni\.it/);
  await expect(page.getByLabel("Oggetto")).toHaveValue(`Re: ${RECEIVED}`);
  await expect(page.getByLabel("Da")).toBeDisabled(); // la risposta parte dalla casella della conversazione
  await expect(page.getByTestId("sender-note")).toContainText(ADDR);
  await expect(page.getByTestId("editor")).toContainText("ha scritto");
  const before = eml().length;
  await page.getByTestId("editor").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("Grazie, vi mando l'offerta domani. ");
  await page.getByRole("button", { name: "Invia", exact: true }).click();
  await page.waitForURL(new RegExp(`/email/${tid}\\?inviata=1`), { timeout: 30_000 });
  await expect(page.getByText("Email inviata.")).toBeVisible();
  await expect(page.getByTestId("message")).toHaveCount(2);
  const sent = eml().slice(before);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.text).toContain(`In-Reply-To: ${origId}`); expect(sent[0]!.text).toContain(`Subject: Re: ${RECEIVED}`); expect(sent[0]!.text).toContain("To: mario@rossi-costruzioni.it");
  expect(sql(`select status || ':' || (in_reply_to = '${origId}')::text || ':' || (sent_by is not null)::text from public.email_messages where direction = 'outbound' and subject = 'Re: ${RECEIVED}'`)).toBe("sent:true:true");
  // la copia in «Inviata» ritrovata dalla sincronizzazione NON viene importata di nuovo
  await page.goto("/email"); await sync(page); await sync(page);
  expect(countMsgs(`Re: ${RECEIVED}`)).toBe(1);
  // storico del cliente e ultimo contatto
  await page.goto(`/clienti/${rossi()}?tab=documenti`);
  await expect(page.getByTestId("customer-emails")).toContainText(RECEIVED);
  await expect(page.locator("#timeline").getByText(`Email inviata: Re: ${RECEIVED}`)).toBeVisible();
  expect(Number(sql(`select extract(epoch from now() - (public.customer_commercial_summary('${rossi()}') ->> 'last_contact_at')::timestamptz)`))).toBeLessThan(300);
});

test("rispondi a tutti e inoltra (con allegati)", async ({ page }) => {
  const subj = `Gruppo ${TAG}`;
  execFileSync("node", ["scripts/verify-stack/mail-inject.mjs", "--from", "mario@rossi-costruzioni.it", "--to", ADDR, "--cc", "capo@rossi-costruzioni.it", "--subject", subj, "--text", "a tutti", "--attach", "/tmp/nx-mail/offerta.pdf"]);
  await page.goto("/email"); await sync(page);
  await page.goto(`/email/${threadId(subj)}`);
  await page.getByRole("link", { name: "Rispondi a tutti" }).click();
  await expect(page.getByLabel("A", { exact: true })).toHaveValue("mario@rossi-costruzioni.it");
  await expect(page.getByLabel("Cc", { exact: true })).toHaveValue("capo@rossi-costruzioni.it");
  await page.goBack();
  await page.getByRole("link", { name: "Inoltra" }).click();
  await expect(page.getByLabel("Oggetto")).toHaveValue(`Fwd: ${subj}`);
  await expect(page.getByLabel("A", { exact: true })).toHaveValue("");
  await expect(page.getByTestId("uploaded")).toContainText("offerta.pdf"); // allegato originale ricopiato
  await expect(page.getByTestId("editor")).toContainText("Messaggio inoltrato");
  await page.getByLabel("A", { exact: true }).fill("collega@azienda-esterna.it");
  const before = eml().length;
  await page.getByRole("button", { name: "Invia", exact: true }).click();
  await page.waitForURL(/\/email\/[0-9a-f-]{36}\?inviata=1/, { timeout: 30_000 });
  const m = eml().slice(before);
  expect(m).toHaveLength(1); expect(m[0]!.text).toContain("filename=offerta.pdf"); expect(m[0]!.text).toContain(`Subject: Fwd: ${subj}`);
});

test("invio: errori del provider, indirizzi non validi e doppio clic non registrano né duplicano nulla", async ({ page }) => {
  await page.goto("/email/nuova");
  await page.getByLabel("A", { exact: true }).fill("nessuno@reject.test");
  await page.getByLabel("Oggetto").fill(`Rifiutata ${TAG}`);
  await page.getByTestId("editor").click(); await page.keyboard.type("testo");
  const before = eml().length;
  await page.getByRole("button", { name: "Invia", exact: true }).click();
  await expect(page.getByText(/rifiutato un destinatario/)).toBeVisible({ timeout: 30_000 });
  expect(countMsgs(`Rifiutata ${TAG}`)).toBe(0); // un invio fallito non risulta mai «inviato»
  expect(eml().length).toBe(before);
  expect(sql(`select count(*) from public.email_threads where subject = 'Rifiutata ${TAG}'`)).toBe("0");
  await page.getByLabel("A", { exact: true }).fill("non-un-indirizzo");
  await page.getByRole("button", { name: "Invia", exact: true }).click();
  await expect(page.getByText(/indirizzo non valido/).first()).toBeVisible();
  await page.getByLabel("A", { exact: true }).fill("");
  await page.getByRole("button", { name: "Invia", exact: true }).click();
  await expect(page.getByText("Indica almeno un destinatario").first()).toBeVisible();
  // doppio clic: un solo invio
  await page.getByLabel("A", { exact: true }).fill("cliente@esterno-doppio.it");
  await page.getByLabel("Oggetto").fill(`Doppio ${TAG}`);
  await page.getByRole("button", { name: "Invia", exact: true }).dblclick();
  await page.waitForURL(/\/email\/[0-9a-f-]{36}\?inviata=1/, { timeout: 30_000 });
  expect(countMsgs(`Doppio ${TAG}`)).toBe(1);
  expect(eml().slice(before).filter((e) => e.text.includes(`Subject: Doppio ${TAG}`))).toHaveLength(1);
});

test("bozze: salvataggio automatico, ripresa ed eliminazione", async ({ page }) => {
  await page.goto("/email/nuova");
  await page.getByLabel("A", { exact: true }).fill("futuro@cliente.it");
  await page.getByLabel("Oggetto").fill(`Bozza ${TAG}`);
  await page.getByTestId("editor").click(); await page.keyboard.type("testo a metà");
  await expect(page.getByTestId("draft-status")).toContainText("Bozza salvata", { timeout: 15_000 });
  expect(sql(`select count(*) from public.email_drafts where subject = 'Bozza ${TAG}'`)).toBe("1");
  await page.goto("/email?cartella=bozze");
  await page.getByTestId("drafts").getByRole("link", { name: new RegExp(`Bozza ${TAG}`) }).click();
  await expect(page.getByLabel("Oggetto")).toHaveValue(`Bozza ${TAG}`);
  await expect(page.getByLabel("A", { exact: true })).toHaveValue(/futuro@cliente\.it/);
  await expect(page.getByTestId("editor")).toContainText("testo a metà");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Elimina bozza" }).click();
  await page.waitForURL(/cartella=bozze/);
  await expect(page.getByTestId("drafts").getByText(`Bozza ${TAG}`)).toHaveCount(0);
  expect(sql(`select count(*) from public.email_drafts where subject = 'Bozza ${TAG}'`)).toBe("0");
});

test("collegamento al CRM: proposta se ambiguo, manuale se sconosciuto, scollegamento, preventivo", async ({ page }) => {
  const o = org();
  sql(`insert into public.customers (organization_id, name, email) values ('${o}', 'Gamma Uno S.r.l.', 'condiviso@gamma.it'), ('${o}', 'Gamma Due S.r.l.', 'condiviso@gamma.it')`);
  const amb = `Ambigua ${TAG}`, unk = `Sconosciuto ${TAG}`;
  inject(amb, { from: "condiviso@gamma.it" }); inject(unk, { from: "nuovo-contatto@sconosciuto.it" });
  await page.goto("/email"); await sync(page);
  expect(sql(`select link_status || ':' || (customer_id is null)::text from public.email_threads where subject = '${amb}'`)).toBe("suggested:true");
  expect(sql(`select link_status from public.email_threads where subject = '${unk}'`)).toBe("none");
  await page.goto(`/email/${threadId(amb)}`);
  const sug = page.getByTestId("link-suggestions");
  await expect(sug).toContainText("Gamma Uno S.r.l."); await expect(sug).toContainText("Gamma Due S.r.l.");
  await sug.locator("li", { hasText: "Gamma Due" }).getByRole("button", { name: "Collega" }).click();
  await expect(page.getByTestId("linked-customer")).toContainText("Gamma Due");
  expect(sql(`select link_status from public.email_threads where subject = '${amb}'`)).toBe("manual");
  // sconosciuto: collegamento manuale, poi scollegamento
  await page.goto(`/email/${threadId(unk)}`);
  await expect(page.getByText("Non collegata a un cliente.")).toBeVisible();
  const lf = page.getByRole("form", { name: "Collega a un cliente" });
  await lf.getByLabel("Cliente").selectOption({ label: "Gamma Uno S.r.l." });
  await lf.getByRole("button", { name: "Salva collegamento" }).click();
  await expect(page.getByTestId("linked-customer")).toContainText("Gamma Uno");
  await page.getByRole("button", { name: "Scollega dal cliente" }).click();
  await expect(page.getByText("Non collegata a un cliente.")).toBeVisible();
  expect(sql(`select link_status from public.email_threads where subject = '${unk}'`)).toBe("none");
  // preventivo e referente della conversazione con Rossi
  await page.goto(`/email/${threadId(RECEIVED)}`);
  const q = first(sql(`select id from public.quotes where customer_id = '${rossi()}' and deleted_at is null limit 1`));
  if (q) {
    await page.getByRole("form", { name: "Collega a un cliente" }).getByLabel("Preventivo").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Salva collegamento" }).click();
    await expect(page.getByText("Collegamento aggiornato")).toBeVisible();
    expect(sql(`select quote_id is not null from public.email_threads where subject = '${RECEIVED}'`)).toBe("t");
  }
});

test("attività e follow-up da un'email: nessun duplicato", async ({ page }) => {
  await page.goto(`/email/${threadId(RECEIVED)}`);
  const wp = page.getByTestId("work-panel");
  await wp.getByRole("button", { name: "Crea attività dalla conversazione" }).click();
  await expect(wp.getByRole("link", { name: new RegExp(`Rispondere a: ${RECEIVED}`) })).toBeVisible();
  await expect(wp.getByRole("button", { name: "Crea attività dalla conversazione" })).toHaveCount(0);
  await wp.getByRole("button", { name: /Crea follow-up/ }).click();
  await expect(wp.getByRole("link", { name: new RegExp(`Ricontatto: ${RECEIVED}`) })).toBeVisible();
  expect(sql(`select count(*) from public.tasks where title = 'Rispondere a: ${RECEIVED}'`)).toBe("1");
  expect(sql(`select count(*) from public.follow_ups where title = 'Ricontatto: ${RECEIVED}'`)).toBe("1");
  await page.reload();
  await expect(wp.getByRole("button", { name: "Crea attività dalla conversazione" })).toHaveCount(0);
  await expect(wp.getByRole("button", { name: /Crea follow-up/ })).toHaveCount(0);
  await wp.getByRole("link", { name: new RegExp(`Rispondere a: ${RECEIVED}`) }).click();
  await expect(page).toHaveURL(/\/attivita\/[0-9a-f-]{36}$/);
});

test("ricerca, filtri e viste della posta", async ({ page }) => {
  await page.goto("/email?cartella=tutte");
  await page.getByLabel("Cerca email").fill(`infissi ${TAG}`);
  await page.getByRole("button", { name: "Applica" }).click();
  await expect(page.getByTestId("threads").locator("li")).toHaveCount(1);
  await page.getByLabel("Cerca email").fill("mario@rossi-costruzioni.it");
  await page.getByRole("button", { name: "Applica" }).click();
  await expect(page.getByTestId("threads").locator("li", { hasText: RECEIVED })).toBeVisible();
  await page.getByLabel("Cerca email").fill("nessuna-corrispondenza-xyz");
  await page.getByRole("button", { name: "Applica" }).click();
  await expect(page.getByText("Nessuna conversazione con questi filtri.")).toBeVisible();
  await page.goto("/email?cartella=tutte&collegamento=auto");
  const nAuto = Number(sql("select count(*) from public.email_threads where link_status = 'auto' and message_count > 0"));
  expect(nAuto).toBeGreaterThan(0);
  await expect(page.getByTestId("threads").locator("li")).toHaveCount(nAuto);
  await page.goto("/email?cartella=inviate");
  await expect(page.getByTestId("threads").locator("li", { hasText: RECEIVED })).toBeVisible(); // conversazione con un messaggio inviato
  await expect(page.getByTestId("threads").locator("li", { hasText: `Ambigua ${TAG}` })).toHaveCount(0); // solo conversazioni con messaggi inviati
  await page.goto("/email?cartella=arrivo&nonletti=1");
  for (const li of await page.getByTestId("threads").locator("li").all()) await expect(li).toHaveAttribute("data-unread", "true");
  await page.goto("/email?cartella=tutte&cliente=" + rossi());
  await expect(page.getByTestId("threads").locator("li", { hasText: RECEIVED })).toBeVisible();
});

test("invio di un preventivo per email: PDF allegato, collegamento al preventivo, stato aggiornato", async ({ page }) => {
  const o = org(), c = rossi();
  const q = first(sql(`insert into public.quotes (organization_id, customer_id, title) values ('${o}', '${c}', 'Preventivo da inviare') returning id`));
  sql(`insert into public.quote_items (organization_id, quote_id, description, quantity, unit_price_cents, vat_rate) values ('${o}', '${q}', 'Voce', 1, 100000, 22)`);
  const number = sql(`select number from public.quotes where id = '${q}'`);
  await page.goto(`/preventivi/${q}`);
  await page.getByRole("link", { name: "Invia per email" }).click();
  await expect(page.getByLabel("Oggetto")).toHaveValue(`Preventivo ${number}`);
  await expect(page.getByLabel("A", { exact: true })).toHaveValue(/mario@rossi-costruzioni\.it/);
  await expect(page.getByLabel(new RegExp(`Allega il PDF del preventivo ${number}`))).toBeChecked();
  await expect(page.getByTestId("editor")).toContainText(number);
  const before = eml().length;
  await page.getByRole("button", { name: "Invia", exact: true }).click();
  await page.waitForURL(/\/email\/[0-9a-f-]{36}\?inviata=1/, { timeout: 40_000 });
  const m = eml().slice(before);
  expect(m).toHaveLength(1);
  expect(m[0]!.text).toContain("application/pdf"); expect(m[0]!.text).toContain("filename=Preventivo-");
  expect(sql(`select status from public.quotes where id = '${q}'`)).toBe("sent");
  expect(sql(`select count(*) from public.email_threads where quote_id = '${q}' and customer_id = '${c}' and link_status = 'manual'`)).toBe("1");
  expect(sql(`select count(*) from public.email_attachments a join public.email_messages m on m.id = a.message_id where m.subject = 'Preventivo ${number}' and a.mime_type = 'application/pdf'`)).toBe("1");
  await page.goto(`/preventivi/${q}`);
  await expect(page.getByText("Inviato").first()).toBeVisible();
});

test("clienti archiviati: storico consultabile, nessuna nuova email dai selettori né collegamenti manuali", async ({ page }) => {
  const o = org();
  const c = first(sql(`insert into public.customers (organization_id, name, email) values ('${o}', 'Archiviato Email S.r.l.', 'arch@mail.it') returning id`));
  const subj = `Storico archiviato ${TAG}`;
  inject(subj, { from: "arch@mail.it" });
  await page.goto("/email"); await sync(page);
  sql(`update public.customers set archived_at = now() where id = '${c}'`);
  await page.goto(`/clienti/${c}?tab=documenti`);
  await expect(page.getByTestId("customer-emails")).toContainText(subj); // storico consultabile
  await page.goto(`/email/nuova?cliente=${c}`);
  await expect(page.getByText("Il cliente è archiviato: ripristinalo prima di scrivergli.")).toBeVisible();
  await page.goto(`/email/${threadId(`Sconosciuto ${TAG}`)}`);
  await expect(page.getByRole("form", { name: "Collega a un cliente" }).getByLabel("Cliente").locator("option", { hasText: "Archiviato Email" })).toHaveCount(0);
  await page.goto("/email/nuova");
  expect(await page.getByLabel("A", { exact: true }).inputValue()).toBe("");
});

test("pianificazione e analisi AI: endpoint protetto dal segreto; l'analisi propone soltanto", async ({ page, request }) => {
  expect((await request.get("http://127.0.0.1:3100/api/email/sync")).status()).toBe(401);
  expect((await request.get("http://127.0.0.1:3100/api/email/sync", { headers: { authorization: "Bearer sbagliato-sbagliato" } })).status()).toBe(401);
  const ok = await request.get("http://127.0.0.1:3100/api/email/sync", { headers: { authorization: "Bearer verify-cron-secret-123456" } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ accounts: expect.any(Number), imported: expect.any(Number) });
  const tasksBefore = sql("select count(*) from public.tasks");
  await page.goto(`/email/${threadId(`Ambigua ${TAG}`)}`);
  await page.getByRole("button", { name: "Analizza con l'AI" }).click();
  await expect(page.getByTestId("analysis-panel").getByText(/AI|modello|servizio|configurat/i).first()).toBeVisible({ timeout: 30_000 }); // senza chiave Gemini: errore chiaro, nessuna azione
  expect(sql("select count(*) from public.tasks")).toBe(tasksBefore);
});

test("permessi: il collaboratore non vede una casella riservata finché non è autorizzato", async ({ browser, page }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/member.json" });
  const m = await ctx.newPage();
  await m.goto("/email");
  await expect(m.getByText(/Nessuna casella collegata/)).toBeVisible();
  await expect(m.getByTestId("threads").locator("li", { hasText: RECEIVED })).toHaveCount(0);
  expect((await m.goto(`/email/${threadId(RECEIVED)}`))?.status()).toBe(404);
  await m.goto("/email/caselle");
  await expect(m.getByTestId("account")).toHaveCount(0);
  // il titolare autorizza la collaboratrice
  await page.goto("/email/caselle");
  const card = page.getByTestId("account").filter({ hasText: ADDR });
  await card.getByText("Impostazioni e collaboratori").click();
  await card.getByLabel("Aggiungi collaboratore").selectOption({ index: 1 });
  await card.getByRole("button", { name: "Autorizza" }).click();
  await expect(card.getByText("Collaboratore autorizzato")).toBeVisible();
  await m.goto("/email");
  await expect(m.getByTestId("threads").locator("li", { hasText: RECEIVED })).toBeVisible();
  // e la revoca toglie di nuovo l'accesso
  await page.goto("/email/caselle");
  await page.getByTestId("account").filter({ hasText: ADDR }).getByText("Impostazioni e collaboratori").click();
  await page.getByTestId("account").filter({ hasText: ADDR }).getByRole("button", { name: "Revoca" }).click();
  await expect.poll(() => sql("select count(*) from public.email_account_members")).toBe("0");
  await m.goto("/email");
  await expect(m.getByTestId("threads").locator("li", { hasText: RECEIVED })).toHaveCount(0);
  await ctx.close();
});

test("modelli: iniziali presenti, modificabili e usabili nella composizione (mai inviati da soli)", async ({ page }) => {
  await page.goto("/email/modelli");
  for (const n of ["Primo contatto", "Invio preventivo", "Follow-up dopo preventivo", "Richiesta di informazioni", "Risposta a un cliente", "Ringraziamento"]) await expect(page.getByRole("form", { name: `Modello ${n}` })).toBeVisible();
  const f = page.getByRole("form", { name: "Nuovo modello" });
  await f.getByLabel("Nome").fill(`Mio modello ${TAG}`); await f.getByLabel("Oggetto").fill("Saluti da {{azienda}}"); await f.getByLabel("Testo").fill("Ciao {{referente}},\n\ngrazie.");
  await f.getByRole("button", { name: "Salva modello" }).click();
  await expect(page.getByRole("form", { name: `Modello Mio modello ${TAG}` })).toBeVisible({ timeout: 15_000 });
  await page.goto(`/email/nuova?cliente=${rossi()}`);
  const before = eml().length;
  await page.getByLabel("Modello").selectOption({ label: `Mio modello ${TAG}` });
  await expect(page.getByLabel("Oggetto")).toHaveValue("Saluti da Azienda Prova S.r.l.");
  await expect(page.getByTestId("editor")).toContainText("Ciao Mario Rossi");
  expect(eml().length).toBe(before); // il modello compila soltanto, non invia
});

test("disconnessione: credenziali eliminate, nessun invio possibile, storico conservato", async ({ page }) => {
  await page.goto("/email/caselle");
  const card = page.getByTestId("account").filter({ hasText: ADDR });
  page.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Disconnetti" }).click();
  await expect(card).toContainText("Disconnessa");
  expect(sql("select count(*) from private.email_account_secrets")).toBe("0");
  expect(sql("select status from public.email_accounts")).toBe("disconnected");
  expect(Number(sql("select count(*) from public.email_messages"))).toBeGreaterThan(3); // lo storico resta
  await page.goto("/email/nuova");
  await expect(page.getByText(/Nessuna casella collegata e pronta all'invio/)).toBeVisible();
  await page.goto(`/email/${threadId(RECEIVED)}`);
  await expect(page.getByTestId("message").first()).toBeVisible();
});
