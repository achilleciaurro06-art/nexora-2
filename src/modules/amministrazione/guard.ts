import "server-only";
import { redirect, notFound } from "next/navigation";
import { getUser, isPlatformAdmin } from "@/server/auth/session";

export async function requireContextOrUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/** Console di piattaforma: 404 per chi non è admin (non rivela l'esistenza dell'area). */
export async function assertPlatformAdmin(userId: string) {
  if (!(await isPlatformAdmin(userId))) notFound();
}
