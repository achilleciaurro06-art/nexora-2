"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { invoiceAmounts, invoiceSchema, paymentSchema } from "./schemas";

function refresh(customerId: string, quoteId: string | null) {
  revalidatePath(`/clienti/${customerId}`); revalidatePath("/dashboard");
  if (quoteId) revalidatePath(`/preventivi/${quoteId}`);
}

/**
 * Registra una fattura (dati registrati, NON un documento fiscale). Se collegata a un preventivo, questo deve essere accettato
 * e il cliente è quello del preventivo; altrimenti si indica il cliente.
 */
export async function registerInvoiceAction(customerId: string | null, fixedQuoteId: string | null, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if ((customerId !== null && !isUuid(customerId)) || (fixedQuoteId !== null && !isUuid(fixedQuoteId))) return fail("Riferimento non valido");
  const parsed = invoiceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Controlla i campi", fieldErrors(parsed.error));
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const quoteId = fixedQuoteId ?? parsed.data.quoteId;
  let custId = customerId;
  if (quoteId) {
    const { data: q } = await db.from("quotes").select("customer_id, status").eq("organization_id", orgId).eq("id", quoteId).is("deleted_at", null).maybeSingle();
    if (!q) return fail("Preventivo non trovato");
    if (q.status !== "accepted") return fail("Si può registrare una fattura solo su un preventivo accettato");
    if (custId && q.customer_id !== custId) return fail("Il preventivo appartiene a un altro cliente");
    custId = q.customer_id as string;
  }
  if (!custId) return fail("Cliente mancante");
  const a = invoiceAmounts(parsed.data.taxable, parsed.data.vatRate);
  const { error } = await db.from("quote_billings").insert({
    organization_id: orgId, quote_id: quoteId, customer_id: custId, amount_cents: a.totalCents, taxable_cents: a.taxableCents, vat_cents: a.vatCents,
    billed_at: parsed.data.billedAt, reference: parsed.data.number, note: parsed.data.note,
    payment_status: parsed.data.paid ? "paid" : "unpaid", paid_at: parsed.data.paid ? parsed.data.paidAt : null, created_by: ctx.userId,
  });
  if (error) return fail(error.code === "23514" ? "Dati non coerenti o preventivo non accettato" : "Impossibile registrare la fattura");
  refresh(custId, quoteId);
  return { ok: true };
}

async function loadInvoice(id: string, orgId: string) {
  const { data } = await (await createClient()).from("quote_billings").select("customer_id, quote_id, billed_at").eq("organization_id", orgId).eq("id", id).maybeSingle();
  return data as { customer_id: string; quote_id: string | null; billed_at: string } | null;
}

export async function markInvoicePaidAction(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Fattura non valida");
  const p = paymentSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return fail("Indica la data di incasso");
  const inv = await loadInvoice(id, ctx.org.organizationId);
  if (!inv) return fail("Fattura non trovata");
  if (p.data.paidAt < inv.billed_at) return fail("L'incasso non può precedere la fattura");
  const { error } = await (await createClient()).from("quote_billings").update({ payment_status: "paid", paid_at: p.data.paidAt }).eq("organization_id", ctx.org.organizationId).eq("id", id);
  if (error) return fail("Impossibile registrare l'incasso");
  refresh(inv.customer_id, inv.quote_id);
  return { ok: true };
}

export async function reopenInvoiceAction(id: string, _prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return fail("Fattura non valida");
  const inv = await loadInvoice(id, ctx.org.organizationId);
  if (!inv) return fail("Fattura non trovata");
  const { error } = await (await createClient()).from("quote_billings").update({ payment_status: "unpaid", paid_at: null }).eq("organization_id", ctx.org.organizationId).eq("id", id);
  if (error) return fail("Impossibile annullare l'incasso");
  refresh(inv.customer_id, inv.quote_id);
  return { ok: true };
}

export async function deleteInvoiceAction(id: string, _prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:delete");
  if (!isUuid(id)) return fail("Fattura non valida");
  const inv = await loadInvoice(id, ctx.org.organizationId);
  if (!inv) return fail("Fattura non trovata");
  const { error } = await (await createClient()).from("quote_billings").delete().eq("organization_id", ctx.org.organizationId).eq("id", id);
  if (error) return fail("Impossibile rimuovere la registrazione");
  refresh(inv.customer_id, inv.quote_id);
  return { ok: true };
}
