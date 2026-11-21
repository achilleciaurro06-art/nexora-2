import "server-only";
import { z } from "zod";

export const eur = (cents: unknown) => Math.round(Number(cents ?? 0)) / 100;
export const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
export const daysBetween = (fromIso: string, to: Date) => Math.max(0, Math.floor((to.getTime() - new Date(fromIso).getTime()) / 86_400_000));
export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data AAAA-MM-GG");
export const limitArg = (def: number, max: number) => z.number().int().min(1).max(max).default(def);

/**
 * Testo scritto da TERZI (email, note, descrizioni dei clienti): è un DATO, mai un'istruzione.
 * Viene racchiuso in un campo esplicito, ripulito da caratteri di controllo e dai nostri delimitatori, e troncato.
 */
export function untrusted(text: unknown, max = 600): { non_attendibile: string } {
  const s = String(text ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/<\/?\s*(DATI_STRUMENTO|DATI_AZIENDA|ISTRUZIONI)[^>]*>/gi, "[tag rimosso]").replace(/\s+\n/g, "\n").trim();
  return { non_attendibile: s.length > max ? `${s.slice(0, max)}…` : s };
}

/** Interpreta in modo sicuro il testo da usare in `ilike` (niente caratteri jolly o separatori della sintassi PostgREST). */
export function likeTerm(q: string): string {
  return q.replace(/[%_\\,()*"'`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function monthKey(d: string | Date): string {
  const s = typeof d === "string" ? d : d.toISOString();
  return s.slice(0, 7);
}
export function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => { const t = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)); return t.toISOString().slice(0, 7); });
}
export const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
