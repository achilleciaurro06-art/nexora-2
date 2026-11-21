import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getQuote } from "./repository";
import { buildQuotePdf, quotePdfFilename } from "./pdf";
import { parseOrgSettings } from "@/modules/impostazioni/settings";

/** PDF del preventivo (stesso documento del download e dell'allegato email). Ritorna null se il preventivo non esiste o non è visibile. */
export async function generateQuotePdf(db: SupabaseClient, orgId: string, orgName: string, quoteId: string): Promise<{ bytes: Uint8Array; filename: string; number: string } | null> {
  const found = await getQuote(db, orgId, quoteId);
  if (!found) return null;
  const { data: org } = await db.from("organizations")
    .select("settings, name, vat_number, tax_code, address, legal_address, email, pec, phone, website, logo_path, quote_footer, bank_name, iban")
    .eq("id", orgId).maybeSingle();
  let logo: { bytes: Uint8Array; type: "png" | "jpg" } | null = null;
  if (org?.logo_path) {
    const { data: blob } = await db.storage.from("documents").download(org.logo_path as string);
    if (blob) logo = { bytes: new Uint8Array(await blob.arrayBuffer()), type: (org.logo_path as string).endsWith(".png") ? "png" : "jpg" };
  }

  const { quote, items } = found;
  const c = quote.customers;
  const address = c ? [c.address_line, [c.postal_code, c.city, c.province && `(${c.province})`].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null;

  const qs = parseOrgSettings(org?.settings).quotes;
  const bytes = await buildQuotePdf({
    options: { template: qs.pdf_template, accent: qs.pdf_accent, showLogo: qs.pdf_show_logo, showPayment: qs.pdf_show_payment, showBrand: qs.pdf_show_brand },
    organization: {
      name: (org?.name as string | undefined) ?? orgName, vatNumber: (org?.vat_number as string | null) ?? null,
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

  return { bytes, filename: quotePdfFilename(quote.number), number: quote.number };
}
