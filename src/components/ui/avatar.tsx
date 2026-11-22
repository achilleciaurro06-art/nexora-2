/* eslint-disable @next/next/no-img-element -- immagine da URL firmato temporaneo */
import { cn } from "@/lib/utils";

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

export function Avatar({ name, url, size = 32, className }: { name: string | null | undefined; url?: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) };
  return url ? (
    <img src={url} alt="" width={size} height={size} style={style} className={cn("shrink-0 rounded-full border border-border object-cover", className)} />
  ) : (
    <span aria-hidden style={style} className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-primary/12 font-semibold text-primary", className)}>{initials(name)}</span>
  );
}
