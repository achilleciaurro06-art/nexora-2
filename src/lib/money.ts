/** Importi sempre in centesimi (interi). Le formule replicano quelle del database. */

export function formatEur(cents: number | bigint | null | undefined): string {
  const n = Number(cents ?? 0) / 100;
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
}

/** "1.234,56" | "1234.56" | "12" -> 123456. Ritorna null se non valido. */
export function parseEuroToCents(input: string): number | null {
  const s = input.trim().replace(/\s/g, "").replace(/€/g, "");
  if (!s) return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

export type LineInput = { quantity: number; unitPriceCents: number; discountPercent: number; vatRate: number };

export function lineNetCents(l: LineInput): number {
  return Math.round(l.quantity * l.unitPriceCents * (1 - l.discountPercent / 100));
}

export function quoteTotals(lines: LineInput[]) {
  let subtotal = 0;
  let vat = 0;
  for (const l of lines) {
    const net = lineNetCents(l);
    subtotal += net;
    vat += Math.round((net * l.vatRate) / 100);
  }
  return { subtotalCents: subtotal, vatCents: vat, totalCents: subtotal + vat };
}
