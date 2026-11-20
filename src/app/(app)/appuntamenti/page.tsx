import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listMembers } from "@/modules/organizzazioni/queries";
import { CAL_VIEWS, isDateStr, monthGrid, parseCalView, shiftDate, titleFor, visibleRange, weekDays } from "@/modules/appuntamenti/calendar";
import { APPOINTMENT_STATUS_LABEL } from "@/modules/agenda/types";
import { Alert, Card, PageHeader, Table } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { dayRangeUtc, fmtDate, fmtTime, todayIn, utcToZonedParts } from "@/lib/datetime";
import { isUuid } from "@/lib/ids";
import { cn } from "@/lib/utils";

export const metadata = { title: "Appuntamenti" };
type Row = { id: string; title: string; starts_at: string; ends_at: string; status: string; location: string | null; assignee_id: string | null; customer_id: string | null; customers: { name: string } | { name: string }[] | null };
const WD = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ vista?: string; data?: string; resp?: string; quando?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const now = new Date();
  const today = todayIn(now);
  const list = sp.vista === "elenco";
  const view = parseCalView(sp.vista);
  const date = isDateStr(sp.data) ? sp.data : today;
  const members = await listMembers(db, orgId);
  const canWrite = can(ctx.org.role, "data:write");
  const resp = sp.resp === "me" ? ctx.userId : isUuid(sp.resp) ? sp.resp : null;

  let q = db.from("appointments").select("id, title, starts_at, ends_at, status, location, assignee_id, customer_id, customers(name)").eq("organization_id", orgId).is("deleted_at", null).limit(500);
  const quando = sp.quando === "passati" ? "passati" : "prossimi";
  if (list) {
    q = quando === "prossimi" ? q.gte("ends_at", now.toISOString()).eq("status", "scheduled").order("starts_at") : q.or(`ends_at.lt.${now.toISOString()},status.in.(completed,cancelled)`).order("starts_at", { ascending: false });
  } else {
    const r = visibleRange(view, date);
    q = q.gte("starts_at", dayRangeUtc(r.from).from).lt("starts_at", dayRangeUtc(r.to).from).neq("status", "cancelled").order("starts_at");
  }
  if (resp) q = q.eq("assignee_id", resp);
  const { data } = await q;
  const rows = (data ?? []) as unknown as Row[];
  const byDay = new Map<string, Row[]>();
  for (const a of rows) { const k = utcToZonedParts(a.starts_at).date; (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(a); }

  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ vista: sp.vista, data: sp.data, resp: sp.resp, quando: sp.quando, ...over })) if (v) p.set(k, v);
    return `/appuntamenti?${p.toString()}`;
  };
  const cname = (a: Row) => { const c = Array.isArray(a.customers) ? a.customers[0] : a.customers; return c?.name; };
  const Chip = ({ a, full }: { a: Row; full?: boolean }) => (
    <Link href={`/appuntamenti/${a.id}`} data-testid="appointment" data-status={a.status}
      className={cn("block truncate rounded border border-border bg-primary/10 px-1.5 py-0.5 text-xs hover:bg-primary/20", a.status === "completed" && "opacity-60 line-through")}>
      {fmtTime(a.starts_at)}{full ? `–${fmtTime(a.ends_at)}` : ""} {a.title}{full && cname(a) ? ` · ${cname(a)}` : ""}
    </Link>
  );

  return (
    <>
      <PageHeader title="Appuntamenti" description="Calendario e elenco degli appuntamenti con i clienti. Gli orari sono quelli dell'azienda (Europa/Roma)."
        actions={canWrite ? <Link href={`/appuntamenti/nuovo${!list && sp.data ? `?data=${date}` : ""}`} className={buttonVariants()}>Nuovo appuntamento</Link> : null} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav className="flex gap-1" aria-label="Vista">
          {CAL_VIEWS.map((v) => <Link key={v.key} href={href({ vista: v.key, quando: undefined })} aria-current={!list && v.key === view ? "page" : undefined} className={buttonVariants({ variant: !list && v.key === view ? "default" : "outline", size: "sm" })}>{v.label}</Link>)}
          <Link href={href({ vista: "elenco", data: undefined })} aria-current={list ? "page" : undefined} className={buttonVariants({ variant: list ? "default" : "outline", size: "sm" })}>Elenco</Link>
        </nav>
        <form className="ml-auto flex items-center gap-2" role="search">
          {sp.vista && <input type="hidden" name="vista" value={sp.vista} />}{sp.data && <input type="hidden" name="data" value={sp.data} />}{sp.quando && <input type="hidden" name="quando" value={sp.quando} />}
          <Select name="resp" defaultValue={sp.resp ?? ""} aria-label="Responsabile" className="w-48"><option value="">Tutti i responsabili</option><option value="me">I miei</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select>
          <button className={buttonVariants({ variant: "outline", size: "sm" })}>Filtra</button>
        </form>
      </div>

      {list ? (
        <>
          <nav className="mb-3 flex gap-2" aria-label="Periodo">
            <Link href={href({ quando: "prossimi" })} aria-current={quando === "prossimi" ? "page" : undefined} className={buttonVariants({ variant: quando === "prossimi" ? "default" : "outline", size: "sm" })}>Imminenti</Link>
            <Link href={href({ quando: "passati" })} aria-current={quando === "passati" ? "page" : undefined} className={buttonVariants({ variant: quando === "passati" ? "default" : "outline", size: "sm" })}>Passati</Link>
          </nav>
          <Table>
            <thead><tr><th>Quando</th><th>Appuntamento</th><th>Cliente</th><th>Luogo</th><th>Stato</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className="text-muted">{quando === "prossimi" ? "Nessun appuntamento in programma." : "Nessun appuntamento passato."}</td></tr>}
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>{fmtDate(a.starts_at)} {fmtTime(a.starts_at)}–{fmtTime(a.ends_at)}</td>
                  <td><Link className="font-medium text-primary hover:underline" href={`/appuntamenti/${a.id}`}>{a.title}</Link></td>
                  <td>{cname(a) ? <Link className="hover:underline" href={`/clienti/${a.customer_id}`}>{cname(a)}</Link> : "—"}</td>
                  <td>{a.location ?? "—"}</td>
                  <td>{APPOINTMENT_STATUS_LABEL[a.status as keyof typeof APPOINTMENT_STATUS_LABEL]}{a.status === "scheduled" && new Date(a.ends_at) < now ? <span className="text-danger"> · da chiudere</span> : ""}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      ) : (
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Link href={href({ data: shiftDate(view, date, -1) })} aria-label="Periodo precedente" className={buttonVariants({ variant: "outline", size: "sm" })}>←</Link>
              <Link href={href({ data: undefined })} className={buttonVariants({ variant: "outline", size: "sm" })}>Oggi</Link>
              <Link href={href({ data: shiftDate(view, date, 1) })} aria-label="Periodo successivo" className={buttonVariants({ variant: "outline", size: "sm" })}>→</Link>
            </div>
            <h2 className="text-lg font-medium capitalize" data-testid="calendar-title">{titleFor(view, date)}</h2>
          </div>
          {rows.length === 0 && <div className="mb-3"><Alert>Nessun appuntamento in questo periodo.</Alert></div>}
          {view === "mese" && (
            <div className="overflow-x-auto"><div className="grid min-w-[44rem] grid-cols-7 gap-px rounded border border-border bg-border text-sm" role="grid" aria-label="Calendario mensile">
              {WD.map((d) => <div key={d} className="bg-card p-1 text-center text-xs font-medium text-muted">{d}</div>)}
              {monthGrid(date).flat().map((d) => {
                const items = byDay.get(d) ?? [];
                const inMonth = d.slice(0, 7) === date.slice(0, 7);
                return (
                  <div key={d} role="gridcell" data-date={d} className={cn("min-h-24 space-y-0.5 bg-card p-1", !inMonth && "opacity-50", d === today && "ring-2 ring-inset ring-primary")}>
                    <Link href={href({ vista: "giorno", data: d })} className="text-xs font-medium hover:underline">{+d.slice(8)}</Link>
                    {items.slice(0, 3).map((a) => <Chip key={a.id} a={a} />)}
                    {items.length > 3 && <Link href={href({ vista: "giorno", data: d })} className="block text-xs text-primary hover:underline">+{items.length - 3} altri</Link>}
                  </div>
                );
              })}
            </div></div>
          )}
          {view === "settimana" && (
            <div className="grid gap-2 md:grid-cols-7" role="grid" aria-label="Calendario settimanale">
              {weekDays(date).map((d, i) => (
                <div key={d} role="gridcell" data-date={d} className={cn("min-h-28 space-y-1 rounded border border-border p-2", d === today && "ring-2 ring-primary")}>
                  <Link href={href({ vista: "giorno", data: d })} className="text-xs font-medium hover:underline">{WD[i]} {+d.slice(8)}</Link>
                  {(byDay.get(d) ?? []).map((a) => <Chip key={a.id} a={a} full />)}
                </div>
              ))}
            </div>
          )}
          {view === "giorno" && (
            <ul className="space-y-2 text-sm" data-date={date}>
              {(byDay.get(date) ?? []).map((a) => (
                <li key={a.id} className="rounded border border-border p-3">
                  <Chip a={a} full />
                  <p className="mt-1 text-xs text-muted">{a.location ?? "Nessun luogo indicato"} · {APPOINTMENT_STATUS_LABEL[a.status as keyof typeof APPOINTMENT_STATUS_LABEL]}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
