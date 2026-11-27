// Allegati di prova (PDF e immagini minimi) per i test sulla stima dei token
/** PDF minimo con N oggetti pagina in chiaro (più un nodo /Pages che NON va contato). */
export function fakePdf(pages: number, extraBytes = 0): Uint8Array {
  const body = Array.from({ length: pages }, (_, i) => `${i + 3} 0 obj << /Type /Page /Parent 2 0 R >> endobj\n`).join("");
  return new TextEncoder().encode(`%PDF-1.4\n2 0 obj << /Type /Pages /Count ${pages} >> endobj\n${body}${"x".repeat(extraBytes)}\n%%EOF`);
}

/** Intestazione PNG con le dimensioni indicate. */
export function fakePng(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const v = new DataView(b.buffer);
  v.setUint32(8, 13); b.set([0x49, 0x48, 0x44, 0x52], 12); v.setUint32(16, width); v.setUint32(20, height);
  return b;
}

/** JPEG con un segmento APP0 e un SOF0 con le dimensioni indicate. */
export function fakeJpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]);
}

