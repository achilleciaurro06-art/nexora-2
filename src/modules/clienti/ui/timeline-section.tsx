import Link from "next/link";
import { createClient } from "@/server/supabase/server";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { fmtTime } from "@/lib/datetime";
import { TIMELINE_FILTERS, eventHref, groupByDay, parseTimelineFilter, type TimelineEvent } from "../timeline";

const ICON: Record<string, string> = { quote: "📄", task: "✅", document: "📎", contact: "👤", note: "📝", customer: "🏢", appointment: "📅", call: "📞", follow_up: "🔁" };

export async function TimelineSection({ orgId, customerId, filter, names }: { orgId: string; customerId: string; filter?: string; names: Map<string, string> }) {
  const f = parseTimelineFilter(filter);
  const db = await createClient();
  let q = db.from("activity_events").select("id, entity, entity_id, summary, created_at, actor_id")
    .eq("organization_id", orgId).eq("customer_id", customerId).order("created_at", { ascending: false }).limit(100);
  if (f.entities) q = q.in("entity", [...f.entities]);
  const { data } = await q;
  const groups = groupByDay((data ?? []) as TimelineEvent[]);

  return (
    <Card id="timeline">
      <h2 className="mb-3 font-medium">Storico delle interazioni</h2>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Filtro timeline">
        {TIMELINE_FILTERS.map((x) => (
          <Link key={x.key} scroll={false} href={`/clienti/${customerId}?tab=documenti&tl=${x.key}#timeline`} aria-current={x.key === f.key ? "true" : undefined}
            className={buttonVariants({ variant: x.key === f.key ? "default" : "outline", size: "sm" })}>{x.label}</Link>
        ))}
      </nav>
      {groups.length === 0 ? <p className="text-sm text-muted">Nessun evento per questo filtro.</p> : (
        <ol className="space-y-4">
          {groups.map((g) => (
            <li key={g.day}>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{g.day}</p>
              <ul className="space-y-2 border-l border-border pl-4">
                {g.events.map((e) => {
                  const href = eventHref(e, customerId);
                  return (
                    <li key={e.id} className="text-sm">
                      <span aria-hidden className="mr-1">{ICON[e.entity] ?? "•"}</span>
                      {href ? <Link className="hover:underline" href={href}>{e.summary}</Link> : e.summary}
                      <span className="ml-2 text-xs text-muted">
                        {fmtTime(e.created_at)}
                        {e.actor_id ? ` · ${names.get(e.actor_id) ?? ""}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
