import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { ADMIN, createAuthUser, sql } from "./helpers";

/**
 * Riparte da dati puliti (solo sullo stack di verifica locale) e prepara l'amministratore di piattaforma
 * (nel prodotto reale si inserisce a mano su private.platform_admins).
 */
/** Posta di prova (Dovecot + SMTP di prova): riparte vuota, così i messaggi di corse precedenti non si mescolano a quelli del test. */
function resetMailHarness() {
  if (!existsSync("/tmp/nx-mail")) return;
  rmSync("/tmp/nx-mail/outbox", { recursive: true, force: true });
  mkdirSync("/tmp/nx-mail/outbox", { recursive: true });
  if (existsSync("/tmp/nx-mail/maildir")) for (const d of readdirSync("/tmp/nx-mail/maildir")) rmSync(`/tmp/nx-mail/maildir/${d}`, { recursive: true, force: true });
}

export default async function globalSetup() {
  resetMailHarness();
  sql(`delete from public.organizations`); // cascata su tutti i dati aziendali (verifica anche la cancellazione di un'organizzazione)
  sql(`delete from private.activation_codes`);
  sql(`delete from private.platform_audit`);
  sql(`delete from auth.users where email <> '${ADMIN.email}'`);
  const id = await createAuthUser(ADMIN.email, ADMIN.password, ADMIN.name);
  sql(`insert into private.platform_admins (user_id) values ('${id}') on conflict do nothing`);
}
