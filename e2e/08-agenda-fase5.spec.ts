import { expect, test } from "@playwright/test";
import { sql } from "./helpers";

test.use({ storageState: "e2e/.auth/owner.json" });
test.describe.configure({ mode: "serial" });

const CUSTOMER = "Rossi Costruzioni S.r.l.";
const rome = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
const org = () => sql("select id from public.organizations where name = 'Azienda Prova S.r.l.'");
const customerId = () => sql(`select id from public.customers where name = '${CUSTOMER}'`);
const first = (s: string) => s.split("\n")[0]!;
let apptId = "";
let followId = "";
let taskId = "";

test("attività: tipologia, ora, durata, promemoria e note si salvano senza spostamenti di data/ora", async ({ page }) => {
  await page.goto("/attivita/nuova");
  await page.getByLabel("Titolo *").fill("Telefonare per sopralluogo");
  await page.getByLabel("Tipologia").selectOption({ label: "Telefonata" });
  await page.getByLabel("Cliente", { exact: true }).selectOption({ label: CUSTOMER });
  await page.getByLabel("Scadenza").fill(rome(3));
  await page.getByLabel("Ora", { exact: true }).fill("00:30"); // vicino a mezzanotte: la data non deve slittare
  await page.getByLabel("Durata prevista (minuti)").fill("20");
  await page.getByLabel("Promemoria").selectOption({ label: "1 giorno prima" });
  await page.getByLabel("Note interne").fill("Chiedere del cantiere di via Po");
  await page.getByRole("button", { name: "Crea attività" }).click();
  await page.waitForURL(/\/attivita\/[0-9a-f-]{36}$/);
  taskId = page.url().split("/").pop()!;
  await page.reload();
  await expect(page.getByLabel("Scadenza")).toHaveValue(rome(3));
  await expect(page.getByLabel("Ora", { exact: true })).toHaveValue("00:30");
  await expect(page.getByLabel("Durata prevista (minuti)")).toHaveValue("20");
  await expect(page.getByLabel("Promemoria")).toHaveValue("1440");
  await expect(page.getByLabel("Tipologia")).toHaveValue(sql(`select type_id from public.tasks where id = '${taskId}'`));
  expect(sql(`select count(*) from public.reminders where task_id = '${taskId}' and status = 'pending' and offset_minutes = 1440`)).toBe("1");
  // modifica e completamento
  await page.getByLabel("Priorità").selectOption({ label: "Alta" });
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  await expect(page.getByText("Salvato", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Segna come completata" }).click();
  await expect(page.getByRole("button", { name: "Riapri" })).toBeVisible();
  expect(sql(`select completed_at is not null from public.tasks where id = '${taskId}'`)).toBe("t");
});

test("attività: ricerca, filtri, ordinamento e vista per data", async ({ page }) => {
  await page.goto("/attivita?vista=elenco");
  await page.getByLabel("Cerca attività").fill("sopralluogo");
  await page.getByLabel("Tipologia").selectOption({ label: "Telefonata" });
  await page.getByRole("button", { name: "Applica" }).click();
  await expect(page.getByRole("link", { name: "Telefonare per sopralluogo", exact: true })).toBeVisible();
  await page.getByLabel("Tipologia").selectOption({ label: "Altro" });
  await page.getByRole("button", { name: "Applica" }).click();
  await expect(page.getByRole("link", { name: "Telefonare per sopralluogo", exact: true })).toHaveCount(0);
  await expect(page.getByText("Nessuna attività con questi filtri.")).toBeVisible();
  await page.goto("/attivita?vista=date&q=sopralluogo");
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: /\d{4}/ }).first()).toBeVisible();
  await page.goto("/attivita?vista=elenco&ordine=priorita&stato=done");
  await expect(page.getByRole("link", { name: "Telefonare per sopralluogo", exact: true })).toBeVisible();
});

