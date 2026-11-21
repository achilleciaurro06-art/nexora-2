import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { isUuid } from "@/lib/ids";
import { readStoredFile } from "@/modules/email/service";
import { downloadMime } from "@/modules/email/limits";

/**
 * Download autorizzato di un allegato: l'accesso alla riga passa dalla RLS (organizzazione + permesso sulla casella);
 * il file è servito dal server (nessun URL pubblico), sempre come "allegato" e mai interpretato dal browser.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  if (!isUuid(id)) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  const { data: att } = await (await createClient()).from("email_attachments").select("filename, mime_type, storage_path").eq("id", id).eq("organization_id", ctx.org.organizationId).maybeSingle();
  if (!att) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  const bytes = await readStoredFile(att.storage_path as string);
  if (!bytes) return NextResponse.json({ error: "File non disponibile" }, { status: 404 });
  const name = att.filename as string;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": downloadMime(att.mime_type as string),
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'", "Cache-Control": "private, no-store",
    },
  });
}
