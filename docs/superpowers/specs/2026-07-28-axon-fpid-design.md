# Driver `axon-fpid` (A.P.esse / Micrelec SF20) — design

Data: 2026-07-28

## Contesto e obiettivo

Collegare al bridge una stampante fiscale RT della famiglia gestita da
**axonFPiD_Pro_v7** di A.P.esse (Hydra RT, Helios RT, Edoplus RT, Aura RT,
Hydra II RT, RT21, RT22, RT30) — nel caso concreto una Micrelec **SF20 "Hydra"**.

axonFPiD_Pro_v7 è un'applicazione Windows che parla con la RT via seriale/USB o
Ethernet (TCPIP porta 9101). Verso i gestionali espone un **Server di Stampa**:
una cartella di ascolto in cui si depositano file `.TXT` contenenti comandi del
protocollo **SF20**; l'app li invia alla stampante e scrive un file
`Response_<nome>.xml` in una cartella LOG separata.

Il bridge non parla con la RT: parla con axonFPiD tramite quello scambio di file.

### Fonti

- `axonfpid_pro_v7.txt` — manuale utente axonFPiD_Pro_v7 v5.7.0 (A.P.esse, 2023).
  Documenta il Server di Stampa, la struttura del Response XML, i comandi SF20 di
  **interrogazione**, i file flag, i 93 Reply Code con relativa Post Action.
- `sf20.txt` — libretto di istruzioni ECR Micrelec SF20 "Hydra" (2015). Non
  contiene il protocollo di comunicazione, ma fissa le tabelle semantiche:
  codici pagamento 1-10, 5 aliquote IVA A-E, 60 reparti, codici errore ERR-0..61.

### Il buco noto

Nessuna delle due fonti documenta la sintassi SF20 di **vendita, subtotale,
sconto, pagamento, chiusura giornaliera, apertura cassetto**. Unico indizio
strutturale: `3/S/…` nell'esempio di eccezione del manuale axonFPiD; la forma
generale dei comandi è `campo/campo/…/`.

Questa spec progetta **tutto il resto**, isolando i comandi mancanti in un unico
modulo, in modo che riempirli sia una modifica a un file solo.

## Decisioni prese

- **Integrazione via cartella di ascolto**, non TCP diretto sulla 9101: è il
  percorso documentato e supportato. Il TCP diretto richiederebbe la specifica di
  framing SF20, che non abbiamo.
- **Nessun template di comando in configurazione.** La sintassi dei comandi vive
  nel codice. Rendere editabile all'utente la composizione di uno scontrino
  fiscale è rischio senza beneficio.
- **Il driver non ritenta mai da sé.** Le Post Action (incluso il reinvio su
  Reply 26 = BUSY) sono già eseguite da axonFPiD; il Response XML riporta cosa è
  stato fatto. Un retry autonomo su una fiscale significa stampare due volte.
- **Sonda di configurazione inclusa in questa versione** (vedi sezione dedicata):
  legge dalla stampante tabella IVA e reparti per costruire `deptMapping` dal
  vero, invece di compilarlo a mano.

## Architettura

Tre moduli, con la stessa separazione protocollo/trasporto già usata per
`zpl.ts` / `zpl-network.ts`:

| File | Natura | Responsabilità |
|---|---|---|
| `src/main/printing/sf20.ts` | puro | costruzione delle righe comando SF20, formattazione importi, sanitizzazione descrizioni |
| `src/main/printing/axon-response.ts` | puro | parsing del Response XML; tabella dei 93 Reply Code (descrizione + Post Action) |
| `src/main/drivers/axon-fpid.ts` | I/O | spool su filesystem, coda seriale, polling, mappatura su `PrinterDriver` |

Registrazione in `registry.ts` con chiave `axon-fpid`.

### Capabilities

```typescript
readonly capabilities: Capability[] = ['fiscal-receipt', 'daily-close', 'drawer']
```

Finché lo slot dei comandi di vendita è aperto, i metodi corrispondenti lanciano
un errore descrittivo che nomina esattamente cosa manca (stesso precedente di
`ditron-wec`). `/print` risponde 500 con quel messaggio: nessun fallimento
silenzioso.

`non-fiscal` **non** è dichiarata: la sintassi dei documenti non fiscali SF20 non
è nota e la cortesia è già coperta da altre stampanti.

## Trasporto — protocollo di scambio con axonFPiD

```
submit(comandi: string[]): Promise<AxonResponse>

  1. jobName univoco = mashup-<timestamp>-<contatore monotono di processo>
  2. scrivi   <spool>/<jobName>.tmp
  3. rename   <spool>/<jobName>.tmp → <spool>/<jobName>.txt
  4. poll ogni 250 ms fino a timeout:
       - <log>/Response_<jobName>.xml       → leggi, cancella, ritorna
       - <log>/Response_<jobName>.txt.xml   → idem (fallback)
       - annota se <spool>/<jobName>.txt è sparito = preso in carico
  5. timeout → errore diagnostico differenziato (tabella sotto)
```

### Perché `.tmp` + rename

