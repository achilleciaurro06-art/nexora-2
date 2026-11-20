import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

test.use({ storageState: "e2e/.auth/owner.json" });
test.describe.configure({ mode: "serial" });

let customerUrl = "";
let quoteUrl = "";
let quoteNumber = "";

const form = (page: Page, buttonName: string) => page.locator("form").filter({ has: page.getByRole("button", { name: buttonName }) });

test("creazione di un cliente", async ({ page }) => {
  await page.goto("/clienti/nuovo");
  await page.getByLabel("Ragione sociale / Nome *").fill("Rossi Costruzioni S.r.l.");
  await page.getByLabel("Partita IVA").fill("01234567890");
  await page.getByLabel("Email").fill("info@rossi-costruzioni.it");
  await page.getByLabel("Telefono").fill("011 1234567");
  await page.getByLabel("Città").fill("Torino");
  await page.getByRole("button", { name: "Salva" }).click();
  await expect(page).toHaveURL(/\/clienti\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Rossi Costruzioni S.r.l." })).toBeVisible();
  customerUrl = page.url();
});

test("referenti: aggiunta, modifica, note e timeline filtrabile", async ({ page }) => {
  await page.goto(`${customerUrl}?tab=referenti`);
  const add = form(page, "Aggiungi referente");
  await add.getByLabel("Nuovo referente").fill("Mario Rossi");
  await add.getByLabel("Ruolo").fill("Titolare");
  await add.getByLabel("Email").fill("mario@rossi-costruzioni.it");
  await add.getByRole("button", { name: "Aggiungi referente" }).click();
  await expect(page.getByText("Mario Rossi").first()).toBeVisible();

  await page.getByText("Modifica", { exact: true }).first().click();
  const edit = page.locator("details form").first();
  await edit.getByLabel("Telefono").fill("333 9876543");
  await edit.getByRole("button", { name: "Salva" }).click();
  await expect(page.getByText(/333 9876543/)).toBeVisible();

  await page.goto(`${customerUrl}?tab=documenti`);
  const note = form(page, "Aggiungi nota");
  await note.getByLabel("Nuova nota").fill("Chiamato oggi: interessato a 3 serramenti.");
  await note.getByRole("button", { name: "Aggiungi nota" }).click();
  await expect(page.getByText("Chiamato oggi: interessato a 3 serramenti.")).toBeVisible();

  const timeline = page.locator("#timeline");
  await expect(timeline.getByText("Cliente creato")).toBeVisible();
  await expect(timeline.getByText("Referente aggiunto: Mario Rossi")).toBeVisible();
  await expect(timeline.getByText("Nota aggiunta")).toBeVisible();
  await timeline.getByRole("link", { name: "Note", exact: true }).click();
  await expect(page).toHaveURL(/tl=note/);
  await expect(page.locator("#timeline").getByText("Nota aggiunta")).toBeVisible();
  await expect(page.locator("#timeline").getByText("Cliente creato")).toHaveCount(0);
});

test("preventivo: righe, sconto, IVA, totali e numerazione", async ({ page }) => {
  const id = customerUrl.split("/").pop();
  await page.goto(`/preventivi/nuovo?cliente=${id}`);
  await page.getByLabel("Oggetto").fill("Fornitura serramenti");
  const row = page.locator("div.grid").filter({ has: page.getByLabel("Descrizione") }).first();
  await row.getByLabel("Descrizione").fill("Serramento in PVC 120x140");
  await row.getByLabel("Quantità").fill("2");
  await row.getByLabel("Prezzo").fill("500");
  await row.getByLabel("Sconto").fill("10");
  await row.getByLabel("IVA").fill("22");
  await expect(page.getByText(/1\.098,00/)).toBeVisible(); // (2 x 500) - 10% = 900 + IVA 198
  await page.getByRole("button", { name: "Salva preventivo" }).click();
  await expect(page).toHaveURL(/\/preventivi\/[0-9a-f-]{36}$/);
  quoteUrl = page.url();
  const heading = await page.getByRole("heading", { level: 1 }).textContent();
  quoteNumber = /Preventivo (\d{4}\/\d{4})/.exec(heading ?? "")?.[1] ?? "";
  expect(quoteNumber).toMatch(/^\d{4}\/0001$/);
  await expect(page.getByText(/1\.098,00/).first()).toBeVisible();
  await expect(page.getByText("Bozza").first()).toBeVisible();
});

test("PDF: scarica un file vero, senza finestra di stampa", async ({ page }) => {
  await page.goto(quoteUrl);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Scarica PDF" }).click()]);
  expect(download.suggestedFilename()).toBe(`Preventivo-${quoteNumber.replace("/", "-")}.pdf`);
  const path = await download.path();
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1500);
});

test("cambio di stato e blocco della modifica dopo l'invio", async ({ page }) => {
  await page.goto(quoteUrl);
  await page.getByRole("button", { name: "Segna inviato" }).click();
  await expect(page.getByText("Inviato").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Modifica" })).toHaveCount(0);
  await page.goto(`${quoteUrl}/modifica`);
  await expect(page).toHaveURL(quoteUrl); // non più modificabile: rimanda alla scheda
});

test("attività collegata al preventivo, completamento e riapertura", async ({ page }) => {
  await page.goto(quoteUrl);
  await page.getByRole("link", { name: "Crea attività" }).click();
  await expect(page.getByLabel("Titolo *")).toHaveValue(`Follow-up preventivo ${quoteNumber}`);
  await page.locator("#dueDate").fill("2026-12-20");
  await page.getByLabel("Priorità").selectOption("high");
  await page.getByRole("button", { name: "Crea attività" }).click();
  await expect(page).toHaveURL(/\/attivita\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("link", { name: /Preventivo \d{4}\/0001/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Cliente: Rossi Costruzioni/ })).toBeVisible();

  await page.getByRole("button", { name: "Segna come completata" }).click();
  await expect(page.getByText("Completata").first()).toBeVisible();
  await page.getByRole("button", { name: "Riapri" }).click();
  await expect(page.getByText("Da fare").first()).toBeVisible();

  await page.goto("/attivita");
  await expect(page.getByRole("heading", { name: /Imminenti/ })).toBeVisible();
  await expect(page.getByRole("link", { name: `Follow-up preventivo ${quoteNumber}`, exact: true })).toBeVisible();

  await page.goto(`${customerUrl}?tab=attivita`);
  await expect(page.getByRole("link", { name: `Follow-up preventivo ${quoteNumber}`, exact: true })).toBeVisible(); // attività visibile nella scheda cliente
});

test("la dashboard riflette i dati reali inseriti", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Preventivi in attesa")).toBeVisible();
  await expect(page.getByText(/1\.098,00/).first()).toBeVisible();
  await expect(page.getByText("Clienti").first()).toBeVisible();
});
