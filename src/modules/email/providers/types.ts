import type { Addr } from "../addresses";

export type OAuthSecret = { kind: "oauth"; refreshToken: string; accessToken?: string; expiresAt?: number };
export type PasswordSecret = { kind: "password"; imapPassword: string; smtpPassword: string };
export type Secret = OAuthSecret | PasswordSecret;

export type Security = "ssl" | "starttls" | "none";
export type ServerSettings = { host: string; port: number; security: Security; username: string };
/** Impostazioni NON segrete di una casella (le password stanno solo nel segreto cifrato). */
export type AccountSettings = { imap?: ServerSettings; smtp?: ServerSettings };

export type ProviderAccount = { id: string; address: string; displayName: string | null; settings: AccountSettings; cursor: Record<string, unknown> };

export type OutgoingAttachment = { filename: string; contentType: string; content: Buffer };
export type OutgoingMessage = {
  from: Addr; to: Addr[]; cc: Addr[]; bcc: Addr[]; subject: string; html: string; text: string;
  attachments: OutgoingAttachment[]; inReplyTo?: string | null; references?: string[]; providerThreadId?: string | null; messageId: string;
};
export type SendResult = { providerMessageId: string | null; internetMessageId: string | null; providerThreadId: string | null; sentAt: Date; secret?: Secret };

export type RawMessage = { providerMessageId: string; providerThreadId: string | null; folder: "inbox" | "sent"; raw: Buffer; isRead: boolean; internalDate: Date | null };
export type SyncResult = { messages: RawMessage[]; cursor: Record<string, unknown>; hasMore: boolean; secret?: Secret };

/**
 * auth: credenziali scadute/revocate (serve ricollegare); temporary: riprovare più tardi; permanent: richiesta rifiutata; config: provider non configurato.
 * `uncertain` = non sappiamo se il messaggio sia partito (es. timeout dopo l'invio dei dati): NON va rinviato in automatico.
 */
export class ProviderError extends Error {
  constructor(message: string, readonly kind: "auth" | "temporary" | "permanent" | "config", readonly uncertain = false) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface EmailProvider {
  send(secret: Secret, account: ProviderAccount, msg: OutgoingMessage): Promise<SendResult>;
  sync(secret: Secret, account: ProviderAccount, opts: { limit: number }): Promise<SyncResult>;
  verify(secret: Secret, account: ProviderAccount): Promise<void>;
}
