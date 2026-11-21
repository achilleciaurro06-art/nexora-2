import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Porte di posta ammesse (evita che l'indirizzo del server serva a esplorare altri servizi). */
export const MAIL_PORTS = new Set([25, 143, 465, 587, 993, 2525]);

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1" || x.startsWith("fe80") || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("ff")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    return mapped ? isPrivateIp(mapped[1]!) : false;
  }
  return true;
}
export const validHostname = (h: string) => h.length > 0 && h.length <= 253 && /^[A-Za-z0-9.-]+$/.test(h) && !h.startsWith(".") && !h.includes("..");

/**
 * Risolve il server di posta e rifiuta indirizzi interni (SSRF). Ritorna l'IP da usare per la connessione.
 * `allowPrivate` serve solo agli ambienti di sviluppo/prova (variabile EMAIL_ALLOW_PRIVATE_HOSTS).
 */
export async function resolveMailHost(host: string, port: number, allowPrivate: boolean): Promise<string> {
  if (!validHostname(host) && isIP(host) === 0) throw new Error("Nome del server non valido");
  if (!allowPrivate && !MAIL_PORTS.has(port)) throw new Error("Porta non ammessa (usa 25, 465, 587, 2525, 143 o 993)");
  if (!allowPrivate && /^(localhost|.*\.(local|internal|localdomain|lan))$/i.test(host)) throw new Error("Server non raggiungibile da qui");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (ips.length === 0) throw new Error("Server non trovato");
  if (!allowPrivate && ips.some(isPrivateIp)) throw new Error("Server non raggiungibile da qui (indirizzo interno)");
  return ips[0]!;
}
