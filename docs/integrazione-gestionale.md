# Spec di integrazione — Gestionale (Mashup Cashflow) ↔ Print Bridge

Versione contratto: bridge `main` al 2026-06-12. Questo documento descrive **tutto ciò che serve al gestionale** per parlare con il bridge attuale; ogni schema è verificato sul codice (`src/main/server.ts`, `src/main/drivers/interface.ts`).

## 1. Trasporto

- **Base URL:** `http://127.0.0.1:8765` (il bridge ascolta **solo** su loopback; la porta è configurabile in `config.json`, default 8765).
- **Formato:** JSON in richiesta e risposta. Inviare sempre `Content-Type: application/json` sulle POST.
- **Autenticazione:** nessuna (loopback-only by design).
- **Timeout consigliati lato client:** 1500–3000 ms per `/ping` e `/status`; ≥ 15 s per le operazioni di stampa (il bridge a sua volta ha un timeout per stampante, default 10 s, e `/print-label` può stampare fino a 50 copie in sequenza).

> ⚠️ **CORS — prerequisito aperto.** Il server Fastify del bridge **non registra alcun handler CORS**: nessun header `Access-Control-Allow-Origin`, nessuna risposta alle preflight `OPTIONS`. Una pagina browser servita da un'origin diversa da `http://127.0.0.1:8765` (cioè qualunque frontend reale) verrà bloccata dal browser: le POST con `Content-Type: application/json` generano una preflight che oggi riceve 404. **Prima dell'integrazione browser va aggiunto `@fastify/cors` al bridge.** Nota positiva: `http://localhost` / `http://127.0.0.1` sono considerati "potentially trustworthy" dai browser, quindi una pagina HTTPS può chiamare il bridge in HTTP senza problemi di mixed content; tenere d'occhio però le preflight Private Network Access di Chrome.

## 2. Rilevamento disponibilità (pattern `isAvailable`)

Il gestionale deve sondare il bridge prima di usarlo e degradare al client legacy (`EpsonFiscalClient`) se irraggiungibile:

```
GET /ping → 200 in < ~2s  ⇒ bridge disponibile
qualsiasi errore di rete / timeout ⇒ fallback legacy
```

Risposta `/ping`:

```json
{
  "ok": true,
  "version": "1.4.0",
  "driver": "epson-fpmate",
  "printers": [
    { "id": "fiscal", "driver": "epson-fpmate" },
    { "id": "labels", "driver": "os-printer" }
  ]
}
```

`driver` è quello della **prima** stampante configurata (campo legacy); usare `printers[]` per l'elenco reale. `/ping` risponde 200 anche con zero stampanti configurate (`printers: []`).

## 3. Modello multi-stampante e risoluzione

Il bridge gestisce N stampanti (`printers[]` in config), ognuna con un `id` stabile e un driver che dichiara **capabilities**:

`fiscal-receipt` | `non-fiscal` | `label` | `daily-close` | `drawer` | `cut`

Ogni rotta di stampa accetta un `printerId` **opzionale** nel body. Regole di risoluzione (identiche per tutte le rotte POST):

| Caso | Comportamento |
|---|---|
| `printerId` presente, id inesistente | **404** `{ "success": false, "error": "Printer not found: <id>" }` |
| `printerId` presente, stampante senza la capability richiesta | **409** `{ "success": false, "error": "La stampante '<id>' non supporta l'operazione '<cap>'" }` |
| `printerId` omesso | prima stampante (in ordine di config) con la capability richiesta |
| nessuna stampante con la capability | **503** `{ "success": false, "error": "Nessuna stampante con capability '<cap>' configurata" }` |

**Raccomandazione per il gestionale:** all'avvio chiamare `GET /printers`, memorizzare gli `id` per ruolo (fiscale / etichette / comande) e passare sempre `printerId` esplicito nelle stampe. L'omissione va bene solo per installazioni mono-stampante.

