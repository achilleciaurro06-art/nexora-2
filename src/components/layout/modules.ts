import { Bell, BellRing, CheckSquare, Clock, FileText, FolderOpen, LayoutDashboard, Mail, Phone, Repeat, Settings, ShieldCheck, Sparkles, Users, type LucideIcon } from "lucide-react";

/**
 * Identità cromatica dei moduli: ogni sezione ha SEMPRE lo stesso colore (menu, intestazione di pagina, indicatori).
 * Il colore aiuta a orientarsi; gli stati (ambra/verde/rosso/grigio) hanno una codifica propria e separata.
 */
export type ModuleKey = "dashboard" | "clienti" | "preventivi" | "email" | "documenti" | "agenda" | "copilot" | "sistema";
export type ModuleStyle = { icon: LucideIcon; chip: string; onDark: string; bar: string };

const STYLE: Record<ModuleKey, Omit<ModuleStyle, "icon">> = {
  dashboard: { chip: "bg-surface-blue text-primary", onDark: "text-[#8fb0ff]", bar: "bg-primary" },
  clienti: { chip: "bg-surface-violet text-violet", onDark: "text-[#bda9ff]", bar: "bg-violet" },
  preventivi: { chip: "bg-surface-blue text-primary", onDark: "text-[#8fb0ff]", bar: "bg-primary" },
  email: { chip: "bg-surface-teal text-teal", onDark: "text-[#5fd9cf]", bar: "bg-teal" },
  documenti: { chip: "bg-surface-amber text-warning", onDark: "text-[#fbc66b]", bar: "bg-warning" },
  agenda: { chip: "bg-[#d8f0f8] text-[#0e7490]", onDark: "text-[#67d4ee]", bar: "bg-[#0e7490]" },
  copilot: { chip: "bg-surface-blue text-primary", onDark: "text-sky", bar: "bg-sky" },
  sistema: { chip: "bg-surface-slate text-[#475569]", onDark: "text-slate-400", bar: "bg-[#475569]" },
};
const ICON: Record<ModuleKey, LucideIcon> = { dashboard: LayoutDashboard, clienti: Users, preventivi: FileText, email: Mail, documenti: FolderOpen, agenda: Clock, copilot: Sparkles, sistema: Settings };

export const moduleStyle = (k: ModuleKey, icon?: LucideIcon): ModuleStyle => ({ ...STYLE[k], icon: icon ?? ICON[k] });

/** Modulo di appartenenza di un percorso dell'app. */
export function moduleOf(path: string): ModuleKey {
  const p = "/" + (path.split("?")[0] ?? "").split("/").filter(Boolean)[0];
  if (p === "/dashboard") return "dashboard";
  if (p === "/clienti") return "clienti";
  if (p === "/preventivi" || p === "/catalogo") return "preventivi";
  if (p === "/email") return "email";
  if (p === "/documenti") return "documenti";
  if (["/promemoria", "/attivita", "/appuntamenti", "/followup", "/chiamate"].includes(p)) return "agenda";
  if (p === "/copilot") return "copilot";
  return "sistema";
}
export const NAV_ICON = { promemoria: BellRing, attivita: CheckSquare, appuntamenti: Clock, followup: Repeat, chiamate: Phone, notifiche: Bell, admin: ShieldCheck } as const;
