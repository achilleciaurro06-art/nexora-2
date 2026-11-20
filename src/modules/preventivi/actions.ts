"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { billingSchema, quoteSchema, quoteStatusSchema } from "./schemas";
import { saveQuote, setQuoteStatus, softDeleteQuote } from "./repository";
import { listFieldDefs } from "@/modules/settore/queries";
import { parseCustomValues } from "@/modules/settore/custom-fields";

function parseForm(formData: FormData) {
  let items: unknown = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    items = [];
  }
  return quoteSchema.safeParse({ ...Object.fromEntries(formData), items });
}

export async function saveQuoteAction(quoteId: string | null, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (quoteId !== null && !isUuid(quoteId)) return fail("Preventivo non valido");
  const parsed = parseForm(formData);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Controlla i campi", fieldErrors(parsed.error));
  const db = await createClient();
  // campi personalizzati: si validano PRIMA di salvare, così un errore non lascia un preventivo a metà
  const defs = await listFieldDefs(db, ctx.org.organizationId, "quote");
  let existing: unknown = {};
  if (quoteId) existing = (await db.from("quotes").select("custom_values").eq("organization_id", ctx.org.organizationId).eq("id", quoteId).maybeSingle()).data?.custom_values;
  const cv = parseCustomValues(defs, Object.fromEntries(formData), existing);
  if (!cv.ok) return fail(cv.error);
  const { data, error } = await saveQuote(db, ctx.org.organizationId, quoteId, parsed.data);
  if (error || !data) {
    return fail(error?.code === "P0002" ? "Il preventivo non è più modificabile" : "Impossibile salvare il preventivo");
  }
  if (defs.length > 0) {
    const { error: cvError } = await db.from("quotes").update({ custom_values: cv.values }).eq("organization_id", ctx.org.organizationId).eq("id", data as string);
    if (cvError) return fail("Preventivo salvato, ma non è stato possibile salvare i campi personalizzati: riaprilo e riprova");
  }
  revalidatePath("/preventivi");
  redirect(`/preventivi/${data as string}`);
}

export async function changeQuoteStatusAction(id: string, formData: FormData) {
  const ctx = await requirePermission("data:write");
  if (!isUuid(id)) return;
  const status = quoteStatusSchema.safeParse(formData.get("status"));
  if (!status.success) return;
  await setQuoteStatus(await createClient(), ctx.org.organizationId, id, status.data);
  revalidatePath(`/preventivi/${id}`);
  revalidatePath("/preventivi");
}

/** Duplica un preventivo in una nuova bozza (nuovo numero, data odierna, validità predefinita): si apre subito in modifica. */
export async function duplicateQuoteAction(id: string) {
  await requirePermission("data:write");
  if (!isUuid(id)) return;
  const { data, error } = await (await createClient()).rpc("duplicate_quote", { p_quote: id });
  if (error || !data) redirect(`/preventivi/${id}?errore=duplicazione`);
  revalidatePath("/preventivi");
  redirect(`/preventivi/${data as string}/modifica`);
}

/** Registra un importo realmente fatturato su un preventivo accettato (distinto dal valore del preventivo). */
export async function addBillingAction(quoteId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(quoteId)) return fail("Preventivo non valido");
  const parsed = billingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Controlla i campi", fieldErrors(parsed.error));
  const db = await createClient();
  const { data: quote } = await db.from("quotes").select("customer_id").eq("organization_id", ctx.org.organizationId).eq("id", quoteId).is("deleted_at", null).maybeSingle();
  if (!quote) return fail("Preventivo non trovato");
  const { error } = await db.from("quote_billings").insert({
    organization_id: ctx.org.organizationId, quote_id: quoteId, customer_id: quote.customer_id, amount_cents: parsed.data.amount,
    billed_at: parsed.data.billedAt, reference: parsed.data.reference, note: parsed.data.note, created_by: ctx.userId,
  });
  if (error) return fail(error.code === "23514" ? "Si può registrare fatturato solo su un preventivo accettato" : "Impossibile registrare il fatturato");
  revalidatePath(`/preventivi/${quoteId}`); revalidatePath("/dashboard"); revalidatePath(`/clienti/${quote.customer_id as string}`);
  return { ok: true };
}

export async function removeBillingAction(quoteId: string, billingId: string, _prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:delete");
  if (!isUuid(quoteId) || !isUuid(billingId)) return fail("Registrazione non valida");
  const { error } = await (await createClient()).from("quote_billings").delete().eq("organization_id", ctx.org.organizationId).eq("id", billingId).eq("quote_id", quoteId);
  if (error) return fail("Impossibile rimuovere la registrazione");
  revalidatePath(`/preventivi/${quoteId}`); revalidatePath("/dashboard");
  return { ok: true };
}

/** Rimuove (archivia) il preventivo: sparisce da liste, follow-up e statistiche; resta recuperabile dall'assistenza. */
export async function deleteQuoteAction(id: string, _prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:delete");
  if (!isUuid(id)) return fail("Preventivo non valido");
  const { error } = await softDeleteQuote(await createClient(), ctx.org.organizationId, id);
  if (error) return fail("Impossibile rimuovere il preventivo");
  revalidatePath("/preventivi"); revalidatePath("/dashboard"); revalidatePath("/promemoria"); revalidatePath("/clienti");
  redirect("/preventivi");
}
