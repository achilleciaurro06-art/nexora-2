import { expect, test, type Browser } from "@playwright/test";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { ADMIN, quoteStep } from "./helpers";

test.use({ storageState: "e2e/.auth/owner.json" });
test.describe.configure({ mode: "serial" });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4EIwESMolGFDAwANBABAg6C0lUAAAAASUVORK5CYII=", "base64");
const MEMBER = { email: "collaboratore@azienda-prova.it", password: "Collab-di-prova-123", name: "Lucia Collaboratrice" };
let inviteLink = "";
let quoteUrl = "";

async function newMemberPage(browser: Browser) {
  const ctx = await browser.newContext({ locale: "it-IT", storageState: { cookies: [], origins: [] } });
  return { ctx, page: await ctx.newPage() };
}

test("impostazioni aziendali: salvataggio e persistenza", async ({ page }) => {
  await page.goto("/impostazioni");
  await expect(page).toHaveURL(/\/impostazioni\/azienda/);
  await page.getByLabel("Indirizzo (sede operativa)").fill("Via Roma 1, 10100 Torino (TO)");
  await page.getByLabel("Codice fiscale").fill("01234567890");
  await page.getByLabel("Email", { exact: true }).fill("info@azienda-prova.it");
  await page.getByLabel("Telefono").fill("011 5550000");
  await page.getByLabel("Sito web").fill("https://www.azienda-prova.it");
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(page.getByText("Dati aziendali salvati")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Indirizzo (sede operativa)")).toHaveValue("Via Roma 1, 10100 Torino (TO)");

  await page.goto("/impostazioni/preventivi");
  await page.getByLabel("Condizioni commerciali predefinite").fill("Validità 30 giorni. Pagamento 50% all'ordine.");
  await page.getByLabel("Informazioni a piè dei preventivi (PDF)").fill("Bonifico: IBAN IT60X0542811101000000123456");
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(page.getByText("Impostazioni dei preventivi salvate")).toBeVisible();
});

test("le condizioni predefinite precompilano i nuovi preventivi", async ({ page }) => {
  await page.goto("/preventivi/nuovo");
  await expect(page.getByLabel("Condizioni")).toHaveValue(/Validità 30 giorni/);
});

test("logo: caricamento (storage), anteprima e PDF ancora valido; file non immagine rifiutato", async ({ page }) => {
  await page.goto("/impostazioni/azienda");
  await page.locator("#logo").setInputFiles({ name: "finto.png", mimeType: "image/png", buffer: Buffer.from("non sono un'immagine") });
  await page.getByRole("button", { name: "Carica logo" }).click();
  await expect(page.getByText("Il file non è un'immagine valida")).toBeVisible();

  await page.locator("#logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Carica logo" }).click();
  await expect(page.getByText("Logo aggiornato")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("img", { name: /Logo di/ })).toBeVisible();

  await page.goto("/preventivi");
  await page.getByRole("link", { name: /^\d{4}\/0001$/ }).click();
  await page.waitForURL(/\/preventivi\/[0-9a-f-]{36}$/);
  quoteUrl = page.url();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Scarica PDF" }).click()]);
  expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("documenti: upload, anti-duplicato, ricerca, filtri, metadati, download ed eliminazione", async ({ page }) => {
  await page.goto("/documenti");
  const file = { name: "capitolato.txt", mimeType: "text/plain", buffer: Buffer.from("Capitolato lavori — 3 serramenti PVC") };
  await page.locator("#file").setInputFiles(file);
  await page.getByRole("button", { name: "Carica", exact: true }).click();
  await expect(page.getByText("Documento caricato")).toBeVisible();
  await expect(page.getByRole("link", { name: "capitolato.txt" })).toBeVisible();

  await page.locator("#file").setInputFiles(file);
  await page.getByRole("button", { name: "Carica", exact: true }).click();
  await expect(page.getByText(/già in archivio/)).toBeVisible();

  await page.getByRole("searchbox", { name: "Cerca documenti" }).or(page.getByLabel("Cerca documenti")).fill("capitolato");
  await page.getByRole("button", { name: "Cerca" }).click();
  await expect(page.getByRole("link", { name: "capitolato.txt" })).toBeVisible();
  await page.goto("/documenti?tipo=pdf");
  await expect(page.getByText(/Nessun documento/)).toBeVisible();
  await page.goto("/documenti?tipo=other");
  await expect(page.getByRole("link", { name: "capitolato.txt" })).toBeVisible();

  await page.getByRole("link", { name: "capitolato.txt" }).click();
  await page.getByLabel("Nome").fill("capitolato-rossi.txt");
  await page.getByLabel("Descrizione").fill("Capitolato del cantiere di via Po");
  await page.getByLabel("Cliente collegato").selectOption({ label: "Rossi Costruzioni S.r.l." });
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(page.getByText("Salvato")).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Scarica" }).first().click()]);
  expect(readFileSync(await download.path()).toString()).toContain("Capitolato lavori");

  await page.goto("/documenti");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Elimina" }).click();
  await expect(page.getByText(/Nessun documento/)).toBeVisible();
});

test("analisi AI di un Word senza chiave configurata: errore chiaro, nessun blocco", async ({ page }) => {
  const zip = new JSZip();
  zip.file("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>Preventivo per Bianchi Srl: 2 porte, 300 euro</w:t></w:r></w:p></w:body></w:document>");
  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  await page.goto("/documenti");
  await page.locator("#file").setInputFiles({ name: "richiesta.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer });
  await page.getByRole("button", { name: "Carica", exact: true }).click();
  await expect(page.getByText("Documento caricato")).toBeVisible();
  await page.getByRole("button", { name: "Analizza con AI" }).click();
  await expect(page.getByText(/non è configurato correttamente/)).toBeVisible();
});

test("Copilot senza chiave: errore visibile, domanda ripristinata, interfaccia non bloccata", async ({ page }) => {
  // lo stack di verifica usa il provider simulato: «@@nokey» riproduce lo stesso errore di autenticazione che il provider reale produce senza chiave
  const q = "Quali preventivi sono in attesa? @@nokey";
  await page.goto("/copilot");
  await page.getByLabel("Domanda").fill(q);
  await page.getByRole("button", { name: "Invia" }).click();
  await expect(page.getByText(/non è configurato correttamente/)).toBeVisible();
  await expect(page.getByLabel("Domanda")).toHaveValue(q);
  await expect(page.getByRole("button", { name: "Invia" })).toBeEnabled();
});

test("analisi dei prezzi senza storico: dichiara i dati insufficienti, senza inventare", async ({ page }) => {
  await page.goto(quoteUrl);
  await page.getByRole("button", { name: /Analizza i prezzi/ }).click();
  await expect(page.getByText("Dati insufficienti")).toBeVisible();
  await expect(page.getByText(/Nessuna voce simile nello storico/).first()).toBeVisible();
  await expect(page.getByText("Prezzo suggerito")).toHaveCount(0);
});

test("team: invito di un collaboratore e accettazione", async ({ page, browser }) => {
  await page.goto("/organizzazione"); // reindirizza alle Impostazioni → Team
  await expect(page).toHaveURL(/\/impostazioni\/team/);
  await page.getByLabel("Email da invitare").fill(MEMBER.email);
  await page.getByLabel("Ruolo").selectOption("member");
  await page.getByRole("button", { name: "Crea invito" }).click();
  const box = page.getByRole("status").filter({ hasText: "Invito creato" });
  await expect(box).toBeVisible();
  inviteLink = ((await box.locator("code").textContent()) ?? "").trim();
  expect(inviteLink).toContain("/invito/");

  const { ctx, page: p } = await newMemberPage(browser);
  await p.goto(inviteLink.replace(/^https?:\/\/[^/]+/, ""));
  await p.getByLabel("Il tuo nome").fill(MEMBER.name);
  await p.getByLabel("Email invitata").fill(MEMBER.email);
  await p.getByLabel(/^Password/).fill(MEMBER.password);
  await p.getByRole("button", { name: "Accetta invito" }).click();
  await expect(p).toHaveURL(/\/dashboard/);
  await ctx.storageState({ path: "e2e/.auth/member.json" });
  await ctx.close();
});

test("il collaboratore (ruolo membro) non vede né può usare le funzioni riservate", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/member.json", locale: "it-IT" });
  const p = await ctx.newPage();
  await p.goto("/clienti");
  await expect(p.getByRole("button", { name: "Elimina" })).toHaveCount(0);
  await p.goto("/preventivi");
  await expect(p.getByRole("button", { name: "Elimina" })).toHaveCount(0);
  await p.goto("/impostazioni/team");
  await expect(p.getByLabel("Email da invitare")).toHaveCount(0);
  await p.goto("/impostazioni/azienda");
  await expect(p.getByLabel("Indirizzo (sede operativa)")).toBeDisabled();
  await expect(p.getByRole("button", { name: "Salva", exact: true })).toHaveCount(0);
  const res = await p.goto("/admin");
  expect(res?.status()).toBe(404);
  await ctx.close();
});

test("attività assegnata al collaboratore: notifica interna", async ({ page, browser }) => {
  await page.goto("/attivita/nuova");
  await page.getByLabel("Titolo *").fill("Preparare il sopralluogo da Rossi");
  await page.getByLabel("Assegnata a").selectOption({ label: MEMBER.name });
  await page.locator("#dueDate").fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Crea attività" }).click();
  await expect(page).toHaveURL(/\/attivita\/[0-9a-f-]{36}$/);

  const ctx = await browser.newContext({ storageState: "e2e/.auth/member.json", locale: "it-IT" });
  const p = await ctx.newPage();
  await p.goto("/dashboard");
  await expect(p.getByRole("link", { name: /Notifiche: \d+ non lett/ })).toBeVisible();
  await p.goto("/notifiche");
  await expect(p.getByText("Ti è stata assegnata un'attività: Preparare il sopralluogo da Rossi")).toBeVisible();
  await p.getByRole("button", { name: "Segna tutte come lette" }).click();
  await expect(p.getByRole("link", { name: "Notifiche", exact: true })).toBeVisible();
  await ctx.close();
});

test("archiviazione di un cliente dalla lista: tutto resta conservato", async ({ page }) => {
  // cliente con un preventivo ACCETTATO e uno in BOZZA
  await page.goto("/clienti/nuovo");
  await page.getByLabel("Ragione sociale / Nome *").fill("Verdi Infissi S.n.c.");
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  await page.waitForURL(/\/clienti\/[0-9a-f-]{36}$/);
  const customerId = page.url().split("/").pop();
  for (const title of ["Preventivo accettato", "Preventivo in bozza"]) {
    await page.goto(`/preventivi/nuovo?cliente=${customerId}`);
    await page.getByLabel("Oggetto").fill(title);
    await quoteStep(page, "Prodotti e servizi");
    await page.getByLabel("Descrizione").first().fill("Voce di prova");
    await page.getByLabel("Prezzo").first().fill("100");
    await quoteStep(page, "Riepilogo");
    await page.getByRole("button", { name: "Salva preventivo" }).click();
    await expect(page).toHaveURL(/\/preventivi\/[0-9a-f-]{36}$/);
    if (title === "Preventivo accettato") {
      await page.getByRole("button", { name: "Segna inviato" }).click();
      await page.getByRole("button", { name: "Segna fatto" }).click();
      await expect(page.locator("[data-status='accepted']").first()).toContainText("Fatto");
    }
  }
  await page.goto("/clienti");
  const row = page.getByRole("row").filter({ hasText: "Verdi Infissi" });
  let message = "";
  page.once("dialog", async (d) => { message = d.message(); await d.accept(); });
  await row.getByRole("button", { name: "Archivia" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Verdi Infissi" })).toHaveCount(0);
  expect(message).toContain("restano conservati");

  await page.goto("/preventivi");
  await expect(page.getByText("Preventivo in bozza")).toBeVisible(); // nulla viene rimosso
  await expect(page.getByText("Verdi Infissi S.n.c. (cliente archiviato)").first()).toBeVisible();
});

test("rimozione di un preventivo dalla lista", async ({ page }) => {
  await page.goto("/preventivi");
  const rows = page.getByRole("row").filter({ hasText: "Rossi Costruzioni" });
  const before = await rows.count();
  page.once("dialog", (d) => d.accept());
  await rows.first().getByRole("button", { name: "Elimina" }).click();
  await expect(rows).toHaveCount(before - 1);
});

test("registro delle operazioni: il titolare vede tutto, il collaboratore solo le proprie", async ({ page, browser }) => {
  // il collaboratore compie un'operazione tracciata (creare un'attività)
  const mctx = await browser.newContext({ storageState: "e2e/.auth/member.json", locale: "it-IT" });
  const m = await mctx.newPage();
  await m.goto("/attivita/nuova");
  await m.getByLabel("Titolo *").fill("Attività creata dalla collaboratrice");
  await m.getByRole("button", { name: "Crea attività" }).click();
  await expect(m).toHaveURL(/\/attivita\/[0-9a-f-]{36}$/);

  await page.goto("/organizzazione/audit");
  await expect(page.getByRole("cell", { name: "Mario Titolare" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Lucia Collaboratrice" }).first()).toBeVisible();
  await page.getByRole("navigation", { name: "Filtra per tipo" }).getByRole("link", { name: "Preventivi" }).click();
  await expect(page).toHaveURL(/entity=quotes/);
  await expect(page.getByRole("cell", { name: "Preventivi" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Clienti", exact: true })).toHaveCount(0); // il filtro esclude le altre entità

  await m.goto("/organizzazione/audit");
  await expect(m.getByRole("cell", { name: "Lucia Collaboratrice" }).first()).toBeVisible();
  await expect(m.getByRole("cell", { name: "Mario Titolare" })).toHaveCount(0);
  await mctx.close();
});

test("dashboard: filtro per periodo e sezioni di andamento", async ({ page }) => {
  await page.goto("/dashboard?range=30");
  await expect(page.getByRole("heading", { name: "Andamento commerciale" })).toBeVisible();
  await expect(page.getByRole("link", { name: "30 giorni" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByText("Clienti da ricontattare")).toBeVisible();
  await expect(page.getByText("Ultime operazioni")).toBeVisible();
});

test("console di piattaforma: quota AI e registro delle azioni; nessun dato commerciale", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "it-IT", storageState: { cookies: [], origins: [] } }); // sessione pulita (non quella del titolare)
  const p = await ctx.newPage();
  await p.goto("/login");
  await p.getByLabel("Email").fill(ADMIN.email);
  await p.getByLabel("Password").fill(ADMIN.password);
  await p.getByRole("button", { name: "Accedi" }).click();
  await expect(p).toHaveURL(/\/admin/);
  const quota = p.getByLabel(/Limite token Azienda Prova/);
  await quota.fill("500000");
  await quota.locator("xpath=ancestor::form").getByRole("button", { name: "Salva", exact: true }).click();
  await expect(p.getByRole("cell", { name: "set_ai_quota" }).first()).toBeVisible();
  await expect(p.getByText("Rossi Costruzioni")).toHaveCount(0); // nessun dato commerciale delle aziende
  // uscita dalla console: si torna al login e la sessione è chiusa (nessun rientro automatico in /admin)
  await p.getByTestId("admin-logout").click();
  await expect(p).toHaveURL(/\/login/);
  await p.goto("/admin");
  await expect(p).toHaveURL(/\/login/);
  await ctx.close();
});
