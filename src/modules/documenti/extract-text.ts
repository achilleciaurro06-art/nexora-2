import "server-only";
import JSZip from "jszip";

/** Limiti anti zip-bomb e anti-costi: l'AI non deve ricevere contenuti sproporzionati. */
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 60_000;
const MAX_SHEETS = 5;
const MAX_ROWS = 500;
const MAX_COLS = 30;

export class DocumentReadError extends Error {}

async function readEntry(zip: JSZip, name: string): Promise<string | null> {
  const entry = zip.file(name);
  if (!entry) return null;
  const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof declared === "number" && declared > MAX_ENTRY_BYTES) throw new DocumentReadError("Il documento è troppo grande una volta decompresso");
  const text = await entry.async("string");
  if (text.length > MAX_ENTRY_BYTES) throw new DocumentReadError("Il documento è troppo grande una volta decompresso");
  return text;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ""));

async function openZip(bytes: Uint8Array): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(bytes);
  } catch {
    throw new DocumentReadError("File non leggibile o danneggiato");
  }
}

export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const zip = await openZip(bytes);
  const xml = await readEntry(zip, "word/document.xml");
  if (!xml) throw new DocumentReadError("Non è un documento Word valido");
  const text = decodeEntities(
    xml
      .replace(/<w:tab\s*\/>/g, "\t")
      .replace(/<w:br\s*\/?>/g, "\n")
      .replace(/<\/w:tc>/g, " | ")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/(\s\|)+\s*\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.slice(0, MAX_TEXT_CHARS);
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function extractXlsxText(bytes: Uint8Array): Promise<string> {
  const zip = await openZip(bytes);
  if (!zip.file("xl/workbook.xml")) throw new DocumentReadError("Non è un foglio Excel valido");

  const sharedXml = (await readEntry(zip, "xl/sharedStrings.xml")) ?? "";
  const shared: string[] = [];
  for (const si of sharedXml.matchAll(/<si[\s>][\s\S]*?<\/si>/g)) {
    const parts = [...si[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => stripTags(m[1] ?? ""));
    shared.push(parts.join(""));
  }

  const names = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1])).slice(0, MAX_SHEETS);
  if (names.length === 0) throw new DocumentReadError("Il foglio Excel non contiene dati");

  const out: string[] = [];
  let budget = MAX_TEXT_CHARS;
  for (const [i, name] of names.entries()) {
    const xml = (await readEntry(zip, name)) ?? "";
    const lines: string[] = [];
    let rows = 0;
    for (const row of xml.matchAll(/<row[\s>][\s\S]*?<\/row>/g)) {
      if (rows++ >= MAX_ROWS) { lines.push("[…righe successive omesse]"); break; }
      const cells: string[] = [];
      for (const c of row[0].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1] ?? "";
        const ref = /r="([A-Z]+\d+)"/i.exec(attrs)?.[1];
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const body = c[2] ?? "";
        const idx = ref ? colIndex(ref) : cells.length;
        if (idx >= MAX_COLS) continue;
        let value = "";
        if (type === "inlineStr") value = stripTags(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
        else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
          value = type === "s" ? (shared[Number(v)] ?? "") : decodeEntities(v);
        }
        while (cells.length < idx) cells.push("");
        cells[idx] = value.replace(/[\t\r\n]+/g, " ").trim();
      }
      if (cells.some((v) => v !== "")) lines.push(cells.join("\t"));
    }
    const block = `# Foglio ${i + 1}\n${lines.join("\n")}`;
    out.push(block.slice(0, Math.max(0, budget)));
    budget -= block.length;
    if (budget <= 0) break;
  }
  return out.join("\n\n").slice(0, MAX_TEXT_CHARS);
}

export async function extractDocumentText(mime: string, bytes: Uint8Array): Promise<string> {
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return extractDocxText(bytes);
  if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return extractXlsxText(bytes);
  throw new DocumentReadError("Formato non supportato per l'estrazione del testo");
}
