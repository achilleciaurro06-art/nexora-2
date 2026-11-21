import Link from "next/link";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { listAccounts } from "@/modules/email/queries";
import { listMembers, nameMap } from "@/modules/organizzazioni/queries";
import { addMemberAction, connectImapAction, disconnectAccountAction, removeMemberAction, saveSignatureAction, setDefaultAccountAction, syncAccountAction, updateAccountAction } from "@/modules/email/actions";
import { missingConfig } from "@/modules/email/providers/oauth";
import { encryptionKey } from "@/modules/email/service";
import { PROVIDER_LABEL } from "@/modules/email/providers";
import { ActionForm } from "@/modules/impostazioni/ui/forms";
import { Alert, Badge, Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { RemoveButton } from "@/components/ui/remove-button";
import { fmtDateTime } from "@/lib/datetime";

const STATUS: Record<string, { label: string; cls: string }> = {
  connected: { label: "Collegata", cls: "border-green-400 text-green-700 dark:text-green-300" }, error: { label: "Errore", cls: "border-danger text-danger" },
  needs_reauth: { label: "Da ricollegare", cls: "border-amber-500 text-amber-700 dark:text-amber-300" }, disconnected: { label: "Disconnessa", cls: "text-muted" },
};
const ERR: Record<string, string> = { "non-configurato": "Il collegamento non è ancora configurato su questo ambiente.", permessi: "Non hai i permessi per collegare caselle.", state: "Richiesta di collegamento scaduta o non valida: riprova.", negato: "Autorizzazione negata o annullata.", provider: "Provider non supportato." };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ collegata?: string; errore?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const [accounts, members] = await Promise.all([listAccounts(db, orgId, true), listMembers(db, orgId)]);
  const names = nameMap(members);
  const { data: memberRows } = await db.from("email_account_members").select("account_id, user_id").eq("organization_id", orgId);
  const { data: sig } = await db.from("email_user_signatures").select("signature").eq("user_id", ctx.userId).eq("organization_id", orgId).maybeSingle();
  const canWrite = can(ctx.org.role, "data:write");
  const canManageAll = can(ctx.org.role, "settings:manage");
  const keyOk = !!encryptionKey();
  const g = missingConfig("gmail"), o = missingConfig("outlook");
  const authorized = new Map<string, string[]>();
  for (const r of memberRows ?? []) authorized.set(r.account_id as string, [...(authorized.get(r.account_id as string) ?? []), r.user_id as string]);

  return (
    <div className="space-y-6">
      {sp.collegata && <Alert kind="success">Casella collegata. La prima sincronizzazione è partita: premi «Sincronizza» per aggiornare.</Alert>}
      {sp.errore && <Alert>{ERR[sp.errore] ?? decodeURIComponent(sp.errore)}</Alert>}
      {!keyOk && <Alert>Per collegare caselle serve la chiave di cifratura dei segreti (<code>EMAIL_ENCRYPTION_KEY</code>), non ancora impostata su questo ambiente: nessuna credenziale viene salvata senza cifratura.</Alert>}

      {canWrite && (
        <Card>
          <h2 className="mb-1 font-medium">Collega una casella</h2>
          <p className="mb-4 text-sm text-muted">Gmail e Outlook si collegano con il login del provider (nessuna password salvata in NEXORA). Le altre caselle usano IMAP e SMTP: le password sono cifrate e non tornano mai al browser.</p>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            {([["gmail", g], ["outlook", o]] as const).map(([k, miss]) => (
              <div key={k} className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium">{PROVIDER_LABEL[k]}</p>
                {miss.length === 0 ? <a href={`/api/email/oauth/${k}/start`} className={buttonVariants({ size: "sm" }) + " mt-2"}>Collega con {k === "gmail" ? "Google" : "Microsoft"}</a> : (
                  <p className="mt-1 text-xs text-muted" data-testid={`missing-${k}`}>Non ancora attivo: mancano le impostazioni <code>{miss.join(", ")}</code> (vedi docs/email.md).</p>
                )}
              </div>
            ))}
          </div>
          <details className="rounded-md border border-border p-3" open={!!sp.errore && accounts.length === 0}>
            <summary className="cursor-pointer text-sm font-medium">{PROVIDER_LABEL.imap_smtp}</summary>
            <div className="mt-3">
              <ActionForm action={connectImapAction} submitLabel="Verifica e collega" successMessage="Casella collegata">
                <div><Label htmlFor="address">Indirizzo email *</Label><Input id="address" name="address" type="email" required /></div>
                <div><Label htmlFor="displayName">Nome del mittente</Label><Input id="displayName" name="displayName" maxLength={120} placeholder="Es. Ufficio vendite" /></div>
                <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-4"><legend className="mb-1 text-sm font-medium">Posta in arrivo (IMAP)</legend>
                  <div className="sm:col-span-2"><Label htmlFor="imapHost">Server *</Label><Input id="imapHost" name="imapHost" required placeholder="imap.azienda.it" /></div>
                  <div><Label htmlFor="imapPort">Porta *</Label><Input id="imapPort" name="imapPort" type="number" defaultValue={993} required /></div>
                  <div><Label htmlFor="imapSecurity">Sicurezza</Label><Select id="imapSecurity" name="imapSecurity" defaultValue="ssl"><option value="ssl">SSL/TLS</option><option value="starttls">STARTTLS</option><option value="none">Nessuna (sconsigliato)</option></Select></div>
                  <div className="sm:col-span-2"><Label htmlFor="imapUser">Utente *</Label><Input id="imapUser" name="imapUser" required autoComplete="off" /></div>
                  <div className="sm:col-span-2"><Label htmlFor="imapPassword">Password *</Label><Input id="imapPassword" name="imapPassword" type="password" required autoComplete="new-password" /></div>
                </fieldset>
                <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-4"><legend className="mb-1 text-sm font-medium">Posta in uscita (SMTP)</legend>
                  <div className="sm:col-span-2"><Label htmlFor="smtpHost">Server *</Label><Input id="smtpHost" name="smtpHost" required placeholder="smtp.azienda.it" /></div>
                  <div><Label htmlFor="smtpPort">Porta *</Label><Input id="smtpPort" name="smtpPort" type="number" defaultValue={587} required /></div>
                  <div><Label htmlFor="smtpSecurity">Sicurezza</Label><Select id="smtpSecurity" name="smtpSecurity" defaultValue="starttls"><option value="ssl">SSL/TLS</option><option value="starttls">STARTTLS</option><option value="none">Nessuna (sconsigliato)</option></Select></div>
                  <div className="sm:col-span-2"><Label htmlFor="smtpUser">Utente *</Label><Input id="smtpUser" name="smtpUser" required autoComplete="off" /></div>
                  <div className="sm:col-span-2"><Label htmlFor="smtpPassword">Password *</Label><Input id="smtpPassword" name="smtpPassword" type="password" required autoComplete="new-password" /></div>
                </fieldset>
              </ActionForm>
            </div>
          </details>
        </Card>
      )}

      <section aria-label="Caselle collegate" className="space-y-4">
        <h2 className="font-medium">Caselle collegate</h2>
        {accounts.length === 0 && <Card><p className="text-sm text-muted">Nessuna casella collegata (o non hai accesso a quelle esistenti).</p></Card>}
        {accounts.map((a) => {
          const mine = a.created_by === ctx.userId;
          const manage = canWrite && (mine || canManageAll);
          const st = STATUS[a.status] ?? STATUS.error!;
          const auth = authorized.get(a.id) ?? [];
          return (
            <Card key={a.id} data-testid="account" data-address={a.address}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{a.display_name ? `${a.display_name} <${a.address}>` : a.address}</p>
                  <p className="text-xs text-muted">{PROVIDER_LABEL[a.provider]} · {a.visibility === "shared" ? "condivisa con tutta l'azienda" : "riservata ai collaboratori autorizzati"} · creata da {a.created_by ? (names.get(a.created_by) ?? "—") : "—"}</p>
                </div>
                <p className="flex items-center gap-2"><Badge className={st.cls}>{st.label}</Badge>{a.is_default && <Badge>Predefinita per l&apos;invio</Badge>}</p>
              </div>
              {a.status_detail && <p className="mt-1 text-xs text-danger">{a.status_detail}</p>}
              <p className="mt-1 text-xs text-muted">Ultima sincronizzazione: {a.last_sync_at ? fmtDateTime(a.last_sync_at) : "mai"}{a.last_sync_error ? ` · ${a.last_sync_error}` : ""}</p>
              {a.status !== "disconnected" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {canWrite && a.status !== "needs_reauth" && <form action={syncAccountAction.bind(null, a.id)}><Button size="sm" variant="outline">Sincronizza ora</Button></form>}
                  {(a.provider === "gmail" || a.provider === "outlook") && manage && (a.status === "needs_reauth" || a.status === "error") && <a className={buttonVariants({ size: "sm" })} href={`/api/email/oauth/${a.provider}/start`}>Ricollega</a>}
                  {canManageAll && !a.is_default && a.status === "connected" && <form action={setDefaultAccountAction.bind(null, a.id)}><Button size="sm" variant="ghost">Imposta come predefinita</Button></form>}
                  {manage && <RemoveButton variant="outline" size="sm" label="Disconnetti" action={disconnectAccountAction.bind(null, a.id)} confirmMessage={`Disconnettere ${a.address}?\n\nLe credenziali vengono eliminate e la casella non sarà più sincronizzata né usabile. I messaggi già importati restano nello storico.`} />}
                </div>
              )}
              {manage && a.status !== "disconnected" && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-primary">Impostazioni e collaboratori</summary>
                  <div className="mt-3 space-y-5">
                    <ActionForm action={updateAccountAction.bind(null, a.id)} successMessage="Impostazioni salvate">
                      <div><Label htmlFor={`dn-${a.id}`}>Nome del mittente</Label><Input id={`dn-${a.id}`} name="displayName" defaultValue={a.display_name ?? ""} maxLength={120} /></div>
                      <div><Label htmlFor={`vis-${a.id}`}>Chi può usarla</Label><Select id={`vis-${a.id}`} name="visibility" defaultValue={a.visibility}><option value="restricted">Solo collaboratori autorizzati</option><option value="shared">Tutta l&apos;azienda</option></Select></div>
                      <div className="sm:col-span-2"><Label htmlFor={`sg-${a.id}`}>Firma della casella</Label><Textarea id={`sg-${a.id}`} name="signature" defaultValue={a.signature ?? ""} maxLength={2000} /></div>
                    </ActionForm>
                    <div>
                      <p className="mb-1 text-sm font-medium">Collaboratori autorizzati</p>
                      <ul className="mb-2 space-y-1 text-sm">
                        <li>{a.created_by ? (names.get(a.created_by) ?? "—") : "—"} <span className="text-xs text-muted">(creatore)</span></li>
                        {auth.map((u) => <li key={u} className="flex items-center gap-2">{names.get(u) ?? "—"}<form action={removeMemberAction.bind(null, a.id, u)}><Button size="sm" variant="ghost" className="text-danger">Revoca</Button></form></li>)}
                      </ul>
                      <ActionForm action={addMemberAction.bind(null, a.id)} submitLabel="Autorizza" successMessage="Collaboratore autorizzato">
                        <div><Label htmlFor={`mem-${a.id}`}>Aggiungi collaboratore</Label><Select id={`mem-${a.id}`} name="userId" defaultValue=""><option value="" disabled>Scegli…</option>{members.filter((m) => m.userId !== a.created_by && !auth.includes(m.userId)).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select></div>
                      </ActionForm>
                    </div>
                  </div>
                </details>
              )}
            </Card>
          );
        })}
      </section>

      {canWrite && (
        <Card>
          <h2 className="mb-1 font-medium">La mia firma</h2>
          <p className="mb-3 text-sm text-muted">Usata quando la casella non ha una firma propria.</p>
          <ActionForm action={saveSignatureAction} successMessage="Firma salvata"><div className="sm:col-span-2"><Label htmlFor="signature">Firma</Label><Textarea id="signature" name="signature" defaultValue={(sig?.signature as string | undefined) ?? ""} maxLength={2000} /></div></ActionForm>
        </Card>
      )}
      <p className="text-xs text-muted">Costi e configurazione: vedi <Link className="underline" href="/email/caselle">docs/email.md</Link> nel repository (variabili d&apos;ambiente, OAuth, pianificazione).</p>
    </div>
  );
}
