import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatEur } from "@/lib/money";

export type QuotePdfData = {
  organization: {
    name: string; vatNumber?: string | null; taxCode?: string | null; address?: string | null; email?: string | null;
    phone?: string | null; website?: string | null; footer?: string | null;
    legalAddress?: string | null; pec?: string | null; bankName?: string | null; iban?: string | null;
    logo?: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  };
  quote: {
    number: string; title: string | null; status: string; issueDate: string; validUntil: string | null;
    subtotalCents: number; vatCents: number; totalCents: number; notes: string | null; terms: string | null;
  };
  customer: { name: string; vatNumber?: string | null; taxCode?: string | null; email?: string | null; phone?: string | null; address?: string | null } | null;
  items: { description: string; quantity: number; unitPriceCents: number; discountPercent: number; vatRate: number; lineNetCents: number }[];
  options?: Partial<PdfOptions>;
};

export type PdfOptions = {
  template: "classic" | "minimal"; accent: "indigo" | "green" | "slate" | "orange" | "red";
  showLogo: boolean; showPayment: boolean; showBrand: boolean;
};
export const DEFAULT_PDF_OPTIONS: PdfOptions = { template: "classic", accent: "indigo", showLogo: true, showPayment: true, showBrand: true };
const ACCENTS = {
  indigo: rgb(0.31, 0.27, 0.9), green: rgb(0.09, 0.5, 0.28), slate: rgb(0.28, 0.33, 0.41), orange: rgb(0.85, 0.4, 0.05), red: rgb(0.75, 0.15, 0.15),
} as const;

const STATUS: Record<string, string> = { draft: "Bozza", sent: "Inviato", accepted: "Accettato", rejected: "Rifiutato", expired: "Scaduto" };
const PAGE = { w: 595.28, h: 841.89, margin: 48 };
const INK = rgb(0.1, 0.12, 0.18);
const MUTED = rgb(0.4, 0.43, 0.5);
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
  const opt: PdfOptions = { ...DEFAULT_PDF_OPTIONS, ...data.options };
  const ACCENT = opt.template === "minimal" ? INK : ACCENTS[opt.accent];
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

  // intestazione: logo (se presente) + dati aziendali a sinistra, numero preventivo a destra
  const org = data.organization;
  let leftY = y;
  let logoDrawn = false;
  if (org.logo && opt.showLogo) {
    try {
      const img = org.logo.type === "png" ? await pdf.embedPng(org.logo.bytes) : await pdf.embedJpg(org.logo.bytes);
      const scale = Math.min(150 / img.width, 48 / img.height, 1);
      const lw = img.width * scale, lh = img.height * scale;
      page.drawImage(img, { x: margin, y: leftY - lh, width: lw, height: lh });
      leftY -= lh + 8;
      logoDrawn = true;
    } catch {
      logoDrawn = false; // logo illeggibile: si ripiega sul solo nome
    }
  }
  if (logoDrawn) { text(org.name, margin, leftY - 8, { size: 11, font: bold }); leftY -= 18; }
  else { text(org.name, margin, leftY - 10, { size: 20, font: bold, color: ACCENT }); leftY -= 26; }
  const orgLines = [
    org.address,
    org.legalAddress && org.legalAddress !== org.address ? `Sede legale: ${org.legalAddress}` : null,
    [org.vatNumber && `P.IVA ${org.vatNumber}`, org.taxCode && `C.F. ${org.taxCode}`].filter(Boolean).join("  ·  "),
    [org.email, org.pec && `PEC ${org.pec}`, org.phone, org.website].filter(Boolean).join("  ·  "),
  ].filter((l): l is string => Boolean(l));
  for (const l of orgLines) for (const wl of wrap(l, font, 8.5, 300)) { text(wl, margin, leftY - 2, { size: 8.5, color: MUTED }); leftY -= 11; }
  textRight("PREVENTIVO", right, y - 6, { size: 11, font: bold, color: MUTED });
  textRight(`N. ${data.quote.number}`, right, y - 24, { size: 15, font: bold });
  y = Math.min(y - 44, leftY - 6); rule(y); y -= 22;

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

  if (opt.showPayment && (org.iban || org.bankName)) {
    ensure(36);
    text("Dati per il pagamento", margin, y, { size: 9, font: bold, color: MUTED }); y -= 14;
    for (const l of wrap([org.bankName, org.iban && `IBAN ${org.iban}`].filter(Boolean).join(" — "), font, 9.5, right - margin)) { ensure(14); text(l, margin, y, { size: 9.5 }); y -= 12.5; }
    y -= 8;
  }
  if (org.footer) {
    ensure(30);
    text("Informazioni", margin, y, { size: 9, font: bold, color: MUTED }); y -= 14;
    for (const l of wrap(org.footer, font, 9, right - margin)) { ensure(14); text(l, margin, y, { size: 9, color: MUTED }); y -= 12; }
  }

  // piè di pagina
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `Preventivo ${data.quote.number} · Pagina ${i + 1} di ${pages.length}`;
    p.drawText(pdfSafe(label), { x: margin, y: 28, size: 8, font, color: MUTED });
    if (opt.showBrand) {
      const brand = "Generato con NEXORA";
      p.drawText(brand, { x: right - font.widthOfTextAtSize(brand, 8), y: 28, size: 8, font, color: MUTED });
    }
  });

  return pdf.save();
}

export function quotePdfFilename(number: string): string {
  return `Preventivo-${number.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
}
