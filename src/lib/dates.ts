/** Helper di data usabili dai Server Component (la lint vieta Date.now() direttamente nel render). */
export function isoDayOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
export function isoOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}
