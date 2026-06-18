# Integrazione gestionale — Scontrino di cortesia (e split payment)

Documento tecnico per il team del gestionale/POS. Spiega come pilotare il
**Mashup Print Bridge** per emettere, dopo lo scontrino fiscale, uno
**scontrino di cortesia** non fiscale, e come inviare un **pagamento diviso**.

- **Base URL:** `http://127.0.0.1:8765` (loopback; il bridge gira sulla macchina POS)
- **Content-Type:** `application/json` per tutte le POST
- **CORS/PNA:** già gestito dal bridge — l'origin pubblico HTTPS del POS può
  chiamare il loopback senza configurazione lato client.

> Verifica disponibilità prima di stampare: chiama `GET /ping`. Se non risponde,
> il bridge non è in esecuzione → applica il fallback legacy.

---

## 1. Flusso d'uso

Lo scontrino di cortesia è **associato a un ordine reale** e si stampa **dopo**
lo scontrino fiscale. Il gestionale orchestra la sequenza (il bridge **non** la
automatizza):

```
1. POST /print            → scontrino fiscale (con eventuale split payment)
   ← attendi success:true
2. POST /print-courtesy   → scontrino di cortesia (non fiscale)
   ← attendi success:true
```

Se lo step 1 fallisce, **non** procedere allo step 2.

Le due stampe possono finire su due stampanti diverse o sulla stessa: il bridge
risolve la stampante per *capability* (vedi §5). Tipicamente entrambe vanno sulla
fiscale Ditron (`fiscal-receipt` per `/print`, `non-fiscal` per `/print-courtesy`).

---

## 2. `POST /print` — scontrino fiscale + split payment

### Body

```jsonc
{
  "items": [
    {
      "description": "ABITO DONNA",   // stringa, descrizione "parlante"
      "quantity": 1,                  // numero
      "unitPrice": 49.90,             // euro, IVA inclusa
      "vatRate": 22,                  // aliquota IVA (numero) → mappata a reparto
      "department": 3                 // opzionale: forzatura reparto (vedi sotto)
    }
  ],
  "discount": 0,                      // sconto a valore sul subtotale (euro), 0 = nessuno
  "payments": [                       // 1+ voci. Più voci = split payment
    { "description": "POS",      "amount": 10.00, "paymentType": 1 },
    { "description": "Contanti", "amount": 39.90, "paymentType": 0 }
  ],
  "printerId": "fiscal"               // opzionale (vedi §5)
}
```

**Reparto / IVA:** il bridge rimappa ogni item al reparto fiscale tramite il
`deptMapping` della stampante, usando la chiave `vatRate.toFixed(2)`
(es. `"22.00" → 3`). Se l'aliquota non è mappata, usa `item.department` se
presente, altrimenti reparto `1`. **Il gestionale invia `vatRate`**; non deve
conoscere i numeri di reparto della singola stampante.

**Split payment:** invia più voci in `payments`. Il driver Ditron chiude tutte
le voci tranne l'ultima con l'importo esplicito e l'ultima senza (chiude il
resto). Codici `paymentType` (questa unità Ditron):

| `paymentType` | Tender | Significato |
|---|---|---|
| `0` | `T=1` | Contanti |
| `1` | `T=5` | POS / Carta |

> I codici tender sono **programmati nella stampante**: 0→contanti, 1→carta su
> questa unità. Mantieni questa convenzione lato POS.

### Risposta

`200` con `{ "success": true, ... }` se stampato; `{ "success": false, "error": "…" }`
altrimenti. Codici di risoluzione stampante: vedi §5.

---

## 3. `POST /print-courtesy` — scontrino di cortesia

Documento **non fiscale strutturato**. Il gestionale invia **dati semantici a
blocchi**, non righe pre-formattate: il bridge possiede il layout (ordine
blocchi, righe vuote, titolo).

### Body

```jsonc
{
  "header": [                          // OBBLIGATORIO: array di stringhe non vuoto
    "I.P.S. S.R.L.",
    "VIA DOMITIANA KM.34",
    "P.Iva 02782600619",
    "Tel. 0823 1234567",
    "www.esempio.it"
  ],
  "number": "1329",                    // opzionale → riga "Scontrino di cortesia 1329"
  "date": "17/06/2026",                // opzionale → riga "del 17/06/2026"
  "items": [                           // OBBLIGATORIO: array di stringhe non vuoto
    "ABITO DONNA VENDITA PROMOZIONALE"
    // SOLO descrizione: niente prezzo/quantità (scelta di design)
  ],
  "returnPolicy": [                    // opzionale: array di stringhe
    "Hai 30 giorni di tempo",
    "per cambiare la merce"
  ],
  "footer": [                          // opzionale: array di stringhe
    "Doc. 1928-0023 del 17/06/2026",
    "RT 2CITP017007"
  ],
  "printerId": "fiscal"                // opzionale (vedi §5)
}
```

