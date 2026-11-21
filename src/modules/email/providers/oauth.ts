import "server-only";
import { env } from "@/server/env";
import { ProviderError, type OAuthSecret } from "./types";

export type OAuthKind = "gmail" | "outlook";

type Cfg = { authUrl: string; tokenUrl: string; scopes: string[]; clientId: string; clientSecret: string; profileUrl: string };
const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send", "openid", "email"];
const MS_SCOPES = ["offline_access", "openid", "email", "https://graph.microsoft.com/Mail.Read", "https://graph.microsoft.com/Mail.Send", "https://graph.microsoft.com/User.Read"];

/** Variabili d'ambiente che mancano per attivare il collegamento (nomi esatti, per la documentazione e l'interfaccia). */
export function missingConfig(kind: OAuthKind): string[] {
  const e = env();
  const m: string[] = [];
  if (!e.EMAIL_ENCRYPTION_KEY) m.push("EMAIL_ENCRYPTION_KEY");
  if (kind === "gmail") { if (!e.GOOGLE_OAUTH_CLIENT_ID) m.push("GOOGLE_OAUTH_CLIENT_ID"); if (!e.GOOGLE_OAUTH_CLIENT_SECRET) m.push("GOOGLE_OAUTH_CLIENT_SECRET"); }
  else { if (!e.MS_OAUTH_CLIENT_ID) m.push("MS_OAUTH_CLIENT_ID"); if (!e.MS_OAUTH_CLIENT_SECRET) m.push("MS_OAUTH_CLIENT_SECRET"); }
  return m;
}

export function oauthConfig(kind: OAuthKind): Cfg {
  const e = env();
  if (missingConfig(kind).length) throw new ProviderError("Collegamento non configurato", "config");
  if (kind === "gmail") return { authUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", scopes: GOOGLE_SCOPES, clientId: e.GOOGLE_OAUTH_CLIENT_ID!, clientSecret: e.GOOGLE_OAUTH_CLIENT_SECRET!, profileUrl: "https://openidconnect.googleapis.com/v1/userinfo" };
  const t = e.MS_OAUTH_TENANT;
  return { authUrl: `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`, tokenUrl: `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, scopes: MS_SCOPES, clientId: e.MS_OAUTH_CLIENT_ID!, clientSecret: e.MS_OAUTH_CLIENT_SECRET!, profileUrl: "https://graph.microsoft.com/v1.0/me" };
}

export function buildAuthUrl(kind: OAuthKind, state: string, redirectUri: string, loginHint?: string): string {
  const c = oauthConfig(kind);
  const p = new URLSearchParams({ client_id: c.clientId, redirect_uri: redirectUri, response_type: "code", scope: c.scopes.join(" "), state });
  if (kind === "gmail") { p.set("access_type", "offline"); p.set("prompt", "consent"); p.set("include_granted_scopes", "false"); }
  else p.set("prompt", "select_account");
  if (loginHint) p.set("login_hint", loginHint);
  return `${c.authUrl}?${p.toString()}`;
}

const post = (url: string, body: URLSearchParams) => fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000), cache: "no-store" });

export async function exchangeCode(kind: OAuthKind, code: string, redirectUri: string): Promise<OAuthSecret> {
  const c = oauthConfig(kind);
  let res: Response;
  try { res = await post(c.tokenUrl, new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri })); }
  catch { throw new ProviderError("Il provider non risponde: riprova", "temporary"); }
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!res.ok || !j.access_token) throw new ProviderError("Il provider ha rifiutato l'autorizzazione", "auth");
  if (!j.refresh_token) throw new ProviderError("Il provider non ha concesso l'accesso permanente: riprova e accetta tutte le autorizzazioni", "auth");
  return { kind: "oauth", refreshToken: j.refresh_token, accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
}

/** Access token valido: riusa quello in cache o lo rinnova col refresh token. `invalid_grant` = autorizzazione revocata → serve ricollegare. */
export async function accessToken(kind: OAuthKind, secret: OAuthSecret, now = Date.now()): Promise<{ token: string; secret: OAuthSecret; refreshed: boolean }> {
  if (secret.accessToken && secret.expiresAt && secret.expiresAt - 60_000 > now) return { token: secret.accessToken, secret, refreshed: false };
  const c = oauthConfig(kind);
  let res: Response;
  try { res = await post(c.tokenUrl, new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: secret.refreshToken, grant_type: "refresh_token" })); }
  catch { throw new ProviderError("Il provider non risponde: riprova più tardi", "temporary"); }
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) {
    if (j.error === "invalid_grant" || res.status === 400 || res.status === 401) throw new ProviderError("L'autorizzazione è stata revocata o è scaduta: ricollega la casella", "auth");
    throw new ProviderError("Il provider ha risposto con un errore temporaneo", "temporary");
  }
  const next: OAuthSecret = { kind: "oauth", refreshToken: j.refresh_token ?? secret.refreshToken, accessToken: j.access_token, expiresAt: now + (j.expires_in ?? 3600) * 1000 };
  return { token: next.accessToken!, secret: next, refreshed: true };
}

export async function profileAddress(kind: OAuthKind, token: string): Promise<string> {
  const res = await fetch(oauthConfig(kind).profileUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as { email?: string; mail?: string; userPrincipalName?: string };
  const a = (j.email ?? j.mail ?? j.userPrincipalName ?? "").toLowerCase();
  if (!res.ok || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) throw new ProviderError("Impossibile leggere l'indirizzo della casella", "permanent");
  return a;
}

/** Errori delle API di posta → classificazione. 401/403 = autorizzazione, 429/5xx = temporaneo. */
export function classifyHttp(status: number, what: string): ProviderError {
  if (status === 401 || status === 403) return new ProviderError(`${what}: autorizzazione non valida o permessi insufficienti`, "auth");
  if (status === 429 || status >= 500) return new ProviderError(`${what}: servizio temporaneamente non disponibile`, "temporary");
  return new ProviderError(`${what}: richiesta rifiutata dal provider (${status})`, "permanent");
}
