# Scontrino di cortesia — design

Data: 2026-06-18

## Contesto e obiettivo

La stampante fiscale Ditron (driver `ditron-streamwec`) deve poter emettere uno
**scontrino di cortesia**: un documento non fiscale, associato a un ordine reale,
stampato **dopo** lo scontrino fiscale. Contiene intestazione negozio, descrizioni
articoli, policy resi e riferimenti documento (numero doc, seriale RT).

Tutti i dati variabili (ragione sociale, indirizzo, P.Iva, policy, riferimenti)
arrivano dal POS **nel payload**: non sono hardcoded nel bridge.

Lo **split payment** (pagamento diviso fra più metodi) è parte dello scontrino
fiscale ed è **già supportato** dal modello dati esistente — vedi sezione dedicata.

## Decisioni prese

- **Payload strutturato**, non righe pre-formattate: il bridge possiede il layout
  (ordine dei blocchi, righe vuote, titolo). Il POS invia dati semantici.
- **Solo descrizione** per gli articoli (niente prezzo/quantità), fedele alla
  cattura del gestionale.
- **Endpoint dedicato** `POST /print-courtesy`, separato da `/print-nonfiscal`.

## Architettura

Flusso della richiesta:

```
POST /print-courtesy
  → validazione payload (400 se manca header o items)
  → buildCourtesyDoc(payload): NonFiscalDoc        [formatter puro]
  → resolveByCapability('non-fiscal', printerId)   [regola 404/409/503 esistente]
  → driver.printNonFiscal(doc): PrintResult
```

Tre responsabilità separate (SRP):

- **`src/main/printing/courtesy-receipt.ts`** — formatter **puro**: trasforma il
  payload strutturato in `NonFiscalDoc` (lista di righe), inserendo le righe vuote
  fra i blocchi e componendo il titolo "Scontrino di cortesia <number>". Nessuna
  dipendenza da rete o driver. Testabile in isolamento.
- **`POST /print-courtesy`** (in `server.ts`) — valida il payload, risolve la
  stampante per capability, invoca `printNonFiscal`. Orchestrazione, niente layout.
- **Driver** — invariati. Riusano `printNonFiscal` già esistente.

### Perché riusare `non-fiscal` invece di una nuova capability `courtesy`

Uno scontrino di cortesia **è** un documento non fiscale. Aggiungere una capability
`courtesy` + metodo `printCourtesy` obbligherebbe ogni driver a implementarla
(viola ISP e OCP) e duplicherebbe la logica di trasporto. Riusare `non-fiscal`:

- mantiene i driver **chiusi alle modifiche** (OCP);
- fa funzionare la cortesia su **qualunque** stampante non-fiscale (Ditron NOFIS,
  escpos raster, os-printer) senza codice nuovo nei driver;
- concentra il layout in un unico formatter puro (SRP).

## Schema del payload

```jsonc
{
  "header": ["I.P.S. S.R.L.", "VIA DOMITIANA KM.34", "P.Iva 02782600619", "Tel. …", "www…"],
  "number": "1329",                 // opzionale → "Scontrino di cortesia 1329"
  "date": "17/06/2026",             // opzionale → "del 17/06/2026"
  "items": ["ABITO DONNA VENDITA PROMOZIONALE"],
  "returnPolicy": ["Hai 30 giorni di tempo", "per cambiare la merce"], // opzionale
  "footer": ["Doc. 1928-0023 del 17/06/2026", "RT 2CITP017007"],       // opzionale
  "printerId": "fiscal"             // opzionale (default: prima stampante non-fiscal)
}
```

Modellazione a **blocchi di righe** (non campi granulari name/via/piva separati):
il bridge tratta ogni voce come una riga di testo; l'unica semantica che conta per
il layout è il **raggruppamento**, che determina dove vanno le righe vuote. YAGNI:
nessun campo separato finché non serve un trattamento diverso (es. allineamento).

### Layout prodotto dal formatter

```
<header[0]>
<header[1]>
…
                          ← riga vuota (se number/date presenti)
Scontrino di cortesia <number>
del <date>
                          ← riga vuota
<items[0]>
<items[1]>
…
                          ← riga vuota (se returnPolicy presente)
<returnPolicy[0]>
…
                          ← riga vuota (se footer presente)
<footer[0]>
…
```

Regole:

- I blocchi opzionali assenti **non** lasciano righe vuote orfane (niente doppie
  righe vuote consecutive).
- Le righe più lunghe della larghezza stampante sono troncate dal driver
  (`buildNonFiscal` tronca già a 40 caratteri per il Ditron).

## Validazione (endpoint)

- `header` deve essere un array non vuoto di stringhe → **400** altrimenti.
- `items` deve essere un array non vuoto di stringhe → **400** altrimenti.
- `number`, `date`, `returnPolicy`, `footer` opzionali; se presenti devono essere
  del tipo atteso, altrimenti **400**.
- Risoluzione stampante come gli altri endpoint: `printerId` esplicito → 404 (id
  inesistente) / 409 (manca capability `non-fiscal`); omesso → prima non-fiscal →
  503 se nessuna.

## Split payment (già supportato)

Nessun lavoro nuovo. Il body di `POST /print` ha già `payments: ReceiptPayment[]`
(array). Il driver `ditron-streamwec` (già aggiornato) genera, per N pagamenti,
`CHIUS T=<tender>,IMP=<importo>` per tutti tranne l'ultimo, e `CHIUS T=<tender>`
(senza IMP, chiude il resto) per l'ultimo. Confermato da cattura:

```
CHIUS T=5,IMP=10.00
CHIUS T=1
```

Il POS ottiene lo split semplicemente inviando più voci in `payments`.

## Testing

- **Formatter** (`courtesy-receipt.test.ts`): ordine dei blocchi; righe vuote tra
  blocchi presenti; nessuna riga vuota orfana per blocchi assenti; titolo composto
  da `number`/`date`; header+items obbligatori.
- **Endpoint** (in `server.test.ts`): 400 senza header/items; instradamento per
  capability (404/409/503); 200 con payload valido che invoca `printNonFiscal`.

## Fuori scope

- Prezzo/quantità nelle righe articolo (scelto: solo descrizione).
- Orchestrazione automatica "fiscale poi cortesia" lato bridge: resta responsabilità
  del POS, che chiama `/print` e poi `/print-courtesy` in sequenza.
- daily-close (Z) e apertura cassetto via WEC: comandi ancora non catturati.
