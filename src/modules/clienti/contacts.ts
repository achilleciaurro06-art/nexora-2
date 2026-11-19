"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { requirePermission } from "@/server/auth/session";
import { optionalText } from "@/lib/forms";

const contactSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  job_title: optionalText(120),
  email: z.union([z.literal(""), z.email()]).optional().transform((v) => (v ? v.toLowerCase() : null)),
  phone: optionalText(40),
});

export async function addContactAction(customerId: string, formData: FormData) {
  const ctx = await requirePermission("data:write");
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await (await createClient()).from("customer_contacts").insert({ ...parsed.data, customer_id: customerId, organization_id: ctx.org.organizationId });
  revalidatePath(`/clienti/${customerId}`);
}

export async function removeContactAction(customerId: string, contactId: string) {
  const ctx = await requirePermission("data:write");
  await (await createClient()).from("customer_contacts").delete().eq("organization_id", ctx.org.organizationId).eq("id", contactId);
  revalidatePath(`/clienti/${customerId}`);
}
