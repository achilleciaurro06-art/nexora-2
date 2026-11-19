// Genera chiavi LOCALI di prova (HS256) per lo stack di verifica. Non sono chiavi di produzione.
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const out = new URL("../../.env.verify", import.meta.url);
if (existsSync(out)) { console.log(".env.verify esiste già: nessuna modifica"); process.exit(0); }

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const secret = randomBytes(32).toString("hex");
const sign = (role) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ iss: "supabase-local", role, iat: 1700000000, exp: 2300000000 });
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
};
writeFileSync(out, [
  `JWT_SECRET=${secret}`,
  `ANON_KEY=${sign("anon")}`,
  `SERVICE_ROLE_KEY=${sign("service_role")}`,
  `DB_PASSWORD=verify`,
  `DB_HOST=127.0.0.1`, `DB_PORT=54399`, `DB_NAME=nx_verify`,
  `API_URL=http://127.0.0.1:54321`,
].join("\n") + "\n");
console.log("creato .env.verify");
