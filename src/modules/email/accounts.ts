import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/server/supabase/admin";
import { getProvider } from "./providers";
import { accessToken, profileAddress, exchangeCode, type OAuthKind } from "./providers/oauth";
import { ProviderError, type AccountSettings, type OAuthSecret, type PasswordSecret, type Secret } from "./providers/types";
import { encryptionKey, storeSecret, syncAccount } from "./service";
import type { z } from "zod";
import type { connectImapSchema } from "./schemas";

type Who = { userId: string; orgId: string; role: string };
type Result = { ok: true; accountId: string } | { ok: false; error: string };
const admin = () => createAdminClient();

/** Crea (o riattiva) la casella e ne salva i segreti cifrati. Se la cifratura non è configurata si rifiuta tutto: niente segreti in chiaro. */
async function upsertAccount(who: Who, provider: "gmail" | "outlook" | "imap_smtp", address: string, displayName: string | null, settings: AccountSettings, secret: Secret): Promise<Result> {
  if (!encryptionKey()) return { ok: false, error: "Cifratura non configurata: manca EMAIL_ENCRYPTION_KEY" };
  const a = admin();
  const { data: existing } = await a.from("email_accounts").select("id, created_by, disconnected_at, status").eq("organization_id", who.orgId).eq("address", address).is("disconnected_at", null).maybeSingle();
  let id: string;
  if (existing) {
    // ricollegamento di una casella esistente: solo chi l'ha creata o un titolare/amministratore
    if (existing.created_by !== who.userId && !["owner", "admin"].includes(who.role)) return { ok: false, error: "Questa casella è già collegata da un collega" };
    id = existing.id as string;
    await a.from("email_accounts").update({ status: "connected", status_detail: null, last_sync_error: null, sync_failures: 0, provider, settings }).eq("id", id);
  } else {
    const { data: def } = await a.from("email_accounts").select("id").eq("organization_id", who.orgId).eq("is_default", true).is("disconnected_at", null).maybeSingle();
    const { data, error } = await a.from("email_accounts").insert({
      organization_id: who.orgId, provider, address, display_name: displayName, settings, created_by: who.userId, visibility: "restricted", is_default: !def,
    }).select("id").single();
    if (error || !data) return { ok: false, error: error?.code === "23505" ? "Questa casella è già collegata" : "Impossibile salvare la casella" };
    id = data.id as string;
  }
  try { await storeSecret(id, secret); }
  catch (e) { if (!existing) await a.from("email_accounts").delete().eq("id", id); return { ok: false, error: e instanceof ProviderError ? e.message : "Impossibile salvare le credenziali" }; }
  return { ok: true, accountId: id };
}

export async function connectPasswordAccount(who: Who, v: z.output<typeof connectImapSchema>): Promise<Result> {
  const settings: AccountSettings = {
    imap: { host: v.imapHost, port: v.imapPort, security: v.imapSecurity, username: v.imapUser },
    smtp: { host: v.smtpHost, port: v.smtpPort, security: v.smtpSecurity, username: v.smtpUser },
  };
  const secret: PasswordSecret = { kind: "password", imapPassword: v.imapPassword, smtpPassword: v.smtpPassword };
  // la connessione si PROVA davvero (SMTP e IMAP) prima di salvare qualsiasi cosa
  try { await getProvider("imap_smtp").verify(secret, { id: "new", address: v.address, displayName: null, settings, cursor: {} }); }
  catch (e) { return { ok: false, error: e instanceof ProviderError ? e.message : "Connessione non riuscita" }; }
  const r = await upsertAccount(who, "imap_smtp", v.address, v.displayName, settings, secret);
  if (r.ok) void syncAccount(r.accountId, { limit: 40 }).catch(() => undefined);
  return r;
}

export async function connectOAuthAccount(who: Who, _db: SupabaseClient, kind: OAuthKind, code: string, redirectUri: string): Promise<Result> {
  try {
    const secret: OAuthSecret = await exchangeCode(kind, code, redirectUri);
    const { token } = await accessToken(kind, secret);
    const address = await profileAddress(kind, token);
    const r = await upsertAccount(who, kind, address, null, {}, secret);
    if (r.ok) void syncAccount(r.accountId, { limit: 40 }).catch(() => undefined);
    return r;
  } catch (e) { return { ok: false, error: e instanceof ProviderError ? e.message : "Collegamento non riuscito" }; }
}

/** Revoca: stato "disconnesso", segreti eliminati, blocco della sincronizzazione. I messaggi già importati restano nello storico. Per Google si revoca anche il token. */
export async function disconnectAccount(accountId: string): Promise<void> {
  const a = admin();
  const { data: acc } = await a.from("email_accounts").select("provider").eq("id", accountId).maybeSingle();
  if (acc?.provider === "gmail") {
    try {
      const { data } = await a.rpc("rpc_email_secret_get", { p_account: accountId });
      const key = encryptionKey();
      if (data && key) {
        const { decryptSecret } = await import("./crypto");
        const s = JSON.parse(decryptSecret(data as string, key)) as OAuthSecret;
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(s.refreshToken)}`, { method: "POST", signal: AbortSignal.timeout(8000) });
      }
    } catch { /* la revoca presso il provider è un di più: la disconnessione locale avviene comunque */ }
  }
  await a.from("email_accounts").update({ status: "disconnected", disconnected_at: new Date().toISOString(), is_default: false, sync_started_at: null, status_detail: null }).eq("id", accountId);
  await a.rpc("rpc_email_secret_delete", { p_account: accountId });
}
