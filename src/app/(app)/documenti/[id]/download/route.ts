import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";

/** Signed URL a breve scadenza, generato solo dopo aver verificato l'accesso al record (RLS). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  const db = await createClient();
  const { data: doc } = await db.from("documents").select("storage_path, name").eq("organization_id", ctx.org.organizationId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  const { data } = await db.storage.from("documents").createSignedUrl(doc.storage_path as string, 60, inline ? undefined : { download: doc.name as string });
  if (!data?.signedUrl) return NextResponse.json({ error: "Non disponibile" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
