import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatEur } from "@/lib/money";

export type QuotePdfData = {
  organization: { name: string; vatNumber?: string | null };
  quote: {
    number: string; title: string | null; status: string; issueDate: string; validUntil: string | null;
    subtotalCents: number; vatCents: number; totalCents: number; notes: string | null; terms: string | null;
  };
  customer: { name: string; vatNumber?: string | null; taxCode?: string | null; email?: string | null; phone?: string | null; address?: string | null } | null;
  items: { description: string; quantity: number; unitPriceCents: number; discountPercent: number; vatRate: number; lineNetCents: number }[];
};

const STATUS: Record<string, string> = { draft: "Bozza", sent: "Inviato", accepted: "Accettato", rejected: "Rifiutato", expired: "Scaduto" };
const PAGE = { w: 595.28, h: 841.89, margin: 48 };
const INK = rgb(0.1, 0.12, 0.18);
const MUTED = rgb(0.4, 0.43, 0.5);
const ACCENT = rgb(0.31, 0.27, 0.9);
const LINE = rgb(0.85, 0.87, 0.9);

/** Le font standard PDF supportano WinAnsi: i caratteri fuori set vengono sostituiti. */
export function pdfSafe(text: string): string {
  return text.replace(/\r/g, "").replace(/\t/g, " ").replace(/[^\n\x20-\x7E\xA0-\xFF€\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/gu, "?");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      let w = word;
      // parola più lunga della riga: spezzala
      while (font.widthOfTextAtSize(w, size) > maxWidth) {
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut--;
        if (line) { out.push(line); line = ""; }
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) line = test;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

const fmtDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("it-IT", { timeZone: "UTC" }) : "—");
const num = (n: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 }).format(n);