test("appuntamenti: creazione, calendario (mese/settimana/giorno), elenco, orari senza spostamenti", async ({ page }) => {
  const day = rome(4);
  await page.goto(`/appuntamenti/nuovo?data=${day}`);
  await page.getByLabel("Titolo *").fill("Sopralluogo cantiere Rossi");
  await page.getByLabel("Cliente", { exact: true }).selectOption({ label: CUSTOMER });
  await page.getByLabel("Inizio *").fill("00:30");
  await page.getByLabel("Fine *").fill("01:30");
  await page.getByLabel("Luogo o indirizzo").fill("Via Po 12, Torino");
  await page.getByLabel("Promemoria").selectOption({ label: "1 ora prima" });
  await page.getByRole("button", { name: "Crea appuntamento" }).click();
  await page.waitForURL(/\/appuntamenti\/[0-9a-f-]{36}$/);
  apptId = page.url().split("/").pop()!;
  await page.reload();
  await expect(page.getByLabel("Data *")).toHaveValue(day);
  await expect(page.getByLabel("Inizio *")).toHaveValue("00:30");
  await expect(page.getByLabel("Fine *")).toHaveValue("01:30");
  expect(sql(`select count(*) from public.reminders where appointment_id = '${apptId}' and status = 'pending'`)).toBe("1");

  // fine prima dell'inizio: errore comprensibile
  await page.getByLabel("Fine *").fill("00:10");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  await expect(page.getByText("L'ora di fine deve essere successiva a quella di inizio").first()).toBeVisible();
  await page.getByLabel("Fine *").fill("01:30");

  // calendario mensile: nella cella del giorno giusto, con l'ora giusta
  await page.goto(`/appuntamenti?vista=mese&data=${day}`);
  const cell = page.locator(`[role=gridcell][data-date="${day}"]`);
  await expect(cell.getByTestId("appointment")).toContainText("00:30 Sopralluogo cantiere Rossi");
  const title = (await page.getByTestId("calendar-title").textContent())!;
  await page.getByRole("link", { name: "Periodo successivo" }).click();
  await expect(page.getByTestId("calendar-title")).not.toHaveText(title);
  await page.getByRole("link", { name: "Periodo precedente" }).click();
  await expect(page.getByTestId("calendar-title")).toHaveText(title);
  await page.getByRole("link", { name: "Oggi" }).click();
  await page.goto(`/appuntamenti?vista=settimana&data=${day}`);
  await expect(page.locator(`[role=gridcell][data-date="${day}"]`).getByTestId("appointment")).toContainText("00:30–01:30");
  await page.goto(`/appuntamenti?vista=giorno&data=${day}`);
  await expect(page.getByTestId("appointment")).toContainText("Sopralluogo cantiere Rossi");
  await page.goto("/appuntamenti?vista=elenco");
  await expect(page.getByRole("link", { name: "Sopralluogo cantiere Rossi" })).toBeVisible();
  await page.getByRole("link", { name: "Sopralluogo cantiere Rossi" }).click();
  await page.getByRole("link", { name: "Scheda cliente" }).click();
  await expect(page).toHaveURL(new RegExp(`/clienti/${customerId()}`));
});

