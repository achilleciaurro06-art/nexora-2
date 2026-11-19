"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/server/supabase/server";
import { requireContext } from "@/server/auth/session";
import { isUuid } from "@/lib/ids";

export async function markNotificationReadAction(id: string) {
  const ctx = await requireContext();
  if (!isUuid(id)) return;
  await (await createClient()).from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", ctx.userId).eq("id", id).is("read_at", null);
  revalidatePath("/notifiche");
}

export async function markAllNotificationsReadAction() {
  const ctx = await requireContext();
  await (await createClient()).from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", ctx.userId).is("read_at", null);
  revalidatePath("/notifiche");
}
