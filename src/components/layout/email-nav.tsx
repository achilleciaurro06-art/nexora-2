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
    <nav aria-label="Sezioni email" className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-2">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={active(i) ? "page" : undefined}
          className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm hover:bg-border/50", active(i) && "bg-primary/10 font-medium text-primary")}>
          {i.label}{"badge" in i && unread > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground" data-testid="unread-badge">{unread}</span>}
        </Link>
      ))}
    </nav>
  );
}
