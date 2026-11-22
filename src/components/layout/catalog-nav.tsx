"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [{ href: "/catalogo", label: "Prodotti e servizi", exact: true }, { href: "/catalogo/listini", label: "Listini" }, { href: "/catalogo/modelli", label: "Modelli di preventivo" }];

export function CatalogNav() {
  const path = usePathname();
  const active = (i: (typeof ITEMS)[number]) => (i.exact ? path === i.href || /^\/catalogo\/(nuovo|[0-9a-f-]{36})$/.test(path) : path.startsWith(i.href));
  return (
    <nav aria-label="Sezioni del catalogo" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={active(i) ? "page" : undefined}
          className={cn("whitespace-nowrap nx-t -mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-foreground", active(i) && "border-primary font-medium text-primary hover:text-primary")}>{i.label}</Link>
      ))}
    </nav>
  );
}
