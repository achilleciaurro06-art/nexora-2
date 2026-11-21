# Ambiente di verifica locale

Permette di provare NEXORA in un browser reale con login, database e storage veri, **senza toccare produzione**.
Non usa Docker Compose di Supabase (immagini troppo pesanti): fa girare i servizi ufficiali (GoTrue, PostgREST, Storage API)
contro un Postgres locale, con un mini gateway al posto di Kong.

## Requisiti
Docker (daemon attivo), Postgres 16 in ascolto su `127.0.0.1:54399` (utente `postgres`, accesso trust), Node 22.
Le chiavi di prova sono generate in `.env.verify` (ignorato da git; non sono chiavi di produzione).

## Uso
```bash
npm run verify:up      # crea il database "nx_verify", avvia i servizi e applica TUTTE le migrazioni
npm run verify:app     # compila e avvia l'app su http://127.0.0.1:3100 (usa --no-build per riavviare soltanto)
npx playwright test    # test end-to-end (27 test); azzerano i dati di prova a ogni esecuzione
npm run verify:down    # ferma i servizi
```
Se Playwright non trova il browser: `PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test`.
Riavviare l'app tra una corsa e l'altra azzera il limitatore di tentativi di accesso (in memoria).

## Posta di prova (modulo Email)
`scripts/verify-stack/mail-up.sh` avvia una casella IMAP/SMTP **vera** in locale (Dovecot + server SMTP di prova) per verificare invio, ricezione e sincronizzazione; vedi `docs/email.md`. Le variabili `EMAIL_ENCRYPTION_KEY` (valore di prova), `EMAIL_ALLOW_PRIVATE_HOSTS=true` e `CRON_SECRET` sono impostate solo da `run-app.sh` per l'ambiente di verifica.

## Cosa NON verifica
Gemini (nessuna chiave: si verifica solo la gestione dell'errore e le parti che non chiamano l'AI), Gmail e Microsoft 365 reali (solo API simulate), notifiche push,
il comportamento di Vercel (regioni, header di piattaforma) e i dati reali di produzione.
