import "server-only";
import { createHash, randomBytes } from "node:crypto";

/** Codici/token: casuali ad alta entropia, in DB solo l'hash SHA-256. */
export function hashSecret(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex");
}

export function generateActivationCode(): string {
  const raw = randomBytes(10).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12).padEnd(12, "7");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}
