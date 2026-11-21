import * as React from "react";

/**
 * Formattazione minima e SICURA delle risposte del modello: paragrafi, elenchi (- / 1.), **grassetto**, titoletti (#).
 * Nessun HTML, nessun link, nessuna immagine: il testo del modello è sempre trattato come testo.
 */
function inline(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong> : <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>));
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => { if (para.length) { blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "), `p${blocks.length}`)}</p>); para = []; } };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(<Tag key={`l${blocks.length}`} className={list.ordered ? "ml-5 list-decimal space-y-0.5" : "ml-5 list-disc space-y-0.5"}>{list.items.map((it, i) => <li key={i}>{inline(it, `l${blocks.length}-${i}`)}</li>)}</Tag>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line), num = /^\s*\d+[.)]\s+(.*)$/.exec(line), head = /^\s*#{1,4}\s+(.*)$/.exec(line);
    if (bullet) { flushPara(); if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; } list.items.push(bullet[1]!); }
    else if (num) { flushPara(); if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; } list.items.push(num[1]!); }
    else if (head) { flushPara(); flushList(); blocks.push(<p key={`h${blocks.length}`} className="font-semibold">{inline(head[1]!, `h${blocks.length}`)}</p>); }
    else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line.trim()); }
  }
  flushPara(); flushList();
  return <div className={className ?? "space-y-2"}>{blocks}</div>;
}
