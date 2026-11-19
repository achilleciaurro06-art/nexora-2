# NEXORA 2.0 – Report di completamento funzionale e allineamento con NEXORA 1

Stato al termine dell'intervento: **modifiche locali, NON committate, NON pubblicate, NON applicate in produzione.**
Base di partenza: commit `9529d8b`. Nessuna modifica a Vercel, variabili d'ambiente, credenziali o database di produzione.

## 1. Funzionalità completate (codice scritto e verificato dove indicato)

| Area | Cosa è stato fatto | Come è stato verificato |
|---|---|---|
| **Analisi prezzi AI (P0)** | Confronto di ogni riga con lo storico dei preventivi *inviati/accettati* dell'azienda; verdetto basso/alto/in linea/dati insufficienti; prezzo suggerito = mediana storica; motivazione; proposta facoltativa che l'utente può applicare, **modificare** o ignorare; solo su bozze. L'AI scrive solo la motivazione, senza cifre (un controllo scarta testi con numeri); i numeri sono deterministici. Meno di 3 voci simili → "dati insufficienti", nessun giudizio. | 12 test unitari sulle regole; test DB sull'isolamento dello storico analisi. **Chiamata Gemini reale non provata.** |
| **Copilot potenziato (P0)** | Contesto mirato per domanda (clienti da ricontattare, preventivi in attesa, storico di accettazione, valore per cliente, attività/scadenze/follow-up/promemoria, anomalie di prezzo, documenti, analisi precedenti, dati aziendali, scheda del cliente o preventivo citato). Budget fisso ≈14.000 caratteri. Proposte: attività, follow-up cliente, follow-up preventivo, nota cliente, bozza di preventivo, spunto. Ogni proposta richiede conferma ed è modificabile prima di applicarla; i nomi sono risolti lato server. Storico conversazioni mantenuto; mostra "Dati consultati". | 15 test sulla selezione del contesto, 6 sulla validazione/applicazione delle proposte. **Risposte reali del modello non provate.** |
| **Analisi documentale (P0)** | Schema esteso: cliente (anagrafica/fiscali), numero/titolo/date/validità, imponibile/IVA/totale, righe (qtà, prezzo, sconto, IVA, totale riga), condizioni di pagamento. Distingue *dedotto* e *mancante*; controlli di coerenza calcolati dal server (somma righe, imponibile+IVA, aliquote, date); controllo duplicati (stesso file, stesso cliente+totale, bozza già esistente). **Word (.docx) ed Excel (.xlsx)** oltre a PDF/immagini. Schermata di **revisione obbligatoria**: nulla viene creato senza conferma; originale sempre in archivio. | 13 test (estrazione docx/xlsx, normalizzazione, controlli, abbinamento cliente). **Analisi reale di un file non provata.** |
| **Scheda cliente 360° (P1)** | Anagrafica/fiscali, referenti (crea/modifica/elimina, con note), preventivi, attività, documenti, note, **timeline cronologica filtrabile** (cliente creato, referente aggiunto, preventivo creato/inviato/accettato, follow-up, attività completata, documento, nota). | Trigger e RLS testati su DB (98 controlli). UI non provata in browser. |
| **Attività avanzate (P1)** | Modifica, assegnazione a collaboratore (validata: deve appartenere all'organizzazione), priorità, scadenza, descrizione, stato, riapertura, collegamento a cliente e preventivo; viste Scadute / Imminenti / Altre / Completate; filtro "solo le mie"; creazione da cliente e da preventivo; scheda con link a cliente e preventivo e storico. | Logica di raggruppamento testata; vincoli DB testati. |
| **Dashboard (P2)** | Mantenuti tutti i KPI e blocchi esistenti. Aggiunti filtro periodo (30gg/90gg/12 mesi/tutto), andamento mensile del valore, conversione sui preventivi decisi, accettati/rifiutati/in attesa, nuovi clienti nel tempo, attività completate/aperte, follow-up imminenti, clienti da ricontattare, ultime operazioni. | 6 test sulle metriche. UI non provata. |
| **Notifiche interne (P2)** | Attività in scadenza (24 h) e scadute, follow-up preventivi, promemoria programmati, attività assegnate; campanella con contatore e pagina Notifiche (segna letta/tutte). Generazione idempotente all'apertura dell'app (nessun cron). | Test DB: 6 notifiche attese, idempotenza, isolamento tra utenti e organizzazioni, non falsificabili. |
| **Impostazioni aziendali (P3)** | Nome, logo (PNG/JPEG ≤1 MB, firma file verificata), indirizzo, P.IVA, C.F., email, telefono, sito, condizioni predefinite e informazioni a piè dei preventivi. Riusate nel **PDF** (logo, dati, piè) e nei nuovi preventivi. Solo titolare/amministratori. | Test DB su permessi e cartella logo; PDF generato e controllato visivamente. |
| **Archivio documentale (P3)** | Caricamento (anti-duplicato per impronta SHA-256), download, **visualizzazione** (PDF/immagini), eliminazione, modifica metadati (nome, descrizione, cliente), ricerca, filtri per tipologia (PDF/Word/Excel/Immagini/Altro) e cliente. | Policy Storage/RLS testate su DB. |
| **Audit (P4)** | Esteso a referenti, note, promemoria, **righe preventivo** (prima non tracciate). Pagina "Registro delle operazioni" con filtri e paginazione: owner/admin vedono tutto, gli altri solo le proprie operazioni. **Registro separato delle operazioni di piattaforma** (codici, sospensioni, quote AI). | Test DB. |
| **Rimozione clienti e preventivi** | Pulsante "Elimina" direttamente nelle liste Clienti e Preventivi (oltre che nelle schede), con conferma che riepiloga le conseguenze. Rimuovere un cliente rimuove in modo atomico anche i suoi preventivi aperti (bozza/inviato); accettati/chiusi, attività e documenti restano nello storico. Solo owner/admin (controllato anche nel database). Archiviazione, nessuna cancellazione fisica; tutto registrato in timeline e audit. I riferimenti a clienti/preventivi rimossi compaiono come "(rimosso)" senza link. | Test DB: ruolo, isolamento, anon, atomicità, storico, timeline e audit. UI non provata in browser. |
| **Sicurezza (P4)** | Vedi §7 del documento e §6/§7 qui sotto. | Test DB + controllo automatico sulle Server Action. |

## 2. Funzionalità già presenti e mantenute (non modificate nel comportamento)
Login, attivazione con codice, inviti, ruoli e permessi, console di piattaforma (codici, aziende, sospensione, quote AI), clienti (CRUD), preventivi (righe, IVA, sconti, numerazione senza buchi, stati, follow-up, PDF scaricabile), promemoria, analisi PDF con bozza, Copilot con storico, monitoraggio e quote token, cambio organizzazione, header di sicurezza, rate limiting, regione `fra1`.

## 3. Funzionalità NON implementate
- **Notifiche email**: richiedono un servizio esterno di invio (vedi §8). Non introdotto. Le notifiche sono solo interne. **Push**: non implementate (infrastruttura sproporzionata).
- **MFA obbligatoria per la console di piattaforma**: non implementata (servirebbe la schermata di registrazione del secondo fattore).
- **File Word/Excel legacy** (.doc, .xls): non supportati; solo .docx e .xlsx. Nei fogli Excel le date salvate come numeri possono comparire come numero seriale.
- **Rate limiting condiviso**: resta "best effort" in memoria per istanza (la barriera definitiva è il Firewall Vercel).
- **Generazione delle notifiche a orario** (cron): sostituita dalla generazione all'apertura dell'app; chi non apre l'app non riceve nulla.
- **Audit riga per riga** dei preventivi: si traccia la modifica del preventivo (campo `items_updated_at`), non il dettaglio di ogni riga.

## 4. Modifiche al database
Solo aggiunte, nessuna eliminazione di dati. Colonne: profilo aziendale (8) su `organizations`; `notes` su `customer_contacts`; `assigned_by` su `tasks`; `description` e `content_hash` su `documents`; `items_updated_at` su `quotes`. Tabelle: `customer_notes`, `activity_events`, `notifications`, `price_analyses`, `private.platform_audit`. Funzioni: `refresh_my_notifications`, `customers_to_recontact`, RPC audit di piattaforma. Policy: audit "proprie operazioni", cartella `_branding` riservata a owner/admin, eliminazione righe di bozza per i membri. Nuovi tipi di suggerimento AI.

## 5. Nuove migrazioni (in `supabase/migrations/`, NON applicate in produzione)
- `…010_commercial_features.sql` – profilo aziendale, note, timeline (con backfill di soli inserimenti), notifiche, audit esteso, audit di piattaforma, storage logo, correzione cancellazione organizzazione.
- `…011_price_analyses.sql` – storico analisi prezzi.
- `…012_audit_quote_items.sql` – tracciamento delle modifiche alle righe preventivo.
- `…013_member_edit_draft_items.sql` – correzione del difetto sotto.
- `…014_remove_customer.sql` – rimozione atomica di un cliente e dei suoi preventivi aperti.

Compatibilità: sono additive; l'app attualmente online non ne è toccata. Provate anche su un database già popolato (backfill: 4 eventi su dati di esempio, dati intatti). **Vanno applicate in ordine PRIMA di pubblicare il nuovo codice.**

## 6. Test
Superati: 74 test unitari (11 file), 98 controlli SQL su RLS/ruoli/isolamento/notifiche/audit/storage (3 file), typecheck, lint (0 errori, 4 avvisi di variabili inutilizzate), build di produzione.
**Non eseguiti:** nessuna prova in browser con un utente reale; nessun test end-to-end; nessuna chiamata reale a Gemini; le query lato app (supabase-js/PostgREST, comprese quelle con filtri su tabelle collegate) non sono state eseguite contro un'istanza reale.

## 7. Problemi aperti e difetti trovati
**Difetti preesistenti trovati e corretti (migrazioni 10 e 13):**
1. Eliminare un'organizzazione falliva (l'audit scriveva su un'organizzazione già rimossa).
2. **Un membro (non titolare/amministratore) che modificava un preventivo in bozza duplicava le righe** (la RLS impediva di eliminare le vecchie senza errore). Gli utenti con ruolo "membro" potrebbero averlo già incontrato: va verificato in produzione.
3. Modificare solo le righe di un preventivo non lasciava traccia nell'audit.

**Aperti:** vedi §3; inoltre quota AI predefinita 200.000 token/mese: con il contesto ampliato una domanda al Copilot ne prenota ~6.000–8.000, quindi bastano per circa 25–30 domande al mese per azienda → va alzata dalla console. Chiave Gemini: in passato bloccata (`API_KEY_SERVICE_BLOCKED`) e modello soggetto a sovraccarichi: non verificato. Il piano gratuito di Gemini può usare i dati per addestrare i modelli: per dati reali serve il piano a pagamento (invariato rispetto a prima).
**Sicurezza:** nessuna vulnerabilità critica trovata. Verificato: RLS attiva su tutte le tabelle (test automatico), isolamento tra organizzazioni, permessi per ruolo, conversazioni e suggerimenti AI privati, cartella logo protetta, ogni Server Action protetta ha un controllo di autorizzazione (verifica automatica) e valida gli identificativi, il platform admin vede solo organizzazioni, stato e quote AI (nessun accesso ai dati commerciali) e ogni sua azione è registrata.

## 8. Costi e dipendenze esterne introdotte
- **Nuova dipendenza npm:** `jszip` 3.10.2 (licenza MIT/GPL, gratuita) per leggere Word/Excel; con limiti anti zip-bomb. `pdf-lib` era già presente. `npm audit`: 0 vulnerabilità.
- **Nessun nuovo servizio a pagamento.** Nessun provider o modello AI cambiato (resta `gemini-3.5-flash-lite`, riserva configurabile `GEMINI_FALLBACK_MODEL`).
- **Costo AI:** la richiesta media del Copilot passa da ~1.000–2.000 a ~4.000–8.000 token in ingresso (contesto fino a ~14.000 caratteri); le analisi prezzi consumano token solo se ci sono ≥3 voci simili; le analisi di Word/Excel inviano il testo (fino a 60.000 caratteri). Tutto è conteggiato nelle quote per organizzazione.
- **Per le email (se le vorrai):** serve un servizio di invio transazionale (es. Resend, Postmark) con dominio verificato e chiave API; i costi vanno verificati al momento della scelta. Non introdotto senza la tua approvazione.

---

## Aggiornamento – Fase 2: Preventivi completi (branch `feature/completamento-funzionale-v2`, NON in produzione)

**Fatto e verificato (DB, unit, E2E in browser):**
- **Duplicazione** (`duplicate_quote`): nuova bozza con nuovo numero, data odierna, validità predefinita, righe e totali copiati; l'originale resta intatto; si apre in modifica. Permessi come la creazione (visualizzatori e altre organizzazioni esclusi).
- **Badge di stato colorato** (`StatusBadge`) in elenco preventivi, scheda preventivo, scheda cliente e Promemoria; il testo resta sempre presente.
- **Numerazione configurabile** (Impostazioni → Preventivi): prefisso, 3–8 cifre, con/senza anno e ripartenza annuale; anteprima; «prossimo numero» (mai indietro rispetto ai numeri emessi, solo titolare/amministratori). I preventivi già emessi non cambiano numero; nessun buco né duplicato (contatore atomico esistente).
- **Opzioni PDF**: modello classico/essenziale, colore, mostra/nascondi logo, dati di pagamento, marchio NEXORA.
- **Storico revisioni** (`quote_revisions`): una revisione per ogni salvataggio che cambia i contenuti (righe incluse; più scritture nella stessa transazione si fondono; salvataggi senza differenze e cambi di stato non generano revisioni); riepilogo leggibile («Modificato: oggetto, righe»); in sola lettura, non falsificabile né cancellabile.
- **Fatturato registrato** (`quote_billings`, decisione D1): importi realmente fatturati registrabili solo su preventivi accettati; scheda con valore preventivo / fatturato / da fatturare; evento in timeline e audit; KPI «Fatturato registrato» in dashboard (distinto dal valore dei preventivi). Rimozione solo titolare/amministratori.

**Migrazione:** `20261119000017_quotes_complete.sql` (additiva; sostituisce solo le funzioni interne `quotes_assign_number` e `activity_trigger`; crea la revisione iniziale dei preventivi esistenti). Da applicare in ordine dopo la 016, **non applicata in produzione**.

**Test:** 143 controlli SQL (+25 nuovi in `40_quotes_complete.sql`), 102 unit (+17), 42 E2E (+7), tsc/eslint/build puliti. I test SQL hanno trovato e fatto correggere un errore reale della migrazione prima del rilascio.

**Limiti noti:** le revisioni registrano lo storico ma non c'è (ancora) «ripristina questa versione»; il fatturato è inserito a mano (nessuna integrazione con la fatturazione elettronica); il prossimo numero effettivo non è leggibile da interfaccia (il contatore è privato) — dopo l'impostazione viene mostrato l'esito.
