import { expect, test, type Page } from "@playwright/test";
import { sql } from "./helpers";

test.use({ storageState: "e2e/.auth/owner.json" });
test.describe.configure({ mode: "serial" });

const NAME = "Bianchi Impianti S.r.l.";
let url = "";
let id = "";
const org = () => sql("select id from public.organizations where name = 'Azienda Prova S.r.l.'");
const eur = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", useGrouping: "always" }).format(n).replace(/\s/g, " ");
const dashboardCustomers = async (page: Page) => {
  await page.goto("/dashboard");
  const t = await page.locator('a[href="/clienti"]').filter({ hasText: "Clienti" }).first().innerText();
  return Number(/(\d+)/.exec(t.replace(/Clienti/, ""))?.[1]);
};
let activeBefore = 0;

test("creazione cliente con tipologia, settore, sito web e campi personalizzati", async ({ page }) => {
  activeBefore = await dashboardCustomers(page);
  await page.goto("/clienti/nuovo");
  await page.getByLabel("Ragione sociale / Nome *").fill(NAME);
  await page.getByLabel("Tipologia").selectOption("company");
  await page.getByLabel("Settore di attività").fill("Impianti termici");
  await page.getByLabel("Sito web").fill("www.bianchi-impianti.it");
  await page.getByLabel("Partita IVA").fill("09876543210");
  await page.getByLabel("Tipo di cliente").selectOption("Impresa"); // campo personalizzato della Fase 3
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  await page.waitForURL(/\/clienti\/[0-9a-f-]{36}$/);
  url = page.url();
  id = url.split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await expect(page.getByText(/Azienda · Impianti termici/)).toBeVisible();
  await expect(page.getByRole("link", { name: "www.bianchi-impianti.it" })).toHaveAttribute("href", "https://www.bianchi-impianti.it");
  await expect(page.getByLabel("Tipo di cliente")).toHaveValue("Impresa");
});

