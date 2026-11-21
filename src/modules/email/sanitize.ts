const ALLOWED = new Set(["p", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li", "div", "span", "blockquote", "a", "h1", "h2", "h3", "pre", "code", "hr"]);
const VOID = new Set(["br", "hr"]);
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "head", "title", "form", "textarea", "select", "button"]);
const SAFE_PROTOCOLS = /^(https?:|mailto:)/i;

const escapeText = (s: string) => s.replace(/&(?!(?:[a-zA-Z]{2,10}|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeBasic = (s: string) => s.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32)).replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d) || 32)).replace(/&(amp|lt|gt|quot|apos|colon|tab|newline);/gi, (_, n) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", colon: ":", tab: " ", newline: " " })[String(n).toLowerCase()] ?? "");

/** Link ammesso solo se http, https o mailto (dopo aver decodificato entità e rimosso spazi/caratteri di controllo). */
export function safeHref(raw: string): string | null {
  const v = decodeBasic(raw).replace(/[\u0000- \u007f-\u009f]/g, "");
  return SAFE_PROTOCOLS.test(v) && v.length <= 2000 ? v : null;
}

/**
 * Sanitizzatore a lista di permessi per l'HTML che l'utente compone (e che esce verso i destinatari).
 * Solo tag di formattazione semplice; niente attributi tranne href (http/https/mailto); script, stili, iframe… eliminati con il loro contenuto.
 */
export function sanitizeEmailHtml(html: string): string {
  const out: string[] = [];
  const stack: string[] = [];
  let skip: { tag: string; depth: number } | null = null;
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>|<[a-zA-Z/!][^>]*$|[^<]+|</g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const tok = m[0];
    const name = m[1]?.toLowerCase();
    if (!name) {
      if (skip || tok.startsWith("<!--") || (tok.startsWith("<") && tok !== "<")) continue;
      out.push(tok === "<" ? "&lt;" : escapeText(tok));
      continue;
    }
    const closing = tok.startsWith("</");
    if (skip) {
      if (name === skip.tag) { if (closing) { skip.depth--; if (skip.depth === 0) skip = null; } else if (!tok.endsWith("/>")) skip.depth++; }
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) { if (!closing && !tok.endsWith("/>")) skip = { tag: name, depth: 1 }; continue; }
    if (!ALLOWED.has(name)) continue;
    if (closing) {
      const i = stack.lastIndexOf(name);
      if (i >= 0) { while (stack.length > i) out.push(`</${stack.pop()}>`); }
      continue;
    }
    if (name === "a") {
      const am = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[2] ?? "");
      const href = am ? safeHref(am[1] ?? am[2] ?? am[3] ?? "") : null;
      out.push(href ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">` : "<a>");
      stack.push("a");
    } else if (VOID.has(name)) out.push(`<${name}>`);
    else { out.push(`<${name}>`); stack.push(name); }
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join("");
}

export function htmlToText(html: string): string {
  return decodeBasic(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<(br|\/p|\/div|\/li|\/h[1-3]|\/blockquote|hr)\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, ""))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export const snippetOf = (text: string, max = 200) => text.replace(/\s+/g, " ").trim().slice(0, max);
export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const textToHtml = (t: string) => t.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");

/**
 * Documento per l'iframe di anteprima: sandbox senza script, CSP che blocca ogni risorsa remota (niente tracking pixel),
 * link in nuova scheda. L'HTML ricevuto non viene mai inserito direttamente nella pagina.
 */
export function sandboxedDoc(html: string): string {
  const safe = html.replace(/<meta[^>]+http-equiv[^>]*>/gi, "").replace(/<base[^>]*>/gi, "");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><base target="_blank"><style>body{font:14px/1.5 system-ui,sans-serif;margin:12px;color:#111;word-wrap:break-word}img{max-width:100%;height:auto}blockquote{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #ccc;color:#555}</style></head><body>${safe}</body></html>`;
}
