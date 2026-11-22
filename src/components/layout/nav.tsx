"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, CalendarDays, ChevronsLeft, ChevronsRight, FileText, FolderOpen, LayoutDashboard, Mail, MoreHorizontal, Package, Phone, Settings, ShieldCheck, Sparkles, Users, X, CheckSquare, Clock, Repeat, BellRing } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo, LogoMark } from "@/components/brand/logo";

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; };
const MAIN: Item[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clienti", label: "Clienti", icon: Users },
  { href: "/preventivi", label: "Preventivi", icon: FileText },
  { href: "/catalogo", label: "Catalogo", icon: Package },
  { href: "/email", label: "Email", icon: Mail },
  { href: "/documenti", label: "Documenti", icon: FolderOpen },
];
/** Agenda: raggruppa le sezioni già esistenti (nessuna route nuova). */
const AGENDA: Item[] = [
  { href: "/promemoria", label: "Promemoria", icon: BellRing },
  { href: "/attivita", label: "Attività", icon: CheckSquare },
  { href: "/appuntamenti", label: "Appuntamenti", icon: Clock },
  { href: "/followup", label: "Follow-up", icon: Repeat },
  { href: "/chiamate", label: "Chiamate", icon: Phone },
];
const COPILOT: Item = { href: "/copilot", label: "Copilot AI", icon: Sparkles };
const SETTINGS: Item = { href: "/impostazioni", label: "Impostazioni", icon: Settings };
const ADMIN: Item = { href: "/admin", label: "Amministrazione", icon: ShieldCheck };

const on = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

type Props = { isPlatformAdmin: boolean; labels?: Record<string, string>; badges?: Record<string, number>; unread: number; orgSlot: React.ReactNode; userSlot: React.ReactNode };

export function Sidebar({ isPlatformAdmin, labels = {}, badges = {}, unread, orgSlot, userSlot }: Props) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    // lettura della preferenza salvata (solo client): evita differenze tra server e primo render
    try {
      const saved = localStorage.getItem("nx_sidebar");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(saved ? saved === "1" : window.innerWidth < 1024); // tablet: a icone; l'utente può espandere
    } catch { /* ignora */ }
  }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("nx_sidebar", c ? "0" : "1"); } catch { /* ignora */ } return !c; });
  const label = (i: Item) => labels[i.href] ?? i.label;

  const link = (i: Item, opts: { child?: boolean } = {}) => {
    const active = on(path, i.href);
    const Icon = i.icon;
    const badge = badges[i.href] ?? 0;
    return (
      <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} title={collapsed ? label(i) : undefined}
        className={cn("nx-t group relative flex items-center gap-3 rounded-md px-3 text-sm", opts.child ? "h-9 text-[0.82rem]" : "h-10",
          active ? "bg-primary/20 font-medium text-white" : "text-slate-300 hover:bg-white/[0.06] hover:text-white", collapsed && "justify-center px-0")}>
        {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-sky" />}
        <Icon className={cn("size-[18px] shrink-0", active ? "text-sky" : "text-slate-400 group-hover:text-slate-200")} />
        {!collapsed && <span className="truncate">{label(i)}</span>}
        {badge > 0 && <span className={cn("rounded-sm bg-primary px-1.5 text-[11px] font-semibold text-white", collapsed ? "absolute right-1.5 top-1" : "ml-auto")} aria-label={`${badge} non lette`}>{badge}</span>}
      </Link>
    );
  };

  return (
    <aside className={cn("no-print sticky top-0 hidden h-dvh shrink-0 flex-col bg-carbon text-slate-200 md:flex nx-t", collapsed ? "w-[72px]" : "w-[248px]")}>
      <div className={cn("flex h-16 items-center border-b border-white/[0.07] px-4", collapsed ? "justify-center" : "justify-between")}>
        <Link href="/dashboard" aria-label="NEXORA home">{collapsed ? <LogoMark size={28} /> : <Logo />}</Link>
        {!collapsed && <button type="button" onClick={toggle} aria-label="Riduci la barra laterale" className="nx-t rounded-md p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white"><ChevronsLeft className="size-4" /></button>}
      </div>
      {collapsed && <button type="button" onClick={toggle} aria-label="Espandi la barra laterale" className="nx-t mx-auto mt-2 rounded-md p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white"><ChevronsRight className="size-4" /></button>}
      {!collapsed && <div className="px-4 pt-4">{orgSlot}</div>}

      <nav className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3" aria-label="Principale">
        {MAIN.map((i) => link(i))}
        <p className={cn("flex items-center gap-2 px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500", collapsed && "justify-center px-0")}>
          <CalendarDays className="size-3.5" />{!collapsed && "Agenda"}
        </p>
        {AGENDA.map((i) => link(i, { child: true }))}
        {isPlatformAdmin && <div className="pt-2">{link(ADMIN)}</div>}
      </nav>

      <div className="space-y-1 border-t border-white/[0.07] p-3">
        <Link href={COPILOT.href} aria-current={on(path, COPILOT.href) ? "page" : undefined} title={collapsed ? "Copilot AI" : undefined}
          className={cn("nx-t relative flex h-11 items-center gap-3 overflow-hidden rounded-md px-3 text-sm font-medium text-white ring-1 ring-sky/30 hover:ring-sky/60", collapsed && "justify-center px-0",
            on(path, COPILOT.href) ? "bg-gradient-to-r from-primary to-[#0a3ad0]" : "bg-gradient-to-r from-deep to-[#0b2270]")}>
          <Sparkles className="size-[18px] shrink-0 text-sky" />
          {!collapsed && <span>Copilot AI</span>}
        </Link>
        <Link href="/notifiche" aria-label={unread ? `Notifiche: ${unread} non lette` : "Notifiche"} title={collapsed ? "Notifiche" : undefined}
          className={cn("nx-t relative flex h-10 items-center gap-3 rounded-md px-3 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white", collapsed && "justify-center px-0")}>
          <Bell className="size-[18px] shrink-0 text-slate-400" />
          {!collapsed && <span>Notifiche</span>}
          {unread > 0 && <span className={cn("rounded-sm bg-primary px-1.5 text-[11px] font-semibold text-white", collapsed ? "absolute right-1.5 top-1" : "ml-auto")}>{unread > 99 ? "99+" : unread}</span>}
        </Link>
        {link(SETTINGS)}
        <div className={cn("pt-2", collapsed && "hidden")}>{userSlot}</div>
      </div>
    </aside>
  );
}

