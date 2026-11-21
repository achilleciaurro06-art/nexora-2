import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { encryptionKey } from "@/modules/email/service";
import { signState } from "@/modules/email/crypto";
import { buildAuthUrl, missingConfig, type OAuthKind } from "@/modules/email/providers/oauth";

/** Avvia il collegamento OAuth (Google / Microsoft). Lo "state" firmato lega la richiesta all'utente e all'organizzazione correnti. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const origin = new URL(req.url).origin;
  if (provider !== "gmail" && provider !== "outlook") return NextResponse.json({ error: "Provider non supportato" }, { status: 404 });
  const ctx = await getContext();
  if (!ctx) return NextResponse.redirect(`${origin}/login`);
  if (!can(ctx.org.role, "data:write")) return NextResponse.redirect(`${origin}/email/caselle?errore=permessi`);
  const kind = provider as OAuthKind;
  const key = encryptionKey();
  if (!key || missingConfig(kind).length) return NextResponse.redirect(`${origin}/email/caselle?errore=non-configurato`);
  const state = signState({ org: ctx.org.organizationId, user: ctx.userId, provider: kind }, key);
  return NextResponse.redirect(buildAuthUrl(kind, state, `${origin}/api/email/oauth/${kind}/callback`));
}
