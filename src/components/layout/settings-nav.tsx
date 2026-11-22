"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/impostazioni/azienda", label: "Azienda" },
  { href: "/impostazioni/profilo", label: "Profilo" },
  { href: "/impostazioni/team", label: "Team" },
  { href: "/impostazioni/preventivi", label: "Preventivi" },
  { href: "/impostazioni/settore", label: "Settore" },
  { href: "/impostazioni/notifiche", label: "Notifiche" },
  { href: "/impostazioni/ai", label: "AI" },
  { href: "/impostazioni/email", label: "Email" },
  { href: "/impostazioni/aspetto", label: "Aspetto" },
];

export function SettingsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Sezioni delle impostazioni" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={path.startsWith(i.href) ? "page" : undefined}
          className={cn("whitespace-nowrap nx-t -mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-foreground", path.startsWith(i.href) && "bg-primary/10 font-medium text-primary")}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
