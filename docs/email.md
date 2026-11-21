# NEXORA – modulo Email

Stato: codice completo e verificato in locale; **collegamento reale verificato solo per IMAP/SMTP** (contro una casella di prova locale).
Gmail e Microsoft 365 sono implementati ma **non provati con account reali** (servono credenziali OAuth: vedi sotto).

## Provider supportati
| Provider | Accesso | Invio | Ricezione | Stato della verifica |
|---|---|---|---|---|
| Altra casella (IMAP/SMTP) | utente e password (cifrate) | SMTP (nodemailer) | IMAP incrementale per UID | **Verificato davvero** con Dovecot + server SMTP di prova (protocolli reali) |
| Gmail / Google Workspace | OAuth 2.0 (nessuna password salvata) | Gmail API `messages.send` | Gmail API + cronologia (`historyId`) | Codice + test con API simulata. **Non provato con Google** |
| Outlook / Microsoft 365 | OAuth 2.0 (Microsoft Entra) | Graph: bozza + invio | Graph delta per cartella | Codice + test con API simulata. **Non provato con Microsoft** |

L'architettura è modulare: ogni provider implementa `send / sync / verify` (`src/modules/email/providers/`); il resto (messaggi, conversazioni, collegamento al CRM, bozze, allegati) è indipendente dal provider.

## Variabili d'ambiente (nessuna è impostata né modificata da questo lavoro)
| Variabile | Obbligatoria per | Note |
|---|---|---|
| `EMAIL_ENCRYPTION_KEY` | **qualsiasi** casella | 32 byte in base64 (es. `openssl rand -base64 32`). Cifra token e password (AES-256-GCM). Senza di essa NEXORA rifiuta di salvare credenziali. **Non perderla né cambiarla**: le caselle collegate andrebbero ricollegate. |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Gmail | Progetto Google Cloud, API Gmail abilitata, schermata di consenso, URI di reindirizzamento `https://<dominio>/api/email/oauth/gmail/callback`. Scope: `gmail.readonly`, `gmail.send`. |
| `MS_OAUTH_CLIENT_ID`, `MS_OAUTH_CLIENT_SECRET`, `MS_OAUTH_TENANT` (facoltativa, default `common`) | Outlook | App in Microsoft Entra, permessi delegati `Mail.Read`, `Mail.Send`, `offline_access`, `User.Read`; URI `https://<dominio>/api/email/oauth/outlook/callback`. |
| `CRON_SECRET` (≥ 16 caratteri) | sincronizzazione pianificata | Protegge `/api/email/sync`. |
| `EMAIL_ALLOW_PRIVATE_HOSTS` | **solo sviluppo/prova** | `true` consente server di posta su reti interne/localhost. **In produzione lasciarla non impostata**: protegge da richieste verso reti interne (SSRF). |

Finché mancano, la pagina «Caselle collegate» elenca con precisione cosa manca (nessuna connessione simulata).

## Sicurezza
- Segreti **cifrati dall'app** e conservati in `private.email_account_secrets` (schema non esposto, nessun accesso per gli utenti: solo funzioni del `service_role`). Mai restituiti al browser, mai nei log.
- Revoca: «Disconnetti» elimina i segreti, ferma la sincronizzazione e (Google) revoca il token; i messaggi già importati restano nello storico.
- Accesso ai messaggi: RLS per organizzazione **e** per casella (`condivisa` o `riservata` + collaboratori autorizzati; anche il titolare non legge una casella riservata se non è autorizzato). Allegati serviti dal server dopo il controllo RLS (bucket privato `email-attachments` senza policy, sempre come download, mai interpretati dal browser).
- HTML ricevuto: mostrato in `iframe sandbox` senza script, con CSP che blocca ogni risorsa remota. HTML scritto dall'utente: sanitizzato con lista di permessi. Intestazioni: indirizzi validati (nessuna iniezione).
- Invii: chiave di idempotenza + indice univoco (nessun doppio invio); l'email risulta «inviata» solo dopo la conferma del provider; se l'esito è incerto (timeout dopo l'invio dei dati) non si rinvia da soli.
- Il contenuto delle email per il Copilot è marcato come dato non attendibile; l'AI propone soltanto, nessuna azione automatica.

## Sincronizzazione
- Manuale («Sincronizza»), all'apertura della posta se i dati hanno più di 5 minuti, e pianificata tramite `GET/POST /api/email/sync` con `Authorization: Bearer $CRON_SECRET`.
- **La pianificazione non è configurata**: questo lavoro non modifica Vercel. Per attivarla: Vercel Cron (nel piano gratuito Hobby la frequenza massima è giornaliera; per intervalli più brevi serve un piano Pro o uno scheduler esterno gratuito, es. GitHub Actions con `curl`).
- Idempotente (id del provider, Message-ID, indici univoci); blocco anti-concorrenza; cursore incrementale (UID IMAP, `historyId`, delta link); errori di autorizzazione → casella «Da ricollegare»; errori temporanei → nuovi tentativi, dopo 5 consecutivi stato «Errore».
- Prima lettura: solo gli ultimi messaggi (40–60) per non importare anni di posta.

## Limiti noti
- Allegati caricati nel compositore: **max 4 MB ciascuno** (limite di richiesta delle funzioni serverless); si possono aggiungere in più il PDF del preventivo e i documenti del cliente (totale 20 MB per email). Gli allegati ricevuti oltre 10 MB non vengono salvati.
- Gli allegati caricati ma poi non inviati restano nella cartella privata delle bozze finché la bozza non viene eliminata (nessuna pulizia automatica).
- Microsoft Graph non consente di impostare `In-Reply-To` personalizzato: le risposte si raggruppano per conversazione del provider.
- Il testo del messaggio si modifica con un editor semplice (grassetto, corsivo, sottolineato, elenchi, link): niente immagini incorporate né tabelle.
- Lo stato letto/non letto è unico per la casella (non per singolo collaboratore). Segnare come letto non lo propaga al provider.
- Ricerca per sottostringa (nessun indice full-text).
- Notifiche push/email di NEXORA non incluse.

## Costi e servizi esterni
- Nessun servizio a pagamento introdotto. Nuove dipendenze npm gratuite: `nodemailer` (MIT-0), `imapflow` (MIT), `mailparser` (MIT); solo test: `smtp-server`.
- Gmail: l'uso in produzione dello scope `gmail.readonly` (sensibile/limitato) richiede la verifica dell'app da parte di Google (e per distribuzione pubblica una valutazione di sicurezza, anche a pagamento); per un uso interno a un'organizzazione Google Workspace si può evitare impostando l'app come «Interna».
- Microsoft: la registrazione dell'app in Entra è gratuita; serve il consenso dell'amministratore del tenant se così configurato.
- Analisi AI delle email: usa il modello e la quota AI già presenti (Gemini); consuma token dell'organizzazione.

## Come si verifica in locale (posta reale di prova)
```bash
scripts/verify-stack/mail-up.sh        # Dovecot (IMAP 127.0.0.1:1143) + server SMTP di prova (127.0.0.1:2525); richiede il pacchetto dovecot-imapd
npx vitest run tests/email-imap-integration.test.ts   # protocolli SMTP/IMAP reali
npx playwright test e2e/09-email.spec.ts               # flussi completi nel browser (dopo verify:up e verify:app)
```
Utenti di prova: `ufficio@test.local / secret123`, `altro@test.local / secret456`. I destinatari `@reject.test` vengono rifiutati (550) per provare gli errori. Il server SMTP di prova salva ogni messaggio ricevuto in `/tmp/nx-mail/outbox/*.eml`.
