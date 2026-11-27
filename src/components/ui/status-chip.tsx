import { Archive, Check, CircleDot, Clock, Minus, Pencil, Send, X, AlertTriangle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Codifica cromatica unica degli stati in tutta l'app. Il colore non è mai l'unico segnale: ogni chip ha testo e icona.
 * - warning (ambra): in preparazione, in attesa, da gestire
 * - success (verde): fatto, completato, positivo
 * - danger (rosso): perso, scaduto, errore, richiede attenzione
 * - neutral (grigio): chiuso o non attivo, senza un esito positivo
 * - info (blu): programmato / informativo, in attesa di una data
 */
export type Tone = "warning" | "success" | "danger" | "neutral" | "info";

export const TONE_CLASS: Record<Tone, string> = {
  warning: "border-warning/30 bg-warning/10 text-warning",
  success: "border-success/30 bg-success/10 text-success",
  danger: "border-danger/30 bg-danger/10 text-danger",
  neutral: "border-border bg-foreground/[0.05] text-foreground/70",
  info: "border-primary/30 bg-primary/10 text-primary",
};
/** Colore pieno per barre e indicatori (stessa semantica dei chip). */
export const TONE_BAR: Record<Tone, string> = { warning: "bg-warning", success: "bg-success", danger: "bg-danger", neutral: "bg-muted/60", info: "bg-primary" };

export const TONE_ICON: Record<Tone, LucideIcon> = { warning: Clock, success: Check, danger: X, neutral: Minus, info: CircleDot };
export const ICON = { draft: Pencil, sent: Send, closed: Archive, alert: AlertTriangle } as const;

export function StatusChip({ tone, icon, round, className, children, ...rest }: { tone: Tone; icon?: LucideIcon; round?: boolean; className?: string; children: React.ReactNode } & Omit<React.HTMLAttributes<HTMLSpanElement>, "className" | "children">) {
  const Icon = icon ?? TONE_ICON[tone];
  return (
    <span {...rest} className={cn("inline-flex items-center gap-1 border px-2 py-0.5 text-xs font-medium", round ? "rounded-full" : "rounded-sm", TONE_CLASS[tone], className)}>
      <Icon className="size-3 shrink-0" aria-hidden />
      {children}
    </span>
  );
}
