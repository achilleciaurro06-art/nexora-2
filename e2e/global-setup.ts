import { ADMIN, createAuthUser, sql } from "./helpers";

/**
 * Riparte da dati puliti (solo sullo stack di verifica locale) e prepara l'amministratore di piattaforma
 * (nel prodotto reale si inserisce a mano su private.platform_admins).
 */
export default async function globalSetup() {
  sql(`delete from public.organizations`); // cascata su tutti i dati aziendali (verifica anche la cancellazione di un'organizzazione)
  sql(`delete from private.activation_codes`);
  sql(`delete from auth.users where email <> '${ADMIN.email}'`);
  const id = await createAuthUser(ADMIN.email, ADMIN.password, ADMIN.name);
  sql(`insert into private.platform_admins (user_id) values ('${id}') on conflict do nothing`);
}
