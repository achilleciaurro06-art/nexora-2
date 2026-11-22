import Link from "next/link";
import { createClient } from "@/server/supabase/server";
import { listThreads } from "../queries";
import { formatAddrList } from "../addresses";
import { Avatar } from "@/components/ui/avatar";
import { fmtDate, fmtTime, todayIn } from "@/lib/datetime";
import { cn } from "@/lib/utils";

const when = (iso: string) => (todayIn(new Date(iso)) === todayIn(new Date()) ? fmtTime(iso) : fmtDate(iso));

/** Colonna sinistra della lettura email (stile client di posta): ultime conversazioni, con quella aperta evidenziata. Sola lettura. */
export async function ThreadPane({ orgId, activeId }: { orgId: string; activeId?: string }) {
  const threads = await listThreads(await createClient(), orgId, { folder: "tutte", limit: 40 });
  return (
    <nav aria-label="Conversazioni recenti" className="hidden max-h-[calc(100dvh-14rem)] overflow-y-auto rounded-lg border border-border bg-card shadow-card lg:block" data-testid="thread-pane">
      <ul className="divide-y divide-line">
        {threads.length === 0 && <li className="p-4 text-sm text-muted">Nessuna conversazione.</li>}
        {threads.map((t) => {
          const l = t.last, unread = t.unread_count > 0, from = l ? (l.direction === "inbound" ? l.from_name || l.from_address : `A: ${formatAddrList(l.to) || "—"}`) : "—";
          return (
            <li key={t.id}>
              <Link href={`/email/${t.id}`} aria-current={t.id === activeId ? "page" : undefined}
                className={cn("nx-t flex gap-3 border-l-[3px] px-3 py-3 text-sm hover:bg-primary/[0.04]", t.id === activeId ? "border-primary bg-primary/[0.06]" : "border-transparent")}>
                <Avatar name={from} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2"><span className={cn("truncate", unread ? "font-semibold" : "font-medium")}>{from}</span><span className="shrink-0 text-[11px] text-muted">{l ? when(l.message_at) : ""}</span></span>
                  <span className={cn("block truncate", unread && "font-medium")}>{t.subject || "(senza oggetto)"}</span>
                </span>
                {unread && <span aria-label={`${t.unread_count} non lette`} className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
