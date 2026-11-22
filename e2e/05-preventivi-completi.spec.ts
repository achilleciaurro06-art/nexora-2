import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { quoteStep, sql } from "./helpers";

test.use({ storageState: "e2e/.auth/owner.json" });
test.describe.configure({ mode: "serial" });

let quoteUrl = "";
let numberBefore = "";
let draftUrl = "";

test("badge di stato colorato in lista e nella scheda", async ({ page }) => {
  // garantisce un preventivo di un cliente attivo (le prove precedenti possono averli rimossi o archiviati)
  const o = sql("select id from public.organizations where name = 'Azienda Prova S.r.l.'");
  const c = sql(`select id from public.customers where name = 'Rossi Costruzioni S.r.l.'`);
  if (sql(`select count(*) from public.quotes where customer_id = '${c}' and deleted_at is null`) === "0") {
    const q = sql(`insert into public.quotes (organization_id, customer_id, title) values ('${o}', '${c}', 'Preventivo di prova') returning id`).split("\n")[0];
    sql(`insert into public.quote_items (organization_id, quote_id, description, quantity, unit_price_cents, vat_rate) values ('${o}', '${q}', 'Voce di prova', 1, 100000, 22)`);
  }
  await page.goto("/preventivi");
  const badge = page.locator("[data-status]").first();
  await expect(badge).toBeVisible();
  const status = await badge.getAttribute("data-status");
  expect(status).toBeTruthy();
  const bg = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  await page.getByRole("row").filter({ hasText: "Rossi Costruzioni" }).getByRole("link", { name: /^\d{4}\/\d{4}$/ }).first().click();
  await page.waitForURL(/\/preventivi\/[0-9a-f-]{36}$/);
  quoteUrl = page.url();
  numberBefore = /Preventivo (\S+)/.exec((await page.getByRole("heading", { level: 1 }).textContent()) ?? "")?.[1] ?? "";
  await expect(page.locator("[data-status]").first()).toBeVisible();
});

test("impostazioni: numerazione personalizzata con anteprima e prossimo numero", async ({ page }) => {
  await page.goto("/impostazioni/preventivi");
  await expect(page.getByTestId("numbering-example")).toHaveText(/^\d{4}\/0001$/);
  await page.getByLabel("Prefisso").fill("a b");
  await page.getByRole("button", { name: "Salva numerazione" }).click();
  await expect(page.getByText(/Prefisso: solo lettere/)).toBeVisible();
  await page.getByLabel("Prefisso").fill("PRV-");
  await page.getByLabel("Cifre del progressivo").fill("5");
  await page.getByLabel(/Includi l.anno/).uncheck();
  await page.getByRole("button", { name: "Salva numerazione" }).click();
  await expect(page.getByText("Numerazione salvata")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("numbering-example")).toHaveText("PRV-00001");
  await page.getByLabel("Prossimo numero progressivo").fill("250");
  await page.getByRole("button", { name: "Imposta" }).click();
  await expect(page.getByText(/numero progressivo 250/)).toBeVisible();
});

test("duplicazione: nuova bozza con il nuovo schema di numerazione, righe copiate, originale intatto", async ({ page }) => {
  await page.goto(quoteUrl);
  await page.getByRole("button", { name: "Duplica", exact: true }).click();
  await page.waitForURL(/\/preventivi\/[0-9a-f-]{36}\/modifica$/);
  const newId = page.url().split("/").slice(-2)[0];
  await expect(page.getByLabel("Descrizione").first()).not.toHaveValue("");
  await page.goto(`/preventivi/${newId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Preventivo PRV-00250");
  await expect(page.locator("[data-status]").first()).toHaveAttribute("data-status", "draft");
  const orig = sql(`select total_cents from public.quotes where id = '${quoteUrl.split("/").pop()}'`);
  const dup = sql(`select total_cents from public.quotes where id = '${newId}'`);
  expect(dup).toBe(orig);
  await page.goto(quoteUrl);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Preventivo ${numberBefore}`);
});

