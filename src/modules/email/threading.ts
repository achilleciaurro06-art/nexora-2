const PREFIX = /^\s*((re|r|fwd|fw|i|rif|ris|aw|wg|sv)\s*(\[\d+\])?\s*:\s*)+/i;
/** "Re: Fwd: Preventivo  2026" -> "preventivo 2026" */
export function normalizeSubject(s: string): string {
  return s.replace(PREFIX, "").replace(/\s+/g, " ").trim().toLowerCase();
}
export const isReplySubject = (s: string) => /^\s*(re|r|rif|ris|aw|sv)\s*(\[\d+\])?\s*:/i.test(s);
export const isForwardSubject = (s: string) => /^\s*(fwd|fw|i|wg)\s*:/i.test(s);

export const cleanMessageId = (id: string | null | undefined): string | null => {
  const v = (id ?? "").trim();
  return v && v.length <= 998 ? v : null;
};
export function parseReferences(v: string | string[] | null | undefined): string[] {
  const list = Array.isArray(v) ? v : (v ?? "").split(/\s+/);
  return [...new Set(list.map((x) => x.trim()).filter((x) => x.startsWith("<") && x.endsWith(">")).filter((x) => x.length <= 998))].slice(0, 100);
}

/**
 * Decide a quale conversazione appartiene un messaggio, SOLO in base agli identificativi (mai per somiglianza di oggetto):
 * 1) identificativo di conversazione del provider; 2) In-Reply-To / References (dal più vicino al più lontano).
 */
export function pickThread(
  msg: { providerThreadId?: string | null; inReplyTo?: string | null; references?: string[] },
  known: { byProviderThread: Map<string, string>; byMessageId: Map<string, string> },
): string | null {
  if (msg.providerThreadId && known.byProviderThread.has(msg.providerThreadId)) return known.byProviderThread.get(msg.providerThreadId)!;
  const refs = [msg.inReplyTo, ...[...(msg.references ?? [])].reverse()].filter((x): x is string => !!x);
  for (const r of refs) if (known.byMessageId.has(r)) return known.byMessageId.get(r)!;
  return null;
}
/** Identificativi da cercare nel database per un messaggio in arrivo. */
export const lookupIds = (msg: { inReplyTo?: string | null; references?: string[] }) => [...new Set([msg.inReplyTo, ...(msg.references ?? [])].filter((x): x is string => !!x))];
