import { expect, test, type Page } from "@playwright/test";
import { quoteStep, sql } from "./helpers";

test.use({ storageState: "e2e/.auth/owner.json" });
test.describe.configure({ mode: "serial" });

const save = (page: Page, name = "Salva") => page.getByRole("button", { name, exact: true }).click();
let customerA = "";

test("settore e terminologia: cambia i nomi nei menu e negli elenchi", async ({ page }) => {
  await page.goto("/impostazioni/settore");
  await page.getByLabel("Settore", { exact: true }).selectOption("serramenti");
  await page.getByLabel("Clienti (plurale)").fill("Committenti");
  await page.getByLabel("Cliente (singolare)").fill("Committente");
  await save(page);
  await expect(page.getByText("Settore e terminologia salvati")).toBeVisible();
  await page.goto("/clienti");
  await expect(page.getByRole("navigation", { name: "Principale" }).getByRole("link", { name: "Committenti" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Committenti" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nuovo committente" })).toBeVisible();
  await page.goto("/impostazioni/settore");
  await page.getByLabel("Clienti (plurale)").fill("<b>x</b>");
  await save(page);
  await expect(page.getByText("Caratteri non ammessi")).toBeVisible();
});

test("proposte del settore: campi aggiunti una sola volta, modello senza duplicati", async ({ page }) => {
  await page.goto("/impostazioni/settore");
  await page.getByRole("button", { name: "Aggiungi le proposte" }).click();
  await expect(page.getByText(/Aggiunti 6 campi e 1 modelli/)).toBeVisible();
  await expect(page.getByTestId("fields-quote").getByText("Indirizzo del cantiere")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Aggiungi le proposte" }).click();
  await expect(page.getByText(/Aggiunti 0 campi e 0 modelli/)).toBeVisible();
  expect(sql("select count(*) from public.quote_templates where name = 'Sostituzione serramenti'")).toBe("1");
});

test("campi personalizzati: creazione, validazione, disattivazione senza perdere i dati", async ({ page }) => {
  await page.goto("/impostazioni/settore");
  const f = page.locator("form").filter({ has: page.getByRole("button", { name: "Crea campo" }) });
  await f.getByLabel("Dove").selectOption("customer");
  await f.getByLabel("Tipo", { exact: true }).selectOption("select");
  await f.getByLabel("Nome del campo").fill("Classe energetica");
  await f.getByRole("button", { name: "Crea campo" }).click();
  await expect(page.getByText(/Indica almeno una scelta/)).toBeVisible();
  await f.getByLabel(/Scelte/).fill("A\nB\nC");
  await f.getByLabel("Obbligatorio").check();
  await f.getByRole("button", { name: "Crea campo" }).click();
  await expect(page.getByText("Campo creato")).toBeVisible();
  await expect(page.getByTestId("fields-customer").getByText(/Classe energetica/)).toBeVisible();
});

test("cliente con campi personalizzati: obbligatorio, salvataggio e valori conservati", async ({ page }) => {
  await page.goto("/clienti/nuovo");
  await page.getByLabel("Ragione sociale / Nome *").fill("Verdi Serramenti Srl");
  await page.getByLabel("Tipo di cliente").selectOption("Impresa");
  await page.getByLabel("Classe energetica *").selectOption(""); // obbligatorio: validazione del browser
  await page.getByRole("button", { name: "Salva" }).click();
  await expect(page).toHaveURL(/\/clienti\/nuovo/);
  await page.getByLabel("Classe energetica *").selectOption("B");
  await page.getByLabel("Interessato a detrazione fiscale").check();
  await page.getByRole("button", { name: "Salva" }).click();
  await page.waitForURL(/\/clienti\/[0-9a-f-]{36}$/);
  customerA = page.url();
  await page.reload();
  await expect(page.getByLabel("Classe energetica *")).toHaveValue("B");
  await expect(page.getByLabel("Tipo di cliente")).toHaveValue("Impresa");
  await expect(page.getByLabel("Interessato a detrazione fiscale")).toBeChecked();
});

test("catalogo: prodotti e servizi, codice univoco, ricerca, modifica, archiviazione", async ({ page }) => {
  await page.goto("/catalogo/nuovo");
  await page.getByLabel("Nome *").fill("Serramento PVC 120x140");
  await page.getByLabel("Codice").fill("SER-01");
  await page.getByLabel("Categoria").fill("Finestre");
  await page.getByLabel("Prezzo base (€)").fill("500,00");
  await save(page, "Crea");
  await page.waitForURL(/\/catalogo$/);
  await expect(page.getByRole("link", { name: "Serramento PVC 120x140" })).toBeVisible();

  await page.goto("/catalogo/nuovo");
  await page.getByLabel("Nome *").fill("Altro");
  await page.getByLabel("Codice").fill("ser-01");
  await save(page, "Crea");
  await expect(page.getByText("Esiste già un prodotto con questo codice")).toBeVisible();

  await page.goto("/catalogo/nuovo");
  await page.getByLabel("Nome *").fill("Posa in opera");
  await page.getByLabel("Tipo").selectOption("service");
  await page.getByLabel("Unità di misura *").fill("ora");
  await page.getByLabel("Prezzo base (€)").fill("45");
  await save(page, "Crea");
  await page.waitForURL(/\/catalogo$/);
  await page.getByLabel("Cerca nel catalogo").fill("finestre");
  await page.getByRole("button", { name: "Cerca" }).click();
  await expect(page.getByRole("link", { name: "Serramento PVC 120x140" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Posa in opera" })).toHaveCount(0);

  await page.goto("/catalogo/nuovo");
  await page.getByLabel("Nome *").fill("Da archiviare");
  await page.getByLabel("Prezzo base (€)").fill("abc");
  await save(page, "Crea");
  await expect(page.getByText("Prezzo non valido")).toBeVisible();
  await page.getByLabel("Prezzo base (€)").fill("10");
  await save(page, "Crea");
  await page.waitForURL(/\/catalogo$/);
  await page.getByRole("link", { name: "Da archiviare" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Archivia" }).click();
  await page.waitForURL(/\/catalogo$/);
  await expect(page.getByRole("link", { name: "Da archiviare" })).toHaveCount(0);
});

test("listino: prezzi dedicati assegnati a un cliente", async ({ page }) => {
  await page.goto("/catalogo/listini");
  await page.getByLabel("Nome *").fill("Rivenditori");
  await save(page, "Crea listino");
  await page.waitForURL(/\/catalogo\/listini\/[0-9a-f-]{36}$/);
  await page.getByLabel("Prezzo di listino per Serramento PVC 120x140").fill("abc");
  await save(page, "Salva prezzi");
  await expect(page.getByText(/Prezzo non valido/)).toBeVisible();
  await page.getByLabel("Prezzo di listino per Serramento PVC 120x140").fill("420,00");
  await save(page, "Salva prezzi");
  await expect(page.getByText("Prezzi salvati")).toBeVisible();
  await page.goto(customerA);
  await page.getByLabel("Listino prezzi").selectOption({ label: "Rivenditori" });
  await page.getByRole("button", { name: "Salva" }).click();
  await expect(page.getByText("Salvato", { exact: true })).toBeVisible();
});

test("preventivo: prodotto dal catalogo con prezzo di listino, modello, campi personalizzati", async ({ page }) => {
  await page.goto("/preventivi/nuovo");
  await page.getByLabel("Cliente *").selectOption({ label: "Verdi Serramenti Srl" });
  await quoteStep(page, "Prodotti e servizi");
  await page.getByLabel("Aggiungi dal catalogo").selectOption({ label: "SER-01 · Serramento PVC 120x140" });
  await expect(page.getByRole("status")).toContainText("prezzo del listino Rivenditori");
  await expect(page.getByLabel("Prezzo").first()).toHaveValue("420.00");
  page.once("dialog", (d) => d.accept()); // le righe presenti verrebbero sostituite: chiede conferma
  await page.getByLabel("Applica un modello").selectOption({ label: "Sostituzione serramenti" });
  await expect(page.getByLabel("Descrizione")).toHaveCount(3);
  await quoteStep(page, "Condizioni");
  await expect(page.getByLabel("Condizioni", { exact: true })).toHaveValue(/Pagamento 50% all.ordine/); // le condizioni già presenti (predefinite aziendali) non vengono sovrascritte
  await quoteStep(page, "Cliente e dati");
  await expect(page.getByLabel("Oggetto")).toHaveValue("Fornitura e posa di serramenti");
  await page.getByLabel("Indirizzo del cantiere").fill("Via Po 12, Torino");
  await page.getByLabel("Materiale").selectOption("PVC");
  await quoteStep(page, "Riepilogo");
  await page.getByRole("button", { name: "Salva preventivo" }).click();
  await page.waitForURL(/\/preventivi\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Via Po 12, Torino")).toBeVisible();
  await expect(page.getByText("PVC", { exact: true })).toBeVisible();
  // duplicazione: i campi personalizzati si copiano
  await page.getByRole("button", { name: "Duplica", exact: true }).click();
  await page.waitForURL(/\/modifica$/);
  await expect(page.getByLabel("Indirizzo del cantiere")).toHaveValue("Via Po 12, Torino");
});

test("senza listino vale il prezzo base", async ({ page }) => {
  await page.goto("/preventivi/nuovo");
  await page.getByLabel("Cliente *").selectOption({ label: "Rossi Costruzioni S.r.l." });
  await quoteStep(page, "Prodotti e servizi");
  await page.getByLabel("Aggiungi dal catalogo").selectOption({ label: "SER-01 · Serramento PVC 120x140" });
  await expect(page.getByRole("status")).toContainText("prezzo base");
  await expect(page.getByLabel("Prezzo").first()).toHaveValue("500.00");
});

test("modello: creazione con righe e archiviazione", async ({ page }) => {
  await page.goto("/catalogo/modelli/nuovo");
  await page.getByLabel("Nome del modello *").fill("Solo posa");
  await page.getByLabel("Descrizione", { exact: true }).first().fill("Posa a ore");
  await page.getByLabel("Prezzo").fill("45");
  await page.locator('input[aria-label="Descrizione"]').fill("Posa in opera");
  await page.getByRole("button", { name: "Salva modello" }).click();
  await page.waitForURL(/\/catalogo\/modelli$/);
  await expect(page.getByTestId("templates").getByRole("link", { name: "Solo posa" })).toBeVisible();
  await page.getByRole("link", { name: "Solo posa" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Archivia modello" }).click();
  await page.waitForURL(/\/catalogo\/modelli$/);
  await expect(page.getByRole("link", { name: "Solo posa" })).toHaveCount(0);
});

test("campo disattivato: sparisce dai moduli ma il valore resta salvato", async ({ page }) => {
  await page.goto("/impostazioni/settore");
  await page.getByTestId("fields-customer").locator("li", { hasText: "Classe energetica" }).getByRole("button", { name: "Disattiva" }).click();
  await expect(page.getByTestId("fields-customer").locator("li", { hasText: "Classe energetica" }).getByRole("button", { name: "Riattiva" })).toBeVisible();
  await page.goto(customerA);
  await expect(page.getByLabel(/Classe energetica/)).toHaveCount(0);
  await page.locator("#phone").fill("0110000000");
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(page.getByText("Salvato", { exact: true })).toBeVisible();
  expect(sql(`select custom_values ->> 'classe_energetica' from public.customers where name = 'Verdi Serramenti Srl'`)).toBe("B");
});

test("un collaboratore usa il catalogo ma non gestisce listini, campi e settore", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/member.json" });
  const page = await ctx.newPage();
  await page.goto("/catalogo");
  await expect(page.getByRole("link", { name: "Nuovo prodotto o servizio" })).toBeVisible();
  await page.goto("/catalogo/listini");
  await expect(page.getByLabel("Nome *")).toHaveCount(0);
  await page.goto("/impostazioni/settore");
  await expect(page.getByLabel("Settore", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Crea campo" })).toHaveCount(0);
  await ctx.close();
});
