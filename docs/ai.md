# NEXORA – AI Core, Copilot, insight proattivi

## Architettura
- **Provider** (`src/server/ai`): interfaccia `AiProvider`; unico adapter reale **Gemini** (modello principale + modello di riserva, tentativi limitati: al massimo 3 per modello). `AI_PROVIDER=mock` attiva un provider SIMULATO solo per i test; è ignorato su Vercel produzione.
- **Crediti** (`usage.ts`, `run.ts`, migrazione 022): ogni chiamata al modello passa da `runAi`: *prenota* i token stimati (atomico nel DB, nessuna concorrenza può superare il limite) → chiama il provider → *contabilizza* i token reali (o, se il provider non li comunica, stimati e segnalati come tali) oppure *rilascia* tutto se fallisce (nessun addebito). Prenotazioni abbandonate si rimborsano dopo 10 minuti. Limite mensile in token per organizzazione, configurabile dal gestore in `/admin` insieme ai prezzi (€ per milione di token) usati SOLO per stimare il costo. Storico visibile in Copilot e in Impostazioni → AI.
- **Strumenti** (`src/modules/copilot/tools`): 19 strumenti tipizzati di sola lettura (clienti, preventivi, analisi preventivo, fatture registrate, statistiche, giornata, follow-up, appuntamenti, briefing, email, catalogo, riepilogo attività, segnalazioni). Eseguiti col client dell'utente (RLS): nome noto, permesso reale, parametri validati con zod, risultati troncati. Il modello non accede mai al database.
- **Orchestratore** (`copilot/service.ts`): protocollo JSON a passi (strumenti → risposta finale), massimo 4 chiamate al modello e 8 strumenti per domanda; contesto della pagina (solo il percorso, verificato dal server).
- **Azioni** (`prepare.ts`, `apply.ts`, `execute.ts`): il modello PROPONE; il server valida e risolve su dati reali (id inventati o di altri tenant scartati; destinatari email mai dal modello). Solo la conferma dell'utente (server action, permesso `data:write`) esegue, con prenotazione atomica (una sola esecuzione), esito registrato e ritentabile se fallita. Tipi: attività, follow-up, data follow-up preventivo, nota cliente, **bozza** email (mai inviata dall'AI), appuntamento, descrizione/categoria catalogo, note/condizioni di preventivo in bozza, bozza di preventivo. L'AI non modifica fatture né preventivi inviati.
- **Insight** (`src/modules/insights`): regole pure su dati reali (nessun costo AI), generate all'apertura della dashboard al massimo ogni 30 minuti (prenotazione atomica), deduplicate per chiave, aggiornate, chiuse quando la condizione cessa, riaperte se ritorna; stato nuovo/visualizzato/completato/ignorato conservato.

## Sicurezza
RLS su tutte le tabelle nuove; funzioni privilegiate solo `service_role`; conferma dell'utente verificata lato server; contenuto di email/documenti = dato non attendibile (delimitato, mai istruzione; il modello non ha strumenti di scrittura); limiti di frequenza (`AI_RATE_LIMIT_PER_10MIN`, default 20) e idempotenza per richiesta.

## Cosa NON è verificato
Gemini reale: non è stato possibile chiamarlo dall'ambiente di sviluppo (chiave del proxy bloccata per il servizio). La logica di tentativi/fallback è testata con SDK simulato, i flussi con provider simulato su database reale. La qualità delle risposte di un modello vero va verificata in produzione con `GEMINI_API_KEY` valida.

## Variabili d'ambiente
Nessuna nuova obbligatoria. Opzionali: `AI_RATE_LIMIT_PER_10MIN`. Esistenti: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`. `AI_PROVIDER` NON va impostata in produzione.

## Limiti
Streaming: arrivano in tempo reale gli stati di avanzamento, non i singoli token (il modello risponde in JSON). Costo in euro solo stimato e solo se il gestore imposta i prezzi. Insight email solo da caselle condivise. Nessuna previsione: le regole descrivono fatti misurati con soglie dichiarate.