**Tutti i dati variabili arrivano dal payload** — ragione sociale, indirizzo,
P.Iva, policy resi, riferimenti documento. Nulla è hardcoded nel bridge.

### Layout prodotto

```
I.P.S. S.R.L.
VIA DOMITIANA KM.34
P.Iva 02782600619
Tel. 0823 1234567
www.esempio.it
                              ← riga vuota (se number/date presenti)
Scontrino di cortesia 1329
del 17/06/2026
                              ← riga vuota
ABITO DONNA VENDITA PROMOZIONALE
                              ← riga vuota (se returnPolicy presente)
Hai 30 giorni di tempo
per cambiare la merce
                              ← riga vuota (se footer presente)
Doc. 1928-0023 del 17/06/2026
RT 2CITP017007
```

Regole di layout:
- I blocchi opzionali assenti **non** lasciano righe vuote orfane.
- Le righe più lunghe della larghezza stampante sono troncate dal driver
  (Ditron: **40 caratteri**). Dimensiona i testi lato POS di conseguenza.

### Validazione → `400`

| Condizione | Errore (italiano) |
|---|---|
| `header` non è array di stringhe non vuoto | `header (array di stringhe non vuoto) è obbligatorio` |
| `items` non è array di stringhe non vuoto | `items (array di stringhe non vuoto) è obbligatorio` |
| `number` presente ma non stringa | `number deve essere una stringa` |
| `date` presente ma non stringa | `date deve essere una stringa` |
| `returnPolicy` presente ma non array di stringhe | `returnPolicy deve essere un array di stringhe` |
| `footer` presente ma non array di stringhe | `footer deve essere un array di stringhe` |

### Risposta

`200` con `{ "success": true, ... }` se stampato. In caso di errore di stampa
`{ "success": false, "error": "…" }`. Risoluzione stampante: §5.

---

## 4. Esempio completo (sequenza)

```js
const BASE = 'http://127.0.0.1:8765'

// 0. disponibilità
const ping = await fetch(`${BASE}/ping`).then(r => r.ok).catch(() => false)
if (!ping) return legacyFallback()

// 1. scontrino fiscale con split payment
const fiscale = await fetch(`${BASE}/print`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    items: [{ description: 'ABITO DONNA', quantity: 1, unitPrice: 49.90, vatRate: 22 }],
    discount: 0,
    payments: [
      { description: 'POS',      amount: 10.00, paymentType: 1 },
      { description: 'Contanti', amount: 39.90, paymentType: 0 },
    ],
  }),
}).then(r => r.json())

if (!fiscale.success) throw new Error(`Fiscale fallito: ${fiscale.error}`)

// 2. scontrino di cortesia (solo dopo il fiscale)
const cortesia = await fetch(`${BASE}/print-courtesy`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    header: ['I.P.S. S.R.L.', 'VIA DOMITIANA KM.34', 'P.Iva 02782600619'],
    number: '1329',
    date: '17/06/2026',
    items: ['ABITO DONNA VENDITA PROMOZIONALE'],
    returnPolicy: ['Hai 30 giorni di tempo', 'per cambiare la merce'],
    footer: ['Doc. 1928-0023 del 17/06/2026', 'RT 2CITP017007'],
  }),
}).then(r => r.json())

if (!cortesia.success) console.warn(`Cortesia fallita: ${cortesia.error}`)
```

---

## 5. Risoluzione stampante e codici di stato

Tutte le route di stampa seguono la stessa regola, per *capability*
(`/print` → `fiscal-receipt`, `/print-courtesy` → `non-fiscal`):

- **`printerId` esplicito** nel body:
  - id inesistente → **404** `Printer not found: <id>`
  - id esistente ma driver senza la capability → **409**
    `La stampante '<id>' non supporta l'operazione '<cap>'`
- **`printerId` omesso** → prima stampante con quella capability; se nessuna →
  **503** `Nessuna stampante con capability '<cap>' configurata`.

Altri codici:

| Codice | Significato | Azione POS |
|---|---|---|
| `200` `success:true` | Stampato | OK |
| `200` `success:false` | Stampante ha rifiutato/errore protocollo | Mostra `error`, eventuale retry |
| `400` | Payload non valido | Bug lato POS: correggi il body |
| `404`/`409`/`503` | Stampante non risolvibile | Verifica config bridge |
| `500` | Errore interno/trasporto | Retry; se persiste, fallback |
| (no risposta) | Bridge non in esecuzione | Fallback legacy |

---

## 6. Note e fuori scope

- Lo **split payment è solo in `/print`** (array `payments`): non si invia in
  `/print-courtesy`.
- Lo scontrino di cortesia riporta **solo le descrizioni** degli articoli
  (niente prezzi/quantità), per design.
- L'orchestrazione "fiscale poi cortesia" è responsabilità del **POS**.
- `daily-close` (Z) e apertura cassetto via WEC non sono coperti da questo
  documento.
