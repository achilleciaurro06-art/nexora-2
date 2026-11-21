export type InsightCategory = "opportunity" | "attention" | "analysis";
export type InsightPriority = "low" | "normal" | "high";
export type InsightStatus = "new" | "seen" | "done" | "dismissed";
export type Evidence = { label: string; href?: string };
export type InsightDraft = {
  dedupe_key: string; rule: string; category: InsightCategory; priority: InsightPriority; title: string; description: string; reason: string;
  evidence: Evidence[]; action_label?: string; action_href?: string; copilot_question?: string; ttl_hours: number;
};
export type InsightRow = {
  id: string; dedupe_key: string; rule: string; category: InsightCategory; priority: InsightPriority; title: string; description: string; reason: string;
  evidence: Evidence[]; action_label: string | null; action_href: string | null; copilot_question: string | null; status: InsightStatus; generated_at: string; refreshed_at: string; expires_at: string;
};

export type SnapQuote = { id: string; number: string; customer_id: string; customer_name: string; status: string; total_cents: number; issue_date: string; follow_up_date: string | null };
export type Snapshot = {
  today: string; now: Date;
  quotes: SnapQuote[];
  billings: { id: string; customer_id: string; customer_name: string; quote_id: string | null; amount_cents: number; billed_at: string; payment_status: string; reference: string | null }[];
  stale: { customer_id: string; name: string; last_activity: string; open_quotes: number }[];
  followUps: { id: string; title: string; customer_id: string; customer_name: string; due_on: string }[];
  appointments24h: { id: string; title: string; starts_at: string; customer_name: string | null }[];
  unansweredEmails: { thread_id: string; subject: string; customer_id: string | null; customer_name: string | null; last_inbound_at: string }[];
  products: { id: string; name: string; description: string | null; category: string | null; unit_price_cents: number }[];
  overdueTasks: number;
};