test("appuntamento: spostamento, completamento, annullamento e riapertura con storico", async ({ page }) => {
  await page.goto(`/appuntamenti/${apptId}`);
  await page.getByLabel("Inizio *").fill("15:00");
  await page.getByLabel("Fine *").fill("16:15");
  await page.getByRole("button", { name: "Salva modifiche" }).click();
  await expect(page.getByText("Salvato", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Inizio *")).toHaveValue("15:00");
  expect(sql(`select r.remind_at = a.starts_at - interval '60 minutes' from public.reminders r join public.appointments a on a.id = r.appointment_id where a.id = '${apptId}' and r.status = 'pending'`)).toBe("t");
  await page.getByRole("button", { name: "Segna completato" }).click();
  await expect(page.getByTestId("appointment-status")).toHaveText("Completato");
  await page.getByRole("button", { name: "Riapri" }).click();
  await expect(page.getByTestId("appointment-status")).toHaveText("Programmato");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Annulla appuntamento" }).click();
  await expect(page.getByTestId("appointment-status")).toHaveText("Annullato");
  await expect(page.getByText(/Appuntamento annullato: Sopralluogo cantiere Rossi/)).toBeVisible();
  expect(sql(`select count(*) from public.reminders where appointment_id = '${apptId}' and status = 'pending'`)).toBe("0"); // nessun promemoria per un appuntamento annullato
  await page.goto(`/appuntamenti?vista=mese&data=${rome(4)}`);
  await expect(page.getByTestId("appointment").filter({ hasText: "Sopralluogo cantiere Rossi" })).toHaveCount(0); // annullato: non è nel calendario
  await page.goto(`/appuntamenti/${apptId}`);
  await page.getByRole("button", { name: "Riapri" }).click();
  await expect(page.getByTestId("appointment-status")).toHaveText("Programmato");
});

test("chiamata con prossimo contatto: registrazione, follow-up generato, registro e filtri", async ({ page }) => {
  await page.goto(`/chiamate/nuova?cliente=${customerId()}`);
  const f = page.getByRole("form", { name: "Registra chiamata" });
  await f.getByLabel("Esito *").selectOption({ label: "Da richiamare" });
  await f.getByLabel("Durata (minuti)").fill("7");
  await f.getByLabel("Note e informazioni raccolte").fill("Il titolare è in cantiere, richiamare giovedì");
  await f.getByLabel("Crea un follow-up").check();
  await f.getByLabel("Data del ricontatto *").fill(rome(2));
  await f.getByRole("button", { name: "Registra chiamata" }).click();
  await page.waitForURL(/\/followup\/[0-9a-f-]{36}$/);
  followId = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`Richiamare ${CUSTOMER}`);
  await expect(page.getByText("Programmato", { exact: true }).first()).toBeVisible();
  expect(sql(`select count(*) from public.call_logs where follow_up_id = '${followId}' and outcome = 'callback' and duration_seconds = 420`)).toBe("1");

  await page.goto("/chiamate");
  const row = page.getByRole("row").filter({ hasText: CUSTOMER }).first();
  await expect(row).toContainText("In uscita");
  await expect(row).toContainText("Da richiamare");
  await expect(row).toContainText("7 min");
  await page.getByLabel("Esito", { exact: true }).selectOption({ label: "Interessato" });
  await page.getByRole("button", { name: "Filtra" }).click();
  await expect(page.getByText(/Nessuna chiamata registrata con questi filtri/)).toBeVisible();

  // futuro rifiutato, chiamata senza follow-up
  await page.goto(`/chiamate/nuova?cliente=${customerId()}`);
  const g = page.getByRole("form", { name: "Registra chiamata" });
  await g.getByLabel("Data chiamata *").fill(rome(3));
  await g.getByRole("button", { name: "Registra chiamata" }).click();
  await expect(page.getByText("La chiamata non può essere nel futuro").first()).toBeVisible();
  await g.getByLabel("Data chiamata *").fill(rome(0));
  await g.getByLabel("In entrata").check();
  await g.getByLabel("Esito *").selectOption({ label: "Interessato" });
  await g.getByRole("button", { name: "Registra chiamata" }).click();
  await page.waitForURL(/\/chiamate\?registrata=1/);
  await expect(page.getByText("Chiamata registrata.")).toBeVisible();
  expect(sql(`select count(*) from public.follow_ups where customer_id = '${customerId()}' and source_call_id is not null`)).toBe("1");
});

test("follow-up: sei stati, transizioni, riprogrammazione e cronologia", async ({ page }) => {
  await page.goto(`/followup/${followId}`);
  const panel = page.getByRole("form", { name: "Cambia stato" });
  // stato "programmato": tutte le transizioni tranne se stesso
  await expect(panel.getByRole("button")).toHaveCount(5);
  await panel.getByLabel(/Nota/).fill("Ho chiamato, linea occupata");
  await panel.getByRole("button", { name: "Segna «In corso»" }).click();
  await expect(page.getByText("Stato aggiornato")).toBeVisible();
  await expect(page.getByTestId("follow-up-history")).toContainText("Programmato → In corso");
  await expect(page.getByTestId("follow-up-history")).toContainText("Ho chiamato, linea occupata");
  await panel.getByRole("button", { name: "Segna «In attesa»" }).click();
  await expect(page.getByTestId("follow-up-history")).toContainText("In corso → In attesa");

  // riprogrammazione: la data precedente resta nello storico
  const old = rome(2), nuova = rome(9);
  const rs = page.getByRole("form", { name: "Riprogramma" });
  await rs.getByLabel("Nuova data").fill(nuova);
  await rs.getByLabel(/Motivo/).fill("Il cliente è in ferie");
  await rs.getByRole("button", { name: "Riprogramma" }).click();
  await expect(page.getByText("Follow-up riprogrammato")).toBeVisible();
  const [y1, m1, d1] = old.split("-"), [y2, m2, d2] = nuova.split("-");
  await expect(page.getByTestId("follow-up-history")).toContainText(`dal ${d1}/${m1}/${y1} al ${d2}/${m2}/${y2}`);
  await expect(page.getByTestId("follow-up-history")).toContainText("Il cliente è in ferie");

  // completamento: la cronologia resta; da chiuso si può solo riaprire
  await panel.getByRole("button", { name: "Completa" }).click();
  await expect(page.getByText("Stato aggiornato")).toBeVisible();
  await expect(panel.getByRole("button")).toHaveCount(1);
  await expect(panel.getByRole("button", { name: "Riapri (Da fare)" })).toBeVisible();
  await expect(page.getByRole("form", { name: "Riprogramma" })).toHaveCount(0); // chiuso: nessuna riprogrammazione
  await expect(page.getByTestId("follow-up-history").locator("li")).toHaveCount(5); // creato, in corso, in attesa, riprogrammato, completato: niente è stato cancellato
});

test("follow-up in ritardo riconoscibile, annullamento con conferma e riapertura", async ({ page }) => {
  await page.goto(`/followup/nuovo?cliente=${customerId()}`);
  await page.getByLabel("Titolo *").fill("Sollecitare risposta preventivo");
  await page.getByLabel("Motivo del ricontatto").fill("Preventivo inviato da due settimane");
  await page.getByLabel("Data prevista *").fill(rome(-3));
  await page.getByLabel("Priorità").selectOption({ label: "Urgente" });
  await page.getByRole("button", { name: "Crea follow-up" }).click();
  await page.waitForURL(/\/followup\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;
  await expect(page.getByText(/Follow-up in ritardo: era previsto per il/)).toBeVisible();
  await expect(page.locator("[data-overdue]").first()).toBeVisible();
  await page.goto("/followup");
  const row = page.getByRole("row").filter({ hasText: "Sollecitare risposta preventivo" });
  await expect(row.locator("[data-overdue]")).toBeVisible();
  await expect(row.locator("[data-status='todo']")).toBeVisible();
  await page.goto("/followup?ritardo=1");
  await expect(page.getByRole("row").filter({ hasText: "Sollecitare risposta preventivo" })).toBeVisible();
  await page.goto(`/followup/${id}`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Annulla follow-up" }).click();
  await expect(page.getByText("Stato aggiornato")).toBeVisible();
  await expect(page.locator("[data-overdue]")).toHaveCount(0); // annullato: non è più "in ritardo"
  await page.goto("/followup?stato=cancelled");
  await expect(page.getByRole("row").filter({ hasText: "Sollecitare risposta preventivo" })).toBeVisible();
  await page.goto(`/followup/${id}`);
  await page.getByRole("button", { name: "Riapri (Da fare)" }).click();
  await expect(page.getByText("Stato aggiornato")).toBeVisible();
  // follow-up creato da un'attività
  await page.goto(`/followup/nuovo?attivita=${taskId}`);
  await expect(page.getByLabel("Titolo *")).toHaveValue("Ricontatto: Telefonare per sopralluogo");
  await expect(page.getByLabel("Cliente *")).toHaveValue(customerId());
  await page.getByRole("button", { name: "Crea follow-up" }).click();
  await page.waitForURL(/\/followup\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("link", { name: "Da attività" })).toBeVisible();
});

test("centro Promemoria: viste, contatori, filtri, azioni rapide ed elementi urgenti", async ({ page }) => {
  const o = org(), c = customerId();
  // dati reali nei rispettivi moduli
  sql(`insert into public.tasks (organization_id, title, customer_id, priority, due_at, status) values ('${o}', 'PRM attività urgente oggi', '${c}', 'urgent', now(), 'todo')`);
  sql(`insert into public.tasks (organization_id, title, customer_id, priority, due_at, status) values ('${o}', 'PRM attività scaduta', '${c}', 'normal', now() - interval '3 days', 'todo')`);
  sql(`insert into public.tasks (organization_id, title, customer_id, due_at, status, type_id) values ('${o}', 'PRM telefonata da fare', '${c}', now() + interval '2 days', 'todo', (select id from public.task_types where organization_id = '${o}' and key = 'call'))`);
  sql(`insert into public.follow_ups (organization_id, customer_id, title, due_on, status) values ('${o}', '${c}', 'PRM follow-up in ritardo', current_date - 4, 'todo')`);
  sql(`insert into public.follow_ups (organization_id, customer_id, title, due_on, status) values ('${o}', '${c}', 'PRM follow-up programmato oggi', (now() at time zone 'Europe/Rome')::date, 'scheduled')`);
  sql(`insert into public.appointments (organization_id, customer_id, title, starts_at, ends_at) values ('${o}', '${c}', 'PRM appuntamento domani', now() + interval '1 day', now() + interval '1 day 1 hour')`);
  sql(`insert into public.tasks (organization_id, title, customer_id, status, completed_at) values ('${o}', 'PRM attività conclusa', '${c}', 'done', now())`);

  await page.goto("/promemoria");
  const n = async (k: string) => Number(await page.getByTestId(`count-${k}`).innerText());
  expect(await n("overdue")).toBeGreaterThanOrEqual(2);
  expect(await n("today")).toBeGreaterThanOrEqual(2);
  expect(await n("upcoming")).toBeGreaterThanOrEqual(2);
  expect(await n("done")).toBeGreaterThanOrEqual(1);
  expect(await n("calls")).toBeGreaterThanOrEqual(1);
  // oggi: l'urgente è evidenziato e richiede azione; il follow-up "programmato" è solo programmato
  const urgent = page.getByTestId("reminder-item").filter({ hasText: "PRM attività urgente oggi" });
  await expect(urgent).toContainText("Urgente");
  await expect(urgent).toContainText("Da fare ora");
  const sched = page.getByTestId("reminder-item").filter({ hasText: "PRM follow-up programmato oggi" });
  await expect(sched).toContainText("Programmato");
  await expect(sched).not.toContainText("Da fare ora");
  // nessun duplicato fra le viste
  const titleToday = await page.getByTestId("reminder-item").allInnerTexts();
  expect(titleToday.join("|")).not.toContain("PRM attività scaduta");
  await page.getByRole("link", { name: /^In ritardo/ }).click();
  await expect(page.getByTestId("reminder-item").filter({ hasText: "PRM attività scaduta" })).toHaveAttribute("data-action", "true");
  await expect(page.getByTestId("reminder-item").filter({ hasText: "PRM follow-up in ritardo" })).toBeVisible();
  await expect(page.getByTestId("reminder-item").filter({ hasText: "PRM attività urgente oggi" })).toHaveCount(0);
  // filtro per tipologia / priorità
  await page.getByLabel("Tipologia").selectOption({ label: "Follow-up" });
  await page.getByRole("button", { name: "Applica" }).click();
  await expect(page.getByTestId("reminder-item")).toHaveCount(await page.locator('[data-kind="follow_up"]').count());
  await expect(page.getByTestId("reminder-item").filter({ hasText: "PRM attività scaduta" })).toHaveCount(0);
  await page.getByLabel("Priorità").selectOption({ label: "Bassa" });
  await page.getByRole("button", { name: "Applica" }).click();
  await expect(page.getByTestId("empty-state")).toBeVisible(); // stato vuoto
  await page.goto("/promemoria?vista=prossimi&tipo=call");
  await expect(page.getByTestId("reminder-item").filter({ hasText: "PRM telefonata da fare" })).toContainText("Telefonata");
  await expect(page.getByTestId("reminder-item")).toHaveCount(1);

  // azioni rapide: riprogramma e completa agiscono sul modulo di origine
  await page.goto("/promemoria?vista=ritardo");
  const item = page.getByTestId("reminder-item").filter({ hasText: "PRM follow-up in ritardo" });
  await item.getByRole("button", { name: /Riprogramma: PRM follow-up in ritardo/ }).click();
  await item.getByLabel(/Nuova data per/).fill(rome(5));
  await item.getByRole("button", { name: "Sposta" }).click();
  await expect(page.getByTestId("reminder-item").filter({ hasText: "PRM follow-up in ritardo" })).toHaveCount(0);
  expect(sql(`select due_on = current_date + 5 or due_on = (now() at time zone 'Europe/Rome')::date + 5 from public.follow_ups where title = 'PRM follow-up in ritardo'`)).toBe("t");
  expect(sql(`select count(*) from public.follow_up_events e join public.follow_ups f on f.id = e.follow_up_id where f.title = 'PRM follow-up in ritardo' and e.event = 'rescheduled'`)).toBe("1");
  await page.getByRole("button", { name: "Completa: PRM attività scaduta" }).click();
  await expect(page.getByTestId("reminder-item").filter({ hasText: "PRM attività scaduta" })).toHaveCount(0);
  expect(sql(`select status from public.tasks where title = 'PRM attività scaduta'`)).toBe("done");
  await page.goto("/promemoria?vista=completati");
  await expect(page.getByTestId("reminder-item").filter({ hasText: "PRM attività scaduta" })).toBeVisible();
});

test("scheda cliente: prossimo appuntamento/follow-up, creazione rapida, storico e ultimo contatto", async ({ page }) => {
  await page.goto(`/clienti/${customerId()}?tab=attivita`);
  const quick = page.getByTestId("quick-create");
  for (const l of ["Nuova attività", "Nuovo appuntamento", "Registra chiamata", "Nuovo follow-up"]) await expect(quick.getByRole("link", { name: l })).toBeVisible();
  await expect(page.getByTestId("next-appointment")).toContainText("PRM appuntamento domani");
  await expect(page.getByTestId("next-followup")).not.toContainText("Nessuno");
  await expect(page.getByTestId("customer-calls")).toContainText("Da richiamare");
  await expect(page.getByTestId("customer-appointments")).toContainText("Sopralluogo cantiere Rossi");
  await expect(page.getByTestId("customer-followups")).toContainText("Richiamare");
  await expect(page.getByTestId("interaction-history")).toContainText("Chiamata in uscita: da richiamare");
  await expect(page.getByTestId("interaction-history")).toContainText(/Follow-up «.*» riprogrammato dal/);
  await expect(page.getByTestId("interaction-history")).toContainText("Appuntamento annullato");
  await quick.getByRole("link", { name: "Nuovo appuntamento" }).click();
  await expect(page.getByLabel("Cliente", { exact: true })).toHaveValue(customerId());
  // l'ultimo contatto considera le chiamate
  const contact = sql(`select (public.customer_commercial_summary('${customerId()}') ->> 'last_contact_at')`);
  expect(contact.length).toBeGreaterThan(5);
});

test("dashboard: numeri del lavoro di oggi uguali ai dati reali", async ({ page }) => {
  await page.goto("/dashboard");
  const o = org();
  const today = sql(`select count(*) from public.agenda_items where organization_id = '${o}' and is_open and when_date = (now() at time zone 'Europe/Rome')::date`);
  const overdue = sql(`select count(*) from public.agenda_items where organization_id = '${o}' and is_open and when_date < (now() at time zone 'Europe/Rome')::date`);
  const fu = sql(`select count(*) from public.agenda_items where organization_id = '${o}' and is_open and kind = 'follow_up' and when_date <= (now() at time zone 'Europe/Rome')::date`);
  await expect(page.getByTestId("dash-today")).toHaveText(today);
  await expect(page.getByTestId("dash-overdue")).toHaveText(overdue);
  await expect(page.getByTestId("dash-followups")).toHaveText(fu);
  await expect(page.getByTestId("workload")).toContainText("Mario Titolare");
  await expect(page.getByTestId("today-work")).toContainText("Prossimi appuntamenti");
});

test("clienti archiviati: non selezionabili per nuove attività, storico consultabile", async ({ page }) => {
  const o = org();
  const name = "Archiviato Agenda S.r.l.";
  const c = first(sql(`insert into public.customers (organization_id, name) values ('${o}', '${name}') returning id`));
  sql(`insert into public.follow_ups (organization_id, customer_id, title, due_on) values ('${o}', '${c}', 'FU storico archiviato', current_date + 1)`);
  sql(`update public.customers set archived_at = now() where id = '${c}'`);
  for (const url of ["/followup/nuovo", "/appuntamenti/nuovo", "/attivita/nuova", "/chiamate/nuova"]) {
    await page.goto(url);
    await expect(page.locator("select option", { hasText: name })).toHaveCount(0);
  }
  await page.goto(`/clienti/${c}?tab=attivita`);
  await expect(page.getByTestId("customer-followups")).toContainText("FU storico archiviato");
  await expect(page.getByTestId("quick-create")).toHaveCount(0);
  await page.goto("/followup");
  await expect(page.getByRole("row").filter({ hasText: "FU storico archiviato" })).toContainText("(archiviato)");
  sql(`delete from public.follow_up_events where follow_up_id in (select id from public.follow_ups where customer_id = '${c}')`);
});

test("tipologie di attività configurabili senza toccare il database", async ({ page }) => {
  await page.goto("/impostazioni/settore");
  await page.getByLabel("Nome della tipologia").fill("Sopralluogo tecnico");
  await page.getByRole("button", { name: "Aggiungi tipologia" }).click();
  await expect(page.getByText("Tipologia aggiunta")).toBeVisible();
  await expect(page.getByTestId("task-types")).toContainText("Sopralluogo tecnico");
  await page.getByLabel("Nome della tipologia").fill("sopralluogo tecnico");
  await page.getByRole("button", { name: "Aggiungi tipologia" }).click();
  await expect(page.getByText("Esiste già una tipologia con questo nome")).toBeVisible();
  await page.goto("/attivita/nuova");
  await expect(page.getByLabel("Tipologia").locator("option", { hasText: "Sopralluogo tecnico" })).toHaveCount(1);
  await page.goto("/impostazioni/settore");
  await page.getByTestId("task-types").locator("li", { hasText: "Sopralluogo tecnico" }).getByRole("button", { name: "Disattiva" }).click();
  await page.goto("/attivita/nuova");
  await expect(page.getByLabel("Tipologia").locator("option", { hasText: "Sopralluogo tecnico" })).toHaveCount(0);
});

test("permessi: il collaboratore lavora con attività, appuntamenti e follow-up ma non gestisce tipologie né elimina", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/member.json" });
  const page = await ctx.newPage();
  await page.goto(`/followup/${followId}`);
  await expect(page.getByRole("form", { name: "Cambia stato" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Elimina" })).toHaveCount(0);
  await page.goto(`/appuntamenti/${apptId}`);
  await expect(page.getByRole("button", { name: "Elimina" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Segna completato" })).toBeVisible();
  await page.goto("/impostazioni/settore");
  await expect(page.getByRole("button", { name: "Aggiungi tipologia" })).toHaveCount(0);
  await page.goto("/promemoria");
  await expect(page.getByTestId("reminder-counters")).toBeVisible();
  await expect((await page.goto("/followup/00000000-0000-0000-0000-000000000000"))?.status()).toBe(404);
  await ctx.close();
});

test("notifiche: follow-up in scadenza e appuntamenti imminenti generano avvisi", async ({ page }) => {
  const o = org(), c = customerId();
  const u = sql(`select id from auth.users where email = 'titolare@azienda-prova.it'`);
  sql(`insert into public.follow_ups (organization_id, customer_id, title, due_on, assignee_id, status) values ('${o}', '${c}', 'NOT follow-up scaduto', current_date - 1, '${u}', 'todo')`);
  sql(`insert into public.appointments (organization_id, customer_id, title, starts_at, ends_at, assignee_id) values ('${o}', '${c}', 'NOT appuntamento tra poco', now() + interval '2 hours', now() + interval '3 hours', '${u}')`);
  await page.goto("/notifiche");
  await expect(page.getByText("Follow-up da eseguire: NOT follow-up scaduto")).toBeVisible();
  await expect(page.getByText("Appuntamento imminente: NOT appuntamento tra poco")).toBeVisible();
});