Scrivere direttamente `.txt` espone alla lettura parziale: axonFPiD sorveglia la
cartella e può leggere il file mentre lo stiamo ancora scrivendo. Il rename è
atomico sullo stesso volume ed elimina la finestra.

`TMP` va aggiunto alla lista "ESTENSIONI NON UTILIZZABILI" di axonFPiD come
difesa in profondità.

### Perché il nome file è univoco

Il Response XML si chiama `Response_<nome del file in stampa>.xml`: **il nome del
file è l'unica chiave di correlazione** fra richiesta e risposta. Deve essere
univoco per job.

Il manuale è ambiguo sul fatto che il nome includa o meno l'estensione originale
(`Response_ Nome del File in stampa.xml`). Il polling cerca entrambe le forme;
quale sia quella vera si accerta alla prima esecuzione sul campo.

### Diagnostica del timeout

| Osservazione | Diagnosi restituita |
|---|---|
| `<jobName>.txt` ancora presente | Server di Stampa non attivo, o cartella di ascolto errata |
| `.txt` sparito, nessun Response XML | Documento inviato alla stampante, ma RESPONSE XML disattivato o cartella LOG errata |
| Response XML presente | Esito autoritativo: `ESITO` / `REPLY` / `ECCEZIONE` |

Un timeout **non significa "non stampato"**. Il messaggio d'errore lo dichiara
esplicitamente, perché il POS non deve ristampare d'istinto.

### Serializzazione

Tutte le `submit` passano da una coda seriale (catena di promise): la RT è una
sola, e un `/status` che si infilasse fra le righe di uno scontrino fiscale
aperto produrrebbe un documento corrotto.

### Encoding

File scritti in **CP1252 (`latin1`) con terminatori CRLF**. Da confermare al
primo collaudo con una descrizione accentata; se la RT stampa caratteri sbagliati
si valuta CP858 o normalizzazione degli accenti.

## Comandi SF20

### Documentati e implementabili subito

| Comando | TAG di risposta usati | Uso nel driver |
|---|---|---|
| `,/10/` | `CMD_virgola_ECR_STATO` | liveness della RT |
| `v/` | `CMD_v_ECR_VERSIONEFW` | diagnostica |
| `a/` | `CMD_a_ECR_MATRICOLA` | `PrintResult.printerSerial` |
| `X/` | `CMD_X_ULTIMO_NUMERO_SCONTRINO` | `PrintResult.receiptNumber` |
| `i/` | `CMD_i_Z_NUMERO` | `PrintResult.closureNumber` |
| `e/` | `CMD_e_VAT_A..E` | tabella IVA reale (sonda) |
| `d/x/` | `CMD_d_DPT_NUMERO`, `_DESCRIZIONE`, `_ALIQUOTAIVA` | reparti (sonda) |

`X/` viene accodato in fondo al file di vendita: la stessa Response XML porta
allora sia l'esito sia il numero di scontrino emesso.

### Da determinare sul campo

Vendita riga, subtotale, sconto, pagamento/chiusura, chiusura giornaliera,
apertura cassetto. Vivono in `sf20.ts` come costanti marcate, isolate dal resto.

Fonte prevista: axonFPiD → **Pannello del Tecnico → "Stampa Scontrini di test"**,
che mostra i comandi SF20 di 19 scontrini di esempio; e **"Invia Comandi SF20 o
File TXT"** per provare una riga singola e vederne la risposta.

## Configurazione

Due campi opzionali nuovi in `PrinterConnection`, sulla falsariga di `deviceName`:

```typescript
export interface PrinterConnection {
  ip: string
  port: number
  timeout: number
  deviceName?: string
  spoolDir?: string   // cartella di ascolto del Server di Stampa
  logDir?: string     // cartella LOG e file di risposta; default: spoolDir
}
```

Propagati in `driverConfigFrom()` e in `DriverConfig`. `ip`/`port` restano inerti
per questo driver, come già accade per `os-printer`.

`migrate()` non richiede modifiche: campi opzionali nuovi attraversano già la
funzione senza perdite, e il percorso di migrazione dal formato legacy resta
intatto.

Esempio di voce di configurazione:

```json
{
  "id": "fiscal",
  "label": "Stampante fiscale Hydra",
  "role": "fiscal",
  "driver": "axon-fpid",
  "connection": {
    "ip": "", "port": 0, "timeout": 30000,
    "spoolDir": "C:\\axonFPiD_Pro_v7\\Spool",
    "logDir": "C:\\axonFPiD_Pro_v7\\Log"
  },
  "operatorId": "1",
  "deptMapping": { "22.00": 1, "10.00": 2, "4.00": 3, "0.00": 4 }
}
```

Timeout di default **30000 ms**: più alto degli altri driver, perché il tempo di
risposta comprende accodamento nel Server di Stampa e stampa fisica del
documento.

## UI

- `ConnectionForm` acquisisce un terzo modo `'spool'` accanto a `'network'` e
  `'system'`, con due selettori di cartella (spool e log).
