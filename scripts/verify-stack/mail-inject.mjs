// Invia un'email di prova al server SMTP locale (protocollo SMTP vero) per simulare un cliente che scrive.
// Uso: node mail-inject.mjs --from a@x --to b@y --subject "..." --text "..." [--html "..."] [--attach file] [--message-id <id>] [--in-reply-to <id>] [--cc c@z]
import nodemailer from "nodemailer";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith("--") ? [...acc, [v.slice(2), arr[i + 1]]] : acc), []));
const t = nodemailer.createTransport({ host: "127.0.0.1", port: 2525, ignoreTLS: true, auth: { user: "altro@test.local", pass: "secret456" } });
const info = await t.sendMail({
  from: a.from, to: a.to, cc: a.cc, subject: a.subject ?? "(prova)", text: a.text, html: a.html, messageId: a["message-id"], inReplyTo: a["in-reply-to"], references: a["in-reply-to"],
  attachments: a.attach ? [{ filename: basename(a.attach), content: readFileSync(a.attach) }] : [],
});
console.log(info.messageId);
