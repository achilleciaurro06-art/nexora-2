import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

test.use({ storageState: "e2e/.auth/owner.json" });
test.describe.configure({ mode: "serial" });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4EIwESMolGFDAwANBABAg6C0lUAAAAASUVORK5CYII=", "base64");
const save = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "Salva", exact: true }).click();

test("navigazione tra le otto sezioni e reindirizzamento della vecchia pagina", async ({ page }) => {
  await page.goto("/impostazioni");
  const nav = page.getByRole("navigation", { name: "Sezioni delle impostazioni" });
  for (const label of ["Azienda", "Profilo", "Team", "Preventivi", "Notifiche", "AI", "Email", "Aspetto"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("navigation", { name: "Principale" }).getByRole("link", { name: "Organizzazione" })).toHaveCount(0);
  await page.goto("/organizzazione");
  await expect(page).toHaveURL(/\/impostazioni\/team/);
});

test("azienda: IBAN controllato, PEC e dati bancari salvati e riportati nel PDF", async ({ page }) => {
  await page.goto("/impostazioni/azienda");
  await page.getByLabel("PEC").fill("azienda-prova@pec.it");
  await page.getByLabel("Sede legale (se diversa)").fill("Corso Legale 10, 20100 Milano");
  await page.getByLabel("Banca").fill("Banca di Prova");
  await page.getByLabel("IBAN").fill("IT60X0542811101000000123457"); // cifra di controllo errata
  await save(page);
  await expect(page.getByText(/IBAN non valido/)).toBeVisible();
  await page.getByLabel("IBAN").fill("it60 x054 2811 1010 0000 0123 456");
  await save(page);
  await expect(page.getByText("Dati aziendali salvati")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("IBAN")).toHaveValue("IT60 X054 2811 1010 0000 0123 456"); // normalizzato

  await page.goto("/preventivi");
  await page.getByRole("link", { name: /^\d{4}\/\d{4}$/ }).first().click();
  await page.waitForURL(/\/preventivi\/[0-9a-f-]{36}$/);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Scarica PDF" }).click()]);
  const file = (await download.path()) + ".pdf";
  writeFileSync(file, readFileSync(await download.path()));
  const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  expect(text).toContain("azienda-prova@pec.it");
  expect(text).toContain("Sede legale: Corso Legale 10, 20100 Milano");
  expect(text).toContain("IBAN IT60 X054 2811 1010 0000 0123 456");
  expect(text).toContain("Banca di Prova");
});

test("preventivi: IVA e validità predefinite applicate ai nuovi preventivi", async ({ page }) => {
  await page.goto("/impostazioni/preventivi");
  await page.getByLabel("Aliquota IVA predefinita (%)").fill("10");
  await page.getByLabel("Validità predefinita (giorni)").fill("15");
  await save(page);
  await expect(page.getByText("Impostazioni dei preventivi salvate")).toBeVisible();

  await page.goto("/preventivi/nuovo");
  await expect(page.getByLabel("IVA")).toHaveValue("10");
  const expected = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
  await expect(page.getByLabel("Valido fino al")).toHaveValue(expected);
  await page.getByRole("button", { name: "Aggiungi riga" }).click();
  await expect(page.getByLabel("IVA").nth(1)).toHaveValue("10");

  await page.goto("/impostazioni/preventivi");
  const vat = page.getByLabel("Aliquota IVA predefinita (%)");
  await vat.fill("150");
  await save(page);
  expect(await vat.evaluate((el: HTMLInputElement) => el.validity.rangeOverflow)).toBe(true); // il browser blocca l'invio
  await expect(page.getByText("Impostazioni dei preventivi salvate")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Aliquota IVA predefinita (%)")).toHaveValue("10"); // nulla è stato salvato
  await page.getByLabel("Aliquota IVA predefinita (%)").fill("22");
  await save(page);
  await expect(page.getByText("Impostazioni dei preventivi salvate")).toBeVisible();
});

test("profilo: nome, ruolo in azienda, immagine visibile in barra laterale", async ({ page }) => {
  await page.goto("/impostazioni/profilo");
  await page.getByLabel("Ruolo in azienda").fill("Responsabile commerciale");
  await save(page);
  await expect(page.getByText("Profilo salvato")).toBeVisible();

  await page.locator("#avatar").setInputFiles({ name: "falso.png", mimeType: "image/png", buffer: Buffer.from("non un'immagine") });
  await page.getByRole("button", { name: "Carica immagine" }).click();
  await expect(page.getByText("Il file non è un'immagine valida")).toBeVisible();
  await page.locator("#avatar").setInputFiles({ name: "io.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await page.getByRole("button", { name: "Carica immagine" }).click();
  await expect(page.getByText(/deve essere PNG, JPEG o WebP/)).toBeVisible();

  await page.locator("#avatar").setInputFiles({ name: "io.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Carica immagine" }).click();
  await expect(page.getByText("Immagine aggiornata")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "Il tuo profilo" }).locator("img")).toBeVisible();

  await page.goto("/impostazioni/team");
  await expect(page.getByText("Responsabile commerciale")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ruoli e permessi" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Invitare e gestire i collaboratori e i loro ruoli" })).toBeVisible();
});

