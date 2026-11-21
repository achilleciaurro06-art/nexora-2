"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import { useFormAction } from "@/lib/use-form-action";
import { deleteDraftAction, saveDraftAction, sendEmailAction } from "../actions";
import { fillTemplate, fillTemplateText } from "../compose";
import { fmtBytes } from "../limits";
import { withSignature } from "../compose";

type Uploaded = { storage_path: string; name: string; mime: string; size: number };
type Account = { id: string; label: string; signature: string | null };
export type ComposerDefaults = {
  accountId: string; to: string; cc: string; bcc: string; subject: string; bodyHtml: string; mode: "new" | "reply" | "reply_all" | "forward";
  replyToMessageId: string | null; customerId: string | null; quoteId: string | null; draftId: string | null; uploaded: Uploaded[]; attachQuotePdf: boolean; markQuoteSent: boolean; documentIds: string[];
};

const TOOLS: { label: string; cmd: string; title: string }[] = [{ label: "G", cmd: "bold", title: "Grassetto" }, { label: "C", cmd: "italic", title: "Corsivo" }, { label: "S", cmd: "underline", title: "Sottolineato" }, { label: "• Elenco", cmd: "insertUnorderedList", title: "Elenco puntato" }, { label: "1. Elenco", cmd: "insertOrderedList", title: "Elenco numerato" }];

