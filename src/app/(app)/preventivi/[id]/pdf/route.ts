import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { getQuote } from "@/modules/preventivi/repository";
import { buildQuotePdf, quotePdfFilename } from "@/modules/preventivi/pdf";

/** Genera il PDF lato server e lo restituisce come download (Content-Disposition: attachment). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const db = await createClient();
  const found = await getQuote(db, ctx.org.organizationId, id);
  if (!found) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  const { data: org } = await db.from("organizations")
    .select("name, vat_number, tax_code, address, legal_address, email, pec, phone, website, logo_path, quote_footer, bank_name, iban")
    .eq("id", ctx.org.organizationId).maybeSingle();
  let logo: { bytes: Uint8Array; type: "png" | "jpg" } | null = null;
  if (org?.logo_path) {
    const { data: blob } = await db.storage.from("documents").download(org.logo_path as string);
    if (blob) logo = { bytes: new Uint8Array(await blob.arrayBuffer()), type: (org.logo_path as string).endsWith(".png") ? "png" : "jpg" };
  }

  const { quote, items } = found;
  const c = quote.customers;
  const address = c ? [c.address_line, [c.postal_code, c.city, c.province && `(${c.province})`].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null;

  const bytes = await buildQuotePdf({
    organization: {
      name: (org?.name as string | undefined) ?? ctx.org.name, vatNumber: (org?.vat_number as string | null) ?? null,
      taxCode: (org?.tax_code as string | null) ?? null, address: (org?.address as string | null) ?? null, email: (org?.email as string | null) ?? null,
      phone: (org?.phone as string | null) ?? null, website: (org?.website as string | null) ?? null, footer: (org?.quote_footer as string | null) ?? null, logo,
      legalAddress: (org?.legal_address as string | null) ?? null, pec: (org?.pec as string | null) ?? null, bankName: (org?.bank_name as string | null) ?? null, iban: (org?.iban as string | null) ?? null,
    },
    quote: {
      number: quote.number, title: quote.title, status: quote.status, issueDate: quote.issue_date, validUntil: quote.valid_until,
      subtotalCents: quote.subtotal_cents, vatCents: quote.vat_cents, totalCents: quote.total_cents, notes: quote.notes, terms: quote.terms,
    },
    customer: c ? { name: c.name ?? "", vatNumber: c.vat_number, taxCode: c.tax_code, email: c.email, phone: c.phone, address } : null,
    items: items.map((i) => ({
      description: i.description, quantity: Number(i.quantity), unitPriceCents: Number(i.unit_price_cents),
      discountPercent: Number(i.discount_percent), vatRate: Number(i.vat_rate), lineNetCents: Number(i.line_net_cents ?? 0),
    })),
  });

  const filename = quotePdfFilename(quote.number);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