/** Mobile: barra in basso con le sezioni principali; «Altro» apre le sezioni secondarie. */
export function BottomNav({ isPlatformAdmin, labels = {}, unread, userSlot }: { isPlatformAdmin: boolean; labels?: Record<string, string>; unread: number; userSlot: React.ReactNode }) {
  const path = usePathname();
  // il pannello «Altro» è legato alla pagina in cui è stato aperto: cambiando pagina si chiude da solo
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === path;
  const setOpen = (v: boolean) => setOpenAt(v ? path : null);
  const primary: Item[] = [MAIN[0]!, MAIN[1]!, MAIN[2]!, { href: "/promemoria", label: "Agenda", icon: CalendarDays }];
  const agendaOn = AGENDA.some((a) => on(path, a.href));
  const more: Item[] = [MAIN[3]!, MAIN[4]!, MAIN[5]!, ...AGENDA.slice(1), COPILOT, { href: "/notifiche", label: "Notifiche", icon: Bell }, SETTINGS, ...(isPlatformAdmin ? [ADMIN] : [])];
  const moreOn = more.some((m) => on(path, m.href)) && !agendaOn;
  return (
    <>
      <nav aria-label="Navigazione mobile" className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-white/10 bg-carbon pb-[env(safe-area-inset-bottom)] md:hidden">
        {primary.map((i) => {
          const active = i.label === "Agenda" ? agendaOn : on(path, i.href);
          const Icon = i.icon;
          return (
            <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={cn("nx-t flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-white" : "text-slate-400")}>
              <Icon className={cn("size-5", active && "text-sky")} />{labels[i.href] ?? i.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setOpen(true)} aria-label="Altre sezioni" className={cn("nx-t relative flex flex-col items-center gap-0.5 py-2 text-[11px]", moreOn || open ? "text-white" : "text-slate-400")}>
          <MoreHorizontal className="size-5" />Altro
          {unread > 0 && <span className="absolute right-[28%] top-1.5 size-2 rounded-full bg-sky" />}
        </button>
      </nav>
      {open && (
        <div className="no-print fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Altre sezioni">
          <button type="button" aria-label="Chiudi" className="absolute inset-0 bg-deep/60" onClick={() => setOpen(false)} />
          <div className="nx-rise absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-xl bg-carbon p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-200">
            <div className="mb-3 flex items-center justify-between"><Logo size={24} /><button type="button" onClick={() => setOpen(false)} aria-label="Chiudi" className="rounded-md p-2 hover:bg-white/10"><X className="size-5" /></button></div>
            <ul className="grid grid-cols-3 gap-2">
              {more.map((i) => {
                const Icon = i.icon;
                return (
                  <li key={i.href}>
                    <Link href={i.href} className={cn("nx-t flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border border-white/10 text-xs", i.href === "/copilot" ? "bg-gradient-to-br from-deep to-[#0b2270] text-white" : "bg-white/[0.04] hover:bg-white/10", on(path, i.href) && "border-sky/60")}>
                      <Icon className="size-5 text-sky" />{labels[i.href] ?? i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 border-t border-white/10 pt-3">{userSlot}</div>
          </div>
        </div>
      )}
    </>
  );
}
