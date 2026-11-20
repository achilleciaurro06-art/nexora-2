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

export default async function NotificationsPage() {
  const ctx = await requireContext();
  const db = await createClient();
  // layout e pagina si caricano in parallelo: si aggiorna qui (idempotente) perché l'elenco includa subito gli avvisi nuovi
  await db.rpc("refresh_my_notifications");
  const { data } = await db.from("notifications").select("id, kind, title, body, link, read_at, created_at, organization_id")
    .eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(100);
  const rows = data ?? [];
  const unread = rows.filter((n) => !n.read_at).length;
  const orgName = new Map(ctx.orgs.map((o) => [o.organizationId, o.name]));
  return (
    <>
      <PageHeader title="Notifiche" description="Scadenze, follow-up, promemoria e attività assegnate a te. Solo notifiche interne: nessuna email viene inviata."
        actions={unread > 0 ? <form action={markAllNotificationsReadAction}><Button variant="outline">Segna tutte come lette ({unread})</Button></form> : null} />
      {rows.length === 0 ? (
        <Card><p className="text-sm text-muted">Nessuna notifica. Le troverai qui quando un&apos;attività sta per scadere, un follow-up è dovuto o ti viene assegnato un compito.</p></Card>
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
