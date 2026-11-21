import { normalizeName } from "@/modules/documenti/extraction";

/** Serializza e tronca: ogni risultato di strumento ha un tetto di caratteri, per tenere sotto controllo i costi. */
export function clampJson(value: unknown, maxChars: number): string {
  const s = JSON.stringify(value);
  if (s.length <= maxChars) return s;
  if (Array.isArray(value)) {
    let items = value;
    while (items.length > 1 && JSON.stringify(items).length > maxChars - 40) items = items.slice(0, Math.ceil(items.length * 0.7));
    return JSON.stringify(items).slice(0, maxChars) + (JSON.stringify(items).length > maxChars ? "…" : "");
  }
  // oggetti: si riducono gli array interni più lunghi prima di troncare (il JSON resta valido più a lungo)
  if (value && typeof value === "object") {
    const obj = { ...(value as Record<string, unknown>) };
    for (let guard = 0; guard < 30; guard++) {
      const str = JSON.stringify(obj);
      if (str.length <= maxChars) return str;
      const biggest = Object.entries(obj).filter(([, v]) => Array.isArray(v) && v.length > 1).sort((a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length)[0];
      if (!biggest) break;
      obj[biggest[0]] = (biggest[1] as unknown[]).slice(0, Math.ceil((biggest[1] as unknown[]).length * 0.7));
      obj._troncato = true;
    }
  }
  return JSON.stringify(value).slice(0, maxChars) + "…";
}

/** Risoluzione prudente di un nome: corrispondenza esatta normalizzata; altrimenti l'unico candidato che lo contiene. */
export function resolveByName<T extends { id: string; name: string }>(candidates: T[], name: string | undefined | null): T | null {
  const n = normalizeName(name ?? "");
  if (n.length < 3) return null;
  const exact = candidates.filter((c) => normalizeName(c.name) === n);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const partial = candidates.filter((c) => { const cn = normalizeName(c.name); return cn.includes(n) || n.includes(cn); });
  return partial.length === 1 ? partial[0]! : null;
}
