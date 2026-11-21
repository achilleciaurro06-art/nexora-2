import "server-only";
import { gmailProvider } from "./gmail";
import { outlookProvider } from "./outlook";
import { smtpImapProvider } from "./smtp-imap";
import type { EmailProvider } from "./types";

export type ProviderKind = "gmail" | "outlook" | "imap_smtp";
export const PROVIDER_LABEL: Record<ProviderKind, string> = { gmail: "Gmail / Google Workspace", outlook: "Outlook / Microsoft 365", imap_smtp: "Altra casella (IMAP/SMTP)" };
const registry: Record<ProviderKind, EmailProvider> = { gmail: gmailProvider, outlook: outlookProvider, imap_smtp: smtpImapProvider };
export const getProvider = (kind: ProviderKind): EmailProvider => registry[kind];
