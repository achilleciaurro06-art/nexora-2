"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "./chat";
import { parsePageContext, suggestedQuestions } from "../page-context";

export const COPILOT_EVENT = "nexora:copilot";

/**
 * Copilot sempre a portata di mano: pannello laterale su ogni pagina. Conosce la pagina aperta (solo il percorso viene inviato:
 * il server verifica l'elemento con i permessi dell'utente). La conversazione continua mentre si naviga nell'app.
 */
export function CopilotDock({ canUse, canConfirm }: { canUse: boolean; canConfirm: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [auto, setAuto] = useState<{ text: string; nonce: number } | undefined>();
  const [conv, setConv] = useState<string | undefined>();
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const h = (e: Event) => {
      const q = (e as CustomEvent<{ question?: string }>).detail?.question;
      setOpen(true);
      if (q) setAuto({ text: q, nonce: Date.now() });
    };
    window.addEventListener(COPILOT_EVENT, h);
    return () => window.removeEventListener(COPILOT_EVENT, h);
  }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  // nella dashboard e nella pagina Copilot la chat è già in pagina: niente pannello flottante
  if (!canUse || pathname.startsWith("/copilot") || pathname === "/dashboard") return null;
  const page = parsePageContext(pathname);
  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="nx-t no-print fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 md:bottom-4 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-primary to-[#0a3ad0] pl-4 pr-5 text-sm font-medium text-primary-foreground shadow-lg ring-1 ring-sky/40 hover:ring-sky/80 hover:shadow-xl active:translate-y-px" aria-label="Apri il Copilot AI, l'assistente intelligente di NEXORA" title="Copilot AI: l'assistente intelligente di NEXORA" data-testid="copilot-open">
          <Sparkles className="size-[18px] text-sky" aria-hidden />
          Copilot AI
        </button>
      )}
      {open && (
        <section role="dialog" aria-label="Copilot AI" aria-modal="false" className="no-print fixed inset-x-2 bottom-2 z-50 flex max-h-[88dvh] flex-col rounded-xl border border-border bg-card p-3 shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[440px]" data-testid="copilot-dock">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="size-4 text-primary" aria-hidden />Copilot AI</p>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => { setConv(undefined); setAuto(undefined); setEpoch((n) => n + 1); }}>Nuova</Button>
              {conv && <Link href={`/copilot?c=${conv}`} className="px-2 text-xs underline">Apri a schermo intero</Link>}
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)} aria-label="Chiudi il Copilot">Chiudi</Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ChatPanel key={epoch} initialMessages={[]} canUse={canUse} canConfirm={canConfirm} path={pathname} suggestions={suggestedQuestions(page)} compact autoQuestion={auto} onConversation={setConv} />
          </div>
        </section>
      )}
    </>
  );
}
