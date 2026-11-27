import Link from "next/link";
import { LogOut } from "lucide-react";
import { requireContext, isPlatformAdmin } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { refreshAndCountUnread } from "@/modules/notifiche/queries";
import { logoutAction, switchOrganizationAction } from "@/modules/auth/actions";
import { Sidebar, BottomNav } from "@/components/layout/nav";
import { Logo } from "@/components/brand/logo";
import { Select } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { getSector } from "@/modules/settore/queries";
import { unreadCount } from "@/modules/email/queries";
import { CopilotDock } from "@/modules/copilot/ui/dock";
import { can } from "@/server/auth/permissions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const admin = await isPlatformAdmin(ctx.userId).catch(() => false);
  const db = await createClient();
  const [unread, { data: prof }, { terms }, emailUnread] = await Promise.all([
    refreshAndCountUnread(db, ctx.userId).catch(() => 0),
    db.from("profiles").select("avatar_path").eq("id", ctx.userId).maybeSingle(),
    getSector(db, ctx.org.organizationId),
    unreadCount(db, ctx.org.organizationId).catch(() => 0),
  ]);
  const avatarUrl = prof?.avatar_path ? (await db.storage.from("avatars").createSignedUrl(prof.avatar_path as string, 3600)).data?.signedUrl : null;
  const labels = { "/clienti": terms.customer_plural, "/preventivi": terms.quote_plural };

  const orgSlot = ctx.orgs.length > 1 ? (
    <form action={switchOrganizationAction} className="space-y-1.5">
      <Select name="organizationId" defaultValue={ctx.org.organizationId} aria-label="Organizzazione" className="h-9 border-white/15 bg-white/[0.06] text-xs text-white">
        {ctx.orgs.map((o) => <option key={o.organizationId} value={o.organizationId} className="text-foreground">{o.name}</option>)}
      </Select>
      <button className="nx-t w-full rounded-md border border-white/15 py-1 text-xs text-slate-300 hover:bg-white/10">Cambia</button>
    </form>
  ) : <p className="truncate rounded-md bg-white/[0.05] px-3 py-2 text-xs text-slate-300">{ctx.org.name}</p>;

  const userSlot = (
    <form action={logoutAction} className="space-y-2">
      <Link href="/impostazioni/profilo" className="nx-t flex items-center gap-2.5 rounded-md p-1.5 hover:bg-white/[0.06]" aria-label="Il tuo profilo">
        <Avatar name={ctx.fullName ?? ctx.email} url={avatarUrl} size={30} />
        <span className="min-w-0"><span className="block truncate text-xs font-medium text-white">{ctx.fullName ?? ctx.email}</span><span className="block truncate text-[11px] text-slate-400">{ctx.org.name}</span></span>
      </Link>
      <button className="nx-t flex h-9 w-full items-center justify-center gap-2 rounded-md border border-white/15 text-xs text-slate-300 hover:bg-white/10 hover:text-white"><LogOut className="size-3.5" />Esci</button>
    </form>
  );

  return (
    <div className="min-h-dvh md:flex">
      <Sidebar isPlatformAdmin={admin} labels={labels} badges={{ "/email": emailUnread }} unread={unread} orgSlot={orgSlot} userSlot={userSlot} />
      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-white/10 bg-carbon px-4 md:hidden">
          <Link href="/dashboard" aria-label="NEXORA home"><Logo size={24} /></Link>
          <Link href="/notifiche" aria-label={unread ? `Notifiche: ${unread} non lette` : "Notifiche"} className="relative rounded-md p-2 text-slate-300 hover:bg-white/10">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
            {unread > 0 && <span className="absolute right-1 top-1 size-2 rounded-full bg-sky" />}
          </Link>
        </header>
        <main className="mx-auto min-w-0 max-w-[1500px] p-4 pb-40 md:p-8 md:pb-24">{children}</main>
      </div>
      <BottomNav isPlatformAdmin={admin} labels={labels} unread={unread} userSlot={userSlot} />
      <CopilotDock canUse={can(ctx.org.role, "ai:use")} canConfirm={can(ctx.org.role, "data:write")} />
    </div>
  );
}