test("modifica cliente: i dati restano dopo il ricaricamento", async ({ page }) => {
  await page.goto(url);
  await page.locator("#phone").fill("011 7654321");
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(page.getByText("Salvato", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator("#phone")).toHaveValue("011 7654321");
  await expect(page.getByLabel("Settore di attività")).toHaveValue("Impianti termici");
});

test("valore commerciale: preventivato, accettato, rifiutato, aperto, medio, conversione — calcolati dal database", async ({ page }) => {
  const o = org();
  // 4 preventivi: accettato 1.220, accettato 610, rifiutato 305, inviato 122 + una bozza 61
  const mk = (title: string, net: number, status: string) => {
    const q = sql(`insert into public.quotes (organization_id, customer_id, title) values ('${o}', '${id}', '${title}') returning id`).split("\n")[0]!;
    sql(`insert into public.quote_items (organization_id, quote_id, description, quantity, unit_price_cents, vat_rate) values ('${o}', '${q}', 'Voce', 1, ${net}, 22)`);
    if (status !== "draft") sql(`update public.quotes set status = 'sent' where id = '${q}'`);
    if (status === "accepted" || status === "rejected") sql(`update public.quotes set status = '${status}' where id = '${q}'`);
    return q;
  };
  mk("Impianto A", 100000, "accepted"); mk("Impianto B", 50000, "accepted"); mk("Impianto C", 25000, "rejected"); mk("Impianto D", 10000, "sent"); mk("Impianto E", 5000, "draft");
  await page.goto(url);
  await expect(page.getByTestId("kpi-accepted")).toHaveText(eur(1830)); // (1000 + 500) + IVA 22%
  await expect(page.getByTestId("kpi-open")).toHaveText(eur(122));
  await expect(page.getByTestId("kpi-invoiced")).toHaveText(eur(0)); // accettato NON è fatturato
  const t = page.getByTestId("commercial-value");
  await expect(t.getByRole("row", { name: /Preventivi emessi 4/ })).toContainText(eur(2257)); // 1830 + 305 + 122
  await expect(t.getByRole("row", { name: /Rifiutati 1/ })).toContainText(eur(305));
  await expect(t.getByRole("row", { name: /Conversione/ })).toContainText("67%");
  await expect(t.getByRole("row", { name: /Valore medio/ })).toContainText(eur(564.25));
  await expect(t.getByText(/Ultima attività commerciale/)).toBeVisible();
});

test("scheda: preventivi con stato, date di invio e accettazione e collegamento", async ({ page }) => {
  await page.goto(`${url}?tab=preventivi`);
  const row = page.getByRole("row").filter({ hasText: "Impianto A" });
  await expect(row.locator("[data-status='accepted']")).toBeVisible();
  await expect(row).toContainText(eur(1220));
  await expect(row.getByRole("cell").nth(5)).not.toHaveText("—"); // inviato
  await expect(row.getByRole("cell").nth(6)).not.toHaveText("—"); // accettato
  await expect(page.getByRole("row").filter({ hasText: "Impianto E" }).getByRole("cell").nth(6)).toHaveText("—");
  await row.getByRole("link", { name: /^\d{4}\/|^PRV|\d+$/ }).first().click();
  await expect(page).toHaveURL(/\/preventivi\/[0-9a-f-]{36}$/);
});

test("fatturazione: registrazione, distinzione accettato / fatturato / incassato, incasso e annullamento", async ({ page }) => {
  await page.goto(`${url}?tab=fatturazione`);
  const cmp = page.getByTestId("value-comparison");
  await expect(cmp.getByTestId("v-accepted")).toHaveText(eur(1830));
  await expect(cmp.getByTestId("v-invoiced")).toHaveText(eur(0));
  await expect(page.getByText(/non genera né invia fatture fiscali/)).toBeVisible();

  const f = page.getByRole("form", { name: "Registra fattura" });
  await f.getByLabel("Preventivo di origine (facoltativo)").selectOption({ index: 1 });
  await f.getByLabel(/Numero fattura/).fill("FT-100");
  await f.getByLabel(/Imponibile/).fill("500");
  await expect(f.getByTestId("invoice-preview")).toContainText("610,00");
  await f.getByRole("button", { name: "Registra fattura" }).click();
  await expect(f.getByText("Fattura registrata")).toBeVisible();
  await expect(page.getByTestId("v-invoiced")).toHaveText(eur(610));
  await expect(page.getByTestId("v-collected")).toHaveText(eur(0));
  await expect(page.getByTestId("v-accepted")).toHaveText(eur(1830)); // l'accettato non cambia

  // fattura senza preventivo, già incassata
  await f.getByLabel("Preventivo di origine (facoltativo)").selectOption("");
  await f.getByLabel(/Numero fattura/).fill("FT-101");
  await f.getByLabel(/Imponibile/).fill("100");
  await f.getByLabel("Già incassata").check();
  await f.getByRole("button", { name: "Registra fattura" }).click();
  await expect(page.getByTestId("v-invoiced")).toHaveText(eur(732));
  await expect(page.getByTestId("v-collected")).toHaveText(eur(122));
  const rows = page.getByTestId("invoices");
  await expect(rows.getByRole("row").filter({ hasText: "FT-101" })).toContainText("Incassata il");
  await expect(rows.getByRole("row").filter({ hasText: "FT-100" })).toContainText("Da incassare");
  await expect(rows.getByRole("row").filter({ hasText: "FT-100" }).getByRole("link")).toBeVisible(); // preventivo di origine

  await rows.getByRole("row").filter({ hasText: "FT-100" }).getByRole("button", { name: "Segna incassata" }).click();
  await expect(page.getByTestId("v-collected")).toHaveText(eur(732));
  await rows.getByRole("row").filter({ hasText: "FT-100" }).getByRole("button", { name: "Annulla incasso" }).click();
  await expect(page.getByTestId("v-collected")).toHaveText(eur(122));

  // validazioni
  await f.getByLabel(/Numero fattura/).fill("FT-102");
  await f.getByLabel(/Imponibile/).fill("abc");
  await f.getByRole("button", { name: "Registra fattura" }).click();
  await expect(f.getByText("Imponibile non valido")).toBeVisible();
  // KPI in testata coerenti
  await expect(page.getByTestId("kpi-invoiced")).toHaveText(eur(732));
  // cronologia
  await page.goto(`${url}?tab=documenti`);
  await expect(page.locator("#timeline").getByText(/Fattura registrata: € 610,00 n\. FT-100/)).toBeVisible();
});

test("attività: aperte, completate e follow-up nella scheda", async ({ page }) => {
  const o = org();
  sql(`insert into public.tasks (organization_id, title, customer_id, due_at) values ('${o}', 'Richiamare Bianchi', '${id}', now() + interval '2 days')`);
  sql(`insert into public.tasks (organization_id, title, customer_id, status, completed_at) values ('${o}', 'Sopralluogo fatto', '${id}', 'done', now())`);
  sql(`update public.quotes set follow_up_date = current_date + 3 where customer_id = '${id}' and title = 'Impianto D'`);
  await page.goto(`${url}?tab=attivita`);
  await expect(page.getByRole("link", { name: "Richiamare Bianchi" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sopralluogo fatto" })).toBeVisible();
  await expect(page.getByText(/Follow-up dei preventivi/)).toBeVisible();
  await expect(page.getByText(/arriveranno con la fase dedicata/).first()).toBeVisible();
  await page.getByRole("link", { name: "Richiamare Bianchi" }).click();
  await expect(page).toHaveURL(/\/attivita\/[0-9a-f-]{36}$/);
});

test("archiviazione dalla scheda: esce da elenchi, selettori e conteggi; i dati restano", async ({ page }) => {
  await page.goto(url);
  let msg = "";
  page.once("dialog", async (d) => { msg = d.message(); await d.accept(); });
  await page.getByRole("button", { name: "Archivia", exact: true }).click();
  await page.waitForURL(/\/clienti$/);
  expect(msg).toContain("restano conservati");
  await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);
  expect(await dashboardCustomers(page)).toBe(activeBefore); // non conteggiato tra gli attivi

  await page.goto("/preventivi/nuovo");
  await expect(page.getByLabel("Cliente *").locator("option", { hasText: NAME })).toHaveCount(0);
  await page.goto("/attivita/nuova");
  await expect(page.getByRole("combobox", { name: /Cliente/ }).locator("option", { hasText: NAME })).toHaveCount(0);

  await page.goto("/clienti?stato=archiviati");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("archiviati");
  await expect(page.getByRole("link", { name: NAME })).toBeVisible();
  await page.getByLabel("Cerca cliente").fill("nessuno-con-questo-nome");
  await page.getByRole("button", { name: "Filtra" }).click();
  await expect(page.getByText("Nessun cliente archiviato.")).toBeVisible();
  await page.getByLabel("Cerca cliente").fill("bianchi");
  await page.getByLabel("Filtra per tipologia").selectOption("company");
  await page.getByRole("button", { name: "Filtra" }).click();
  await expect(page.getByRole("link", { name: NAME })).toBeVisible();
  await page.getByLabel("Filtra per tipologia").selectOption("private");
  await page.getByRole("button", { name: "Filtra" }).click();
  await expect(page.getByRole("link", { name: NAME })).toHaveCount(0);

  // la scheda resta consultabile, in sola lettura, con tutti i dati
  await page.goto(url);
  await expect(page.getByTestId("archived-banner")).toContainText(/Archiviato il .* da Mario Titolare/);
  await expect(page.getByLabel("Settore di attività")).toBeDisabled();
  await expect(page.getByRole("link", { name: "Nuovo preventivo" })).toHaveCount(0);
  await expect(page.getByTestId("kpi-accepted")).toHaveText(eur(1830));
  await page.goto(`${url}?tab=preventivi`);
  await expect(page.getByRole("row").filter({ hasText: "Impianto A" })).toBeVisible();
  expect(sql(`select count(*) from public.quotes where customer_id = '${id}' and deleted_at is null`)).toBe("5");
  expect(sql(`select archived_by is not null from public.customers where id = '${id}'`)).toBe("t");
  await page.goto(`${url}?tab=documenti`);
  await expect(page.locator("#timeline").getByText("Cliente archiviato")).toBeVisible();
});

test("eliminazione definitiva negata: il cliente ha dati collegati, spiegazione chiara", async ({ page }) => {
  await page.goto(url);
  const panel = page.getByTestId("delete-panel");
  await expect(panel.getByTestId("delete-blocked")).toContainText(/non è consentita/);
  await expect(panel.getByTestId("delete-blocked")).toContainText(/5 preventivi/);
  await expect(panel.getByTestId("delete-blocked")).toContainText(/2 fatture registrate/);
  await expect(panel.getByTestId("delete-blocked")).toContainText(/2 attività/);
  await expect(panel.getByLabel(/Per confermare scrivi/)).toHaveCount(0);
});

test("ripristino: il cliente torna attivo, selezionabile e con tutti i dati", async ({ page }) => {
  await page.goto("/clienti?stato=archiviati");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("row").filter({ hasText: NAME }).getByRole("button", { name: "Ripristina" }).click();
  await page.waitForURL(url);
  await expect(page.getByTestId("archived-banner")).toHaveCount(0);
  await expect(page.getByLabel("Settore di attività")).toBeEnabled();
  await expect(page.getByLabel("Tipo di cliente")).toHaveValue("Impresa"); // campo personalizzato intatto
  expect(await dashboardCustomers(page)).toBe(activeBefore + 1);
  await page.goto("/preventivi/nuovo");
  await expect(page.getByLabel("Cliente *").locator("option", { hasText: NAME })).toHaveCount(1);
  await page.goto("/clienti");
  await expect(page.getByRole("link", { name: NAME })).toBeVisible();
  await expect(page.getByTestId("kpi-invoiced")).toHaveCount(0);
});

test("eliminazione definitiva consentita: conferma esplicita, cliente senza dati collegati", async ({ page }) => {
  await page.goto("/clienti/nuovo");
  await page.getByLabel("Ragione sociale / Nome *").fill("Da Eliminare S.r.l.");
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  await page.waitForURL(/\/clienti\/[0-9a-f-]{36}$/);
  const u = page.url();
  const cid = u.split("/").pop()!;
  await page.goto(`${u}?tab=referenti`);
  await page.getByLabel("Nuovo referente").fill("Referente da eliminare");
  await page.getByRole("button", { name: "Aggiungi referente" }).click();
  await expect(page.getByText("Referente da eliminare").first()).toBeVisible();

  // non archiviato: nessun pannello di eliminazione
  await expect(page.getByTestId("delete-panel")).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Archivia", exact: true }).click();
  await page.waitForURL(/\/clienti$/);
  await page.goto(u);
  await expect(page.getByTestId("delete-panel")).toContainText(/definitiva/);
  await expect(page.getByTestId("delete-panel")).toContainText(/1 referenti/);
  page.once("dialog", (d) => d.accept());
  await page.getByLabel(/Per confermare scrivi/).fill("elimina");
  await page.getByRole("button", { name: "Elimina definitivamente" }).click();
  await expect(page.getByText("Per confermare scrivi ELIMINA").first()).toBeVisible();
  expect(sql(`select count(*) from public.customers where id = '${cid}'`)).toBe("1");
  page.once("dialog", (d) => d.accept());
  await page.getByLabel(/Per confermare scrivi/).fill("ELIMINA");
  await page.getByRole("button", { name: "Elimina definitivamente" }).click();
  await page.waitForURL(/\/clienti\?stato=archiviati&eliminato=1/);
  await expect(page.getByText("Cliente eliminato definitivamente.")).toBeVisible();
  expect(sql(`select count(*) from public.customers where id = '${cid}'`)).toBe("0");
  expect(sql(`select count(*) from public.customer_contacts where customer_id = '${cid}'`)).toBe("0");
  expect(sql(`select count(*) from public.audit_logs where entity = 'customers' and action = 'delete' and entity_id = '${cid}'`)).toBe("1");
  expect((await page.goto(u))?.status()).toBe(404);
});

test("permessi: il collaboratore archivia e ripristina ma non vede l'eliminazione definitiva; coerenza con il Copilot", async ({ browser }) => {
  const o = org();
  const c2 = sql(`insert into public.customers (organization_id, name) values ('${o}', 'Per Collaboratore S.r.l.') returning id`).split("\n")[0]!;
  const ctx = await browser.newContext({ storageState: "e2e/.auth/member.json" });
  const page = await ctx.newPage();
  await page.goto("/clienti");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("row").filter({ hasText: "Per Collaboratore" }).getByRole("button", { name: "Archivia" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Per Collaboratore" })).toHaveCount(0);
  await page.goto(`/clienti/${c2}`);
  await expect(page.getByTestId("archived-banner")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ripristina cliente" })).toBeVisible();
  await expect(page.getByTestId("delete-panel")).toHaveCount(0);
  // il database rifiuta comunque l'eliminazione al collaboratore (verificato nei test SQL); qui: l'azione non è esposta
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Ripristina cliente" }).click();
  await page.waitForURL(`/clienti/${c2}`);
  await expect(page.getByTestId("archived-banner")).toHaveCount(0);
  await ctx.close();
  sql(`delete from public.customers where id = '${c2}'`);
});
