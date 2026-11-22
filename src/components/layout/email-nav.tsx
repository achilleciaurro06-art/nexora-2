"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/email", label: "Posta in arrivo", folder: "arrivo", badge: true }, { href: "/email?cartella=inviate", label: "Inviate", folder: "inviate" },
  { href: "/email?cartella=bozze", label: "Bozze", folder: "bozze" }, { href: "/email?cartella=tutte", label: "Tutte le email", folder: "tutte" },
  { href: "/email/caselle", label: "Caselle collegate", path: "/email/caselle" }, { href: "/email/modelli", label: "Modelli", path: "/email/modelli" },
] as const;

export function EmailNav({ unread }: { unread: number }) {
  const path = usePathname();
  const folder = useSearchParams().get("cartella") ?? "arrivo";
  const active = (i: (typeof ITEMS)[number]) => ("path" in i ? path.startsWith(i.path) : path === "/email" && folder === i.folder);
  return (
    <nav aria-label="Sezioni email" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={active(i) ? "page" : undefined}
          className={cn("flex items-center gap-1.5 whitespace-nowrap nx-t -mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-foreground", active(i) && "border-primary font-medium text-primary hover:text-primary")}>
          {i.label}{"badge" in i && unread > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground" data-testid="unread-badge">{unread}</span>}
        </Link>
      ))}
    </nav>
  );
}