export async function buildQuotePdf(data: QuotePdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Preventivo ${data.quote.number}`);
  pdf.setAuthor(pdfSafe(data.organization.name));
  pdf.setCreator("NEXORA");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const { w, h, margin } = PAGE;
  const right = w - margin;
  let page: PDFPage = pdf.addPage([w, h]);
  let y = h - margin;

  const text = (t: string, x: number, yy: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) =>
    page.drawText(pdfSafe(t), { x, y: yy, size: o.size ?? 10, font: o.font ?? font, color: o.color ?? INK });
  const textRight = (t: string, xr: number, yy: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    const f = o.font ?? font, s = o.size ?? 10;
    text(t, xr - f.widthOfTextAtSize(pdfSafe(t), s), yy, o);
  };
  const rule = (yy: number) => page.drawLine({ start: { x: margin, y: yy }, end: { x: right, y: yy }, thickness: 0.6, color: LINE });

  // colonne tabella
  const col = { desc: margin, qty: 318, price: 372, disc: 430, vat: 472, net: right };
  const tableHeader = () => {
    text("Descrizione", col.desc, y, { size: 8.5, font: bold, color: MUTED });
    textRight("Qtà", col.qty + 24, y, { size: 8.5, font: bold, color: MUTED });
    textRight("Prezzo", col.price + 42, y, { size: 8.5, font: bold, color: MUTED });
    textRight("Sconto", col.disc + 30, y, { size: 8.5, font: bold, color: MUTED });
    textRight("IVA", col.vat + 24, y, { size: 8.5, font: bold, color: MUTED });
    textRight("Netto", col.net, y, { size: 8.5, font: bold, color: MUTED });
    y -= 6; rule(y); y -= 14;
  };
  const ensure = (needed: number, withHeader = false) => {
    if (y - needed < margin + 30) {
      page = pdf.addPage([w, h]);
      y = h - margin;
      if (withHeader) tableHeader();
    }
  };

  // intestazione
  text(data.organization.name, margin, y - 8, { size: 20, font: bold, color: ACCENT });
  if (data.organization.vatNumber) text(`P.IVA ${data.organization.vatNumber}`, margin, y - 24, { size: 9, color: MUTED });
  textRight("PREVENTIVO", right, y - 6, { size: 11, font: bold, color: MUTED });
  textRight(`N. ${data.quote.number}`, right, y - 24, { size: 15, font: bold });
  y -= 44; rule(y); y -= 22;

  // metadati + cliente
  const metaTop = y;
  text("Data emissione", margin, y, { size: 8.5, color: MUTED }); text(fmtDate(data.quote.issueDate), margin + 90, y);
  y -= 15;
  text("Valido fino al", margin, y, { size: 8.5, color: MUTED }); text(fmtDate(data.quote.validUntil), margin + 90, y);
  y -= 15;
  text("Stato", margin, y, { size: 8.5, color: MUTED }); text(STATUS[data.quote.status] ?? data.quote.status, margin + 90, y);
  const metaBottom = y;

  let cy = metaTop;
  const cx = 320;
  text("Cliente", cx, cy, { size: 8.5, color: MUTED }); cy -= 15;
  if (data.customer) {
    for (const l of wrap(data.customer.name, bold, 11, right - cx)) { text(l, cx, cy, { size: 11, font: bold }); cy -= 14; }
    const lines = [
      data.customer.address, data.customer.vatNumber ? `P.IVA ${data.customer.vatNumber}` : null,
      data.customer.taxCode ? `C.F. ${data.customer.taxCode}` : null, data.customer.email, data.customer.phone,
    ].filter((l): l is string => Boolean(l));
    for (const l of lines) for (const wl of wrap(l, font, 9.5, right - cx)) { text(wl, cx, cy, { size: 9.5 }); cy -= 12.5; }
  }
  y = Math.min(metaBottom, cy) - 22;

  if (data.quote.title) {
    for (const l of wrap(data.quote.title, bold, 13, right - margin)) { ensure(20); text(l, margin, y, { size: 13, font: bold }); y -= 17; }
    y -= 6;
  }

  // righe
  ensure(40); tableHeader();
  for (const it of data.items) {
    const lines = wrap(it.description, font, 9.5, col.qty - col.desc - 14);
    ensure(lines.length * 12.5 + 10, true);
    const top = y;
    lines.forEach((l, i) => text(l, col.desc, top - i * 12.5, { size: 9.5 }));
    textRight(num(it.quantity), col.qty + 24, top, { size: 9.5 });
    textRight(formatEur(it.unitPriceCents), col.price + 42, top, { size: 9.5 });
    textRight(it.discountPercent ? `${num(it.discountPercent)}%` : "—", col.disc + 30, top, { size: 9.5 });
    textRight(`${num(it.vatRate)}%`, col.vat + 24, top, { size: 9.5 });
    textRight(formatEur(it.lineNetCents), col.net, top, { size: 9.5, font: bold });
    y -= lines.length * 12.5 + 4; rule(y); y -= 12;
  }

  // totali
  ensure(80);
  y -= 6;
  const tx = 380;
  text("Imponibile", tx, y, { size: 10, color: MUTED }); textRight(formatEur(data.quote.subtotalCents), right, y); y -= 16;
  text("IVA", tx, y, { size: 10, color: MUTED }); textRight(formatEur(data.quote.vatCents), right, y); y -= 8;
  page.drawLine({ start: { x: tx, y }, end: { x: right, y }, thickness: 0.8, color: INK }); y -= 18;
  text("Totale", tx, y, { size: 13, font: bold }); textRight(formatEur(data.quote.totalCents), right, y, { size: 13, font: bold, color: ACCENT });
  y -= 32;

  // note e condizioni
  for (const [label, body] of [["Note", data.quote.notes], ["Condizioni", data.quote.terms]] as const) {
    if (!body) continue;
    ensure(30);
    text(label, margin, y, { size: 9, font: bold, color: MUTED }); y -= 14;
    for (const l of wrap(body, font, 9.5, right - margin)) { ensure(14); text(l, margin, y, { size: 9.5 }); y -= 12.5; }
    y -= 10;
  }

  // piè di pagina
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `Preventivo ${data.quote.number} · Pagina ${i + 1} di ${pages.length}`;
    p.drawText(pdfSafe(label), { x: margin, y: 28, size: 8, font, color: MUTED });
    const brand = "Generato con NEXORA";
    p.drawText(brand, { x: right - font.widthOfTextAtSize(brand, 8), y: 28, size: 8, font, color: MUTED });
  });

  return pdf.save();
}

export function quotePdfFilename(number: string): string {
  return `Preventivo-${number.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
}
