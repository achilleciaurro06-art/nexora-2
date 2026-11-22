import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/modules/notifiche/actions";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Notifiche" };

const KIND_LABEL: Record<string, string> = {
  task_due_soon: "In scadenza", task_overdue: "Scaduta", quote_followup: "Follow-up preventivo", reminder: "Promemoria", task_assigned: "Assegnata a te", followup_due: "Follow-up", appointment_soon: "Appuntamento",
};

const CATEGORIES = [
  { key: "tutte", label: "Tutte", kinds: null as string[] | null },
  { key: "attivita", label: "Attività", kinds: ["task_due_soon", "task_overdue", "task_assigned"] },
  { key: "followup", label: "Follow-up", kinds: ["quote_followup", "followup_due"] },
  { key: "agenda", label: "Promemoria e appuntamenti", kinds: ["reminder", "appointment_soon"] },
];

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ cat?: string; nonlette?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  // layout e pagina si caricano in parallelo: si aggiorna qui (idempotente) perché l'elenco includa subito gli avvisi nuovi
  await db.rpc("refresh_my_notifications");
  const { data } = await db.from("notifications").select("id, kind, title, body, link, read_at, created_at, organization_id")
    .eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(100);
  const all = data ?? [];
  const unread = all.filter((n) => !n.read_at).length;
  const cat = CATEGORIES.find((c) => c.key === sp.cat) ?? CATEGORIES[0]!;
  const onlyUnread = sp.nonlette === "1";
  const rows = all.filter((n) => (!cat.kinds || cat.kinds.includes(n.kind as string)) && (!onlyUnread || !n.read_at));
  const count = (kinds: string[] | null) => all.filter((n) => !n.read_at && (!kinds || kinds.includes(n.kind as string))).length;
  const link = (c: string, u: boolean) => `/notifiche?${new URLSearchParams({ ...(c !== "tutte" ? { cat: c } : {}), ...(u ? { nonlette: "1" } : {}) }).toString()}`;
  const orgName = new Map(ctx.orgs.map((o) => [o.organizationId, o.name]));
  return (
    <>
      <PageHeader title="Notifiche" description="Scadenze, follow-up, promemoria e attività assegnate a te. Solo notifiche interne: nessuna email viene inviata."
        actions={unread > 0 ? <form action={markAllNotificationsReadAction}><Button variant="outline">Segna tutte come lette ({unread})</Button></form> : null} />
      <nav aria-label="Categorie" className="mb-4 flex flex-wrap items-center gap-1 border-b border-border">
        {CATEGORIES.map((c) => (
          <Link key={c.key} href={link(c.key, onlyUnread)} aria-current={c.key === cat.key ? "page" : undefined}
            className={`nx-t -mb-px border-b-2 px-3 py-2 text-sm ${c.key === cat.key ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-foreground"}`}>
            {c.label}{count(c.kinds) > 0 && <span className="ml-1.5 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">{count(c.kinds)}</span>}
          </Link>
        ))}
        <Link href={link(cat.key, !onlyUnread)} aria-pressed={onlyUnread} className={`nx-t ml-auto rounded-md px-2.5 py-1 text-xs ${onlyUnread ? "bg-primary/10 font-medium text-primary" : "text-muted hover:text-foreground"}`}>Solo non lette</Link>
      </nav>
      {rows.length === 0 ? (
        <Card><p className="text-sm text-muted">{all.length ? "Nessuna notifica in questa vista." : "Nessuna notifica. Le troverai qui quando un'attività sta per scadere, un follow-up è dovuto o ti viene assegnato un compito."}</p></Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => (
            <li key={n.id as string}>
              <Card className={`flex flex-wrap items-start justify-between gap-3 p-4 ${n.read_at ? "opacity-70" : "border-primary/40"}`}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge>{KIND_LABEL[n.kind as string] ?? (n.kind as string)}</Badge>
                    {ctx.orgs.length > 1 && <span className="text-xs text-muted">{orgName.get(n.organization_id as string)}</span>}
                    {!n.read_at && <span className="text-xs font-medium text-primary">nuova</span>}
                  </p>
                  <p className="mt-1 font-medium">{n.link ? <Link className="hover:underline" href={n.link as string}>{n.title as string}</Link> : (n.title as string)}</p>
                  {n.body ? <p className="text-sm text-muted">{n.body as string}</p> : null}
                  <p className="mt-1 text-xs text-muted">{new Date(n.created_at as string).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</p>
                </div>
                {!n.read_at && <form action={markNotificationReadAction.bind(null, n.id as string)}><Button size="sm" variant="ghost">Segna come letta</Button></form>}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
