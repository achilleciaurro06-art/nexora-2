import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { storeDraftUpload } from "@/modules/email/service";
import { MAX_UPLOAD_BYTES, isDangerousFile, safeFilename } from "@/modules/email/limits";

/** Caricamento di un allegato per la composizione (cartella privata dell'utente). I file non sono mai raggiungibili senza autenticazione. */
export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  if (!can(ctx.org.role, "data:write")) return NextResponse.json({ error: "Permessi insufficienti" }, { status: 403 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 100_000) return NextResponse.json({ error: "File troppo grande (massimo 4 MB per allegato caricato)" }, { status: 413 });
  let file: FormDataEntryValue | null;
  try { file = (await req.formData()).get("file"); } catch { return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 }); }
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "File mancante" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "File troppo grande (massimo 4 MB per allegato caricato)" }, { status: 413 });
  const name = safeFilename(file.name);
  if (isDangerousFile(name)) return NextResponse.json({ error: "Tipo di file non consentito (eseguibili e script)" }, { status: 415 });
  const stored = await storeDraftUpload(ctx.org.organizationId, ctx.userId, name, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
  if (!stored) return NextResponse.json({ error: "Caricamento non riuscito" }, { status: 500 });
  return NextResponse.json({ storage_path: stored.storage_path, name, mime: file.type || "application/octet-stream", size: file.size });
}
