import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path.resolve(__dirname, "../.env.verify"), "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

export function sql(query: string): string {
  const e = env();
  return execFileSync("psql", ["-h", e.DB_HOST!, "-p", e.DB_PORT!, "-U", "postgres", "-d", e.DB_NAME!, "-At", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
}

export async function createAuthUser(email: string, password: string, fullName: string): Promise<string> {
  const e = env();
  const res = await fetch(`${e.API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: e.SERVICE_ROLE_KEY!, Authorization: `Bearer ${e.SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: fullName } }),
  });
  const body = (await res.json()) as { id?: string; msg?: string; error_code?: string };
  if (body.id) return body.id;
  if (body.error_code === "email_exists") return sql(`select id from auth.users where email = '${email}'`);
  throw new Error(`createAuthUser: ${JSON.stringify(body)}`);
}

export const ADMIN = { email: "admin@nexora.test", password: "Admin-di-prova-123", name: "Admin Piattaforma" };
export const OWNER = { email: "titolare@azienda-prova.it", password: "Titolare-di-prova-123", name: "Mario Titolare", org: "Azienda Prova S.r.l." };

/** Procedura guidata del preventivo: apre il passaggio indicato (Cliente e dati, Prodotti e servizi, Condizioni, Riepilogo). */
export const quoteStep = (page: import("@playwright/test").Page, name: string) => page.getByRole("list", { name: "Passaggi" }).getByRole("button", { name: new RegExp(name) }).click();
