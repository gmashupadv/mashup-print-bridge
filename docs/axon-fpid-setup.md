# Collegamento stampante fiscale via axonFPiD_Pro_v7 (`axon-fpid`)

Il driver `axon-fpid` non parla con la stampante: scambia file con il **Server di
Stampa** di axonFPiD_Pro_v7, che a sua volta pilota la RT.

```
POS → bridge → <spool>/job.txt → axonFPiD → RT
                <log>/Response_job.xml ←
```

## 1. axonFPiD_Pro_v7

Installare l'applicazione sul PC POS (default `C:\axonFPiD_Pro_v7`).

**Connessione Stampante** — Ethernet TCPIP, IP della RT, porta 9101 (oppure
RS232 / USB virtual COM a 115200 baud). Sulla stampante, menù Ethernet,
selezionare TCPIP.

**Server di Stampa**
- Cartella di ascolto: una cartella dedicata, es. `C:\axonFPiD_Pro_v7\Spool`
- Nome file: `*`
- Estensione: `TXT`
- ESTENSIONI NON UTILIZZABILI: **aggiungere `TMP`**

Il bridge scrive `job.tmp` e poi lo rinomina in `job.txt`: il rename è atomico ed
evita che axonFPiD legga un file ancora incompleto. Escludere `TMP` è la difesa
di riserva.

**LOG e file di risposta**
- Cartella LOG: es. `C:\axonFPiD_Pro_v7\Log`
- **RESPONSE XML: attivo** — obbligatorio, senza questo ogni stampa va in timeout
- Attivare anche i file flag: Fine Carta, Sportello, Errore Grave, Display

**Modalità Esecuzione FPiD**: `Minimized` o `Iconized`, così l'app resta attiva
in tray. Su Windows 10/11 avviarla da Utilità di Pianificazione, non
dall'Esecuzione Automatica (indicazione dello stesso manuale A.P.esse).

## 2. Stampante

Portare la RT in modalità **EMISSIONE RICEVUTA**: la tastiera è protetta e
l'apparecchio accetta comandi di vendita solo da PC.

## 3. Bridge

Configurazione stampante → ruolo **Fiscale** → driver **axon-fpid**.
Impostare cartella di ascolto e cartella LOG (pulsante Sfoglia), timeout 30000 ms.

Premere **Testa connessione**. Il messaggio d'errore distingue i casi:

| Messaggio | Causa |
|---|---|
| "Server di Stampa non attivo, o cartella di ascolto errata" | il file resta nello spool: axonFPiD non è in esecuzione o guarda un'altra cartella |
| "Nessun Response XML … NON ristampare" | il file è stato prelevato ma non torna risposta: RESPONSE XML disattivato o cartella LOG sbagliata |

## 4. Sonda di configurazione

> **Un TAG per Response.** axonFPiD scrive ogni TAG `CMD_*` **una sola volta** nel
> Response XML: se un file contiene più comandi che producono lo stesso TAG, resta
> solo il valore dell'ultimo. Verificato su file reale — `d/1/`, `d/2/` e `d/60/`
> nello stesso file hanno prodotto un unico blocco `CMD_d_DPT_*`, quello del
> reparto 60. Per questo la sonda legge **un reparto per job** e la lettura
> completa richiede decine di secondi: l'avanzamento compare nel log.
>
> Chi estende la sonda con nuove interrogazioni deve tenerne conto: comandi che
> condividono lo stesso TAG non possono stare nello stesso file.

Premere **Sonda configurazione**. Legge dalla stampante versione FW, matricola,
tabella delle aliquote IVA e i 60 reparti con la rispettiva aliquota.

Premere **Applica a mappatura reparti** per generare `deptMapping` dalla
configurazione reale della RT.

Non compilare la mappatura a mano: la corrispondenza aliquota↔reparto dipende da
come la stampante è stata programmata e varia da installazione a installazione.

## 5. I comandi SF20

La sintassi di vendita è stata ricavata dal **Pannello del Tecnico → Stampa
Scontrini di test** su una RT30 con FW serie 2 G100 e **validata il 29/07/2026**
emettendo uno scontrino fiscale reale da 0,01 €:

```
3/S/PROVA//1/0.01/1/22///0/
U/
5/1/0////PC//
```

La RT ha risposto `00/00/02/75` — REPLY `00`, comando elaborato correttamente —
e ha emesso il documento. È implementata in `src/main/printing/sf20.ts`.

Gli scontrini di esempio mostrano una riga iniziale `I/12345678/0/`, ma quel
numero è un segnaposto e la sequenza funziona senza: il driver non la emette.

### Riga di vendita

```
3/S/Prodotto "A"//1/160.65/4/22///0/
│ │      │      │ │   │    │ │ ││ └ 0 = bene, 1 = servizio
│ │      │      │ │   │    │ │ │└── campo non identificato, sempre vuoto
│ │      │      │ │   │    │ │ └─── natura esenzione (N1..N6), solo se IVA = 0
│ │      │      │ │   │    │ └───── aliquota IVA in percentuale
│ │      │      │ │   │    └─────── reparto
│ │      │      │ │   └──────────── prezzo unitario
│ │      │      │ └──────────────── quantità
│ │      │      └────────────────── seconda riga di descrizione
│ │      └───────────────────────── descrizione
│ └──────────────────────────────── S = vendita, G = omaggio
└────────────────────────────────── comando di vendita
```

### Pagamento

```
5/1/200////PC//
│ │  │     └── PC contante, PE elettronico, NR non riscosso, SP sconto a pagare
│ │  └──────── importo; 0 = salda tutto il residuo
│ └─────────── codice pagamento programmato sulla RT
└───────────── comando di pagamento
```

