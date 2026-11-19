"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors } from "@/lib/forms";
import { isUuid } from "@/lib/ids";
import { quoteSchema, quoteStatusSchema } from "./schemas";
import { saveQuote, setQuoteStatus, softDeleteQuote } from "./repository";

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
  const { data, error } = await saveQuote(await createClient(), ctx.org.organizationId, quoteId, parsed.data);
  if (error || !data) {
    return fail(error?.code === "P0002" ? "Il preventivo non è più modificabile" : "Impossibile salvare il preventivo");
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

export async function deleteQuoteAction(id: string) {
  const ctx = await requirePermission("data:delete");
  if (!isUuid(id)) return;
  await softDeleteQuote(await createClient(), ctx.org.organizationId, id);
  revalidatePath("/preventivi");
  redirect("/preventivi");
}
