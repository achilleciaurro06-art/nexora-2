import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";

/** Chiave AES-256: 32 byte in base64 oppure 64 caratteri esadecimali. */
export function parseKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const v = raw.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, "hex") : Buffer.from(v, "base64");
  return buf.length === 32 ? buf : null;
}

/** Cifratura autenticata AES-256-GCM: "v1:" + base64(iv | tag | testo cifrato). I segreti non finiscono mai in chiaro nel database. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return `${VERSION}:${Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64")}`;
}
export function decryptSecret(token: string, key: Buffer): string {
  if (!token.startsWith(`${VERSION}:`)) throw new Error("formato non riconosciuto");
  const raw = Buffer.from(token.slice(VERSION.length + 1), "base64");
  if (raw.length < 29) throw new Error("dato non valido");
  const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

/** "state" OAuth firmato e a scadenza: impedisce di avviare il collegamento per conto di un altro utente/organizzazione. */
export function signState(payload: Record<string, unknown>, key: Buffer, ttlSeconds = 600, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSeconds })).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}
export function verifyState<T extends Record<string, unknown>>(state: string, key: Buffer, now = Date.now()): T | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", key).update(body).digest();
  let given: Buffer;
  try { given = Buffer.from(sig, "base64url"); } catch { return null; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    return typeof p.exp === "number" && p.exp * 1000 > now ? p : null;
  } catch { return null; }
}
