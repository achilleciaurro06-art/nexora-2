"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const LIMITS = { left: [200, 420], right: [260, 480] } as const;

/**
 * Workspace del Copilot a tre aree: cronologia · chat · contesto. I pannelli laterali si chiudono e si ridimensionano
 * (trascinando il bordo o con le frecce da tastiera); le preferenze sono ricordate nel browser. Sotto i 1024px le aree si impilano.
 */
export function CopilotWorkspace({ left, right, children }: { left: React.ReactNode; right: React.ReactNode; children: React.ReactNode }) {
  const [state, setState] = useState({ lOpen: true, rOpen: true, l: 248, r: 320 });
  const ref = useRef(state);
  useEffect(() => { ref.current = state; }, [state]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nx_copilot_ws") ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preferenza salvata, letta solo sul client
      if (saved && typeof saved === "object") setState((s) => ({ ...s, ...saved }));
    } catch { /* ignora */ }
  }, []);
  const set = useCallback((patch: Partial<typeof state>) => {
    setState((s) => { const n = { ...s, ...patch }; try { localStorage.setItem("nx_copilot_ws", JSON.stringify(n)); } catch { /* ignora */ } return n; });
  }, []);

  const drag = (side: "l" | "r") => (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, start = ref.current[side], [min, max] = side === "l" ? LIMITS.left : LIMITS.right;
    const move = (ev: PointerEvent) => set({ [side]: Math.min(max, Math.max(min, start + (side === "l" ? ev.clientX - startX : startX - ev.clientX))) } as Partial<typeof state>);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const key = (side: "l" | "r") => (e: React.KeyboardEvent) => {
    const [min, max] = side === "l" ? LIMITS.left : LIMITS.right;
    const step = e.key === "ArrowLeft" ? (side === "l" ? -24 : 24) : e.key === "ArrowRight" ? (side === "l" ? 24 : -24) : 0;
    if (step) { e.preventDefault(); set({ [side]: Math.min(max, Math.max(min, ref.current[side] + step)) } as Partial<typeof state>); }
  };

  const handle = (side: "l" | "r") => (
    <div role="separator" aria-orientation="vertical" aria-label={side === "l" ? "Ridimensiona la cronologia" : "Ridimensiona il contesto"} tabIndex={0} onPointerDown={drag(side)} onKeyDown={key(side)}
      className="group hidden w-2 shrink-0 cursor-col-resize items-stretch justify-center lg:flex"><span className="nx-t my-2 w-px bg-border group-hover:w-0.5 group-hover:bg-primary group-focus-visible:bg-primary" /></div>
  );

  return (
    <div className="flex min-h-[calc(100dvh-13rem)] flex-col gap-4 lg:h-[calc(100dvh-13rem)] lg:flex-row lg:gap-0" data-testid="copilot-workspace">
      {state.lOpen && <aside aria-label="Cronologia" className="max-h-60 min-h-0 shrink-0 overflow-hidden rounded-lg border border-border bg-card shadow-card lg:max-h-none lg:w-[var(--lw)]" style={{ "--lw": `${state.l}px` } as React.CSSProperties}>{left}</aside>}
      {state.lOpen && handle("l")}
      <section aria-label="Conversazione" className="relative flex min-h-[28rem] min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card lg:min-h-0">
        <div className="flex items-center justify-between border-b border-line px-2 py-1.5">
          <button type="button" onClick={() => set({ lOpen: !state.lOpen })} aria-label={state.lOpen ? "Chiudi la cronologia" : "Apri la cronologia"} aria-pressed={state.lOpen} className="nx-t hidden rounded-md p-1.5 text-muted hover:bg-foreground/[0.06] hover:text-foreground lg:inline-flex">{state.lOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}</button>
          <span className="px-2 text-xs font-medium text-muted lg:hidden">Conversazione</span>
          <button type="button" onClick={() => set({ rOpen: !state.rOpen })} aria-label={state.rOpen ? "Chiudi il contesto" : "Apri il contesto"} aria-pressed={state.rOpen} className="nx-t hidden rounded-md p-1.5 text-muted hover:bg-foreground/[0.06] hover:text-foreground lg:inline-flex">{state.rOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </section>
      {state.rOpen && handle("r")}
      {state.rOpen && <aside aria-label="Contesto" className="min-h-0 shrink-0 space-y-4 overflow-y-auto lg:w-[var(--rw)]" style={{ "--rw": `${state.r}px` } as React.CSSProperties}>{right}</aside>}
    </div>
  );
}

/** Cronologia con ricerca (filtro locale sui titoli già caricati). */
export function ConversationList({ items, activeId }: { items: { id: string; title: string }[]; activeId?: string }) {
  const [q, setQ] = useState("");
  const shown = items.filter((i) => i.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <Link href="/copilot?c=" data-testid="new-conversation" className="nx-t flex h-9 items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-white hover:bg-primary-hover"><Plus className="size-4" />Nuova conversazione</Link>
        <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cerca nelle conversazioni" placeholder="Cerca…" className="nx-t h-9 w-full rounded-md border border-border bg-card pl-8 pr-2 text-sm placeholder:text-muted/80 focus-visible:border-primary" /></div>
      </div>
      <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Recenti</p>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3 text-sm">
        {shown.length === 0 && <li className="px-2 py-3 text-xs text-muted">{items.length ? "Nessun risultato." : "Nessuna conversazione ancora."}</li>}
        {shown.map((v) => <li key={v.id}><Link href={`/copilot?c=${v.id}`} aria-current={v.id === activeId ? "page" : undefined} className={cn("nx-t block truncate rounded-md px-3 py-2", v.id === activeId ? "bg-primary/10 font-medium text-primary" : "text-foreground/80 hover:bg-foreground/[0.05]")}>{v.title || "Senza titolo"}</Link></li>)}
      </ul>
    </div>
  );
}