Codici di fabbrica (`sf20.txt`): 1 Contante, 2 Crediti (non riscosso), 3 Ticket,
4 Bancomat, 5 Carta di credito, 6-10 programmabili. Il driver usa 1/`PC` per i
contanti e 4/`PE` per carta. Verificabili con `{/x/` o con la stampa "lista
pagamenti".

### Sconto sul totale

```
3/S/TEST SCONTO//1/0.20/1/22///0/
U/
4/0.10/Sconto//0/0/1/
5/1/0////PC//
```

Validato sulla stessa RT30: 0,20 meno 0,10 ha stampato 0,10.

Quello che discrimina fra sconto di riga e sconto sul totale è la **posizione**,
non i campi. Lo stesso comando `4/…/0/0/1/` messo subito dopo una riga di vendita
sconta quella riga (è la forma degli scontrini di esempio); messo dopo `U/`
sconta il subtotale. Su uno scontrino con aliquote miste la ripartizione dello
sconto fra le aliquote la esegue la RT.

### Documento gestionale (scontrino di cortesia)

Sintassi catturata il **04/08/2026** dal LOG verbose di axonFPiD mentre il
gestionale **Danea** stampava uno scontrino di cortesia sulla RT30 della
cliente. Ogni comando ha risposto `00/00/02/75`:

```
7/1/1/VanityRose di Rosa Paparo/
7/1/1//
7/1/1/Scontrino di cortesia 2428/
...
m/
```

Non esiste comando di apertura: il **primo `7/` apre** il documento gestionale,
**`m/` lo chiude e lo stampa**. Numerazione (`DOC. GESTIONALE N. 0185-0002`),
data, matricola e righe `*** DOCUMENTO GESTIONALE ***` le aggiunge la RT.

I due campi `1/1` fra comando e testo valgono sempre così in tutte le righe
della cattura, comprese le vuote: il loro significato resta ignoto e non
proviamo a variarli. Per lo stesso motivo `bold`, `size` e `align` di
`NonFiscalLine` sono **ignorati**.

Il testo è troncato a **32 caratteri**, la riga più lunga accettata nella
cattura. Per alzare il limite serve una prova sulla stampante: una riga troppo
lunga fa fallire l'intero documento con REPLY 2.

### Come catturare altri comandi

Il metodo che ha risolto questo caso, senza Wireshark:

1. In axonFPiD attivare **LOG VERBOSE**.
2. Far eseguire l'operazione al gestionale che già la sa fare.
3. Leggere `FPiD AAAAMMGG.log` nella cartella LOG: registra ogni comando
   inviato (`Elaboro comando <…>`) e la risposta della RT.

In alternativa si **disattiva il Server di Stampa**: il file `.TXT` resta nella
cartella di ascolto e si legge com'è. Ricordarsi di cancellarlo prima di
riattivare, altrimenti viene stampato in ritardo.

### Cosa resta da ricavare

Queste operazioni rispondono ancora con un errore che rimanda a questa sezione,
perché non comparivano negli scontrini di test:

| Operazione | Stato |
|---|---|
| **Chiusura giornaliera** (`/daily-close`) | comando di azzeramento Z1 ignoto — catturabile col metodo qui sopra facendo eseguire la chiusura a Danea |
| **Apertura cassetto** (`/open-drawer`) | comando ignoto — idem |
| **Righe con IVA 0%** | richiedono la natura di esenzione (N1..N6). Non è un problema aperto sulla RT della cliente: la sua tabella IVA (4, 10, 22…22) non ha alcuno slot a 0, quindi non può emettere righe esenti finché non viene riprogrammata. La natura è un attributo del **reparto** — la sonda legge già `CMD_d_DPT_NATURAESENZIONE` — quindi quando servirà basterà programmare sulla RT uno slot a 0 con la sua natura e associarlo a un reparto |

Per ricavarle: **Pannello del Tecnico → Invia Comandi SF20 o File TXT** consente
di mandare un comando e leggerne la risposta prima di scriverlo nel codice.
In alternativa, richiedere la specifica del protocollo SF20 ad A.P.esse.

Completandole, sostituire il lancio di `Sf20CommandUnavailableError` in
`src/main/printing/sf20.ts` e aggiungere i test in `sf20.test.ts`.

## 6. Attenzione con più stampanti fiscali configurate

`axon-fpid` dichiara la capability `fiscal-receipt`. Se in `printers[]` è
presente anche una Epson (o un'altra fiscale) funzionante ma posizionata
**dopo** quella axon-fpid, `resolveByCapability` (`server.ts`) sceglie comunque
axon-fpid per ogni `/print`, `/daily-close` o `/open-drawer` che arriva
**senza** `printerId` esplicito: è la prima stampante con la capability
richiesta, in ordine di configurazione.

Per `/print` e `/print-courtesy` oggi questo va bene. Per `/daily-close` e `/open-drawer`, finché i
relativi comandi non sono noti, il risultato è un errore invece dell'operazione
attesa dall'altra fiscale: tenere axon-fpid come **unica** stampante fiscale
configurata, oppure far sì che il POS invii sempre un `printerId` esplicito.

## 7. Collaudo

- Verifica accenti: stampare una descrizione con `à è ì ò ù`. Il bridge scrive i
  file in CP1252; se i caratteri risultano errati, cambiare l'encoding in
  `submitNow` (`src/main/drivers/axon-fpid.ts`).
- Verifica del nome della Response: alla prima stampa riuscita controllare se
  axonFPiD ha scritto `Response_<job>.xml` o `Response_<job>.txt.xml`. Il driver
  gestisce entrambe le forme; una volta accertata quella vera si può rimuovere
  l'altra dal polling.
- Scontrino di prova da 0,01 € con il pulsante di test fiscale della UI.
