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
    <nav aria-label="Sezioni delle impostazioni" className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-2">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={path.startsWith(i.href) ? "page" : undefined}
          className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm hover:bg-border/50", path.startsWith(i.href) && "bg-primary/10 font-medium text-primary")}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
