import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "./ai-helpers";
import { fakePdf, fakePng } from "./ai-fixtures";

const runAi = vi.fn();
vi.mock("@/server/ai/run", () => ({ runAi: (...a: unknown[]) => runAi(...a) }));
import { analyzeDocument } from "@/modules/documenti/analysis";

const DOC = "55555555-5555-4555-8555-555555555555", ORG = "00000000-0000-4000-8000-0000000000a1";
function setup(mime: string, bytes: Uint8Array) {
  const db = fakeDb({ documents: [{ id: DOC, organization_id: ORG, name: "x", storage_path: "x/x", mime_type: mime, size_bytes: bytes.byteLength, content_hash: null }], customers: [], quotes: [], ai_suggestions: [] });
  (db as unknown as { storage: unknown }).storage = { from: () => ({ download: async () => ({ data: new Blob([bytes as BlobPart]), error: null }) }) };
  return db;
}
beforeEach(() => { runAi.mockReset(); runAi.mockResolvedValue({ ok: false, kind: "provider", error: "x" }); });

describe("analisi documenti: limiti sugli allegati", () => {
  it("PDF da 26 pagine: rifiutato prima di qualsiasi chiamata AI (quindi prima di prenotare crediti e di chiamare il provider)", async () => {
    const db = setup("application/pdf", fakePdf(26));
    const r = await analyzeDocument({ db, orgId: ORG, userId: "u", documentId: DOC });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/26 pagine.*al massimo 25/);
    expect(runAi).not.toHaveBeenCalled();
    expect(db.calls.some((c) => c.table === "documents" && c.op === "update" && JSON.stringify(c.payload).includes("failed"))).toBe(true);
  });
  it("PDF da 25 pagine: accettato e inviato all'AI", async () => {
    await analyzeDocument({ db: setup("application/pdf", fakePdf(25)), orgId: ORG, userId: "u", documentId: DOC });
    expect(runAi).toHaveBeenCalledTimes(1);
    expect(runAi.mock.calls[0]![0].req.attachment.mimeType).toBe("application/pdf");
  });
  it("immagine con risoluzione enorme: rifiutata prima della chiamata AI", async () => {
    const r = await analyzeDocument({ db: setup("image/png", fakePng(9000, 7000)), orgId: ORG, userId: "u", documentId: DOC });
    expect(r).toMatchObject({ ok: false });
    expect(runAi).not.toHaveBeenCalled();
  });
});
