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
import { AgendaNav } from "@/components/layout/agenda-nav";

export const metadata = { title: "Appuntamenti" };
type Row = { id: string; title: string; starts_at: string; ends_at: string; status: string; location: string | null; assignee_id: string | null; customer_id: string | null; customers: { name: string } | { name: string }[] | null };
const WD = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];


const mins = (iso: string) => { const [h, m] = utcToZonedParts(iso).time.split(":").map(Number) as [number, number]; return h * 60 + m; };

/** Griglia oraria (settimana/giorno): puramente presentazionale, usa gli stessi appuntamenti già caricati. */
function TimeGrid({ days, byDay, today, label, cname, href }: { days: string[]; byDay: Map<string, Row[]>; today: string; label: (d: string) => string; cname: (a: Row) => string | undefined; href: (d: string) => string }) {
  const all = days.flatMap((d) => byDay.get(d) ?? []);
  const startH = Math.min(8, ...all.map((a) => Math.floor(mins(a.starts_at) / 60)));
  const endH = Math.max(19, ...all.map((a) => Math.min(24, Math.ceil(mins(a.ends_at) / 60) || 24)));
  const H = 52; // px per ora
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[44rem]" role="grid" aria-label={days.length === 1 ? "Calendario giornaliero" : "Calendario settimanale"}>
        <div className="grid border-b border-border" style={{ gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div />
          {days.map((d) => <Link key={d} href={href(d)} className={cn("nx-t border-l border-line px-2 py-2 text-center text-xs font-medium hover:bg-primary/[0.04]", d === today && "text-primary")}>{label(d)}</Link>)}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div>{hours.map((h) => <div key={h} style={{ height: H }} className="pr-2 text-right text-[11px] text-muted"><span className="relative -top-2">{String(h).padStart(2, "0")}:00</span></div>)}</div>
          {days.map((d) => {
            const items = [...(byDay.get(d) ?? [])].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
            // corsie semplici per gli appuntamenti sovrapposti
            const lanes: number[] = []; const placed = items.map((a) => { let l = lanes.findIndex((end) => end <= mins(a.starts_at)); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = mins(a.ends_at); return { a, l }; });
            const n = Math.max(1, lanes.length);
            return (
              <div key={d} role="gridcell" data-date={d} className={cn("relative border-l border-line", d === today && "bg-primary/[0.035]")} style={{ height: hours.length * H }}>
                {hours.map((h, i) => <div key={h} aria-hidden className="absolute inset-x-0 border-t border-line" style={{ top: i * H }} />)}
                {placed.map(({ a, l }) => {
                  const top = ((mins(a.starts_at) - startH * 60) / 60) * H, hgt = Math.max(24, ((mins(a.ends_at) - mins(a.starts_at)) / 60) * H - 2);
                  return (
                    <Link key={a.id} href={`/appuntamenti/${a.id}`} data-testid="appointment" data-status={a.status}
                      className={cn("nx-t absolute overflow-hidden rounded-sm border-l-[3px] border-primary bg-primary/12 px-1.5 py-1 text-[11px] leading-tight hover:bg-primary/20", a.status === "completed" && "opacity-60 line-through")}
                      style={{ top, height: hgt, left: `calc(${(l / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)` }}>
                      <span className="font-semibold">{fmtTime(a.starts_at)}–{fmtTime(a.ends_at)}</span> {a.title}{cname(a) ? <span className="block truncate text-muted">{cname(a)}</span> : null}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

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
      <AgendaNav active="appuntamenti" />
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
          {view === "settimana" && <TimeGrid days={weekDays(date)} byDay={byDay} today={today} cname={cname} label={(d) => `${WD[weekDays(date).indexOf(d)]} ${+d.slice(8)}`} href={(d) => href({ vista: "giorno", data: d })} />}
          {view === "giorno" && (
            <>
              <TimeGrid days={[date]} byDay={byDay} today={today} cname={cname} label={(d) => titleFor("giorno", d)} href={(d) => href({ vista: "giorno", data: d })} />
              <ul className="sr-only" data-date={date}>{(byDay.get(date) ?? []).map((a) => <li key={a.id}>{fmtTime(a.starts_at)} {a.title} · {a.location ?? "Nessun luogo indicato"} · {APPOINTMENT_STATUS_LABEL[a.status as keyof typeof APPOINTMENT_STATUS_LABEL]}</li>)}</ul>
            </>
          )}
        </Card>
      )}
    </>
  );
}
