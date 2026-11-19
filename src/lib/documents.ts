/** Categorie e tipi consentiti per l'archivio documentale (condivisi da upload, filtri e analisi). */
export const DOCUMENT_MIME: Record<string, { category: DocumentCategory; label: string }> = {
  "application/pdf": { category: "pdf", label: "PDF" },
  "image/png": { category: "image", label: "Immagine" },
  "image/jpeg": { category: "image", label: "Immagine" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { category: "word", label: "Word" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { category: "excel", label: "Excel" },
  "text/plain": { category: "other", label: "Testo" },
  "text/csv": { category: "other", label: "CSV" },
};

export type DocumentCategory = "pdf" | "word" | "excel" | "image" | "other";

export const CATEGORY_FILTERS: { key: DocumentCategory | "all"; label: string }[] = [
  { key: "all", label: "Tutti" }, { key: "pdf", label: "PDF" }, { key: "word", label: "Word" },
  { key: "excel", label: "Excel" }, { key: "image", label: "Immagini" }, { key: "other", label: "Altro" },
];

export const ALLOWED_DOCUMENT_MIMES = new Set(Object.keys(DOCUMENT_MIME));

export function documentCategory(mime: string): DocumentCategory {
  return DOCUMENT_MIME[mime]?.category ?? "other";
}
export function documentLabel(mime: string): string {
  return DOCUMENT_MIME[mime]?.label ?? "File";
}
export function mimesForCategory(cat: string): string[] | null {
  if (!CATEGORY_FILTERS.some((c) => c.key === cat) || cat === "all") return null;
  return Object.entries(DOCUMENT_MIME).filter(([, v]) => v.category === cat).map(([m]) => m);
}
/** Tipi che l'analisi AI sa leggere. */
export const ANALYZABLE_MIMES = new Set([
  "application/pdf", "image/png", "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