- `PrinterCard` mappa `axon-fpid` al modo `'spool'` e lo include fra i driver di
  ruolo `fiscal`.

## Stato ed errori

`getStatus()` combina due fonti, entrambe economiche:

- **Liveness** — sonda `,/10/` attraverso lo spool, con **cache di 10 secondi**.
  Senza cache ogni `GET /status` del POS accoderebbe un job nella coda della
  fiscale, finendo dietro a un eventuale scontrino in corso.
- **Granularità** — file flag nella cartella LOG, che esistono finché la
  condizione è vera e costano una `stat()`:

  | File | Effetto su `PrinterStatus` |
  |---|---|
  | `Fine_Carta.log` / `Quasi_Fine_Carta.log` | `paperPresent: false` |
  | `Sportello_Aperto.log` | `coverClosed: false` |
  | `Errore_Grave.log` | `errorMessage` = contenuto del file |
  | `Display_Non_OK.log` | `errorMessage` |

  Sono più specifici del singolo campo `CMD_virgola_ECR_STATO`.

Limite noto e accettato: se axonFPiD non è in esecuzione i file flag restano
fermi all'ultimo stato noto. La sonda `,/10/` è ciò che rileva davvero il
processo morto — va in timeout e riporta la diagnosi corrispondente.

I 93 Reply Code servono **solo** a tradurre l'esito in un messaggio leggibile in
`PrintResult.errorMessage`. La Post Action associata è già stata eseguita da
axonFPiD prima di scrivere la Response.

## Sonda di configurazione

Nuovo `kind: 'probe'` sull'IPC `driver:test` esistente, servito da un metodo
opzionale del driver. `index.ts` lo individua con un check strutturale
(`typeof d.probeConfig === 'function'`): nessuna modifica all'interfaccia
`PrinterDriver`, nessun accoppiamento via `instanceof`.

La sonda scrive un unico file di sole interrogazioni:

```
v/    a/    ,/10/    X/    e/    d/1/  …  d/60/
```

e dalla Response ricava: versione FW, matricola, tabella IVA reale, elenco dei
reparti con la rispettiva aliquota.

La UI li mostra e offre **"Applica a deptMapping"**, che genera la mappa
`vatRate → numero di reparto` dalla configurazione effettiva della stampante.

Il motivo per cui non è rimandabile: l'esempio nel manuale axonFPiD riporta
`VAT_A=0, VAT_B=4, VAT_C=5, VAT_D=10, VAT_E=22`, un ordine **diverso** dai
default di fabbrica documentati in `sf20.txt` (A=4, B=10, C=22, D=0, E=0). La
corrispondenza aliquota↔reparto va letta, non assunta.

## Test

| File | Copertura |
|---|---|
| `sf20.test.ts` | builder puri, formattazione importi, sanitizzazione descrizioni |
| `axon-response.test.ts` | Response OK / NON OK / con `<ECCEZIONE>` / con TAG di interrogazione; lookup Reply Code |
| `axon-fpid.test.ts` | tmpdir + finto axonFPiD: correlazione per nome, cleanup, i tre casi di timeout, serialità della coda |
| `config.test.ts` | `spoolDir`/`logDir` sopravvivono a `migrate()` |

Il finto axonFPiD — una funzione che consuma il `.txt` dallo spool e scrive la
Response nella cartella LOG — è la parte che vale davvero: verifica il contratto
di scambio su filesystem reale, non su mock.

## Documentazione operativa

`docs/axon-fpid-setup.md`, checklist per la sessione presso il cliente:

1. axonFPiD_Pro_v7 installato; Connessione Stampante = TCPIP `<ip>:9101` (o COM).
2. Server di Stampa: cartella di ascolto, nome file `*`, estensione `TXT`;
   aggiungere `TMP` alle estensioni non utilizzabili.
3. LOG e file di risposta: **RESPONSE XML attivo**; attivare i file flag Fine
   Carta, Sportello, Errore Grave, Display; annotare la cartella LOG.
4. RT in modalità **EMISSIONE RICEVUTA** (tastiera protetta, accetta comandi di
   vendita solo da PC).
5. Nel bridge: driver `axon-fpid`, `spoolDir`, `logDir` → "Testa connessione".
6. **Sonda** → verificare FW/matricola/IVA/reparti → "Applica a deptMapping".
7. Pannello del Tecnico → **Stampa Scontrini di test** → screenshot dei comandi
   SF20; il primo esempio (vendita + pagamento) è sufficiente a chiudere lo slot.
8. Se possibile: "Invia Comandi SF20 o File TXT" per validare a mano una riga di
   vendita prima di scriverla nel codice.

## Fuori ambito

- Comunicazione diretta TCP/UDP con la RT sulla porta 9101.
- Fatture, note di credito, lotteria, trasmissione corrispettivi, comandi MACRO
  `REPRINT:` / `SAVEDOC`.
- Documenti non fiscali e scontrino di cortesia su questa stampante.
- Programmazione della RT dal bridge (intestazioni, reparti, aliquote): resta
  competenza di axonFPiD.
