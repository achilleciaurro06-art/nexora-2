import Link from "next/link";
import { cn } from "@/lib/utils";

const ITEMS = [
  { key: "promemoria", href: "/promemoria", label: "Promemoria" },
  { key: "attivita", href: "/attivita", label: "Attività" },
  { key: "appuntamenti", href: "/appuntamenti", label: "Appuntamenti" },
  { key: "followup", href: "/followup", label: "Follow-up" },
  { key: "chiamate", href: "/chiamate", label: "Chiamate" },
] as const;

/** Barra comune alle cinque viste dell'agenda: da qualsiasi punto si passa alle altre senza tornare al menu. */
export function AgendaNav({ active }: { active: (typeof ITEMS)[number]["key"] }) {
  return (
    <nav aria-label="Sezioni agenda" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {ITEMS.map((i) => (
        <Link key={i.key} href={i.href} aria-current={i.key === active ? "page" : undefined}
          className={cn("nx-t -mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-foreground", i.key === active && "border-primary font-medium text-foreground")}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
