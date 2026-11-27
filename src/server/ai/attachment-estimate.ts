/**
 * Stima PRUDENTE dei token di un allegato (PDF o immagine) PRIMA della chiamata al provider.
 * Serve alla prenotazione dei crediti: una stima troppo bassa farebbe entrare una richiesta che poi consuma molto di più.
 * Se la stima supera i limiti del prodotto l'allegato viene rifiutato prima di qualsiasi prenotazione o chiamata al provider.
 *
 * Ipotesi (non verificate sul modello configurato, da riverificare se cambia il modello):
 * - PDF: 1.500 token a pagina (testo + resa grafica della pagina).
 * - Immagini: almeno 2.000 token; per le foto grandi si usa il peso a riquadri della documentazione Gemini 2.x
 *   (258 token per riquadro, lato del riquadro = min(lato corto / 1,5) tra 256 e 768 px), perché a risoluzioni alte supera i 2.000.
 */
export const PDF_TOKENS_PER_PAGE = 1500;
export const MAX_PDF_PAGES = 25;
export const IMAGE_MIN_TOKENS = 2000;
export const IMAGE_TILE_TOKENS = 258;
/** Oltre questa stima l'immagine è rifiutata (circa il 5% del limite mensile da 200.000 token). */
export const MAX_IMAGE_TOKENS = 10_000;
/** Immagine di cui non si leggono le dimensioni: si assume una foto da circa 12 megapixel. */
const IMAGE_UNKNOWN_TOKENS = 6_200;
/** PDF senza oggetti «pagina» leggibili (stream compressi): si ipotizzano 60 KB a pagina. */
const PDF_FALLBACK_BYTES_PER_PAGE = 60_000;
/** Un PDF non può avere meno di una pagina ogni 400 KB: protegge da PDF con pochi oggetti pagina dichiarati ma molti dati (scansioni). */
const PDF_MAX_BYTES_PER_PAGE = 400_000;
/** Allegato di tipo non previsto: stima forfettaria storica. */
const OTHER_TOKENS = 4_000;

export type AttachmentEstimate = {
  tokens: number;
  pages?: number;
  /** true se il numero di pagine è dedotto dalla dimensione del file (nessun oggetto pagina leggibile) */
  approximate?: boolean;
  tooLarge?: { code: "pdf_pages" | "image_size"; message: string };
};

/** Conta gli oggetti `/Type /Page` (non `/Pages`). Restituisce 0 se le pagine sono dentro stream compressi. */
export function countPdfPages(bytes: Uint8Array): number {
  const s = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  return s.match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
}

export function estimatePdfPages(bytes: Uint8Array): { pages: number; approximate: boolean } {
  const declared = countPdfPages(bytes);
  const base = declared > 0 ? declared : Math.max(1, Math.ceil(bytes.byteLength / PDF_FALLBACK_BYTES_PER_PAGE));
  return { pages: Math.max(base, Math.ceil(bytes.byteLength / PDF_MAX_BYTES_PER_PAGE), 1), approximate: declared === 0 };
}

/** Larghezza e altezza di un PNG o JPEG leggendo solo l'intestazione; null se non riconosciuto. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const b = bytes;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1]!;
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
      const len = (b[i + 2]! << 8) | b[i + 3]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]! };
      }
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

/** Token d'immagine con il peso a riquadri (limite superiore): 258 se entrambi i lati sono ≤ 384 px. */
export function imageTileTokens(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return IMAGE_UNKNOWN_TOKENS;
  if (width <= 384 && height <= 384) return IMAGE_TILE_TOKENS;
  const crop = Math.min(768, Math.max(256, Math.floor(Math.min(width, height) / 1.5)));
  return IMAGE_TILE_TOKENS * Math.ceil(width / crop) * Math.ceil(height / crop);
}

export function estimateAttachment(mimeType: string, bytes: Uint8Array): AttachmentEstimate {
  if (mimeType === "application/pdf") {
    const { pages, approximate } = estimatePdfPages(bytes);
    const tokens = pages * PDF_TOKENS_PER_PAGE;
    if (pages > MAX_PDF_PAGES) {
      return { tokens, pages, approximate, tooLarge: { code: "pdf_pages", message: `Il PDF ha ${approximate ? "circa " : ""}${pages} pagine: l'analisi AI ne accetta al massimo ${MAX_PDF_PAGES}. Carica solo le pagine utili o dividi il documento.` } };
    }
    return { tokens, pages, approximate };
  }
  if (mimeType.startsWith("image/")) {
    const size = imageSize(bytes);
    const tiles = size ? imageTileTokens(size.width, size.height) : IMAGE_UNKNOWN_TOKENS;
    const tokens = Math.max(IMAGE_MIN_TOKENS, tiles);
    if (tokens > MAX_IMAGE_TOKENS) {
      return { tokens, tooLarge: { code: "image_size", message: "L'immagine ha una risoluzione troppo alta per l'analisi AI: riducine le dimensioni e riprova." } };
    }
    return { tokens };
  }
  return { tokens: OTHER_TOKENS };
}
