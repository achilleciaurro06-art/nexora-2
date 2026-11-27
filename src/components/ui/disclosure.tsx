import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sezione richiudibile per la «progressive disclosure»: i dettagli avanzati restano nel modulo (i campi vengono inviati
 * anche da chiusa) ma non occupano la schermata finché servono. Funziona senza JavaScript (elemento <details>).
 */
export function Disclosure({ title, hint, defaultOpen = false, className, children }: { title: string; hint?: string; defaultOpen?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className={cn("group rounded-md border border-line", className)}>
      <summary className="nx-t flex cursor-pointer list-none items-center gap-2 rounded-md px-3.5 py-2.5 text-sm font-medium hover:bg-primary/[0.04] [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-muted transition-transform group-open:rotate-90" aria-hidden />
        <span>{title}</span>
        {hint && <span className="truncate text-xs font-normal text-muted">{hint}</span>}
      </summary>
      <div className="border-t border-line p-3.5">{children}</div>
    </details>
  );
}
