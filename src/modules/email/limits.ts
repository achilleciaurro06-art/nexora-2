/** Limiti degli allegati. Il tetto in invio è legato al limite di 4,5 MB per richiesta delle funzioni serverless. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_SEND_ATTACHMENTS_BYTES = 20 * 1024 * 1024;
export const MAX_STORED_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 20;
export const MAX_RAW_MESSAGE_BYTES = 25 * 1024 * 1024;

const DANGEROUS_EXT = new Set(["exe", "bat", "cmd", "com", "scr", "pif", "msi", "js", "jse", "vbs", "vbe", "wsf", "wsh", "ps1", "jar", "hta", "cpl", "lnk", "reg", "dll", "sh", "app", "apk"]);
export const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");
export const isDangerousFile = (name: string) => DANGEROUS_EXT.has(extOf(name));

/** Nome file sicuro per il salvataggio e per l'intestazione di download. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "allegato";
  const clean = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "_").replace(/^\.+/, "").trim().slice(0, 150);
  return clean || "allegato";
}
/** Tipi che il browser potrebbe eseguire/interpretare: si scaricano sempre come file generico. */
export function downloadMime(mime: string): string {
  return /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|text\/javascript|application\/javascript)/i.test(mime) ? "application/octet-stream" : (mime || "application/octet-stream").slice(0, 150);
}
export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
