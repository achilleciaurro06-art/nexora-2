import { describe, expect, it } from "vitest";
import {
  IMAGE_MIN_TOKENS, MAX_IMAGE_TOKENS, MAX_PDF_PAGES, PDF_TOKENS_PER_PAGE,
  countPdfPages, estimateAttachment, imageSize, imageTileTokens,
} from "@/server/ai/attachment-estimate";
import { fakeJpeg, fakePdf, fakePng } from "./ai-fixtures";

describe("stima dei token di un PDF", () => {
  it("conta gli oggetti pagina e non il nodo /Pages", () => {
    expect(countPdfPages(fakePdf(1))).toBe(1);
    expect(countPdfPages(fakePdf(7))).toBe(7);
    expect(countPdfPages(new TextEncoder().encode("%PDF-1.4 << /Type /Pages /Count 40 >>"))).toBe(0);
  });
  it("1.500 token a pagina: 1, 5 e 25 pagine", () => {
    expect(PDF_TOKENS_PER_PAGE).toBe(1500);
    expect(estimateAttachment("application/pdf", fakePdf(1)).tokens).toBe(1500);
    expect(estimateAttachment("application/pdf", fakePdf(5)).tokens).toBe(7500);
    const e = estimateAttachment("application/pdf", fakePdf(25));
    expect(e.tokens).toBe(37_500);
    expect(e.tooLarge).toBeUndefined();
  });
  it("oltre 25 pagine l'allegato è rifiutato con un messaggio chiaro", () => {
    expect(MAX_PDF_PAGES).toBe(25);
    const e = estimateAttachment("application/pdf", fakePdf(26));
    expect(e.tooLarge?.code).toBe("pdf_pages");
    expect(e.tooLarge?.message).toMatch(/26 pagine.*al massimo 25/);
  });
  it("senza oggetti pagina leggibili (stream compressi) si stima dalla dimensione, in modo prudente", () => {
    const blob = new Uint8Array(300_000); // 300 KB senza pagine dichiarate → 5 pagine ipotizzate
    const e = estimateAttachment("application/pdf", blob);
    expect(e.approximate).toBe(true);
    expect(e.pages).toBe(5);
    const big = estimateAttachment("application/pdf", new Uint8Array(3_000_000)); // 3 MB → 50 pagine ipotizzate → rifiutato
    expect(big.tooLarge?.code).toBe("pdf_pages");
    expect(big.tooLarge?.message).toContain("circa");
  });
  it("pochi oggetti pagina ma molti dati (scansioni): conta almeno una pagina ogni 400 KB", () => {
    const e = estimateAttachment("application/pdf", fakePdf(2, 9_000_000)); // 9 MB dichiarati su 2 pagine → almeno 23 pagine
    expect(e.pages).toBe(23);
    expect(e.tokens).toBe(23 * 1500);
    expect(estimateAttachment("application/pdf", fakePdf(2, 10_300_000)).tooLarge?.code).toBe("pdf_pages"); // > 25 pagine equivalenti
  });
});

describe("stima dei token di un'immagine", () => {
  it("legge le dimensioni di PNG e JPEG", () => {
    expect(imageSize(fakePng(4000, 3000))).toEqual({ width: 4000, height: 3000 });
    expect(imageSize(fakeJpeg(1280, 720))).toEqual({ width: 1280, height: 720 });
    expect(imageSize(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
  });
  it("mai sotto i 2.000 token, anche per un'icona", () => {
    expect(IMAGE_MIN_TOKENS).toBe(2000);
    expect(estimateAttachment("image/png", fakePng(200, 200)).tokens).toBe(2000);
    expect(estimateAttachment("image/jpeg", fakeJpeg(1024, 768)).tokens).toBeGreaterThanOrEqual(2000);
  });
  it("una foto da 12 megapixel supera i 2.000 token: la stima a riquadri la copre", () => {
    expect(imageTileTokens(4000, 3000)).toBe(258 * 6 * 4); // 6.192
    expect(estimateAttachment("image/png", fakePng(4000, 3000)).tokens).toBe(6192);
  });
  it("immagine di cui non si leggono le dimensioni: stima da circa 12 megapixel", () => {
    expect(estimateAttachment("image/png", new Uint8Array(100)).tokens).toBe(6200);
  });
  it("risoluzioni enormi sono rifiutate prima di prenotare crediti", () => {
    const e = estimateAttachment("image/png", fakePng(9000, 7000));
    expect(e.tokens).toBeGreaterThan(MAX_IMAGE_TOKENS);
    expect(e.tooLarge?.code).toBe("image_size");
  });
});