test("notifiche: preferenze personali salvate e rilette", async ({ page }) => {
  await page.goto("/impostazioni/notifiche");
  await page.getByLabel("Attività assegnate a me").uncheck();
  await page.getByLabel(/Avvisami delle scadenze/).fill("6");
  await save(page);
  await expect(page.getByText("Preferenze di notifica salvate")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Attività assegnate a me")).not.toBeChecked();
  await expect(page.getByLabel("Attività scadute")).toBeChecked();
  await expect(page.getByLabel(/Avvisami delle scadenze/)).toHaveValue("6");
  await page.getByLabel(/Avvisami delle scadenze/).fill("999");
  await save(page);
  await expect(page.getByText(/Da 1 a 168 ore/).first()).toBeVisible();
});

test("AI: stile e contesto aziendale salvati; utilizzo e limiti visibili", async ({ page }) => {
  await page.goto("/impostazioni/ai");
  await page.getByLabel("Stile delle risposte").selectOption("detailed");
  await page.getByLabel(/Informazioni sull'azienda utili all'AI/).fill("Azienda di serramenti di Torino, clienti soprattutto imprese edili.");
  await save(page);
  await expect(page.getByText("Preferenze AI salvate")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Stile delle risposte")).toHaveValue("detailed");
  await expect(page.getByLabel(/Informazioni sull'azienda utili all'AI/)).toHaveValue(/serramenti di Torino/);
  await expect(page.getByRole("progressbar", { name: "Quota AI utilizzata" })).toBeVisible();
  await expect(page.getByText(/Il limite è stabilito dal gestore della piattaforma/)).toBeVisible();
});

test("email e aspetto: preferenze salvate; il periodo predefinito guida la dashboard", async ({ page }) => {
  await page.goto("/impostazioni/email");
  await page.getByLabel("Nome del mittente").fill("Azienda Prova — Ufficio commerciale");
  await page.getByLabel("Firma").fill("Cordiali saluti,\nMario Titolare");
  await save(page);
  await expect(page.getByText("Preferenze email salvate")).toBeVisible();
  const reply = page.getByLabel("Indirizzo per le risposte");
  await reply.fill("non-una-email");
  await save(page);
  expect(await reply.evaluate((el: HTMLInputElement) => el.validity.typeMismatch)).toBe(true); // il browser blocca l'invio
  await reply.fill("");

  await page.goto("/impostazioni/aspetto");
  await page.getByLabel("Periodo predefinito della dashboard").selectOption("30");
  await save(page);
  await expect(page.getByText("Preferenze salvate")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "30 giorni" })).toHaveAttribute("aria-current", "true");
  await page.goto("/dashboard?range=all");
  await expect(page.getByRole("link", { name: "Tutto" })).toHaveAttribute("aria-current", "true");
});

test("il collaboratore modifica il proprio profilo e le proprie preferenze, non quelle aziendali", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/member.json", locale: "it-IT" });
  const p = await ctx.newPage();
  await p.goto("/impostazioni/profilo");
  await p.getByLabel("Ruolo in azienda").fill("Tecnico di cantiere");
  await p.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(p.getByText("Profilo salvato")).toBeVisible();
  await p.goto("/impostazioni/notifiche");
  await expect(p.getByLabel("Attività scadute")).toBeEnabled();
  await p.goto("/impostazioni/preventivi");
  await expect(p.getByLabel("Aliquota IVA predefinita (%)")).toBeDisabled();
  await p.goto("/impostazioni/ai");
  await expect(p.getByLabel("Stile delle risposte")).toBeDisabled();
  await ctx.close();
});
