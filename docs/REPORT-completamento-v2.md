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

---

## Aggiornamento – Fase 3: adattabilità per settore (branch `feature/completamento-funzionale-v2`, NON in produzione)

**Fatto e verificato (DB, unit, E2E in browser):**
- **Settore e terminologia** (Impostazioni → Settore): settore (generico, rubinetterie, serramenti, edilizia, impianti, servizi) e nomi personalizzabili di cliente/preventivo (singolare e plurale). Applicati a menu laterale, titoli e pulsanti degli elenchi Clienti e Preventivi. Il settore entra anche nel contesto del Copilot (sotto forma di dato, non di istruzione).
- **Campi personalizzati** su clienti e preventivi (testo, numero, data, scelta da elenco, sì/no; obbligatori opzionali): creazione, disattivazione/riattivazione senza perdere i valori già salvati, validazione lato server (i valori di campi disattivati restano intatti), copia nella duplicazione del preventivo, visibili nella scheda preventivo.
- **Catalogo prodotti e servizi** (nuova voce «Catalogo»): codice univoco, categoria, unità, prezzo base, IVA, attivo/archiviato, ricerca.
- **Listini**: prezzi per prodotto, assegnabili al cliente; nel preventivo il prodotto prende il prezzo di listino del cliente, altrimenti il prezzo base (con indicazione di quale è stato applicato).
- **Modelli di preventivo**: righe, oggetto, note e condizioni; «Applica un modello» nel modulo (chiede conferma se sostituisce righe; non sovrascrive oggetto/note/condizioni già compilati).
- **Proposte per settore**: campi e modelli di partenza aggiungibili con un clic (idempotente, non duplica né tocca l'esistente).
- Permessi: catalogo e modelli → chi può scrivere; listini, campi personalizzati e settore → titolare/amministratori. Tutto isolato per organizzazione e registrato in audit.

**Migrazione:** `20261119000018_sector_adaptability.sql` (additiva: 5 tabelle nuove, colonne `sector`/`terminology` su `organizations`, `custom_values` su `customers`/`quotes`, `price_list_id` su `customers`; sostituisce `duplicate_quote` per copiare i campi personalizzati). Da applicare dopo la 017; **non applicata in produzione**.

**Test:** 195 controlli SQL (+27 in `50_sector.sql`), 111 unit (+9), 53 E2E (+11), tsc/eslint puliti.

**Limiti noti e decisioni da confermare:**
- I preset di settore (campi e modelli) sono **proposte mie, non conoscenza di settore**: per rubinetterie e serramenti servono i vostri veri campi, listini e voci tipo. I prezzi dei modelli sono a zero.
- La terminologia personalizzata è applicata a menu ed elenchi principali; altre schermate (messaggi, PDF, Copilot, schede di dettaglio) usano ancora «cliente»/«preventivo».
- I campi personalizzati non compaiono (ancora) nel PDF, nelle ricerche né nei filtri; i valori dei preventivi si salvano con una seconda scrittura dopo il salvataggio (se fallisce, il preventivo c'è e il messaggio lo dice).
- Il catalogo non ha import da Excel/CSV né storico dei prezzi; la scelta del prodotto nel preventivo ricopia i dati (non resta un legame con il prodotto: cambiare il catalogo non modifica i preventivi esistenti — voluto).
- Il confronto prezzi AI (Fase precedente) non usa ancora il catalogo.

---

## Aggiornamento – Fase 4: CRM completo e valore commerciale (branch `feature/completamento-funzionale-v2`, NON in produzione)

**Fatto e verificato (DB, unit, E2E in browser):**
- **Archiviazione e ripristino** (distinti dall'eliminazione): dalla scheda e dalla lista; elenco «Attivi» / «Archiviati (n)» con ricerca (nome, P.IVA, email, città) e filtri per stato e tipologia; data e autore impostati dal database (non falsificabili); tutto resta collegato (preventivi, referenti, documenti, attività, storico). Gli archiviati sono esclusi da elenchi attivi, selettori (preventivi, attività, documenti, revisione documenti), conteggi e «nuovi clienti» della dashboard, «clienti da ricontattare», abbinamento clienti nell'analisi documenti e proposte del Copilot; il database vieta nuovi preventivi su clienti archiviati (anche duplicando). Le schede dei record già collegati (modifica preventivo/attività/documento) mostrano comunque il cliente archiviato.
- **Eliminazione definitiva controllata** (`delete_customer_permanently`): solo titolare/amministratori, solo su clienti già archiviati, conferma scritta «ELIMINA»; **negata** se esistono preventivi (anche rimossi), fatture registrate, documenti o attività, con spiegazione dei numeri. Se consentita, elimina con il cliente solo referenti, note e cronologia; l'audit conserva l'operazione. Nessun audit disattivato, nessuna cascata indiscriminata.
- **Scheda cliente a sezioni** (Panoramica, Referenti, Preventivi, Attività, Documenti e comunicazioni, Fatturazione) con 4 indicatori sempre visibili (accettato, in trattativa, fatturato/incassato, ultima attività/ultimo contatto). Anagrafica estesa: tipologia, settore di attività, sito web, data di creazione, campi personalizzati e listino (Fase 3, compatibili e conservati).
- **Valore commerciale**: una sola funzione SQL (`customer_commercial_summary`) alimenta scheda e Copilot: emessi (non bozze), accettati, rifiutati, scaduti, aperti (inviati), bozze, valore medio, conversione (accettati su decisi), ultima attività, ultimo contatto. **Accettato ≠ fatturato ≠ incassato** in ogni schermata.
- **Fatture registrate**: estesa la tabella `quote_billings` della Fase 2 (nessuna duplicazione): numero, data, imponibile, IVA, totale (calcolati dal server), collegamento facoltativo al preventivo accettato, stato e data di incasso, note; incasso/annullamento, rimozione (titolare/amministratori), eventi in cronologia. Dalla scheda cliente e dalla scheda preventivo. **Non è fatturazione elettronica**: sono registrazioni di dati; NEXORA non genera né invia documenti fiscali.

**Migrazione:** `20261119000019_crm_complete.sql` (additiva; sostituisce `activity_trigger`, `quote_billings_guard`, `customers_to_recontact`). Dopo la 018, non applicata in produzione. Nuove funzioni: `customer_commercial_summary`, `customer_delete_blockers`, `delete_customer_permanently`.

**Sostituzione di funzioni già presenti:** il pulsante «Rimuovi cliente» (RPC `remove_customer`, che rimuoveva anche i preventivi aperti) è stato sostituito da archiviazione + eliminazione definitiva controllata; la RPC resta nel database ma non è più usata dall'interfaccia.

**Test:** 241 controlli SQL (+46 in `60_crm.sql`), 122 unit (+11), 64 E2E (+11), tsc/eslint/build puliti. Il test SQL ha fatto correggere un ordine di cancellazione (gli eventi generati dalla cascata dei referenti).

**Limiti noti:**
- **Appuntamenti, chiamate registrate ed email** non esistono ancora (Fasi 5 e 6): la scheda lo dichiara; documenti, note e cronologia sono integrati.
- «Ultimo contatto» = ultima nota, attività chiusa o preventivo inviato/deciso (finché non ci saranno chiamate/email).
- Le fatture non si modificano (si rimuove e si reinserisce); nessuna nota di credito, scadenze di pagamento o solleciti; incasso solo totale (niente pagamenti parziali).
- I preventivi di un cliente archiviato restano visibili in elenchi, follow-up e statistiche dei preventivi (sono trattative reali), contrassegnati «(cliente archiviato)».
- La dashboard usa ancora il proprio calcolo per periodo; la sua riscrittura su aggregazioni SQL è prevista in Fase 9.

---

## Aggiornamento – Fase 5: attività, appuntamenti, chiamate, follow-up e centro Promemoria (branch `feature/completamento-funzionale-v2`, NON in produzione)

**Fatto e verificato (DB, unit, E2E in browser):**
- **Attività evolute**: tipologie configurabili da Impostazioni → Settore (di base: generica, telefonata, invio/preparazione materiale, altro; se ne aggiungono senza toccare il database), referente, ora di scadenza, durata, note interne, promemoria a scelta (all'ora, 15 min, 1 ora, 1 o 2 giorni prima). Elenco con ricerca, filtri (stato, tipologia, cliente, responsabile, priorità) e ordinamento; tre viste: per scadenza, elenco, per data. Creazione dalla scheda cliente.
- **Appuntamenti**: titolo, cliente e referente, data, inizio/fine, luogo, responsabile, partecipanti, note interne, stato (programmato/completato/annullato), promemoria che segue lo spostamento. **Calendario mese/settimana/giorno** navigabile + elenco imminenti/passati; completa, annulla, riapri, sposta; scheda cliente a un clic.
- **Registro chiamate (manuale)**: entrata/uscita, cliente e referente, collaboratore, data e ora, durata, esito (risposto, nessuna risposta, occupato, da richiamare, interessato, non interessato, altro), note, e **prossimo contatto che genera il follow-up** nella stessa transazione. Nessuna integrazione telefonica.
- **Follow-up con sei stati** (Da fare, Programmato, In corso, In attesa, Completato, Annullato): ogni stato ha un significato definito (visibile in app); transizioni imposte dal database (i chiusi si possono solo riaprire in «Da fare»); **cronologia scritta solo dal database** (stati, note, riprogrammazioni con data precedente e nuova); riprogrammazione con motivo; in ritardo ben riconoscibile; creabile da attività, chiamata, preventivo o cliente.
- **Centro Promemoria**: viste Oggi / In ritardo / Prossimi (14 giorni) / Completati con contatori dinamici, «richiedono azione», urgenti, telefonate da fare, filtri per responsabile, tipologia e priorità, ordinamento per scadenza, azioni rapide (completa, riprogramma, modifica) che agiscono sul modulo di origine. Legge la vista SQL `agenda_items` (attività, follow-up, appuntamenti, follow-up dei preventivi): **nessun dato duplicato**; ogni elemento sta in una sola vista. Distingue «Da fare ora» da «Programmato».
- **Integrazioni**: scheda cliente (prossimo appuntamento e follow-up, creazione rapida, chiamate, storico cronologico, ultimo contatto che considera chiamate e appuntamenti); dashboard («lavoro di oggi»: da completare oggi, scaduti, follow-up da effettuare, appuntamenti a 7 giorni, carico di lavoro per responsabile) con numeri dai dati reali; Copilot (nuovi blocchi agenda e chiamate, profilo cliente con chiamate/appuntamenti/follow-up, clienti senza contatti recenti e follow-up in ritardo) con le stesse regole di accesso; clienti archiviati esclusi dai selettori ma storico consultabile (il database vieta nuovi record su archiviati).
- **Notifiche interne**: nuovi tipi (follow-up da eseguire, appuntamento imminente, promemoria anche per gli appuntamenti), preferenze per tipo, idempotenti, stato di lettura. Corretto un difetto: la pagina Notifiche poteva non mostrare subito gli avvisi appena generati.
- **Fuso orario**: istanti in UTC, orari inseriti e mostrati nel fuso dell'azienda (Europe/Rome) con gestione di ora legale e mezzanotte; corretto anche il raggruppamento per giorno della cronologia cliente (prima usava il fuso del server).
- Predisposto per la futura creazione di attività da parte dell'AI: le proposte del Copilot passano da `apply.ts` e dalle stesse tabelle/regole (nessuna scorciatoia).

**Migrazione:** `20261119000020_agenda_followups.sql` (additiva). Tabelle: `task_types`, `appointments`, `appointment_participants`, `follow_ups`, `follow_up_events`, `call_logs`; colonne nuove su `tasks` (tipologia, referente, durata, note, ora) e `reminders` (appuntamento, scarto); vista `agenda_items`; funzioni `log_call`, `set_follow_up_status`, `reschedule_follow_up`; sostituisce `refresh_my_notifications`, `customer_delete_blockers`, `delete_customer_permanently`, `customer_commercial_summary`. Dopo la 019; **non applicata in produzione**.

**Test:** 332 controlli SQL (+91 in `70_agenda.sql`), 159 unit (+37), 78 E2E (+13), tsc/eslint/build puliti. I test hanno fatto emergere e correggere: una funzione trigger che non poteva servire due tabelle, un permesso mancante in `log_call`, la race delle notifiche.

**Limiti noti:**
- **Nessuna notifica email né push**: sono solo interne e si generano all'apertura dell'app (nessun cron). Per email/push servono un servizio di invio e una pianificazione: nessuno è attivo, nessun costo introdotto.
- Il fuso è fisso (Europa/Roma): niente impostazione per azienda.
- Gli appuntamenti non si sincronizzano con calendari esterni e non c'è la ricorrenza; i partecipanti sono solo collaboratori NEXORA.
- Le tipologie di attività non includono «follow-up» e «appuntamento» perché hanno moduli propri (con scorciatoie di creazione).
- Il centro Promemoria mostra al massimo 14 giorni in avanti e gli ultimi 30 giorni di completati.

---

## Fase 6 – Email, invio, casella aziendale e storico clienti

Dettagli di configurazione, sicurezza e limiti: `docs/email.md`.

**Realizzato (codice):** collegamento caselle (Gmail e Outlook via OAuth, altra casella via IMAP/SMTP); invio reale (l'email è «inviata» solo dopo la conferma del provider, idempotente, nessun doppio invio); ricezione con sincronizzazione incrementale e idempotente (manuale, all'apertura, e via `/api/email/sync` con `CRON_SECRET`); conversazioni; collegamento automatico al CRM solo per indirizzo esatto (certo → collega; ambiguo → l'utente sceglie; nessuno → manuale; mai per somiglianza di nome) e collegamento/scollegamento manuale con cliente, referente, preventivo, attività, follow-up; storico email nella scheda cliente che alimenta «ultimo contatto» (i clienti archiviati mantengono lo storico ma non si può scrivere dai selettori normali); sezione Email generale (arrivo, inviate, bozze, tutte, caselle) con ricerca e filtri; allegati in bucket privato con download autorizzato; bozze con salvataggio automatico, 6 modelli iniziali, firma per casella/collaboratore; invio preventivo con PDF; creazione attività/follow-up da email senza duplicati; analisi Copilot (l'AI propone soltanto, il testo delle email è dato non attendibile).

**Verificato davvero:** IMAP/SMTP contro una casella locale reale (Dovecot + server SMTP di prova): collegamento, invio con allegato/Ccn/risposta, rifiuto 550, sincronizzazione incrementale, deduplica della copia in Inviata, blocco SSRF; interfaccia completa in browser.
**Solo con API simulate (non provato con account reali):** Gmail, Microsoft 365. **Non verificabile:** analisi AI (nessuna chiave Gemini; provata solo la gestione dell'errore).
**Configurazione ancora necessaria:** `EMAIL_ENCRYPTION_KEY`, credenziali OAuth Google/Microsoft, `CRON_SECRET` e uno scheduler esterno; nessuna modifica a Vercel/produzione è stata fatta.

**Migrazione:** `20261119000021_email.sql` (additiva; **non applicata in produzione**).

**Test:** 429 controlli SQL (suite completa verde), 241 unit/integrazione (6 con SMTP/IMAP reali), 94 E2E (15 nuovi), tsc/eslint/build puliti.

**Limiti noti:** allegati caricati max 4 MB; nessuna pulizia automatica degli allegati di bozze abbandonate; risposte Graph raggruppate per conversazione; sincronizzazione senza cron configurato; scope Gmail `gmail.readonly` soggetto a verifica Google per uso pubblico; niente notifiche push/email; letto/non letto unico per casella.

---

## Fase 7 – AI Core, Copilot intelligente e AI proattiva

Dettagli: `docs/ai.md`. Migrazione `20261119000022_ai_core.sql` (additiva).

- **AI Core**: 19 strumenti di sola lettura con permessi/validazione lato server, orchestratore a passi con limiti di costo, contesto della pagina verificato, provider astratto (Gemini + provider simulato solo test).
- **Copilot**: pannello su ogni pagina e pagina dedicata, conversazioni persistenti, stati di avanzamento in streaming, fonti consultate, domande suggerite per pagina, azioni proposte con conferma ed esito.
- **Proattività**: insight da regole su dati reali (clienti di valore fermi, preventivi senza risposta, follow-up scaduti, email senza risposta, fatture non incassate, calo fatturato/clienti, appuntamenti, catalogo) con deduplicazione, aggiornamento, scadenza, stato.
- **Dashboard** con sintesi, opportunità, attenzione, azioni consigliate; **moduli**: scheda cliente (analisi), preventivi, email, appuntamenti (briefing), catalogo, promemoria.
- **Crediti**: prenotazione/contabilizzazione/rilascio atomici, limiti e prezzi configurabili, costo sempre dichiarato stimato.
- **Test**: SQL 489, unit/integrazione 296, E2E 108 (14 nuovi), tsc/eslint/build puliti. Gemini reale non verificabile da qui.