export function Composer({ accounts, defaults, templates, vars, lockAccount, quoteNumber, quoteIsDraft, documents, userSignature }: {
  accounts: Account[]; defaults: ComposerDefaults; templates: { id: string; name: string; subject: string; body_html: string }[]; vars: Record<string, string>;
  lockAccount: boolean; quoteNumber: string | null; quoteIsDraft: boolean; documents: { id: string; name: string }[]; userSignature: string | null;
}) {
  const router = useRouter();
  const editor = useRef<HTMLDivElement>(null);
  const [accountId, setAccountId] = useState(defaults.accountId);
  const [to, setTo] = useState(defaults.to), [cc, setCc] = useState(defaults.cc), [bcc, setBcc] = useState(defaults.bcc);
  const [showCc, setShowCc] = useState(!!defaults.cc || !!defaults.bcc);
  const [subject, setSubject] = useState(defaults.subject);
  const [uploaded, setUploaded] = useState<Uploaded[]>(defaults.uploaded);
  const [docIds, setDocIds] = useState<string[]>(defaults.documentIds);
  const [attachPdf, setAttachPdf] = useState(defaults.attachQuotePdf);
  const [markSent, setMarkSent] = useState(defaults.markQuoteSent);
  const [draftId, setDraftId] = useState<string | null>(defaults.draftId);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const bodyHidden = useRef<HTMLInputElement>(null);
  const { state, pending, onSubmit } = useFormAction(sendEmailAction);
  const html = () => editor.current?.innerHTML ?? "";
  const account = accounts.find((a) => a.id === accountId);

  // salvataggio automatico della bozza (privata dell'autore) dopo qualche secondo di inattività
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const idRef = useRef<string | null>(draftId);
  const save = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    const r = await saveDraftAction({ id: idRef.current, accountId, mode: defaults.mode, replyToMessageId: defaults.replyToMessageId, customerId: defaults.customerId, quoteId: defaults.quoteId, to, cc, bcc, subject, bodyHtml: html(), uploaded, attachQuotePdf: attachPdf });
    saving.current = false;
    if (r.ok) { idRef.current = r.id; setDraftId(r.id); setDraftMsg(`Bozza salvata alle ${new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" })}`); setDirty(false); }
    else setDraftMsg(`Bozza non salvata: ${r.error}`);
  }, [accountId, defaults.mode, defaults.replyToMessageId, defaults.customerId, defaults.quoteId, to, cc, bcc, subject, uploaded, attachPdf]);
  const touch = useCallback(() => { setDirty(true); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { void save(); }, 3000); }, [save]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { if (!dirty) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h); }, [dirty]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadErr(null); setUploading(true);
    for (const f of Array.from(files)) {
      const fd = new FormData(); fd.set("file", f);
      try {
        const res = await fetch("/api/email/attachments", { method: "POST", body: fd });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { setUploadErr(`${f.name}: ${(j as { error?: string }).error ?? "caricamento non riuscito"}`); continue; }
        setUploaded((u) => [...u, j as Uploaded]); touch();
      } catch { setUploadErr(`${f.name}: caricamento non riuscito`); }
    }
    setUploading(false);
  };
  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (editor.current && editor.current.innerText.trim().length > 40 && !window.confirm("Sostituire il testo attuale con il modello?")) return;
    if (editor.current) editor.current.innerHTML = withSignature(fillTemplate(t.body_html, vars), account?.signature ?? userSignature);
    setSubject(fillTemplateText(t.subject, vars)); touch();
  };
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k]?.[0] : undefined);
  const uncertain = state && !state.ok && (state as { data?: { uncertain?: boolean } }).data?.uncertain;
  const totalBytes = useMemo(() => uploaded.reduce((n, u) => n + u.size, 0), [uploaded]);

  return (
    <form onSubmit={(e) => { if (bodyHidden.current) bodyHidden.current.value = html(); onSubmit(e); }} className="max-w-4xl space-y-4" aria-label="Scrivi email">
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="bodyHtml" ref={bodyHidden} defaultValue="" />
      <input type="hidden" name="uploaded" value={JSON.stringify(uploaded)} />
      <input type="hidden" name="documentIds" value={JSON.stringify(docIds)} />
      {draftId && <input type="hidden" name="draftId" value={draftId} />}
      {defaults.replyToMessageId && defaults.mode !== "forward" && <input type="hidden" name="replyToMessageId" value={defaults.replyToMessageId} />}
      {defaults.customerId && <input type="hidden" name="customerId" value={defaults.customerId} />}
      {defaults.quoteId && <input type="hidden" name="quoteId" value={defaults.quoteId} />}

      <div className="grid gap-3 sm:grid-cols-[6rem_1fr] sm:items-center">
        <Label htmlFor="accountId">Da</Label>
        <div>
          <Select id="accountId" name="accountId" value={accountId} onChange={(e) => { setAccountId(e.target.value); touch(); }} disabled={lockAccount} required>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </Select>
          {lockAccount && <input type="hidden" name="accountId" value={accountId} />}
          <p className="mt-1 text-xs text-muted" data-testid="sender-note">L&apos;email partirà da <strong>{account?.label ?? "—"}</strong>.</p>
        </div>
        <Label htmlFor="to">A</Label>
        <div><Input id="to" name="to" value={to} onChange={(e) => { setTo(e.target.value); touch(); }} placeholder="nome@azienda.it, altro@azienda.it" autoComplete="off" />{err("to") && <p className="mt-1 text-xs text-danger">{err("to")}</p>}
          {!showCc && <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => setShowCc(true)}>Aggiungi Cc / Ccn</button>}</div>
        {showCc && <>
          <Label htmlFor="cc">Cc</Label><div><Input id="cc" name="cc" value={cc} onChange={(e) => { setCc(e.target.value); touch(); }} autoComplete="off" />{err("cc") && <p className="mt-1 text-xs text-danger">{err("cc")}</p>}</div>
          <Label htmlFor="bcc">Ccn</Label><div><Input id="bcc" name="bcc" value={bcc} onChange={(e) => { setBcc(e.target.value); touch(); }} autoComplete="off" />{err("bcc") && <p className="mt-1 text-xs text-danger">{err("bcc")}</p>}</div>
        </>}
        <Label htmlFor="subject">Oggetto</Label>
        <Input id="subject" name="subject" value={subject} onChange={(e) => { setSubject(e.target.value); touch(); }} maxLength={998} />
      </div>

      {templates.length > 0 && (
        <div className="max-w-sm"><Label htmlFor="tpl">Modello</Label>
          <Select id="tpl" value="" onChange={(e) => applyTemplate(e.target.value)}><option value="">Scegli un modello…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></div>
      )}

      <div>
        <div className="flex flex-wrap gap-1 rounded-t-md border border-b-0 border-border bg-card p-1" role="toolbar" aria-label="Formattazione">
          {TOOLS.map((t) => <Button key={t.cmd} type="button" size="sm" variant="ghost" title={t.title} aria-label={t.title} onMouseDown={(e) => e.preventDefault()} onClick={() => { document.execCommand(t.cmd); touch(); }}>{t.label}</Button>)}
          <Button type="button" size="sm" variant="ghost" title="Inserisci link" aria-label="Inserisci link" onMouseDown={(e) => e.preventDefault()} onClick={() => { const u = window.prompt("Indirizzo del link (https://…)"); if (u && /^(https?:\/\/|mailto:)/i.test(u.trim())) { document.execCommand("createLink", false, u.trim()); touch(); } }}>Link</Button>
        </div>
        <div ref={editor} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Testo del messaggio" data-testid="editor" onInput={touch}
          className="min-h-56 rounded-b-md border border-border bg-card p-3 text-sm focus-visible:outline-2 focus-visible:outline-primary [&_blockquote]:ml-2 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-primary [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: defaults.bodyHtml }} />
      </div>

      <fieldset className="space-y-2 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Allegati</legend>
        <ul className="space-y-1 text-sm" data-testid="uploaded">
          {uploaded.map((u) => <li key={u.storage_path} className="flex items-center gap-2">📎 {u.name} <span className="text-xs text-muted">{fmtBytes(u.size)}</span><button type="button" className="text-xs text-danger hover:underline" onClick={() => { setUploaded((x) => x.filter((y) => y.storage_path !== u.storage_path)); touch(); }}>Rimuovi</button></li>)}
          {quoteNumber && <li><label className="flex items-center gap-2"><input type="checkbox" name="attachQuotePdf" checked={attachPdf} onChange={(e) => { setAttachPdf(e.target.checked); touch(); }} /> Allega il PDF del preventivo {quoteNumber}</label></li>}
          {quoteNumber && quoteIsDraft && <li><label className="flex items-center gap-2"><input type="checkbox" name="markQuoteSent" checked={markSent} onChange={(e) => setMarkSent(e.target.checked)} /> Segna il preventivo come «Inviato» dopo l&apos;invio</label></li>}
          {documents.map((d) => <li key={d.id}><label className="flex items-center gap-2"><input type="checkbox" checked={docIds.includes(d.id)} onChange={(e) => setDocIds((x) => (e.target.checked ? [...x, d.id] : x.filter((y) => y !== d.id)))} /> Documento del cliente: {d.name}</label></li>)}
        </ul>
        <div><Label htmlFor="file">Carica file (massimo 4 MB ciascuno; no eseguibili)</Label><Input id="file" type="file" multiple onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} /></div>
        {uploading && <p className="text-xs text-muted">Caricamento…</p>}
        {uploadErr && <p role="alert" className="text-xs text-danger">{uploadErr}</p>}
        {totalBytes > 0 && <p className="text-xs text-muted">Allegati caricati: {fmtBytes(totalBytes)}</p>}
      </fieldset>

      {state && !state.ok && <Alert>{state.error}{uncertain ? " Se vuoi inviare comunque, premi «Invia comunque»." : ""}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending || uploading}>{pending ? "Invio in corso…" : "Invia"}</Button>
        {uncertain && <Button type="button" variant="outline" onClick={() => setKey(crypto.randomUUID())}>Invia comunque (nuovo tentativo)</Button>}
        <Button type="button" variant="outline" onClick={() => void save()}>Salva bozza</Button>
        {draftId && <Button type="button" variant="ghost" onClick={async () => { if (!window.confirm("Eliminare la bozza?")) return; await deleteDraftAction(draftId, null, new FormData()); router.push("/email?cartella=bozze"); }}>Elimina bozza</Button>}
        <Link href="/email" className="text-sm text-muted hover:underline" onClick={(e) => { if (dirty && !window.confirm("Ci sono modifiche non salvate. Uscire senza salvare?")) e.preventDefault(); }}>Annulla</Link>
        {draftMsg && <span role="status" className="text-xs text-muted" data-testid="draft-status">{draftMsg}</span>}
      </div>
    </form>
  );
}