## 4. Endpoints

### 4.1 `GET /ping` — health check
Vedi §2. Sempre 200.

### 4.2 `GET /status` — stato della stampante fiscale (legacy)

Restituisce lo stato della **prima stampante con capability `fiscal-receipt`** (fallback: `printers[0]` se nessuna fiscale è configurata).

- **200** → `PrinterStatus`:
  ```json
  { "online": true, "paperPresent": true, "coverClosed": true, "errorMessage": "" }
  ```
- **503** → `{ "error": "No printers configured" }`
- **500** → `{ "error": "<messaggio>" }` (stampante non raggiungibile, ecc.)

Per lo stato di una stampante specifica usare `/printers` (non esiste `/status?printerId=`).

### 4.3 `GET /printers` — elenco completo con stato live

Sempre 200, array (gli stati sono interrogati in parallelo; una stampante offline non blocca le altre):

```json
[
  {
    "id": "fiscal",
    "label": "Stampante fiscale",
    "role": "fiscal",
    "capabilities": ["fiscal-receipt", "non-fiscal", "daily-close", "drawer"],
    "driver": "epson-fpmate",
    "ip": "192.168.1.10",
    "status": { "online": true, "paperPresent": true, "coverClosed": true, "errorMessage": "" }
  },
  {
    "id": "labels",
    "label": "Etichettatrice",
    "role": "label",
    "capabilities": ["label", "non-fiscal"],
    "driver": "os-printer",
    "ip": "",
    "status": { "online": false, "errorMessage": "..." }
  }
]
```

