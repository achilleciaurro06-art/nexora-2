/** Tipi di riga usati dall'app. Si possono rigenerare con `npm run db:types` (Supabase CLI) in CI. */
export type Customer = {
  id: string; organization_id: string; name: string; vat_number: string | null; tax_code: string | null;
  email: string | null; phone: string | null; address_line: string | null; city: string | null;
  province: string | null; postal_code: string | null; country: string; status: "lead" | "active" | "inactive";
  notes: string | null; created_at: string;
};
export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";
export type Quote = {
  id: string; organization_id: string; customer_id: string; number: string; title: string | null; status: QuoteStatus;
  issue_date: string; valid_until: string | null; follow_up_date: string | null; subtotal_cents: number; vat_cents: number; total_cents: number;
  notes: string | null; terms: string | null; created_at: string;
};
export type QuoteItem = {
  id: string; position: number; description: string; quantity: number; unit_price_cents: number;
  discount_percent: number; vat_rate: number; line_net_cents: number | null;
};
export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";
export type Task = {
  id: string; title: string; description: string | null; status: TaskStatus; priority: "low" | "normal" | "high" | "urgent";
  due_at: string | null; customer_id: string | null; quote_id: string | null; assignee_id: string | null;
};
export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Bozza", sent: "Inviato", accepted: "Accettato", rejected: "Rifiutato", expired: "Scaduto",
};
