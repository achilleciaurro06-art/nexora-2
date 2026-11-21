export type Addr = { address: string; name?: string };

const LOCAL = "[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+";
const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const EMAIL_RE = new RegExp(`^${LOCAL}@${LABEL}(?:\\.${LABEL})+$`);

/** Indirizzo valido e privo di caratteri di controllo (nessuna iniezione di intestazioni). */
export function isValidEmail(v: string): boolean {
  return v.length <= 254 && !/[\r\n\0]/.test(v) && EMAIL_RE.test(v) && v.split("@")[0]!.length <= 64;
}
export const normAddress = (v: string) => v.trim().toLowerCase();

/** "Mario Rossi <mario@x.it>, altro@y.it; ..." -> indirizzi validi e stringhe non valide. Rifiuta ritorni a capo dentro un singolo indirizzo. */
export function parseAddressList(input: string): { ok: Addr[]; invalid: string[] } {
  const parts: string[] = [];
  let cur = "", inQuote = false, inAngle = false;
  for (const ch of input) {
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === "<") inAngle = true;
    else if (!inQuote && ch === ">") inAngle = false;
    if (!inQuote && !inAngle && (ch === "," || ch === ";" || ch === "\n")) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  const ok: Addr[] = [], invalid: string[] = [];
  for (const raw of parts.map((p) => p.trim()).filter(Boolean)) {
    const m = /^(?:"?([^"<]*)"?\s*)?<([^<>]+)>$/.exec(raw);
    const address = normAddress(m ? m[2]! : raw);
    const name = m?.[1]?.trim().replace(/[\r\n"<>]/g, "") || undefined;
    if (isValidEmail(address)) ok.push(name ? { address, name: name.slice(0, 120) } : { address });
    else invalid.push(raw.slice(0, 80));
  }
  return { ok: dedupeAddrs(ok), invalid };
}

export function dedupeAddrs(list: Addr[]): Addr[] {
  const seen = new Set<string>();
  return list.filter((a) => { const k = normAddress(a.address); if (seen.has(k)) return false; seen.add(k); return true; });
}
export const formatAddr = (a: Addr) => (a.name ? `${a.name} <${a.address}>` : a.address);
export const formatAddrList = (l: Addr[]) => l.map(formatAddr).join(", ");
export const addrOnly = (l: Addr[]) => l.map((a) => normAddress(a.address));
/** Converte il JSON salvato nel database in indirizzi, ignorando voci non valide. */
export function addrsFromJson(v: unknown): Addr[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => (x && typeof x === "object" && typeof (x as Addr).address === "string" && isValidEmail((x as Addr).address) ? [{ address: normAddress((x as Addr).address), name: typeof (x as Addr).name === "string" ? (x as Addr).name : undefined }] : []));
}
