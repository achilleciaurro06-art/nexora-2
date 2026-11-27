"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { moduleOf, moduleStyle } from "./modules";

/** Pittogramma del modulo corrente nell'intestazione di pagina (colore e icona derivano dal percorso). */
export function ModuleChip({ className }: { className?: string }) {
  const m = moduleStyle(moduleOf(usePathname()));
  const Icon = m.icon;
  return <span aria-hidden className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-md", m.chip, className)}><Icon className="size-5" /></span>;
}
