import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
/** Client Supabase finto: tabelle in memoria; supporta eq/in/is/neq/order/limit/maybeSingle/single (basta per testare logica di risoluzione e strumenti). */
export function fakeDb(tables: Record<string, Row[]>, opts: { rpc?: Record<string, unknown> } = {}): SupabaseClient & { calls: { table: string; op: string; payload?: unknown }[] } {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let mode: "select" | "insert" | "update" = "select"; let payload: unknown;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const chain: Record<string, unknown> = {
      select: () => chain,
      insert: (p: unknown) => { mode = "insert"; payload = p; calls.push({ table, op: "insert", payload: p }); return chain; },
      update: (p: unknown) => { mode = "update"; payload = p; calls.push({ table, op: "update", payload: p }); return chain; },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return chain; },
      neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return chain; },
      in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return chain; },
      is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return chain; },
      not: () => chain, gte: () => chain, lte: () => chain, lt: () => chain, gt: () => chain, ilike: () => chain, or: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => (mode === "insert" ? { data: { id: "new-id", ...(payload as Row) }, error: null } : { data: rows()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => res({ data: mode === "select" ? rows() : null, error: null, count: rows().length }),
    };
    return chain;
  };
  const rpc = async (name: string) => ({ data: opts.rpc?.[name] ?? [], error: null });
  return { from, rpc, calls } as unknown as SupabaseClient & { calls: { table: string; op: string; payload?: unknown }[] };
}
