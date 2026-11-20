"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/clienti", label: "Clienti" },
  { href: "/preventivi", label: "Preventivi" },
  { href: "/catalogo", label: "Catalogo" },
  { href: "/attivita", label: "Attività" },
  { href: "/appuntamenti", label: "Appuntamenti" },
  { href: "/chiamate", label: "Chiamate" },
  { href: "/followup", label: "Follow-up" },
  { href: "/promemoria", label: "Promemoria" },
  { href: "/documenti", label: "Documenti" },
  { href: "/copilot", label: "Copilot AI" },
  { href: "/impostazioni", label: "Impostazioni" },
];

export function Nav({ isPlatformAdmin, labels = {} }: { isPlatformAdmin: boolean; labels?: Record<string, string> }) {
  const path = usePathname();
  const base = ITEMS.map((i) => ({ ...i, label: labels[i.href] ?? i.label }));
  const items = isPlatformAdmin ? [...base, { href: "/admin", label: "Amministrazione" }] : base;
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label="Principale">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={path.startsWith(i.href) ? "page" : undefined}
          className={cn("whitespace-nowrap rounded-md px-3 py-2 text-sm hover:bg-border/50", path.startsWith(i.href) && "bg-primary/10 font-medium text-primary")}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
