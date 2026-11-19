import { formatEur } from "@/lib/money";

type Row = { key: string; label: string; valueCents?: number; acceptedCents?: number; count: number };

/** Grafico a barre semplice (solo CSS) con tabella equivalente per screen reader. */
export function TrendChart({ rows, mode, caption }: { rows: Row[]; mode: "value" | "count"; caption: string }) {
  const val = (r: Row) => (mode === "value" ? (r.valueCents ?? 0) : r.count);
  const max = Math.max(1, ...rows.map(val));
  return (
    <figure>
      <figcaption className="mb-2 text-sm font-medium">{caption}</figcaption>
      <div className="flex h-32 items-end gap-1 overflow-x-auto" role="img" aria-label={caption}>
        {rows.map((r) => {
          const total = (val(r) / max) * 100;
          const acc = mode === "value" && val(r) > 0 ? ((r.acceptedCents ?? 0) / val(r)) * 100 : 0;
          return (
            <div key={r.key} className="flex min-w-6 flex-1 flex-col items-center justify-end gap-1" title={`${r.label}: ${mode === "value" ? formatEur(r.valueCents) : r.count}`}>
              <div className="relative flex w-full items-end rounded-t bg-primary/25" style={{ height: `${Math.max(total, val(r) > 0 ? 3 : 0)}%` }}>
                {acc > 0 && <div className="w-full rounded-t bg-primary" style={{ height: `${acc}%` }} />}
              </div>
              <span className="text-[10px] text-muted">{r.label}</span>
            </div>
          );
        })}
      </div>
      {mode === "value" && <p className="mt-1 flex gap-3 text-xs text-muted"><span><span className="mr-1 inline-block size-2 rounded-sm bg-primary/25" />Valore preventivi</span><span><span className="mr-1 inline-block size-2 rounded-sm bg-primary" />di cui accettati</span></p>}
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th>Mese</th><th>{mode === "value" ? "Valore" : "Numero"}</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}><td>{r.label}</td><td>{mode === "value" ? formatEur(r.valueCents) : r.count}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
