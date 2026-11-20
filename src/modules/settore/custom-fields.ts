export type FieldType = "text" | "number" | "date" | "select" | "boolean";
export type CustomFieldDef = { id?: string; entity: "customer" | "quote"; key: string; label: string; field_type: FieldType; options: string[]; required: boolean; position?: number; active: boolean };
export type CustomValues = Record<string, string | number | boolean>;

export const FIELD_TYPE_LABEL: Record<FieldType, string> = { text: "Testo", number: "Numero", date: "Data", select: "Scelta da elenco", boolean: "Sì / No" };
export const cfName = (key: string) => `cf_${key}`;

/** Chiave tecnica dal nome mostrato ("Tipo di infisso" -> "tipo_di_infisso"), univoca rispetto a quelle già usate. */
export function slugKey(label: string, taken: Iterable<string>, max = 34): string {
  const used = new Set(taken);
  const base = (label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[0-9]+/, "") || "campo").slice(0, max);
  let key = base, n = 2;
  while (used.has(key)) key = `${base.slice(0, max - String(n).length - 1)}_${n++}`;
  return key;
}

type Input = Record<string, FormDataEntryValue | null | undefined>;

/**
 * Valida i valori dei campi personalizzati inviati da un modulo e li unisce a quelli già salvati.
 * I valori di campi disattivati o non più definiti restano intatti (nessuna perdita di dati).
 */
export function parseCustomValues(defs: CustomFieldDef[], input: Input, existing: unknown = {}): { ok: true; values: CustomValues } | { ok: false; error: string } {
  const values: CustomValues = {};
  const ex = existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as CustomValues) : {};
  const active = new Map(defs.filter((d) => d.active).map((d) => [d.key, d]));
  for (const [k, v] of Object.entries(ex)) if (!active.has(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) values[k] = v;
  for (const d of active.values()) {
    const raw = input[cfName(d.key)];
    const s = typeof raw === "string" ? raw.trim() : "";
    if (d.field_type === "boolean") { values[d.key] = raw === "on"; continue; }
    if (!s) {
      if (d.required) return { ok: false, error: `Compila il campo «${d.label}»` };
      continue;
    }
    if (d.field_type === "text") {
      if (s.length > 500) return { ok: false, error: `«${d.label}»: massimo 500 caratteri` };
      values[d.key] = s;
    } else if (d.field_type === "number") {
      const n = Number(s.replace(",", "."));
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) return { ok: false, error: `«${d.label}»: numero non valido` };
      values[d.key] = n;
    } else if (d.field_type === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) return { ok: false, error: `«${d.label}»: data non valida` };
      values[d.key] = s;
    } else if (d.field_type === "select") {
      if (!d.options.includes(s)) return { ok: false, error: `«${d.label}»: scelta non valida` };
      values[d.key] = s;
    }
  }
  return { ok: true, values };
}

export function displayValue(def: CustomFieldDef, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (def.field_type === "boolean") return value ? "Sì" : "No";
  if (def.field_type === "date" && typeof value === "string") return new Date(value).toLocaleDateString("it-IT");
  if (def.field_type === "number" && typeof value === "number") return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3, useGrouping: "always" }).format(value);
  return String(value);
}
