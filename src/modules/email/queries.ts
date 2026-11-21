import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Addr, addrsFromJson } from "./addresses";

export type Folder = "arrivo" | "inviate" | "bozze" | "tutte";
export const FOLDERS: { key: Folder; label: string }[] = [{ key: "arrivo", label: "Posta in arrivo" }, { key: "inviate", label: "Inviate" }, { key: "bozze", label: "Bozze" }, { key: "tutte", label: "Tutte le email" }];
export const parseFolder = (v: string | undefined): Folder => FOLDERS.find((f) => f.key === v)?.key ?? "arrivo";

export type ThreadRow = {
  id: string; account_id: string; subject: string; last_message_at: string; message_count: number; unread_count: number; customer_id: string | null; link_status: string;
  customers: { name: string; archived_at: string | null } | null;
  last: { direction: "inbound" | "outbound"; from_address: string; from_name: string | null; to: Addr[]; snippet: string | null; message_at: string; status: string; has_attachments: boolean } | null;
};
export type ListOptions = { folder: Folder; q?: string; accountId?: string; customerId?: string; unread?: boolean; link?: string; from?: string; to?: string; limit?: number };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Elenco delle conversazioni: tutte le letture passano dalla RLS (organizzazione + permesso sulla casella). */
export async function listThreads(db: SupabaseClient, orgId: string, o: ListOptions): Promise<ThreadRow[]> {
  const limit = Math.min(o.limit ?? 50, 300);
  let ids: string[] | null = null;
  if (o.folder === "arrivo" || o.folder === "inviate" || o.q) {
    let mq = db.from("email_messages").select("thread_id").eq("organization_id", orgId).order("message_at", { ascending: false }).limit(1000);
    if (o.folder === "arrivo") mq = mq.eq("direction", "inbound");
    if (o.folder === "inviate") mq = mq.eq("direction", "outbound").in("status", ["sent", "failed", "sending"]);
    if (o.q) { const s = o.q.toLowerCase().replace(/[%_,()\\]/g, " ").trim(); if (s) mq = mq.ilike("search_text", `%${s}%`); }
    if (o.accountId) mq = mq.eq("account_id", o.accountId);
    ids = [...new Set(((await mq).data ?? []).map((r) => r.thread_id as string))];
    if (ids.length === 0) return [];
  }
  let tq = db.from("email_threads").select("id, account_id, subject, last_message_at, message_count, unread_count, customer_id, link_status, customers(name, archived_at)").eq("organization_id", orgId).gt("message_count", 0).order("last_message_at", { ascending: false }).limit(limit);
  if (ids) tq = tq.in("id", ids.slice(0, 500));
  if (o.accountId) tq = tq.eq("account_id", o.accountId);
  if (o.customerId) tq = tq.eq("customer_id", o.customerId);
  if (o.unread) tq = tq.gt("unread_count", 0);
  if (o.link === "none" || o.link === "suggested" || o.link === "auto" || o.link === "manual") tq = tq.eq("link_status", o.link);
  if (o.from) tq = tq.gte("last_message_at", o.from);
  if (o.to) tq = tq.lt("last_message_at", o.to);
  const { data: threads } = await tq;
  if (!threads?.length) return [];
  const { data: msgs } = await db.from("email_messages").select("thread_id, direction, from_address, from_name, to_addrs, snippet, message_at, status, has_attachments").eq("organization_id", orgId).in("thread_id", threads.map((t) => t.id as string)).order("message_at", { ascending: false }).limit(1500);
  const last = new Map<string, NonNullable<ThreadRow["last"]>>();
  for (const m of msgs ?? []) if (!last.has(m.thread_id as string)) last.set(m.thread_id as string, { direction: m.direction as "inbound" | "outbound", from_address: m.from_address as string, from_name: m.from_name as string | null, to: addrsFromJson(m.to_addrs), snippet: m.snippet as string | null, message_at: m.message_at as string, status: m.status as string, has_attachments: m.has_attachments as boolean });
  return threads.map((t) => ({ ...(t as unknown as ThreadRow), customers: one(t.customers as unknown as { name: string; archived_at: string | null } | { name: string; archived_at: string | null }[] | null), last: last.get(t.id as string) ?? null }));
}

export async function unreadCount(db: SupabaseClient, orgId: string): Promise<number> {
  const { count } = await db.from("email_messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("direction", "inbound").eq("is_read", false);
  return count ?? 0;
}

export type Account = { id: string; provider: "gmail" | "outlook" | "imap_smtp"; address: string; display_name: string | null; status: string; status_detail: string | null; visibility: string; is_default: boolean; signature: string | null; last_sync_at: string | null; last_sync_error: string | null; created_by: string | null };
export async function listAccounts(db: SupabaseClient, orgId: string, includeDisconnected = false): Promise<Account[]> {
  let q = db.from("email_accounts").select("id, provider, address, display_name, status, status_detail, visibility, is_default, signature, last_sync_at, last_sync_error, created_by").eq("organization_id", orgId).order("created_at");
  if (!includeDisconnected) q = q.is("disconnected_at", null);
  const { data } = await q;
  return (data ?? []) as Account[];
}
