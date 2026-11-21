/** Prezzo di un prodotto per un cliente: prezzo di listino se il cliente ha un listino con quel prodotto, altrimenti prezzo base. */
export function priceFor(product: { id: string; unit_price_cents: number }, listId: string | undefined, listPrices: Record<string, Record<string, number>>): { cents: number; fromList: boolean } {
  const p = listId ? listPrices[listId]?.[product.id] : undefined;
  return p !== undefined ? { cents: p, fromList: true } : { cents: Number(product.unit_price_cents), fromList: false };
}
