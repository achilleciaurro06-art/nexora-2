import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { createClient } from "@/server/supabase/server";
import { can } from "@/server/auth/permissions";
import { isUuid } from "@/lib/ids";
import { listAccounts } from "@/modules/email/queries";
import { type Addr, addrsFromJson, formatAddrList } from "@/modules/email/addresses";
import { fillTemplate, fillTemplateText, forwardSubject, quotedBlock, replyRecipients, replySubject, withSignature, type Mode, type Original } from "@/modules/email/compose";
import { sanitizeEmailHtml } from "@/modules/email/sanitize";
import { copyAttachmentsToDraft } from "@/modules/email/service";
import { Composer, type ComposerDefaults } from "@/modules/email/ui/composer";
import { Alert } from "@/components/ui/card";

export const metadata = { title: "Scrivi email" };

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ bozza?: string; rispondi?: string; modo?: string; inoltra?: string; cliente?: string; preventivo?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!can(ctx.org.role, "data:write")) redirect("/email");
  const db = await createClient();
  const orgId = ctx.org.organizationId;
  const [accountsAll, { data: templates }, { data: sig }, { data: prof }] = await Promise.all([
    listAccounts(db, orgId),
    db.from("email_templates").select("id, name, subject, body_html").eq("organization_id", orgId).order("name"),
    db.from("email_user_signatures").select("signature").eq("user_id", ctx.userId).eq("organization_id", orgId).maybeSingle(),
    db.from("profiles").select("full_name").eq("id", ctx.userId).maybeSingle(),
  ]);
  const accounts = accountsAll.filter((a) => a.status === "connected");
  if (accounts.length === 0) return <Alert>Nessuna casella collegata e pronta all&apos;invio. Collega una casella dalla sezione «Caselle collegate».</Alert>;
  const userSig = (sig?.signature as string | undefined) || null;
  const defaultAccount = accounts.find((a) => a.is_default) ?? accounts[0]!;

  const d: ComposerDefaults = { accountId: defaultAccount.id, to: "", cc: "", bcc: "", subject: "", bodyHtml: "", mode: "new", replyToMessageId: null, customerId: null, quoteId: null, draftId: null, uploaded: [], attachQuotePdf: false, markQuoteSent: false, documentIds: [] };
  const vars: Record<string, string> = { azienda: ctx.org.name, mittente: (prof?.full_name as string | null) ?? "" };
  let lock = false, quoteNumber: string | null = null, quoteIsDraft = false, blocked: string | null = null;
  let customerId: string | null = null;

  if (isUuid(sp.bozza)) {
    const { data: dr } = await db.from("email_drafts").select("*").eq("id", sp.bozza).eq("author_id", ctx.userId).maybeSingle();
    if (dr) {
      Object.assign(d, { accountId: dr.account_id ?? d.accountId, to: formatAddrList(addrsFromJson(dr.to_addrs)), cc: formatAddrList(addrsFromJson(dr.cc_addrs)), bcc: formatAddrList(addrsFromJson(dr.bcc_addrs)),
        subject: dr.subject, bodyHtml: sanitizeEmailHtml(dr.body_html as string), mode: dr.mode, replyToMessageId: dr.reply_to_message_id, customerId: dr.customer_id, quoteId: dr.quote_id, draftId: dr.id,
        uploaded: dr.attachments ?? [], attachQuotePdf: !!(dr.options as { attachQuotePdf?: boolean } | null)?.attachQuotePdf });
      lock = !!dr.reply_to_message_id && dr.mode !== "forward";
      customerId = dr.customer_id as string | null;
    }
  } else if (isUuid(sp.rispondi) || isUuid(sp.inoltra)) {
    const id = (isUuid(sp.rispondi) ? sp.rispondi : sp.inoltra)!;
    const forward = !isUuid(sp.rispondi);
    const { data: m } = await db.from("email_messages").select("*, email_threads(customer_id, quote_id)").eq("id", id).eq("organization_id", orgId).maybeSingle();
    if (m) {
      const acc = accounts.find((a) => a.id === m.account_id);
      if (!acc) blocked = "La casella di questa conversazione non è collegata: non puoi rispondere da qui.";
      else {
        const mode: Mode = forward ? "forward" : sp.modo === "tutti" ? "reply_all" : "reply";
        const orig: Original = { direction: m.direction, from: { address: m.from_address, name: m.from_name ?? undefined }, to: addrsFromJson(m.to_addrs), cc: addrsFromJson(m.cc_addrs), subject: m.subject, messageAt: m.message_at, bodyHtml: m.body_html, bodyText: m.body_text };
        const r = replyRecipients(orig, acc.address, mode);
        const th = Array.isArray(m.email_threads) ? m.email_threads[0] : m.email_threads;
        customerId = (th as { customer_id: string | null } | null)?.customer_id ?? null;
        Object.assign(d, { accountId: acc.id, mode, to: formatAddrList(r.to), cc: formatAddrList(r.cc), subject: forward ? forwardSubject(m.subject) : replySubject(m.subject), replyToMessageId: m.id,
          customerId, quoteId: (th as { quote_id: string | null } | null)?.quote_id ?? null });
        d.bodyHtml = withSignature(quotedBlock(orig, mode), acc.signature ?? userSig);
        if (forward) d.uploaded = await copyAttachmentsToDraft(db, orgId, ctx.userId, m.id as string);
        lock = !forward;
        vars.oggetto = m.subject as string;
      }
    }
  } else {
    let cid: string | null = isUuid(sp.cliente) ? sp.cliente : null;
    if (isUuid(sp.preventivo)) {
      const { data: q } = await db.from("quotes").select("id, number, title, status, customer_id").eq("id", sp.preventivo).eq("organization_id", orgId).is("deleted_at", null).maybeSingle();
      if (q) { cid = q.customer_id as string; Object.assign(d, { quoteId: q.id, attachQuotePdf: true, markQuoteSent: q.status === "draft" }); quoteNumber = q.number as string; quoteIsDraft = q.status === "draft"; vars.numero_preventivo = q.number as string; }
    }
    if (cid) {
      const { data: c } = await db.from("customers").select("id, name, email, archived_at").eq("id", cid).eq("organization_id", orgId).is("deleted_at", null).maybeSingle();
      if (c?.archived_at) blocked = "Il cliente è archiviato: ripristinalo prima di scrivergli.";
      else if (c) {
        customerId = c.id as string; d.customerId = c.id as string; vars.cliente = c.name as string; vars.referente = c.name as string;
        const { data: ks } = await db.from("customer_contacts").select("full_name, email").eq("organization_id", orgId).eq("customer_id", cid).not("email", "is", null).order("created_at").limit(5);
        const first: Addr[] = [];
        if (ks?.[0]) { first.push({ address: ks[0].email as string, name: ks[0].full_name as string }); vars.referente = ks[0].full_name as string; }
        else if (c.email) first.push({ address: c.email as string });
        d.to = formatAddrList(first);
        if (isUuid(sp.preventivo)) {
          const t = (templates ?? []).find((x) => x.name === "Invio preventivo");
          d.subject = t ? fillTemplateText(t.subject as string, vars) : `Preventivo ${quoteNumber ?? ""}`;
          d.bodyHtml = withSignature(t ? fillTemplate(t.body_html as string, vars) : "<p></p>", defaultAccount.signature ?? userSig);
        } else d.bodyHtml = withSignature("<p></p>", defaultAccount.signature ?? userSig);
      }
    } else d.bodyHtml = withSignature("<p></p>", defaultAccount.signature ?? userSig);
  }
  if (blocked) return <Alert>{blocked}</Alert>;
  let documents: { id: string; name: string }[] = [];
  if (customerId) { const { data } = await db.from("documents").select("id, name").eq("organization_id", orgId).eq("customer_id", customerId).is("deleted_at", null).order("created_at", { ascending: false }).limit(15); documents = (data ?? []) as { id: string; name: string }[]; }
  if (!vars.referente && vars.cliente) vars.referente = vars.cliente;
  return (
    <Composer key={d.draftId ?? `${sp.rispondi ?? sp.inoltra ?? sp.preventivo ?? sp.cliente ?? "new"}`} accounts={accounts.map((a) => ({ id: a.id, label: a.display_name ? `${a.display_name} <${a.address}>` : a.address, signature: a.signature }))}
      defaults={d} templates={(templates ?? []) as { id: string; name: string; subject: string; body_html: string }[]} vars={vars} lockAccount={lock} quoteNumber={quoteNumber} quoteIsDraft={quoteIsDraft} documents={documents} userSignature={userSig} />
  );
}
