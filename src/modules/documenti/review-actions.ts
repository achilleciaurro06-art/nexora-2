"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors, optionalText } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { quoteItemSchema } from "@/modules/preventivi/schemas";
import { saveQuote } from "@/modules/preventivi/repository";
import { normalizeSuggestionPayload } from "./extraction";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null);

const reviewSchema = z.object({
  customerMode: z.enum(["existing", "new"]),
  customerId: z.uuid().optional().or(z.literal("")).transform((v) => v || null),
  new_name: optionalText(200), new_vat_number: optionalText(32), new_tax_code: optionalText(32),
  new_email: z.union([z.literal(""), z.email()]).optional().transform((v) => (v ? v.toLowerCase() : null)),
  new_phone: optionalText(40), new_address: optionalText(300),
  title: optionalText(200), issueDate: date, validUntil: date, followUpDate: date, notes: optionalText(4000), terms: optionalText(4000),
  items: z.array(quoteItemSchema).min(1, "Aggiungi almeno una riga").max(200),
  confirmDuplicates: z.literal("on").optional(),
}).superRefine((v, ctx) => {
  if (v.customerMode === "existing" && !v.customerId) ctx.addIssue({ code: "custom", path: ["customerId"], message: "Seleziona un cliente" });
  if (v.customerMode === "new" && !v.new_name) ctx.addIssue({ code: "custom", path: ["new_name"], message: "Inserisci il nome del nuovo cliente" });
});

/** L'utente ha controllato e (eventualmente) corretto i dati estratti: solo ora si crea il preventivo. */
export async function confirmExtractionAction(suggestionId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  if (!isUuid(suggestionId)) return fail("Suggerimento non valido");
  let items: unknown = [];
  try { items = JSON.parse(String(formData.get("items") ?? "[]")); } catch { items = []; }
  const parsed = reviewSchema.safeParse({ ...Object.fromEntries(formData), items });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Controlla i campi", fieldErrors(parsed.error));
  const v = parsed.data;

  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const { data: sug } = await db.from("ai_suggestions").select("id, kind, status, payload").eq("organization_id", orgId).eq("id", suggestionId).maybeSingle();
  if (!sug || sug.kind !== "quote_draft") return fail("Suggerimento non trovato");
  if (sug.status !== "pending") return fail("Questo suggerimento è già stato gestito");
  const payload = normalizeSuggestionPayload(sug.payload);
  if (!payload) return fail("Dati estratti non leggibili");
  if (payload.checks.duplicates.length > 0 && !v.confirmDuplicates) return fail("Sono stati rilevati possibili duplicati: conferma di voler procedere comunque.");

  let customerId = v.customerId;
  let createdCustomerId: string | null = null;
  if (v.customerMode === "existing") {
    const { data: c } = await db.from("customers").select("id").eq("organization_id", orgId).eq("id", customerId!).is("deleted_at", null).maybeSingle();
    if (!c) return fail("Cliente non trovato");
  } else {
    const { data: created, error } = await db.from("customers").insert({
      organization_id: orgId, name: v.new_name!, vat_number: v.new_vat_number, tax_code: v.new_tax_code, email: v.new_email,
      phone: v.new_phone, address_line: v.new_address, created_by: ctx.userId,
    }).select("id").single();
    if (error || !created) return fail("Impossibile creare il cliente");
    customerId = created.id as string;
    createdCustomerId = customerId;
  }

  const { data: quoteId, error: quoteError } = await saveQuote(db, orgId, null, {
    customerId: customerId!, title: v.title, issueDate: v.issueDate, validUntil: v.validUntil, followUpDate: v.followUpDate,
    notes: v.notes, terms: v.terms, items: v.items,
  });
  if (quoteError || !quoteId) {
    // nessun cliente "orfano" creato da questa operazione
    if (createdCustomerId) await db.from("customers").update({ deleted_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", createdCustomerId);
    return fail("Impossibile creare il preventivo");
  }

  await db.from("ai_suggestions").update({ status: "accepted" }).eq("organization_id", orgId).eq("id", suggestionId);
  if (payload.document_id) {
    // il documento originale resta in archivio, ora collegato a cliente e preventivo
    await db.from("documents").update({ customer_id: customerId, quote_id: quoteId as string }).eq("organization_id", orgId).eq("id", payload.document_id);
  }
  revalidatePath("/preventivi"); revalidatePath("/documenti"); revalidatePath("/clienti"); revalidatePath("/dashboard");
  redirect(`/preventivi/${quoteId as string}`);
}

export async function discardExtractionAction(suggestionId: string) {
  const ctx = await requirePermission("data:write");
  if (!isUuid(suggestionId)) return;
  await (await createClient()).from("ai_suggestions").update({ status: "rejected" }).eq("organization_id", ctx.org.organizationId).eq("id", suggestionId).eq("status", "pending");
  revalidatePath("/documenti"); revalidatePath("/copilot");
  redirect("/documenti");
}
