"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { fail, type ActionResult } from "@/lib/result";
import { fieldErrors } from "@/lib/forms";
import { customerSchema } from "./schemas";
import { insertCustomer, softDeleteCustomer, updateCustomer } from "./repository";

export async function createCustomerAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Controlla i campi", fieldErrors(parsed.error));
  const { data, error } = await insertCustomer(await createClient(), ctx.org.organizationId, ctx.userId, parsed.data);
  if (error || !data) return fail("Impossibile salvare il cliente");
  revalidatePath("/clienti");
  redirect(`/clienti/${data.id}`);
}

export async function updateCustomerAction(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data:write");
  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Controlla i campi", fieldErrors(parsed.error));
  const { error } = await updateCustomer(await createClient(), ctx.org.organizationId, id, parsed.data);
  if (error) return fail("Impossibile salvare le modifiche");
  revalidatePath("/clienti");
  return { ok: true };
}

export async function deleteCustomerAction(id: string) {
  const ctx = await requirePermission("data:delete");
  await softDeleteCustomer(await createClient(), ctx.org.organizationId, id);
  revalidatePath("/clienti");
  redirect("/clienti");
}
