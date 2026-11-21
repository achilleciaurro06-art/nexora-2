// Server SMTP di PROVA per la verifica locale (non è parte dell'applicazione).
// Riceve email con il protocollo SMTP vero e le consegna nelle Maildir di Dovecot per gli utenti noti;
// ogni messaggio ricevuto viene anche salvato in /tmp/nx-mail/outbox come file .eml per i controlli.
// Destinatari @reject.test vengono rifiutati (550) per provare la gestione degli errori del provider.
import { SMTPServer } from "smtp-server";
import { mkdirSync, writeFileSync, readFileSync, chownSync } from "node:fs";
import { randomUUID } from "node:crypto";

const BASE = "/tmp/nx-mail";
const users = Object.fromEntries(readFileSync(`${BASE}/users`, "utf8").split("\n").filter(Boolean).map((l) => l.split(":")));
mkdirSync(`${BASE}/outbox`, { recursive: true });
const own = (p) => { try { chownSync(p, 5000, 5000); } catch { /* non root */ } };

const server = new SMTPServer({
  authOptional: true, allowInsecureAuth: true, disabledCommands: ["STARTTLS"], size: 30 * 1024 * 1024, logger: false,
  onAuth(auth, _s, cb) { if (users[auth.username] && users[auth.username] === auth.password) cb(null, { user: auth.username }); else cb(new Error("Invalid credentials")); },
  onRcptTo(addr, _s, cb) { if (/@reject\.test$/i.test(addr.address)) cb(Object.assign(new Error("550 Recipient rejected"), { responseCode: 550 })); else cb(); },
  onData(stream, session, cb) {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => {
      const raw = Buffer.concat(chunks);
      writeFileSync(`${BASE}/outbox/${Date.now()}-${randomUUID().slice(0, 8)}.eml`, raw);
      for (const r of session.envelope.rcptTo) {
        const user = r.address.toLowerCase();
        if (!users[user]) continue;
        for (const d of ["", "/tmp", "/new", "/cur"]) { const p = `${BASE}/maildir/${user}${d}`; mkdirSync(p, { recursive: true }); own(p); }
        const f = `${BASE}/maildir/${user}/new/${Date.now()}.${randomUUID().slice(0, 8)}.nx:2,`;
        writeFileSync(f, raw); own(f);
      }
      cb();
    });
  },
});
server.on("error", (e) => console.error("smtp error", e.message));
server.listen(2525, "127.0.0.1", () => console.log("SMTP di prova su 127.0.0.1:2525"));