`role` è `fiscal` | `label` | `receipt` (informativo, scelto dall'utente nella UI del bridge); **il routing usa solo `capabilities`**.

### 4.4 `POST /print` — scontrino fiscale  *(capability: `fiscal-receipt`)*

Body:

```json
{
  "items": [
    { "description": "Caffè", "quantity": 2, "unitPrice": 1.20, "vatRate": 10 }
  ],
  "discount": 0.50,
  "payments": [
    { "description": "Contanti", "amount": 1.90, "paymentType": 0 }
  ],
  "printerId": "fiscal"
}
```

Semantica dei campi:

- **Importi in euro** (numeri decimali): `unitPrice`, `discount`, `amount`. La conversione in centesimi la fa il bridge.
- `quantity`: numero (decimali ammessi, es. 0.5 kg).
- `vatRate`: aliquota IVA numerica (es. `22`, `10`, `4`, `0`). Il bridge la usa per risolvere il **reparto fiscale** tramite il `deptMapping` della stampante target, con chiave `vatRate.toFixed(2)` (es. `"22.00"`). Il gestionale **non deve conoscere i reparti**: manda l'aliquota e basta.
- `department` (opzionale per item): usato solo come fallback se l'aliquota non è nel mapping; ultimo fallback: reparto `1`.
- `discount`: sconto **a valore in euro sul subtotale** dell'intero scontrino; applicato solo se `> 0`. Non esistono sconti per riga né sconti percentuali.
- `payments`: uno o più pagamenti; `paymentType` è il codice tipo pagamento passato **senza trasformazioni** al protocollo della stampante (per Epson FP Mate è l'attributo `paymentType` di `printRecTotal`: tipicamente `0` = contanti, `2` = pagamento elettronico — confermare con la configurazione della singola stampante).
- `items`, `discount`, `payments` sono attesi sempre presenti (usare `discount: 0` e mai ometterli: il server non applica default).

Risposte:

- **200** → `PrintResult` (vedi §5). Attenzione: può essere `success: false` con HTTP 200 se la stampante rifiuta logicamente la stampa — **controllare sempre `success`, non solo lo status HTTP**.
- **404 / 409 / 503** → risoluzione stampante fallita (§3).
- **500** → `{ "success": false, "error": "<messaggio>" }` (timeout, rete, ecc.).

### 4.5 `POST /print-nonfiscal` — documento non fiscale (comanda, preconto, prova)  *(capability: `non-fiscal`)*

```json
{
  "lines": [
    { "text": "COMANDA CUCINA", "bold": true, "size": "double", "align": "center" },
    { "text": "" },
    { "text": "2x Margherita" },
    { "text": "1x Diavola", "bold": true }
  ],
  "cut": true,
  "printerId": "fiscal"
}
```

- Per riga: `text` (obbligatorio), `bold?: boolean`, `size?: "normal" | "double"`, `align?: "left" | "center" | "right"`. Default: normale, sinistra, non grassetto.
- `cut?: boolean` (default `false`): taglio carta dove il driver lo supporta (capability `cut`); ignorato altrimenti.
- `lines` mancante viene trattato come `[]` (stampa vuota), quindi validare lato gestionale.
- Risposte: come `/print` (200 con `PrintResult`, 404/409/503/500).

### 4.6 `POST /print-label` — etichetta prodotto  *(capability: `label`)*

```json
{
  "label": {
    "name": "Tagliatelle al ragù",
    "variant": "porzione grande",
    "price": 8.50,
    "sku": "TAG-001",
    "barcode": "8001234567890"
  },
  "copies": 3,
  "printerId": "labels"
}
```

Validazioni (→ **400** `{ "success": false, "error": "..." }`):

- `label.name` **string** e `label.price` **number** finito sono **obbligatori**.
- `barcode` (opzionale) deve essere **EAN-13**: 13 cifre con checksum valido, **oppure 12 cifre** (il bridge calcola e appende il checksum). Qualsiasi altro formato → 400. Inviarlo come stringa per preservare gli zeri iniziali.
- `copies` (opzionale, default 1): numero ≥ 1; valori > 50 vengono **silenziosamente ridotti a 50**.

Il layout (dimensioni carta, template, barcode on/off) è **configurato nel bridge per stampante**, non inviato dal gestionale.

Risposta **200**:

```json
{
  "success": true,
  "receiptNumber": "", "closureNumber": "", "printerSerial": "",
  "errorMessage": "",
  "copiesRequested": 3,
  "copiesPrinted": 3
}
```

Le copie sono stampate in sequenza: in caso di fallimento parziale si riceve `success: false` con `copiesPrinted` < richieste (anche su HTTP 500 il body include `copiesPrinted`). Il gestionale può quindi ristampare solo le copie mancanti.

### 4.7 `POST /daily-close` — chiusura giornaliera (Z)  *(capability: `daily-close`)*

```json
{ "operatorId": "1", "printerId": "fiscal" }
```

Entrambi i campi opzionali; `operatorId` di default usa quello configurato sulla stampante (fallback `"1"`). Risposta: `PrintResult` / 404 / 409 / 503 / 500. **Operazione irreversibile fiscalmente**: nel gestionale prevedere conferma esplicita dell'utente.

### 4.8 `POST /open-drawer` — apertura cassetto  *(capability: `drawer`)*

```json
{ "operatorId": "1", "printerId": "fiscal" }
```

- **204 No Content** in caso di successo — **body vuoto**, non tentare il parse JSON.
- 404 / 409 / 503 / 500 come sopra (con body JSON di errore).

## 5. `PrintResult` — risposta comune delle stampe

```typescript
interface PrintResult {
  success: boolean
  receiptNumber: string   // numero documento fiscale (vuoto per non-fiscale/etichette)
  closureNumber: string   // numero chiusura (vuoto se non applicabile)
  printerSerial: string   // matricola stampante (vuoto se non disponibile)
  errorMessage: string    // valorizzato se success === false
}
```

Regola d'oro: **HTTP 200 non significa stampato** — fare sempre il check su `success`. Gli errori HTTP (400/404/409/500/503) hanno body `{ success: false, error: string }` (eccetto `/status` che usa `{ error }` e `/open-drawer` 204 senza body).

## 6. Tipi TypeScript per il client del gestionale

```typescript
// ---- richieste ----
interface ReceiptItemReq {
  description: string
  quantity: number
  unitPrice: number      // euro
  vatRate: number        // es. 22, 10, 4, 0 — il bridge mappa il reparto
  department?: number    // solo fallback, normalmente omettere
}
interface ReceiptPaymentReq { description: string; amount: number; paymentType: number }
interface PrintReceiptReq {
  items: ReceiptItemReq[]
  discount: number       // euro, 0 se nessuno sconto
  payments: ReceiptPaymentReq[]
  printerId?: string
}

interface NonFiscalLineReq {
  text: string
  bold?: boolean
  size?: 'normal' | 'double'
  align?: 'left' | 'center' | 'right'
}
interface PrintNonFiscalReq { lines: NonFiscalLineReq[]; cut?: boolean; printerId?: string }

interface LabelReq { name: string; price: number; variant?: string; sku?: string; barcode?: string }
interface PrintLabelReq { label: LabelReq; copies?: number; printerId?: string }

interface OperatorReq { operatorId?: string; printerId?: string }

// ---- risposte ----
interface PrintResult {
  success: boolean
  receiptNumber: string
  closureNumber: string
  printerSerial: string
  errorMessage: string
}
type PrintLabelResult = PrintResult & { copiesRequested: number; copiesPrinted: number }

interface PrinterStatus { online: boolean; paperPresent: boolean; coverClosed: boolean; errorMessage: string }

type Capability = 'fiscal-receipt' | 'non-fiscal' | 'label' | 'daily-close' | 'drawer' | 'cut'
interface PrinterInfo {
  id: string
  label: string
  role: 'fiscal' | 'label' | 'receipt'
  capabilities: Capability[]
  driver: string
  ip: string
  status: PrinterStatus | { online: false; errorMessage: string }
}

interface PingResponse { ok: true; version: string; driver: string; printers: { id: string; driver: string }[] }

interface BridgeError { success?: false; error: string }
```

## 7. Flussi consigliati nel gestionale

1. **Avvio / riconnessione:** `GET /ping` (timeout 2 s). Se ok → `GET /printers`, salvare gli id per capability. Se ko → fallback `EpsonFiscalClient`. Ripetere il ping periodicamente o al primo errore di rete per ri-promuovere il bridge.
2. **Vendita:** `POST /print` con `printerId` fiscale → se `success: false` o HTTP ≥ 400, mostrare `error`/`errorMessage` all'operatore e **non** chiudere la vendita.
3. **Pre-vendita (preconto/comanda):** `POST /print-nonfiscal` con `cut: true`.
4. **Etichette da scheda prodotto:** `POST /print-label`; su fallimento parziale ristampare `copiesRequested − copiesPrinted`.
5. **Fine giornata:** `GET /status` (stampante ok?) → conferma utente → `POST /daily-close`.
6. **Cassetto:** `POST /open-drawer`, trattare 204 come successo.

Gestione errori di rete (fetch rigettata / timeout): trattare come "bridge non disponibile" e proporre retry o fallback — **non** dare per fallita la stampa fiscale senza verificare, perché un timeout lato client può avvenire a stampa già eseguita.

## 8. Garanzie di stabilità e fuori scope

- Il contratto HTTP sopra è considerato **stabile** (vincolo documentato nel repo del bridge: "Keep the HTTP contract stable"). Nuovi campi di risposta potranno essere **aggiunti**; il client deve ignorare campi sconosciuti.
- La **configurazione non è esposta via HTTP**: niente `GET/PUT /config`. Stampanti, layout etichette, deptMapping si gestiscono solo dalla UI locale del bridge.
- `orientation` nel paper config è **riservato** (fase 1: solo portrait di fatto); non c'è alcun controllo lato API.
- Versioni bridge: leggere `version` da `/ping` per eventuale gating di feature future.
