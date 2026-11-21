import { type Addr, normAddress } from "./addresses";

export type MatchRow = { address: string; customer_id: string; contact_id: string | null; customer_name: string; archived: boolean };
export type Candidate = { customer_id: string; contact_id: string | null; name: string; archived: boolean };
export type LinkDecision = { status: "auto" | "suggested" | "none"; customerId: string | null; contactId: string | null; candidates: Candidate[] };

/**
 * Corrispondenza certa = un solo cliente identificato da indirizzi ESATTI (cliente o referente).
 * Più clienti (anche per lo stesso indirizzo) = proposta da confermare. Nessun indirizzo noto = nessun collegamento.
 * Mai collegamenti per somiglianza di nome o contenuto.
 */
export function decideLink(rows: MatchRow[]): LinkDecision {
  const byCustomer = new Map<string, MatchRow[]>();
  for (const r of rows) (byCustomer.get(r.customer_id) ?? byCustomer.set(r.customer_id, []).get(r.customer_id)!).push(r);
  if (byCustomer.size === 0) return { status: "none", customerId: null, contactId: null, candidates: [] };
  const candidates: Candidate[] = [...byCustomer.entries()].map(([id, rs]) => {
    const contacts = [...new Set(rs.map((r) => r.contact_id).filter((c): c is string => !!c))];
    return { customer_id: id, contact_id: contacts.length === 1 ? contacts[0]! : null, name: rs[0]!.customer_name, archived: rs[0]!.archived };
  });
  if (candidates.length > 1) return { status: "suggested", customerId: null, contactId: null, candidates: candidates.slice(0, 20) };
  const c = candidates[0]!;
  return { status: "auto", customerId: c.customer_id, contactId: c.contact_id, candidates: [] };
}

/** Indirizzi della controparte: per i messaggi ricevuti il mittente (se non è noto, i destinatari); per quelli inviati i destinatari. Mai la casella stessa. */
export function counterparties(m: { direction: "inbound" | "outbound"; from: Addr; to: Addr[]; cc: Addr[] }, own: string[]): string[] {
  const ownSet = new Set(own.map(normAddress));
  const not = (a: Addr) => !ownSet.has(normAddress(a.address));
  const uniq = (l: Addr[]) => [...new Set(l.filter(not).map((a) => normAddress(a.address)))];
  if (m.direction === "outbound") return uniq([...m.to, ...m.cc]);
  const f = uniq([m.from]);
  return f.length ? f : uniq([...m.to, ...m.cc]);
}
