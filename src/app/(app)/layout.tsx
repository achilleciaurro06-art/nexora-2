import Link from "next/link";
import { requireContext, isPlatformAdmin } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { refreshAndCountUnread } from "@/modules/notifiche/queries";
import { logoutAction, switchOrganizationAction } from "@/modules/auth/actions";
import { Nav } from "@/components/layout/nav";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { getSector } from "@/modules/settore/queries";
import { unreadCount } from "@/modules/email/queries";

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
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
      <aside className="no-print border-b border-border bg-card p-4 md:border-b-0 md:border-r">
        <p className="mb-4 text-xl font-bold tracking-tight text-primary">NEXORA</p>
        {ctx.orgs.length > 1 ? (
          <form action={switchOrganizationAction} className="mb-4">
            <Select name="organizationId" defaultValue={ctx.org.organizationId} aria-label="Organizzazione" className="text-xs">
              {ctx.orgs.map((o) => <option key={o.organizationId} value={o.organizationId}>{o.name}</option>)}
            </Select>
            <Button size="sm" variant="outline" className="mt-1 w-full">Cambia</Button>
          </form>
        ) : (
          <p className="mb-4 truncate text-sm text-muted">{ctx.org.name}</p>
        )}
        <Link href="/notifiche" className="mb-2 flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-border/50" aria-label={unread ? `Notifiche: ${unread} non lette` : "Notifiche"}>
          <span>Notifiche</span>
          {unread > 0 && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">{unread > 99 ? "99+" : unread}</span>}
        </Link>
        <Nav isPlatformAdmin={admin} labels={{ "/clienti": terms.customer_plural, "/preventivi": terms.quote_plural }} badges={{ "/email": emailUnread }} />
        <form action={logoutAction} className="mt-6">
          <Link href="/impostazioni/profilo" className="mb-2 flex items-center gap-2 rounded-md p-1 hover:bg-border/50" aria-label="Il tuo profilo">
            <Avatar name={ctx.fullName ?? ctx.email} url={avatarUrl} size={28} />
            <span className="truncate text-xs text-muted">{ctx.fullName ?? ctx.email}</span>
          </Link>
          <Button variant="outline" size="sm" className="w-full">Esci</Button>
        </form>
      </aside>
      <main className="min-w-0 p-4 md:p-8">{children}</main>
    </div>
  );
}
