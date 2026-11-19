"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/server/supabase/server";
import { createAdminClient } from "@/server/supabase/admin";
import { ORG_COOKIE } from "@/server/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { fail, type ActionResult } from "@/lib/result";
import { activationSchema, invitationAcceptSchema, loginSchema } from "./schemas";
import { hashSecret } from "./crypto";

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function loginAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Credenziali non valide");
  const ip = await clientIp();
  if (!rateLimit(`login:${ip}`, 20, 15 * 60_000) || !rateLimit(`login:${parsed.data.email}`, 8, 15 * 60_000)) {
    return fail("Troppi tentativi. Riprova tra qualche minuto.");
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return fail("Email o password non corretti");
  redirect("/dashboard");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function switchOrganizationAction(formData: FormData) {
  const orgId = String(formData.get("organizationId") ?? "");
  const supabase = await createClient();
  const { data } = await supabase.from("memberships").select("organization_id").eq("organization_id", orgId).maybeSingle();
  if (data) (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
  redirect("/dashboard");
}

const GENERIC_ACTIVATION_ERROR = "Codice di attivazione non valido, scaduto o non associato a questa email.";

/** Attivazione di una nuova azienda con codice. Nessuna registrazione pubblica. */
export async function activateAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = activationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Controlla i campi", parsed.error.flatten().fieldErrors);
  const { code, email, fullName, orgName, password } = parsed.data;

  const ip = await clientIp();
  if (!rateLimit(`activate:${ip}`, 10, 60 * 60_000)) return fail("Troppi tentativi. Riprova più tardi.");

  const admin = createAdminClient();
  const codeHash = hashSecret(code.toUpperCase());

  const { data: valid } = await admin.rpc("rpc_check_activation_code", { p_code_hash: codeHash, p_email: email });
  if (valid !== true) return fail(GENERIC_ACTIVATION_ERROR);

  // Il codice è legato all'email (flusso standard): la consegna del codice verifica la proprietà dell'email.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError || !created.user) return fail(GENERIC_ACTIVATION_ERROR);

  const { error: redeemError } = await admin.rpc("rpc_redeem_activation_code", {
    p_code_hash: codeHash,
    p_email: email,
    p_org_name: orgName,
    p_user_id: created.user.id,
    p_full_name: fullName,
  });
  if (redeemError) {
    await admin.auth.admin.deleteUser(created.user.id); // compensazione: nessun utente orfano
    return fail(GENERIC_ACTIVATION_ERROR);
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) redirect("/login");
  redirect("/dashboard");
}

/** Accettazione di un invito: l'utente imposta la password; il token è l'unico segreto. */
export async function acceptInvitationAction(token: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = invitationAcceptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Controlla i campi", parsed.error.flatten().fieldErrors);
  const { email, fullName, password } = parsed.data;
  const ip = await clientIp();
  if (!rateLimit(`invite:${ip}`, 15, 60 * 60_000)) return fail("Troppi tentativi. Riprova più tardi.");

  const admin = createAdminClient();
  const tokenHash = hashSecret(token);
  const GENERIC = "Invito non valido, scaduto o non associato a questa email.";

  let userId: string | undefined;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (created?.user) {
    userId = created.user.id;
  } else if (createError) {
    // account già esistente: si accetta solo dimostrando di conoscere la password
    const probe = await createClient();
    const { data: signed } = await probe.auth.signInWithPassword({ email, password });
    userId = signed.user?.id;
  }
  if (!userId) return fail(GENERIC);

  const { error } = await admin.rpc("rpc_accept_invitation", { p_token_hash: tokenHash, p_user_id: userId, p_email: email });
  if (error) {
    if (created?.user) await admin.auth.admin.deleteUser(userId);
    return fail(GENERIC);
  }
  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email, password });
  redirect("/dashboard");
}
