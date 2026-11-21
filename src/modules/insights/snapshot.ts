import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIn, addDays } from "@/lib/datetime";
import { one } from "../copilot/tools/util";
import type { Snapshot } from "./types";

/**
 * Carica i dati reali su cui si basano insight e sintesi, con il client DELL'UTENTE (RLS).
 * Le email contano solo se provengono da caselle CONDIVISE: gli insight sono visibili a tutta l'organizzazione
 * e non devono rivelare il contenuto di caselle riservate.
 */
export async function loadSnapshot(db: SupabaseClient, orgId: string, now: Date): Promise<Snapshot> {
  const today = todayIn(now);
  const since24m = addDays(today, -730);
  const in24h = new Date(now.getTime() + 24 * 3_600_000).toISOString();
  const [{ data: quotes }, { data: billings }, { data: stale }, { data: fus }, { data: apps }, { data: accounts }, { data: products }, { count: overdueTasks }] = await Promise.all([
    db.from("quotes").select("id, number, customer_id, status, total_cents, issue_date, follow_up_date, customers(name)").eq("organization_id", orgId).is("deleted_at", null).gte("issue_date", since24m).limit(4000),
    db.from("quote_billings").select("id, customer_id, quote_id, amount_cents, billed_at, payment_status, reference, customers(name)").eq("organization_id", orgId).gte("billed_at", since24m).limit(5000),
    db.rpc("customers_to_recontact", { p_org: orgId, p_days: 60, p_limit: 100 }),
    db.from("follow_ups").select("id, title, customer_id, due_on, customers(name)").eq("organization_id", orgId).is("deleted_at", null).in("status", ["todo", "scheduled", "in_progress", "waiting"]).limit(500),
    db.from("appointments").select("id, title, starts_at, customers(name)").eq("organization_id", orgId).is("deleted_at", null).eq("status", "scheduled").gte("starts_at", now.toISOString()).lte("starts_at", in24h).order("starts_at").limit(20),
    db.from("email_accounts").select("id").eq("organization_id", orgId).eq("visibility", "shared").is("disconnected_at", null),
    db.from("products").select("id, name, description, category, unit_price_cents").eq("organization_id", orgId).is("deleted_at", null).eq("active", true).limit(600),
    db.from("tasks").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null).in("status", ["todo", "in_progress"]).lt("due_at", now.toISOString()),
  ]);

  const accountIds = (accounts ?? []).map((a) => a.id as string);
  const unansweredEmails: Snapshot["unansweredEmails"] = [];
  if (accountIds.length) {
    const { data: threads } = await db.from("email_threads").select("id, subject, customer_id, customers(name)").eq("organization_id", orgId).in("account_id", accountIds).gte("last_message_at", addDays(today, -30)).order("last_message_at", { ascending: false }).limit(150);
    const ids = (threads ?? []).map((t) => t.id as string);
    const { data: msgs } = ids.length ? await db.from("email_messages").select("thread_id, direction, message_at, status").eq("organization_id", orgId).in("thread_id", ids).neq("status", "failed").order("message_at", { ascending: false }).limit(1500) : { data: [] };
    const last = new Map<string, { direction: string; at: string }>();
    for (const m of msgs ?? []) if (!last.has(m.thread_id as string)) last.set(m.thread_id as string, { direction: m.direction as string, at: m.message_at as string });
    for (const t of threads ?? []) {
      const l = last.get(t.id as string);
      if (l?.direction === "inbound") unansweredEmails.push({ thread_id: t.id as string, subject: String(t.subject ?? ""), customer_id: (t.customer_id as string | null) ?? null, customer_name: one(t.customers as { name: string } | { name: string }[])?.name ?? null, last_inbound_at: l.at });
    }
  }

  return {
    today, now,
    quotes: (quotes ?? []).map((q) => ({ id: q.id as string, number: q.number as string, customer_id: q.customer_id as string, customer_name: one(q.customers as { name: string } | { name: string }[])?.name ?? "Cliente", status: q.status as string, total_cents: Number(q.total_cents), issue_date: q.issue_date as string, follow_up_date: (q.follow_up_date as string | null) ?? null })),
    billings: (billings ?? []).map((b) => ({ id: b.id as string, customer_id: b.customer_id as string, customer_name: one(b.customers as { name: string } | { name: string }[])?.name ?? "Cliente", quote_id: (b.quote_id as string | null) ?? null, amount_cents: Number(b.amount_cents), billed_at: b.billed_at as string, payment_status: b.payment_status as string, reference: (b.reference as string | null) ?? null })),
    stale: (stale ?? []) as Snapshot["stale"],
    followUps: (fus ?? []).map((f) => ({ id: f.id as string, title: f.title as string, customer_id: f.customer_id as string, customer_name: one(f.customers as { name: string } | { name: string }[])?.name ?? "Cliente", due_on: f.due_on as string })),
    appointments24h: (apps ?? []).map((a) => ({ id: a.id as string, title: a.title as string, starts_at: a.starts_at as string, customer_name: one(a.customers as { name: string } | { name: string }[])?.name ?? null })),
    unansweredEmails,
    products: (products ?? []).map((p) => ({ id: p.id as string, name: p.name as string, description: (p.description as string | null) ?? null, category: (p.category as string | null) ?? null, unit_price_cents: Number(p.unit_price_cents) })),
    overdueTasks: overdueTasks ?? 0,
  };
}
