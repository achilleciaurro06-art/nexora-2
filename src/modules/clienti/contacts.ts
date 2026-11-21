"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { optionalText } from "@/lib/forms";
import { isUuid } from "@/lib/ids";

const contactSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  job_title: optionalText(120),
  email: z.union([z.literal(""), z.email()]).optional().transform((v) => (v ? v.toLowerCase() : null)),
  phone: optionalText(40),
  notes: optionalText(1000),
});

export async function addContactAction(customerId: string, formData: FormData) {
  const ctx = await requirePermission("data:write");
  if (!isUuid(customerId)) return;
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await (await createClient()).from("customer_contacts").insert({ ...parsed.data, customer_id: customerId, organization_id: ctx.org.organizationId });
  revalidatePath(`/clienti/${customerId}`);
}

export async function updateContactAction(customerId: string, contactId: string, formData: FormData) {
  const ctx = await requirePermission("data:write");
  if (!isUuid(customerId) || !isUuid(contactId)) return;
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await (await createClient()).from("customer_contacts").update(parsed.data)
    .eq("organization_id", ctx.org.organizationId).eq("customer_id", customerId).eq("id", contactId);
  revalidatePath(`/clienti/${customerId}`);
}

export async function removeContactAction(customerId: string, contactId: string) {
  const ctx = await requirePermission("data:write");
  if (!isUuid(customerId) || !isUuid(contactId)) return;
  await (await createClient()).from("customer_contacts").delete()
    .eq("organization_id", ctx.org.organizationId).eq("customer_id", customerId).eq("id", contactId);
  revalidatePath(`/clienti/${customerId}`);
}

/** Referenti di un cliente (per i selettori dei moduli): la lettura è comunque protetta dalla RLS dell'organizzazione. */
export async function listContactsAction(customerId: string): Promise<{ id: string; name: string }[]> {
  const ctx = await requirePermission("data:read");
  if (!isUuid(customerId)) return [];
  const { data } = await (await createClient()).from("customer_contacts").select("id, full_name").eq("organization_id", ctx.org.organizationId).eq("customer_id", customerId).order("full_name").limit(100);
  return (data ?? []).map((c) => ({ id: c.id as string, name: c.full_name as string }));
}
