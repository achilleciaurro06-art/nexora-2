import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { listAccounts, listThreads, parseFolder } from "@/modules/email/queries";
import { listCustomers } from "@/modules/clienti/repository";
import { deleteDraftAction } from "@/modules/email/actions";
import { formatAddrList } from "@/modules/email/addresses";
import { SyncButton } from "@/modules/email/ui/sync-button";
import { Alert, Badge, Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { RemoveButton } from "@/components/ui/remove-button";
import { dayRangeUtc, fmtDate, fmtDateTime, fmtTime, todayIn } from "@/lib/datetime";
import { isUuid } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Mail } from "lucide-react";

type SP = { cartella?: string; q?: string; casella?: string; cliente?: string; nonletti?: string; collegamento?: string; da?: string; a?: string; n?: string };
const whenLabel = (iso: string) => (todayIn(new Date(iso)) === todayIn(new Date()) ? fmtTime(iso) : fmtDate(iso));

export default async function EmailPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const folder = parseFolder(sp.cartella);
  const accounts = await listAccounts(db, orgId);

  if (folder === "bozze") {
    const { data: drafts } = await db.from("email_drafts").select("id, subject, to_addrs, updated_at, account_id").eq("organization_id", orgId).eq("author_id", ctx.userId).order("updated_at", { ascending: false }).limit(100);
    return (
      <Card className="p-0">
        <ul className="divide-y divide-line text-sm" data-testid="drafts">
          {(drafts ?? []).length === 0 && <li className="p-4 text-muted">Nessuna bozza. Le bozze si salvano da sole mentre scrivi e sono visibili solo a te.</li>}
          {(drafts ?? []).map((d) => (
            <li key={d.id as string} className="flex items-center justify-between gap-3 p-3">
              <Link className="min-w-0 flex-1 truncate hover:underline" href={`/email/nuova?bozza=${d.id}`}><strong>{(d.subject as string) || "(senza oggetto)"}</strong><span className="text-muted"> · a {formatAddrList((d.to_addrs as { address: string }[]) ?? []) || "nessun destinatario"}</span></Link>
              <span className="shrink-0 text-xs text-muted">{fmtDateTime(d.updated_at as string)}</span>
              <RemoveButton action={deleteDraftAction.bind(null, d.id as string)} confirmMessage="Eliminare la bozza?" />
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  const customers = await listCustomers(db, orgId);
  const limit = Math.min(Number(sp.n) || 50, 300);
  const threads = await listThreads(db, orgId, {
    folder, q: sp.q, accountId: isUuid(sp.casella) ? sp.casella : undefined, customerId: isUuid(sp.cliente) ? sp.cliente : undefined, unread: sp.nonletti === "1", link: sp.collegamento,
    from: sp.da && /^\d{4}-\d{2}-\d{2}$/.test(sp.da) ? dayRangeUtc(sp.da).from : undefined, to: sp.a && /^\d{4}-\d{2}-\d{2}$/.test(sp.a) ? dayRangeUtc(sp.a).to : undefined, limit,
  });
  const accName = new Map(accounts.map((a) => [a.id, a.display_name ? `${a.display_name} <${a.address}>` : a.address]));
  const filtered = !!(sp.q || sp.casella || sp.cliente || sp.nonletti || sp.collegamento || sp.da || sp.a);
  const nowMs = new Date().getTime();
  const stale = accounts.some((a) => a.status === "connected" && (!a.last_sync_at || nowMs - new Date(a.last_sync_at).getTime() > 5 * 60_000));

  return (
    <>
      {accounts.length === 0 && <div className="mb-4"><Alert>Nessuna casella collegata. <Link className="underline" href="/email/caselle">Collega una casella</Link> per inviare e ricevere email da NEXORA.</Alert></div>}
      {accounts.some((a) => a.status === "needs_reauth") && <div className="mb-4"><Alert>Una casella richiede di essere ricollegata. <Link className="underline" href="/email/caselle">Apri le caselle</Link></Alert></div>}
      <form className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6" role="search" aria-label="Filtri email">
        <input type="hidden" name="cartella" value={folder} />
        <Input name="q" defaultValue={sp.q} placeholder="Cerca oggetto, mittente, destinatario…" aria-label="Cerca email" className="lg:col-span-2" />
        <Select name="casella" defaultValue={sp.casella ?? ""} aria-label="Casella"><option value="">Tutte le caselle</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.address}</option>)}</Select>
        <Select name="cliente" defaultValue={sp.cliente ?? ""} aria-label="Cliente"><option value="">Tutti i clienti</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select name="collegamento" defaultValue={sp.collegamento ?? ""} aria-label="Collegamento al cliente"><option value="">Collegate e non</option><option value="none">Non collegate</option><option value="suggested">Da confermare</option><option value="auto">Collegate in automatico</option><option value="manual">Collegate a mano</option></Select>
        <Input name="da" type="date" defaultValue={sp.da} aria-label="Dal" /><Input name="a" type="date" defaultValue={sp.a} aria-label="Al" />
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="nonletti" value="1" defaultChecked={sp.nonletti === "1"} /> Solo non lette</label>
        <div className="flex items-center gap-2 lg:col-span-3"><button className={buttonVariants({ variant: "outline", size: "sm" })}>Applica</button>{filtered && <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/email?cartella=${folder}`}>Azzera</Link>}<SyncButton auto={stale} /></div>
      </form>
      <Card className="p-0">
        <ul className="divide-y divide-line" data-testid="threads">
          {threads.length === 0 && <li className="p-8 text-center text-sm text-muted"><Mail className="mx-auto mb-2 size-6 text-primary/60" />{filtered ? "Nessuna conversazione con questi filtri." : folder === "arrivo" ? "La posta in arrivo è vuota." : folder === "inviate" ? "Nessuna email inviata." : "Nessuna email."}</li>}
          {threads.map((t) => {
            const unread = t.unread_count > 0;
            const l = t.last;
            return (
              <li key={t.id} data-unread={unread || undefined} className={cn("nx-t flex items-start gap-3 border-l-[3px] p-3 hover:bg-primary/[0.04]", unread ? "border-primary bg-primary/[0.04]" : "border-transparent")}>
                <Avatar name={l ? (l.direction === "inbound" ? l.from_name || l.from_address : "Tu") : "?"} size={34} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <Link href={`/email/${t.id}`} className="block">
                    <p className="flex items-center gap-2 truncate text-sm">
                      <span className={cn("truncate", unread ? "font-semibold" : "font-medium")}>{l ? (l.direction === "inbound" ? l.from_name || l.from_address : `A: ${formatAddrList(l.to) || "—"}`) : "—"}</span>
                      {t.message_count > 1 && <span className="shrink-0 text-xs text-muted">({t.message_count})</span>}
                      {unread && <Badge className="border-primary text-primary">{t.unread_count} {t.unread_count === 1 ? "nuova" : "nuove"}</Badge>}
                      {l?.status === "failed" && <Badge className="border-danger text-danger">Non inviata</Badge>}
                    </p>
                    <p className={cn("truncate text-sm", unread && "font-medium")}>{t.subject || "(senza oggetto)"} <span className="font-normal text-muted">— {l?.snippet ?? ""}</span></p>
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                    <span>{accName.get(t.account_id) ?? ""}</span>
                    {t.customers && t.customer_id && <Link className="text-primary hover:underline" href={`/clienti/${t.customer_id}`}>{t.customers.name}{t.customers.archived_at ? " (archiviato)" : ""}</Link>}
                    {t.link_status === "suggested" && <span className="text-warning">Cliente da confermare</span>}
                    {t.link_status === "none" && <span>Non collegata a un cliente</span>}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-muted">{l ? whenLabel(l.message_at) : ""}{l?.has_attachments ? <span title="Allegati" aria-label="Con allegati"> 📎</span> : null}</div>
              </li>
            );
          })}
        </ul>
      </Card>
      {threads.length >= limit && limit < 300 && <p className="mt-3 text-center"><Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/email?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), n: String(limit + 50) } as Record<string, string>).toString()}`}>Mostra altre</Link></p>}
    </>
  );
}
