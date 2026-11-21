import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { createClient } from "@/server/supabase/server";
import { connectOAuthAccount } from "@/modules/email/accounts";
import { verifyState } from "@/modules/email/crypto";
import { encryptionKey } from "@/modules/email/service";
import type { OAuthKind } from "@/modules/email/providers/oauth";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const origin = url.origin;
  const back = (q: string) => NextResponse.redirect(`${origin}/email/caselle?${q}`);
  if (provider !== "gmail" && provider !== "outlook") return back("errore=provider");
  const ctx = await getContext();
  if (!ctx) return NextResponse.redirect(`${origin}/login`);
  const key = encryptionKey();
  const st = key ? verifyState<{ org: string; user: string; provider: string }>(url.searchParams.get("state") ?? "", key) : null;
  // lo state deve essere valido, recente e appartenere a QUESTO utente, nell'organizzazione attiva e per questo provider
  if (!st || st.user !== ctx.userId || st.org !== ctx.org.organizationId || st.provider !== provider) return back("errore=state");
  if (!can(ctx.org.role, "data:write")) return back("errore=permessi");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) return back("errore=negato");
  const res = await connectOAuthAccount({ userId: ctx.userId, orgId: ctx.org.organizationId, role: ctx.org.role }, await createClient(), provider as OAuthKind, code, `${origin}/api/email/oauth/${provider}/callback`);
  return res.ok ? back("collegata=1") : back(`errore=${encodeURIComponent(res.error.slice(0, 120))}`);
}