test("storico modifiche: ogni salvataggio con differenze produce una revisione leggibile", async ({ page }) => {
  await page.goto("/preventivi?status=draft");
  await page.getByRole("link", { name: /^PRV-00250$/ }).click();
  await page.waitForURL(/\/preventivi\/[0-9a-f-]{36}$/);
  const url = page.url();
  draftUrl = url;
  const card = page.getByTestId("revisions-card");
  await expect(card.getByText("Preventivo creato")).toBeVisible();
  await page.goto(`${url}/modifica`);
  await page.getByLabel("Oggetto").fill("Oggetto cambiato");
  await quoteStep(page, "Riepilogo");
  await page.getByRole("button", { name: "Salva preventivo" }).click();
  await page.waitForURL(url);
  await expect(page.getByTestId("revisions-card").getByText(/Modificato:.*oggetto/)).toBeVisible();
  const before = await page.getByTestId("revisions-card").locator("li").count();
  await page.goto(`${url}/modifica`);
  await quoteStep(page, "Riepilogo");
  await page.getByRole("button", { name: "Salva preventivo" }).click(); // nessuna differenza
  await page.waitForURL(url);
  await expect(page.getByTestId("revisions-card").locator("li")).toHaveCount(before);
});

test("fatturato registrato: solo su preventivi accettati, distinto dal valore, con totale e rimozione", async ({ page }) => {
  await page.goto(draftUrl);
  await expect(page.getByTestId("billing-card")).toHaveCount(0); // bozza: nessun fatturato
  await page.getByRole("button", { name: "Segna inviato" }).click();
  await expect(page.getByText("Inviato").first()).toBeVisible();
  await expect(page.getByTestId("billing-card")).toHaveCount(0); // inviato: ancora no
  await page.getByRole("button", { name: "Segna accettato" }).click();
  const card = page.getByTestId("billing-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("billed-total")).toHaveText(/0,00/);
  await card.getByLabel(/Numero fattura/).fill("FT-2026-9");
  await card.getByLabel(/Imponibile/).fill("0");
  await card.getByRole("button", { name: "Registra fattura" }).click();
  await expect(card.getByText("Imponibile non valido")).toBeVisible();
  await card.getByLabel(/Imponibile/).fill("300,50");
  await expect(card.getByTestId("invoice-preview")).toContainText("366,61"); // 300,50 + IVA 22%
  await card.getByRole("button", { name: "Registra fattura" }).click();
  await expect(card.getByTestId("billed-total")).toHaveText(/366,61/);
  await expect(card.getByText(/FT-2026-9/)).toBeVisible();
  await page.goto("/dashboard?range=all");
  await expect(page.getByText("Fatturato registrato", { exact: true })).toBeVisible();
  await page.goto(draftUrl);
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("billing-card").getByRole("button", { name: "Elimina" }).click();
  await expect(page.getByTestId("billing-card").getByTestId("billed-total")).toHaveText(/0,00/);
});

test("PDF con opzioni: logo/IBAN/marchio escludibili e modello essenziale", async ({ page }) => {
  await page.goto("/impostazioni/preventivi");
  await page.getByLabel("Modello").selectOption("minimal");
  await page.getByLabel("Colore principale").selectOption("green");
  await page.getByLabel("Mostra i dati di pagamento (IBAN)").uncheck();
  await page.getByLabel(/Generato con NEXORA/).uncheck();
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(page.getByText("Impostazioni dei preventivi salvate")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Modello")).toHaveValue("minimal");
  await page.goto(quoteUrl);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Scarica PDF" }).click()]);
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  // ripristino dei valori predefiniti
  await page.goto("/impostazioni/preventivi");
  await page.getByLabel("Modello").selectOption("classic");
  await page.getByLabel("Colore principale").selectOption("indigo");
  await page.getByLabel("Mostra i dati di pagamento (IBAN)").check();
  await page.getByLabel(/Generato con NEXORA/).check();
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(page.getByText("Impostazioni dei preventivi salvate")).toBeVisible();
});

test("un collaboratore vede la numerazione ma non può modificarla; può duplicare", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/member.json" });
  const page = await ctx.newPage();
  await page.goto("/impostazioni/preventivi");
  await expect(page.getByLabel("Prefisso")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Imposta" })).toHaveCount(0);
  await page.goto(quoteUrl);
  await expect(page.getByRole("button", { name: "Duplica", exact: true })).toBeVisible();
  await ctx.close();
});
