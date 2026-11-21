#!/usr/bin/env bash
# Avvia una casella di posta VERA per la verifica locale: Dovecot (IMAP 127.0.0.1:1143) + un server SMTP di prova (127.0.0.1:2525).
# Richiede il pacchetto "dovecot-imapd" (solo ambiente di prova, non è una dipendenza dell'app). Utenti: ufficio@test.local / secret123, altro@test.local / secret456.
set -euo pipefail
cd "$(dirname "$0")/../.."
B=/tmp/nx-mail
mkdir -p $B/maildir $B/run $B/home $B/outbox
id vmail >/dev/null 2>&1 || useradd -r -u 5000 -m -d $B/home vmail 2>/dev/null || true
printf 'ufficio@test.local:secret123\naltro@test.local:secret456\n' > $B/users
chown -R 5000:5000 $B/maildir $B/home 2>/dev/null || true
cat > $B/dovecot.conf <<'CONF'
protocols = imap
listen = 127.0.0.1
base_dir = /tmp/nx-mail/run
log_path = /tmp/nx-mail/dovecot.log
mail_location = maildir:/tmp/nx-mail/maildir/%u
ssl = no
disable_plaintext_auth = no
auth_mechanisms = plain login
first_valid_uid = 1
passdb {
  driver = passwd-file
  args = scheme=PLAIN username_format=%u /tmp/nx-mail/users
}
userdb {
  driver = static
  args = uid=5000 gid=5000 home=/tmp/nx-mail/home/%u
}
service imap-login {
  inet_listener imap {
    port = 1143
  }
  inet_listener imaps {
    port = 0
  }
}
namespace inbox {
  inbox = yes
  mailbox Sent {
    special_use = \Sent
    auto = create
  }
  mailbox Drafts {
    special_use = \Drafts
    auto = create
  }
}
CONF
pgrep -f "dovecot -c $B/dovecot.conf" >/dev/null || (nohup dovecot -c $B/dovecot.conf >/dev/null 2>&1 </dev/null &)
pkill -f "mail-smtp.mjs" 2>/dev/null || true
nohup node scripts/verify-stack/mail-smtp.mjs > $B/smtp.log 2>&1 </dev/null &
for _ in $(seq 1 20); do (echo > /dev/tcp/127.0.0.1/1143) 2>/dev/null && (echo > /dev/tcp/127.0.0.1/2525) 2>/dev/null && { echo "POSTA DI PROVA pronta: IMAP 127.0.0.1:1143, SMTP 127.0.0.1:2525"; exit 0; }; sleep 0.5; done
echo "posta di prova non raggiungibile" >&2; exit 1
