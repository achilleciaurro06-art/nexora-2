import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { syncDueAccounts } from "@/modules/email/service";

export const maxDuration = 60;

/**
 * Sincronizzazione pianificata: da richiamare da un servizio esterno (es. Vercel Cron o altro scheduler) con
 * `Authorization: Bearer <CRON_SECRET>`. Senza CRON_SECRET configurato l'endpoint è disattivato.
 */
async function handle(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Sincronizzazione pianificata non configurata (manca CRON_SECRET)" }, { status: 503 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const r = await syncDueAccounts(null, 240, 45_000);
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
export const GET = handle;
export const POST = handle;
