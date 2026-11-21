import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { generateQuotePdf } from "@/modules/preventivi/pdf-data";

/** Genera il PDF lato server e lo restituisce come download (Content-Disposition: attachment). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const pdf = await generateQuotePdf(await createClient(), ctx.org.organizationId, ctx.org.name, id);
  if (!pdf) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  const filename = pdf.filename;
  const bytes = pdf.bytes;
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
