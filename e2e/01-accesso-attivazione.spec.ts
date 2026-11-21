import { expect, test } from "@playwright/test";
import { ADMIN, OWNER } from "./helpers";

test.describe.configure({ mode: "serial" });
let code = "";

test("pagine pubbliche e protezione delle aree riservate", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Accedi" })).toBeVisible();
  await page.goto("/attivazione");
  await expect(page.getByLabel("Codice di attivazione")).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});

test("login con password errata mostra un errore generico", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill("sbagliata");
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.getByText("Email o password non corretti")).toBeVisible();
});

test("l'amministratore di piattaforma accede e crea un codice di attivazione", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page).toHaveURL(/\/admin/); // senza azienda: va alla console, non in un ciclo di redirect
  await page.getByLabel("Email del cliente *").fill(OWNER.email);
  await page.getByRole("button", { name: "Genera codice" }).click();
  const box = page.getByRole("status").filter({ hasText: "Codice per" });
  await expect(box).toBeVisible();
  code = ((await box.locator("code").textContent()) ?? "").trim();
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});

test("attivazione di una nuova azienda con il codice e accesso alla dashboard", async ({ page }) => {
  await page.goto("/attivazione");
  await page.getByLabel("Codice di attivazione").fill(code);
  await page.getByLabel("Nome azienda").fill(OWNER.org);
  await page.getByLabel("Il tuo nome").fill(OWNER.name);
  await page.getByLabel(/^Email/).fill(OWNER.email);
  await page.getByLabel(/^Password/).fill(OWNER.password);
  await page.getByRole("button", { name: "Attiva azienda" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText(`Panoramica di ${OWNER.org}`)).toBeVisible();
  await page.context().storageState({ path: "e2e/.auth/owner.json" }); // sessione riusata dai test successivi
});

test("il codice è monouso", async ({ page }) => {
  await page.goto("/attivazione");
  await page.getByLabel("Codice di attivazione").fill(code);
  await page.getByLabel("Nome azienda").fill("Altra Azienda");
  await page.getByLabel("Il tuo nome").fill("Qualcuno");
  await page.getByLabel(/^Email/).fill(OWNER.email);
  await page.getByLabel(/^Password/).fill("Un-altra-password-123");
  await page.getByRole("button", { name: "Attiva azienda" }).click();
  await expect(page.getByText(/non valido, scaduto/)).toBeVisible();
});
