import { formatEur } from "@/lib/money";

type Row = { key: string; label: string; valueCents?: number; acceptedCents?: number; count: number };

/** Grafico a barre semplice (solo CSS) con tabella equivalente per screen reader. */
export function TrendChart({ rows, mode, caption }: { rows: Row[]; mode: "value" | "count"; caption: string }) {
  const val = (r: Row) => (mode === "value" ? (r.valueCents ?? 0) : r.count);
  const max = Math.max(1, ...rows.map(val));
  return (
    <figure>
      <figcaption className="mb-3 text-sm font-semibold text-foreground/75">{caption}</figcaption>
      <div className="relative h-44" role="img" aria-label={caption}>
        {/* linee guida */}
        <div aria-hidden className="absolute inset-0 flex flex-col justify-between pb-5">{[0, 1, 2, 3].map((i) => <div key={i} className="border-t border-dashed border-line" />)}</div>
        <div className="absolute inset-0 flex items-stretch gap-2 pb-0">
          {rows.map((r) => {
            const total = (val(r) / max) * 100;
            const acc = mode === "value" && val(r) > 0 ? ((r.acceptedCents ?? 0) / val(r)) * 100 : 0;
            return (
              <div key={r.key} className="group flex min-w-6 flex-1 flex-col" title={`${r.label}: ${mode === "value" ? formatEur(r.valueCents) : r.count}`}>
                <div className="relative flex flex-1 items-end justify-center pb-0">
                  <div className="relative w-full max-w-10 overflow-hidden rounded-t-sm bg-primary/25 transition-[height,background-color] duration-200 group-hover:bg-primary/35" style={{ height: `${Math.max(total, val(r) > 0 ? 3 : 0)}%` }}>
                    {acc > 0 && <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-success to-[#27b887]" style={{ height: `${acc}%` }} />}
                    {mode === "count" && val(r) > 0 && <div className="absolute inset-0 bg-gradient-to-t from-violet to-[#9a7bff]" />}
                  </div>
                </div>
                <span className="h-5 pt-1 text-center text-[10px] text-muted">{r.label}</span>
              </div>
            );
          })}
        </div>
      </div>
      {mode === "value" && <p className="mt-2 flex gap-4 text-xs text-muted"><span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-primary/25" />Valore preventivi</span><span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-success" />di cui accettati</span></p>}
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th>Mese</th><th>{mode === "value" ? "Valore" : "Numero"}</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}><td>{r.label}</td><td>{mode === "value" ? formatEur(r.valueCents) : r.count}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
