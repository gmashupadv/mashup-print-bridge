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

Premere **Sonda configurazione**. Legge dalla stampante versione FW, matricola,
tabella delle aliquote IVA e i 60 reparti con la rispettiva aliquota.

Premere **Applica a mappatura reparti** per generare `deptMapping` dalla
configurazione reale della RT.

Non compilare la mappatura a mano: la corrispondenza aliquota↔reparto dipende da
come la stampante è stata programmata e varia da installazione a installazione.

## 5. Ricavare i comandi SF20 di vendita

**Questo passo è quello che sblocca la stampa degli scontrini.** Finché non è
fatto, `/print`, `/daily-close` e `/open-drawer` rispondono con un errore che
rimanda a questa sezione.

In axonFPiD_Pro_v7:

1. **Pannello del Tecnico → Stampa Scontrini di test.** La finestra mostra a
   sinistra i comandi SF20 dello scontrino di esempio selezionato e a destra
   l'anteprima di stampa. Serve almeno il primo esempio: una vendita a reparto
   più la chiusura con un pagamento.
2. Fotografare o trascrivere i comandi.
3. Facoltativo ma utile: **Invia Comandi SF20 o File TXT** permette di inviare
   un singolo comando e leggerne la risposta, per validare la sintassi prima di
   scriverla nel codice.

Le informazioni da ricavare:

| Operazione | Cosa serve |
|---|---|
| Riga di vendita | comando, campi reparto / prezzo / quantità / descrizione |
| Sconto | comando e se si applica a riga o a subtotale |
| Subtotale | comando |
| Pagamento e chiusura | comando, codice pagamento, gestione dell'importo parziale per lo split |
| Chiusura giornaliera | comando di azzeramento Z1 |
| Apertura cassetto | comando |

Codici di pagamento programmati di fabbrica sull'SF20 (`sf20.txt`):
1 Contante, 2 Crediti (non riscosso), 3 Ticket, 4 Bancomat, 5 Carta di credito,
6-10 programmabili. Da confermare con `{/x/` o con la stampa "lista pagamenti".

4. Completare `buildReceipt`, `buildDailyClose` e `buildOpenDrawer` in
   `src/main/printing/sf20.ts`, sostituendo il lancio di
   `Sf20CommandUnavailableError`, e aggiungere i test corrispondenti in
   `src/main/printing/sf20.test.ts`.

## 6. Collaudo

- Verifica accenti: stampare una descrizione con `à è ì ò ù`. Il bridge scrive i
  file in CP1252; se i caratteri risultano errati, cambiare l'encoding in
  `submitNow` (`src/main/drivers/axon-fpid.ts`).
- Verifica del nome della Response: alla prima stampa riuscita controllare se
  axonFPiD ha scritto `Response_<job>.xml` o `Response_<job>.txt.xml`. Il driver
  gestisce entrambe le forme; una volta accertata quella vera si può rimuovere
  l'altra dal polling.
- Scontrino di prova da 0,01 € con il pulsante di test fiscale della UI.
